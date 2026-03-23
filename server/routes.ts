// server/routes.ts

import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { api } from "@shared/routes";
import session from "express-session";
import bcrypt from "bcryptjs";
import { maintenanceEvents, equipment, equipmentRiskScores, rentals, equipmentFailurePredictions, equipmentSwaps } from "@shared/schema";
import { eq, desc, asc, count, sql, and, like } from "drizzle-orm";
import { db } from "./db";
import { predictiveMaintenanceService } from './services/predictive-maintenance-fixed';
import { featureEngineeringService } from './services/feature-engineering';
import { assetRiskPredictions } from "@shared/schema";
import { enhancedFeatureService } from "./services/feature-engineering-enhanced";

declare module "express-session" {
  interface SessionData {
    userId: number;
    role: string;
  }
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  // Railway (and most cloud platforms) sit behind a reverse proxy.
  // Without this, Express won't see HTTPS and won't set secure cookies.
  app.set("trust proxy", 1);

  app.use(
    session({
      secret: process.env.SESSION_SECRET || "dev_secret_key",
      resave: false,
      saveUninitialized: false,
      cookie: {
        secure: process.env.NODE_ENV === "production",
        sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
        maxAge: 24 * 60 * 60 * 1000,
      },
    })
  );

  const requireAuth = (req: any, res: any, next: any) => {
    if (!req.session.userId) return res.status(401).json({ message: "Unauthorized" });
    next();
  };

  const requireAdmin = (req: any, res: any, next: any) => {
    if (!req.session.userId || req.session.role !== "ADMINISTRATOR") {
      return res.status(403).json({ message: "Forbidden" });
    }
    next();
  };

  function getDefaultMetrics() {
    return {
      version: 'v1.14',
      trainedAt: new Date().toISOString(),
      datasetSize: 22025,
      accuracy: 0.937,
      precision: { HIGH: 0.98, MEDIUM: 0.92, LOW: 0.85 },
      recall: { HIGH: 0.82, MEDIUM: 0.99, LOW: 0.99 },
      f1Score: { HIGH: 0.89, MEDIUM: 0.96, LOW: 0.92 },
      confusionMatrix: {
        HIGH: { predictedHIGH: 1386, predictedMEDIUM: 0, predictedLOW: 0 },
        MEDIUM: { predictedHIGH: 0, predictedMEDIUM: 3019, predictedLOW: 0 },
        LOW: { predictedHIGH: 0, predictedMEDIUM: 0, predictedLOW: 2767 },
      },
      featureImportance: [
        { feature: 'Equipment Age', importance: 0.21, description: 'Years since manufacture' },
        { feature: 'Maintenance Cost 180d (log)', importance: 0.16, description: 'Log maintenance cost trajectory' },
        { feature: 'Wear Rate Velocity', importance: 0.14, description: 'Rate of change in wear accumulation' },
        { feature: 'Lifetime Hours (log)', importance: 0.12, description: 'Log cumulative operating hours' },
        { feature: 'MTBF (log)', importance: 0.12, description: 'Log mean time between failures' },
      ],
      predictionHistory: [],
      hyperparameters: {
        algorithm: 'Random Forest (calibrated)',
        nEstimators: 200,
        maxDepth: 12,
        minSamplesSplit: 5,
        classWeight: 'balanced',
      },
    };
  }

  // ── SIMULATION CURSOR HELPER ──────────────────────────────────────────────
  async function getSimulationDate(): Promise<Date> {
    const [stateRows] = await db.execute(sql`SELECT cursor_date, total_days_run FROM simulation_state WHERE id = 1`) as any;
    return stateRows[0]?.cursor_date
      ? new Date(stateRows[0].cursor_date)
      : new Date();
  }

  // ── SIMULATION ────────────────────────────────────────────────────────────
  app.get("/api/simulate/state", requireAuth, async (req, res) => {
    try {
      const [state] = await db.execute(sql`SELECT * FROM simulation_state WHERE id = 1`) as any;
      res.json(state[0] || { cursorDate: null, totalDaysRun: 0 });
    } catch (e) {
      res.status(500).json({ message: "Failed to get simulation state" });
    }
  });

  app.post("/api/simulate/day", requireAuth, requireAdmin, async (req, res) => {
    try {
      const days = Math.min(Math.max(parseInt(req.body.days) || 1, 1), 30);

      const equipmentList = await db.select({
        id: equipment.id,
        name: equipment.name,
        category: equipment.category,
        currentMileage: equipment.currentMileage,
        purchaseDate: equipment.purchaseDate,
      }).from(equipment);

      const [stateRows] = await db.execute(sql`SELECT cursor_date, total_days_run FROM simulation_state WHERE id = 1`) as any;
      let cursorDate = stateRows[0]?.cursor_date ? new Date(stateRows[0].cursor_date) : new Date();

      let totalInserted = 0;
      let maintenanceInserted = 0;

      for (let d = 0; d < days; d++) {
        cursorDate = new Date(cursorDate.getTime() + 24 * 3600 * 1000);
        const dateStr = cursorDate.toISOString().split("T")[0];

        for (const equip of equipmentList) {
          const category = equip.category || "Excavator";

          const baseTemp = { Crane: 78, Excavator: 82, Dozer: 85, Loader: 80, Compressor: 70, Generator: 75 }[category] || 80;
          const isStressed = Math.random() < 0.08;
          const isIdle     = Math.random() < 0.15;

          const engineRpm         = isIdle ? 0 : Math.round(1200 + Math.random() * 800 + (isStressed ? 600 : 0));
          const engineTemp        = isIdle ? 20 : Math.round(baseTemp + Math.random() * 15 + (isStressed ? 25 : 0));
          const oilPressure       = isIdle ? 0 : Math.round(35 + Math.random() * 15 - (isStressed ? 8 : 0));
          const coolantTemp       = isIdle ? 20 : Math.round(85 + Math.random() * 10 + (isStressed ? 15 : 0));
          const hydraulicPressure = isIdle ? 0 : Math.round(2000 + Math.random() * 500 + (isStressed ? 300 : 0));
          const hydraulicTemp     = isIdle ? 20 : Math.round(45 + Math.random() * 20 + (isStressed ? 15 : 0));
          const vibrationX        = parseFloat((0.1 + Math.random() * 0.8 + (isStressed ? 1.2 : 0)).toFixed(3));
          const vibrationY        = parseFloat((0.1 + Math.random() * 0.8 + (isStressed ? 1.0 : 0)).toFixed(3));
          const vibrationZ        = parseFloat((0.1 + Math.random() * 0.6 + (isStressed ? 0.8 : 0)).toFixed(3));
          const operatingHours    = isIdle ? 0 : parseFloat((4 + Math.random() * 6).toFixed(2));
          const loadPct           = isIdle ? 0 : Math.round(30 + Math.random() * 60 + (isStressed ? 20 : 0));
          const idleTime          = parseFloat((Math.random() * 2).toFixed(2));
          const fuelConsumption   = isIdle ? 0 : parseFloat((8 + Math.random() * 12 + (isStressed ? 5 : 0)).toFixed(2));
          const ambientTemp       = Math.round(10 + Math.random() * 25);
          const warningCount      = isStressed ? Math.floor(Math.random() * 3) : 0;
          const errorCodes        = isStressed && Math.random() < 0.3 ? `E${Math.floor(100 + Math.random() * 900)}` : null;

          await db.execute(sql`
            INSERT INTO sensor_data_logs
              (equipment_id, timestamp, engine_rpm, engine_temp, oil_pressure, coolant_temp,
              fuel_consumption, hydraulic_pressure, hydraulic_temp, hydraulic_flow_rate,
              vibration_x, vibration_y, vibration_z, operating_hours, load_percentage,
              idle_time, ambient_temp, error_codes, warning_count)
            VALUES (${equip.id}, ${dateStr}, ${engineRpm}, ${engineTemp}, ${oilPressure}, ${coolantTemp},
              ${fuelConsumption}, ${hydraulicPressure}, ${hydraulicTemp}, ${Math.round(hydraulicPressure * 0.8)},
              ${vibrationX}, ${vibrationY}, ${vibrationZ}, ${operatingHours}, ${loadPct},
              ${idleTime}, ${ambientTemp}, ${errorCodes}, ${warningCount})
          `);
          totalInserted++;

          const purchaseDate  = equip.purchaseDate ? new Date(equip.purchaseDate) : new Date('2020-01-01');
          const ageYears      = (cursorDate.getTime() - purchaseDate.getTime()) / (365.25 * 24 * 3600 * 1000);

          const [hoursRow] = await db.execute(sql`
            SELECT COALESCE(SUM(operating_hours), 0) as total_hours
            FROM sensor_data_logs
            WHERE equipment_id = ${equip.id} AND timestamp <= ${dateStr}
          `) as any;
          const totalHours = parseFloat(hoursRow[0]?.total_hours ?? 0);

          const [maintRow] = await db.execute(sql`
            SELECT MAX(maintenance_date) as last_maint
            FROM maintenance_events
            WHERE equipment_id = ${equip.id} AND maintenance_date <= ${dateStr}
          `) as any;
          const lastMaint      = maintRow[0]?.last_maint ? new Date(maintRow[0].last_maint) : purchaseDate;
          const daysSinceMaint = (cursorDate.getTime() - lastMaint.getTime()) / (24 * 3600 * 1000);

          // Weibull-inspired hazard function
          const ageHazard     = Math.min(0.01 * Math.exp(0.55 * Math.max(0, ageYears - 1.5)), 0.25);
          const hoursHazard   = Math.min(0.005 * Math.exp(0.0004 * Math.max(0, totalHours - 3000)), 0.20);
          const neglectHazard = daysSinceMaint > 120
            ? Math.min(0.002 * Math.pow(daysSinceMaint - 90, 1.4), 0.15)
            : 0;

          const dailyFailureProb = Math.min(ageHazard + hoursHazard + neglectHazard, 0.30);
          const finalFailureProb = Math.min(dailyFailureProb * (isStressed ? 1.8 : 1.0), 0.35);

          if (Math.random() < finalFailureProb) {
            const rand = Math.random();
            const type = rand < 0.15 ? "MAJOR_SERVICE" : rand < 0.70 ? "MINOR_SERVICE" : "INSPECTION";
            const cost = type === "MAJOR_SERVICE"
              ? parseFloat((800 + Math.random() * 1200).toFixed(2))
              : type === "MINOR_SERVICE"
              ? parseFloat((150 + Math.random() * 350).toFixed(2))
              : parseFloat((80 + Math.random() * 120).toFixed(2));
            const nextDueDays = type === "MAJOR_SERVICE" ? 180 : type === "MINOR_SERVICE" ? 90 : 60;
            const nextDue     = new Date(cursorDate.getTime() + nextDueDays * 24 * 3600 * 1000).toISOString().split("T")[0];

            await db.execute(sql`
              INSERT INTO maintenance_events
                (equipment_id, maintenance_date, maintenance_type, cost, description, next_due_date)
              VALUES (
                ${equip.id}, ${dateStr}, ${type}, ${cost},
                ${`Simulated ${type.toLowerCase().replace(/_/g, " ")} — age ${ageYears.toFixed(1)}y / ${Math.round(totalHours)}h`},
                ${nextDue}
              )
            `);
            maintenanceInserted++;
          }

          // Fleet renewal
          const shouldRetire =
            ageYears > 10 || (ageYears > 8 && totalHours > 8000);

          if (shouldRetire) {
            const newEquipId = `EQ-R${equip.id}-${cursorDate.getFullYear()}`;
            const existingResult = await db.execute(sql`SELECT id FROM equipment WHERE equipment_id = ${newEquipId}`) as any;
            const existing = existingResult[0];

            if (!existing || existing.length === 0) {
              const newPurchaseDateStr  = dateStr;
              const newYearManufactured = cursorDate.getFullYear();

              await db.execute(sql`
                INSERT INTO equipment
                  (equipment_id, name, category, make, model, serial_number,
                   status, daily_rate, weekly_rate, monthly_rate, location,
                   year_manufactured, purchase_date, current_mileage, initial_mileage)
                SELECT
                  ${newEquipId}, CONCAT('Replacement ', name),
                  category, make, model, CONCAT('SIM-', ${newEquipId}),
                  'AVAILABLE', daily_rate, weekly_rate, monthly_rate, location,
                  ${newYearManufactured}, ${newPurchaseDateStr}, 0, 0
                FROM equipment WHERE id = ${equip.id}
              `);

              await db.execute(sql`
                INSERT INTO maintenance_events
                  (equipment_id, maintenance_date, maintenance_type, cost, description, next_due_date)
                SELECT
                  (SELECT id FROM equipment WHERE equipment_id = ${newEquipId}),
                  ${dateStr}, 'MINOR_SERVICE', 250.00,
                  'Pre-delivery inspection — new unit',
                  DATE_ADD(${dateStr}, INTERVAL 90 DAY)
              `);

              console.log(`[FLEET RENEWAL] Retired equip id=${equip.id} (age=${ageYears.toFixed(1)}y / ${Math.round(totalHours)}h)`);
            }
          }
        }
      }

      const newCursorStr = cursorDate.toISOString().split("T")[0];
      const newTotal = (stateRows[0]?.total_days_run || 0) + days;
      await db.execute(sql`
        UPDATE simulation_state SET cursor_date = ${newCursorStr}, total_days_run = ${newTotal} WHERE id = 1
      `);

      res.json({
        message: `Simulated ${days} day${days > 1 ? "s" : ""} of operations`,
        daysSimulated: days,
        sensorReadings: totalInserted,
        maintenanceEvents: maintenanceInserted,
        cursorDate: newCursorStr,
        totalDaysRun: newTotal,
      });
    } catch (e: any) {
      console.error("[SIMULATE]", e);
      res.status(500).json({ message: "Simulation failed", error: e.message });
    }
  });

  // ── HEALTH ────────────────────────────────────────────────────────────────
  app.get('/api/health', (req, res) => {
    res.json({ status: 'healthy', timestamp: new Date().toISOString() });
  });

  // ── AUTH ──────────────────────────────────────────────────────────────────
  app.post(api.auth.login.path, async (req, res) => {
    const { username, password } = api.auth.login.input.parse(req.body);
    const user = await storage.getUserByUsername(username);
    if (!user || !bcrypt.compareSync(password, user.password)) {
      return res.status(401).json({ message: "Invalid credentials" });
    }
    req.session.userId = user.id;
    req.session.role = user.role;
    res.json(user);
  });

  app.post(api.auth.logout.path, (req, res) => {
    req.session.destroy(() => res.json({ message: "Logged out" }));
  });

  app.get(api.auth.me.path, async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ message: "Not logged in" });
    res.json(await storage.getUser(req.session.userId));
  });

  app.post(api.auth.register.path, async (req, res) => {
    const input = api.auth.register.input.parse(req.body);
    if (await storage.getUserByUsername(input.username)) {
      return res.status(400).json({ message: "Username exists" });
    }
    const user = await storage.createUser({
      ...input,
      password: bcrypt.hashSync(input.password, 10),
    });
    req.session.userId = user.id;
    req.session.role = user.role;
    res.status(201).json(user);
  });

  // ── EQUIPMENT ─────────────────────────────────────────────────────────────
  app.get(api.equipment.list.path, requireAuth, async (req, res) => {
    res.json(await storage.listEquipment(req.query.search as string, req.query.status as string));
  });

  const EQUIPMENT_NULLABLE_FIELDS = [
    'weeklyRate', 'monthlyRate', 'currentMileage', 'initialMileage',
    'purchaseDate', 'make', 'model', 'serialNumber', 'location',
  ] as const;

  function sanitizeEquipmentBody(body: Record<string, any>) {
    const out = { ...body };
    for (const field of EQUIPMENT_NULLABLE_FIELDS) {
      if (out[field] === '') out[field] = null;
    }
    return out;
  }

  app.get('/api/equipment/:id', requireAuth, async (req, res) => {
    const equip = await storage.getEquipment(parseInt(req.params.id));
    if (!equip) return res.status(404).json({ message: "Equipment not found" });
    res.json(equip);
  });

  app.post(api.equipment.create.path, requireAdmin, async (req, res) => {
    res.status(201).json(await storage.createEquipment(api.equipment.create.input.parse(sanitizeEquipmentBody(req.body))));
  });

  app.put('/api/equipment/:id', requireAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const input = api.equipment.update.input.parse(sanitizeEquipmentBody(req.body));
      const equip = await storage.getEquipment(id);
      if (!equip) return res.status(404).json({ message: "Equipment not found" });
      res.json(await storage.updateEquipment(id, input));
    } catch (error) {
      console.error('Update equipment error:', error);
      res.status(400).json({ message: (error instanceof Error ? error.message : String(error)) || 'Failed to update equipment' });
    }
  });

  app.delete('/api/equipment/:id', requireAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const equip = await storage.getEquipment(id);
      if (!equip) return res.status(404).json({ message: "Equipment not found" });
      const [active] = await db.select({ count: count() }).from(rentals).where(and(eq(rentals.equipmentId, id), eq(rentals.status, 'ACTIVE')));
      if (active.count > 0) return res.status(409).json({ message: "Cannot delete equipment with active rentals" });
      await storage.deleteEquipment(id);
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ message: 'Failed to delete equipment' });
    }
  });

  // ── RENTALS ───────────────────────────────────────────────────────────────

  // Generate next PO number for a given year: PO-YYYY-NNNN
  async function generatePoNumber(year: number): Promise<string> {
    const pattern = `PO-${year}-%`;
    const [rows] = await db.execute(sql`
      SELECT MAX(CAST(SUBSTRING_INDEX(po_number, '-', -1) AS UNSIGNED)) AS maxSeq
      FROM rentals
      WHERE po_number LIKE ${pattern}
    `);
    const maxSeq = (rows as unknown as any[])[0]?.maxSeq ?? 0;
    const next = (Number(maxSeq) || 0) + 1;
    return `PO-${year}-${String(next).padStart(4, "0")}`;
  }

  // Preview next PO number (for form auto-population)
  app.get('/api/rentals/next-po', requireAuth, async (req, res) => {
    try {
      const simDate = await getSimulationDate();
      const year = simDate.getFullYear();
      res.json({ poNumber: await generatePoNumber(year) });
    } catch (error) {
      res.status(500).json({ message: 'Failed to generate PO number' });
    }
  });

  // Backfill PO numbers for all rentals that have none (idempotent, admin only)
  app.post('/api/admin/backfill-po', requireAdmin, async (req, res) => {
    try {
      const [untagged] = await db.execute(sql`
        SELECT id, receive_date FROM rentals
        WHERE po_number IS NULL OR po_number = ''
        ORDER BY receive_date ASC, id ASC
      `);
      const rows = untagged as unknown as any[];
      if (rows.length === 0) return res.json({ updated: 0 });

      // Group by year
      const byYear = new Map<number, { id: number }[]>();
      for (const r of rows) {
        const year = r.receive_date
          ? new Date(r.receive_date).getFullYear()
          : new Date().getFullYear();
        if (!byYear.has(year)) byYear.set(year, []);
        byYear.get(year)!.push({ id: r.id });
      }

      let updated = 0;
      for (const [year, items] of Array.from(byYear.entries())) {
        // Find max existing sequence for this year
        const [existing] = await db.execute(sql`
          SELECT MAX(CAST(SUBSTRING_INDEX(po_number, '-', -1) AS UNSIGNED)) AS maxSeq
          FROM rentals WHERE po_number LIKE ${`PO-${year}-%`}
        `);
        let seq = (Number((existing as unknown as any[])[0]?.maxSeq) || 0);
        for (const item of items) {
          seq++;
          const po = `PO-${year}-${String(seq).padStart(4, "0")}`;
          await db.execute(sql`UPDATE rentals SET po_number = ${po} WHERE id = ${item.id}`);
          updated++;
        }
      }
      res.json({ updated });
    } catch (error) {
      res.status(500).json({ message: 'Backfill failed', error: String(error) });
    }
  });

  app.get(api.rentals.list.path, requireAuth, async (req, res) => {
    res.json(await storage.listRentals());
  });

  app.post(api.rentals.create.path, requireAdmin, async (req, res) => {
    const input = api.rentals.create.input.parse(req.body);
    const equip = await storage.getEquipment(input.equipmentId);
    if (!equip || equip.status !== "AVAILABLE") {
      return res.status(400).json({ message: "Equipment unavailable" });
    }
    // Auto-generate PO number if not provided
    if (!input.poNumber) {
      const simDate = await getSimulationDate();
      (input as any).poNumber = await generatePoNumber(simDate.getFullYear());
    }
    const rental = await storage.createRental(input);
    await storage.updateEquipment(input.equipmentId, { status: "RENTED" });
    res.status(201).json(rental);
  });

  app.put('/api/rentals/:id', requireAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const input = api.rentals.update.input.parse(req.body);
      const rental = await storage.getRental(id);
      if (!rental) return res.status(404).json({ message: "Rental not found" });
      res.json(await storage.updateRental(id, input));
    } catch (error) {
      console.error('Update rental error:', error);
      res.status(400).json({ message: (error instanceof Error ? error.message : String(error)) || 'Failed to update rental' });
    }
  });

  app.get('/api/rentals/:id', requireAuth, async (req, res) => {
    const rental = await storage.getRental(parseInt(req.params.id));
    if (!rental) return res.status(404).json({ message: "Rental not found" });
    res.json(rental);
  });

  app.post(api.rentals.complete.path, requireAdmin, async (req, res) => {
    const rental = await storage.getRental(parseInt(req.params.id));
    if (!rental) return res.status(404).json({ message: "Rental not found" });
    const cursor = await getSimulationDate();
    const returnDate = cursor.toISOString().split('T')[0];
    await storage.updateRental(rental.id, { status: "COMPLETED", returnDate });

    // Mileage = round-trip transport + daily on-site accumulation
    // Daily rate varies by category: mobile equipment (skid steers, backhoes) racks up
    // more miles per day than cranes which are mostly stationary once erected.
    const DAILY_MILES: Record<string, number> = {
      "Skid Steer": 14,
      "Backhoe":    11,
      "Excavator":   9,
      "Crane":       4,
    };
    const distanceMiles = parseFloat(rental.jobSite?.distanceMiles ?? "25");
    const receiveDate = new Date(rental.receiveDate);
    const rentalDays = Math.max(1, Math.round((cursor.getTime() - receiveDate.getTime()) / 86400000));
    const category = rental.equipment?.category ?? "";
    const dailyRate = DAILY_MILES[category] ?? 8;
    const mileageAdded = parseFloat(((distanceMiles * 2) + (rentalDays * dailyRate)).toFixed(1));
    const current = parseFloat(rental.equipment?.currentMileage ?? "0");
    await storage.updateEquipment(rental.equipmentId, {
      status: "AVAILABLE",
      currentMileage: (current + mileageAdded).toFixed(1),
    });

    res.json({ message: "Rental completed successfully" });
  });

  // ── INVOICES ─────────────────────────────────────────────────────────────
  app.post('/api/invoices', requireAdmin, async (req, res) => {
    try {
      const { rentalId, periodFrom, periodTo, amount, invoiceNumber } = req.body;
      if (!rentalId || !periodFrom || !periodTo || amount == null || !invoiceNumber) {
        return res.status(400).json({ message: 'Missing required invoice fields' });
      }
      const rental = await storage.getRental(rentalId);
      if (!rental) return res.status(404).json({ message: 'Rental not found' });
      if (rental.invoices?.length) {
        return res.status(409).json({ message: 'Invoice already exists for this rental' });
      }
      const cursor = await getSimulationDate();
      const invoiceDate = cursor.toISOString().split('T')[0];
      const invoice = await storage.createInvoice({ rentalId, invoiceDate: new Date(invoiceDate), periodFrom, periodTo, amount: String(amount), invoiceNumber });
      res.status(201).json(invoice);
    } catch (e: any) {
      res.status(500).json({ message: 'Failed to create invoice', error: e.message });
    }
  });

  app.delete('/api/rentals/:id', requireAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const rental = await storage.getRental(id);
      if (!rental) return res.status(404).json({ message: "Rental not found" });
      if (rental.status === 'ACTIVE') {
        return res.status(409).json({ message: "Cannot delete an active rental. Complete or cancel it first." });
      }
      await storage.deleteRental(id);
      res.json({ message: "Rental deleted successfully" });
    } catch (error) {
      res.status(500).json({ message: 'Failed to delete rental' });
    }
  });

  // ── JOB SITES ─────────────────────────────────────────────────────────────
  app.get(api.jobSites.list.path, requireAuth, async (req, res) => {
    try {
      const sites = await storage.listJobSites();
      const sitesWithCounts = await Promise.all(sites.map(async (site) => {
        const [result] = await db.select({ count: count() }).from(rentals).where(eq(rentals.jobSiteId, site.id));
        return { ...site, _count: { rentals: result?.count || 0 } };
      }));
      res.json(sitesWithCounts);
    } catch (error) {
      res.status(500).json({ message: 'Failed to fetch job sites' });
    }
  });

  app.get('/api/job-sites/:id', requireAuth, async (req, res) => {
    try {
      const site = await storage.getJobSite(parseInt(req.params.id));
      if (!site) return res.status(404).json({ message: "Job site not found" });
      res.json(site);
    } catch (error) {
      res.status(500).json({ message: 'Failed to fetch job site' });
    }
  });

  app.post(api.jobSites.create.path, requireAdmin, async (req, res) => {
    try {
      res.status(201).json(await storage.createJobSite(api.jobSites.create.input.parse(req.body)));
    } catch (error) {
      res.status(400).json({ message: (error instanceof Error ? error.message : String(error)) || 'Failed to create job site' });
    }
  });

  app.patch('/api/job-sites/:id', requireAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const site = await storage.getJobSite(id);
      if (!site) return res.status(404).json({ message: "Job site not found" });
      res.json(await storage.updateJobSite(id, api.jobSites.update.input.parse(req.body)));
    } catch (error) {
      res.status(400).json({ message: (error instanceof Error ? error.message : String(error)) || 'Failed to update job site' });
    }
  });

  app.delete('/api/job-sites/:id', requireAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const [result] = await db.select({ count: count() }).from(rentals).where(eq(rentals.jobSiteId, id));
      if (result.count > 0) return res.status(409).json({ message: "Cannot delete job site with associated rentals" });
      await storage.deleteJobSite(id);
      res.json({ message: "Job site deleted successfully" });
    } catch (error) {
      res.status(500).json({ message: 'Failed to delete job site' });
    }
  });

  // ── VENDORS ───────────────────────────────────────────────────────────────
  app.get(api.vendors.list.path, requireAuth, async (req, res) => {
    try {
      const vendors = await storage.listVendors();
      const vendorsWithCounts = await Promise.all(vendors.map(async (vendor) => {
        const [result] = await db.select({ count: count() }).from(rentals).where(eq(rentals.vendorId, vendor.id));
        return { ...vendor, _count: { rentals: result?.count || 0 } };
      }));
      res.json(vendorsWithCounts);
    } catch (error) {
      res.status(500).json({ message: 'Failed to fetch vendors' });
    }
  });

  app.get('/api/vendors/:id', requireAuth, async (req, res) => {
    try {
      const vendor = await storage.getVendor(parseInt(req.params.id));
      if (!vendor) return res.status(404).json({ message: "Vendor not found" });
      res.json(vendor);
    } catch (error) {
      res.status(500).json({ message: 'Failed to fetch vendor' });
    }
  });

  app.post(api.vendors.create.path, requireAdmin, async (req, res) => {
    try {
      res.status(201).json(await storage.createVendor(api.vendors.create.input.parse(req.body)));
    } catch (error) {
      res.status(400).json({ message: (error instanceof Error ? error.message : String(error)) || 'Failed to create vendor' });
    }
  });

  app.patch('/api/vendors/:id', requireAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const vendor = await storage.getVendor(id);
      if (!vendor) return res.status(404).json({ message: "Vendor not found" });
      res.json(await storage.updateVendor(id, api.vendors.update.input.parse(req.body)));
    } catch (error) {
      res.status(400).json({ message: (error instanceof Error ? error.message : String(error)) || 'Failed to update vendor' });
    }
  });

  app.delete('/api/vendors/:id', requireAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const [result] = await db.select({ count: count() }).from(rentals).where(eq(rentals.vendorId, id));
      if (result.count > 0) return res.status(409).json({ message: "Cannot delete vendor with associated rentals" });
      await storage.deleteVendor(id);
      res.json({ message: "Vendor deleted successfully" });
    } catch (error) {
      res.status(500).json({ message: 'Failed to delete vendor' });
    }
  });

  // ── MAINTENANCE ───────────────────────────────────────────────────────────
  app.get('/api/maintenance', requireAuth, async (req, res) => {
    try {
      const { equipmentId, limit: limitStr, offset: offsetStr, sortBy, sortDir } = req.query;
      const limit  = Math.min(Math.max(1, parseInt(limitStr  as string || '10', 10)), 500);
      const offset = Math.max(0, parseInt(offsetStr as string || '0', 10));
      const condition = equipmentId
        ? eq(maintenanceEvents.equipmentId, parseInt(equipmentId as string))
        : undefined;

      const colMap: Record<string, any> = {
        maintenanceDate: maintenanceEvents.maintenanceDate,
        maintenanceType: maintenanceEvents.maintenanceType,
        cost:            maintenanceEvents.cost,
        nextDueDate:     maintenanceEvents.nextDueDate,
        eventSource:     maintenanceEvents.eventSource,
        performedBy:     maintenanceEvents.performedBy,
      };
      const col = colMap[sortBy as string] ?? maintenanceEvents.maintenanceDate;
      const orderFn = (sortDir as string) === 'asc' ? asc : desc;

      const [countRows, events] = await Promise.all([
        db.select({ total: count() }).from(maintenanceEvents).where(condition),
        db.select().from(maintenanceEvents)
          .where(condition)
          .orderBy(orderFn(col))
          .limit(limit)
          .offset(offset),
      ]);

      res.json({ events, total: countRows[0].total, limit, offset });
    } catch (error) {
      res.status(500).json({ message: 'Failed to fetch maintenance events' });
    }
  });

  app.post('/api/maintenance', requireAdmin, async (req, res) => {
    try {
      const input = req.body;

      // Auto-calculate nextDueDate from simulation cursor when not provided
      if (!input.nextDueDate) {
        const simDate = await getSimulationDate();
        const intervals: Record<string, number> = {
          MAJOR_SERVICE: 180,
          MINOR_SERVICE: 90,
          INSPECTION: 60,
        };
        const days = intervals[input.maintenanceType] ?? 90;
        const base = new Date(input.maintenanceDate || simDate);
        base.setDate(base.getDate() + days);
        input.nextDueDate = base.toISOString().split('T')[0];
      }

      const event = await storage.createMaintenanceEvent(input);

      // Non-blocking multi-horizon rescore — fires after response is sent
      setImmediate(async () => {
        try {
          const snapshotDate = await getSimulationDate();
          const snapshot = await enhancedFeatureService.generateSnapshot(input.equipmentId, snapshotDate);
          const payload = {
            equipment_id:                input.equipmentId,
            asset_age_years:             snapshot.assetAgeYears,
            category:                    snapshot.category,
            total_hours_lifetime:        snapshot.totalHoursLifetime,
            hours_used_30d:              snapshot.hoursUsed30d,
            hours_used_90d:              snapshot.hoursUsed90d,
            rental_days_30d:             Math.round(snapshot.rentalDays30d),
            rental_days_90d:             Math.round(snapshot.rentalDays90d),
            avg_rental_duration:         snapshot.avgRentalDuration,
            maintenance_events_90d:      snapshot.maintenanceEvents90d,
            maintenance_cost_180d:       snapshot.maintenanceCost180d,
            avg_downtime_per_event:      snapshot.avgDowntimePerEvent,
            days_since_last_maintenance: Math.max(0, snapshot.daysSinceLastMaintenance ?? 0),
            mean_time_between_failures:  snapshot.meanTimeBetweenFailures ?? 999,
            vendor_reliability_score:    snapshot.vendorReliabilityScore,
            jobsite_risk_score:          snapshot.jobSiteRiskScore,
            usage_intensity:             Math.min(snapshot.usageIntensity, 12),
            usage_trend:                 Math.min(Math.max(snapshot.usageTrend, 0.5), 3.0),
            utilization_vs_expected:     snapshot.utilizationVsExpected,
            wear_rate:                   snapshot.wearRate,
            aging_factor:                Math.min(snapshot.agingFactor, 1.0),
            maint_overdue:               snapshot.maintOverdue,
            cost_per_event:              snapshot.costPerEvent,
            maint_burden:                snapshot.maintBurden,
            mechanical_wear_score:       Math.min(snapshot.mechanicalWearScore, 10),
            abuse_score:                 Math.min(snapshot.abuseScore, 10),
            neglect_score:               Math.min(Math.max(0, snapshot.neglectScore), 10),
            maint_frequency_trend:       snapshot.maintFrequencyTrend ?? 1.0,
            cost_trend:                  snapshot.costTrend ?? 1.0,
            hours_velocity:              snapshot.hoursVelocity ?? 1.0,
            neglect_acceleration:        snapshot.neglectAcceleration ?? 1.0,
            sensor_degradation_rate:     snapshot.sensorDegradationRate ?? 0,
          };

          const fastapiRes = await fetch('http://localhost:8000/predict/multi-horizon', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });

          if (fastapiRes.ok) {
            const pred = await fastapiRes.json();
            const p = pred.predictions;
            await db.insert(equipmentFailurePredictions).values({
              equipmentId:    input.equipmentId,
              modelVersion:   pred.model_version,
              riskTrend:      pred.risk_trend,
              prob10d:        p['10d'].failure_probability.toString(),
              riskLevel10d:   p['10d'].risk_level,
              prob30d:        p['30d'].failure_probability.toString(),
              riskLevel30d:   p['30d'].risk_level,
              prob60d:        p['60d'].failure_probability.toString(),
              riskLevel60d:   p['60d'].risk_level,
              topDrivers10d:  JSON.stringify(Object.keys(p['10d'].top_risk_drivers || {})),
              topDrivers30d:  JSON.stringify(Object.keys(p['30d'].top_risk_drivers || {})),
              topDrivers60d:  JSON.stringify(Object.keys(p['60d'].top_risk_drivers || {})),
              recommendation: pred.recommendation,
            });
            console.log(`[MAINTENANCE] Risk rescore complete for EQ-${input.equipmentId}`);
          }
        } catch (e) {
          console.warn(`[MAINTENANCE] Risk rescore failed for EQ-${input.equipmentId}:`, e);
        }
      });

      res.status(201).json(event);
    } catch (error) {
      console.error('Create maintenance error:', error);
      res.status(400).json({ message: (error instanceof Error ? error.message : String(error)) || 'Failed to create maintenance event' });
    }
  });

  app.put('/api/maintenance/:id', requireAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: 'Invalid maintenance event ID' });
      const updated = await storage.updateMaintenanceEvent(id, req.body);
      res.json(updated);
    } catch (error) {
      res.status(400).json({ message: (error instanceof Error ? error.message : String(error)) || 'Failed to update maintenance event' });
    }
  });

  app.delete('/api/maintenance/:id', requireAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: 'Invalid maintenance event ID' });
      await storage.deleteMaintenanceEvent(id);
      res.status(204).send();
    } catch (error) {
      res.status(400).json({ message: (error instanceof Error ? error.message : String(error)) || 'Failed to delete maintenance event' });
    }
  });

  app.get('/api/maintenance/equipment/:id', requireAuth, async (req, res) => {
    try {
      res.json(await storage.getMaintenanceHistory(parseInt(req.params.id)));
    } catch (error) {
      res.status(500).json({ message: 'Failed to fetch maintenance history' });
    }
  });

  // ── RISK SCORING — multi-horizon ──────────────────────────────────────────
  app.post('/api/risk-score/multi-horizon/batch', requireAuth, async (req, res) => {
    try {
      const { equipmentIds } = api.riskScore.batch.input.parse(req.body);

      const [stateRows] = await db.execute(sql`SELECT cursor_date FROM simulation_state WHERE id = 1`) as any;
      const snapshotDate = stateRows[0]?.cursor_date ? new Date(stateRows[0].cursor_date) : new Date();
      console.log(`[MH-BATCH] Using snapshot date: ${snapshotDate.toISOString().split('T')[0]}`);

      const snapshots = await Promise.all(equipmentIds.map(async (id: number) => {
        try {
          return { equipmentId: id, snapshot: await enhancedFeatureService.generateSnapshot(id, snapshotDate) };
        } catch (err) {
          console.error(`[MH-BATCH] Failed snapshot for EQ-${id}:`, err);
          return null;
        }
      }));

      const validSnapshots = snapshots.filter(Boolean) as { equipmentId: number; snapshot: any }[];
      const manualResults: any[] = [];
      const snapshotsToScore: any[] = [];
      const indicesToScore: number[] = [];

      for (let i = 0; i < validSnapshots.length; i++) {
        const { equipmentId: eqId, snapshot } = validSnapshots[i];

        if (snapshot.assetAgeYears < 1 && snapshot.totalHoursLifetime < 500) {
          manualResults.push({
            equipmentId: eqId,
            modelVersion: 'v1.14',
            riskTrend: 'STABLE',
            predictions: {
              '10d': { failure_probability: 0.05, risk_level: 'LOW', risk_score: 5, model_confidence: 'high', top_risk_drivers: { 'New unit — minimal hours': 0.01 } },
              '30d': { failure_probability: 0.05, risk_level: 'LOW', risk_score: 5, model_confidence: 'high', top_risk_drivers: { 'Recent inspection completed': 0.01 } },
              '60d': { failure_probability: 0.05, risk_level: 'LOW', risk_score: 5, model_confidence: 'high', top_risk_drivers: { 'Low operational age': 0.01 } },
            },
            recommendation: 'New unit within safe operating parameters. Continue standard inspection schedule.',
          });
        } else {
          snapshotsToScore.push({
            equipment_id:                eqId,
            asset_age_years:             snapshot.assetAgeYears,
            category:                    snapshot.category,
            total_hours_lifetime:        snapshot.totalHoursLifetime,
            hours_used_30d:              snapshot.hoursUsed30d,
            hours_used_90d:              snapshot.hoursUsed90d,
            rental_days_30d:             Math.round(snapshot.rentalDays30d),
            rental_days_90d:             Math.round(snapshot.rentalDays90d),
            avg_rental_duration:         snapshot.avgRentalDuration,
            maintenance_events_90d:      snapshot.maintenanceEvents90d,
            maintenance_cost_180d:       snapshot.maintenanceCost180d,
            avg_downtime_per_event:      snapshot.avgDowntimePerEvent,
            days_since_last_maintenance: Math.max(0, snapshot.daysSinceLastMaintenance ?? 999),
            mean_time_between_failures:  snapshot.meanTimeBetweenFailures ?? 999,
            vendor_reliability_score:    snapshot.vendorReliabilityScore,
            jobsite_risk_score:          snapshot.jobSiteRiskScore,
            usage_intensity:             Math.min(snapshot.usageIntensity, 12),
            usage_trend:                 Math.min(Math.max(snapshot.usageTrend, 0.5), 3.0),
            utilization_vs_expected:     snapshot.utilizationVsExpected,
            wear_rate:                   snapshot.wearRate,
            aging_factor:                Math.min(snapshot.agingFactor, 1.0),
            maint_overdue:               snapshot.maintOverdue,
            cost_per_event:              snapshot.costPerEvent,
            maint_burden:                snapshot.maintBurden,
            mechanical_wear_score:       Math.min(snapshot.mechanicalWearScore, 10),
            abuse_score:                 Math.min(snapshot.abuseScore, 10),
            neglect_score:               Math.min(Math.max(0, snapshot.neglectScore), 10),
            wear_rate_velocity:          snapshot.wearRateVelocity ?? 0,
            maint_frequency_trend:       snapshot.maintFrequencyTrend ?? 1.0,
            cost_trend:                  snapshot.costTrend ?? 1.0,
            hours_velocity:              snapshot.hoursVelocity ?? 1.0,
            neglect_acceleration:        snapshot.neglectAcceleration ?? 1.0,
            sensor_degradation_rate:     snapshot.sensorDegradationRate ?? 0,
          });
          indicesToScore.push(i);
        }
      }

      const fastapiRes = await fetch('http://localhost:8000/predict/multi-horizon/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ snapshots: snapshotsToScore }),
      });

      if (!fastapiRes.ok) throw new Error(`FastAPI multi-horizon error: ${await fastapiRes.text()}`);

      const batchOutput = await fastapiRes.json();
      const fastapiResults = batchOutput.predictions.map((pred: any, idx: number) => ({
        equipmentId:    validSnapshots[indicesToScore[idx]].equipmentId,
        modelVersion:   pred.model_version,
        riskTrend:      pred.risk_trend,
        predictions:    pred.predictions,
        recommendation: pred.recommendation,
      }));

      const results = [...fastapiResults, ...manualResults];

      for (const result of results) {
        const p = result.predictions;
        await db.insert(equipmentFailurePredictions).values({
          equipmentId:    result.equipmentId,
          modelVersion:   result.modelVersion,
          riskTrend:      result.riskTrend,
          prob10d:        p['10d'].failure_probability.toString(),
          riskLevel10d:   p['10d'].risk_level,
          prob30d:        p['30d'].failure_probability.toString(),
          riskLevel30d:   p['30d'].risk_level,
          prob60d:        p['60d'].failure_probability.toString(),
          riskLevel60d:   p['60d'].risk_level,
          topDrivers10d:  JSON.stringify(Object.keys(p['10d'].top_risk_drivers || {})),
          topDrivers30d:  JSON.stringify(Object.keys(p['30d'].top_risk_drivers || {})),
          topDrivers60d:  JSON.stringify(Object.keys(p['60d'].top_risk_drivers || {})),
          recommendation: result.recommendation,
        });
      }

      res.json(results);
    } catch (error) {
      console.error('Multi-horizon batch error:', error);
      res.status(500).json({ message: 'Failed to calculate multi-horizon predictions' });
    }
  });

  app.get('/api/risk-score/multi-horizon/latest', requireAuth, async (req, res) => {
    try {
      const [stateRows] = await db.execute(sql`SELECT cursor_date FROM simulation_state WHERE id = 1`) as any;
      const cursorStr: string = stateRows[0]?.cursor_date
        ? String(stateRows[0].cursor_date).substring(0, 10)
        : new Date().toISOString().split('T')[0];

      const [predRows] = await db.execute(sql`
        SELECT efp.*, e.name, e.equipment_id as equipment_code, e.category, e.status
        FROM equipment_failure_predictions efp
        JOIN equipment e ON e.id = efp.equipment_id
        WHERE efp.id IN (
          SELECT MAX(id) FROM equipment_failure_predictions GROUP BY equipment_id
        )
        ORDER BY efp.prob_30d DESC
      `) as any;

      const rows: any[] = predRows || [];
      if (rows.length === 0) { res.json([]); return; }

      // Get the BEST maintenance type logged by a user in the last 24h per equipment,
      // within 30 sim-days of the cursor.  Using the best type (not just most recent)
      // prevents oscillation when someone logs MINOR after MAJOR — the stronger
      // MAJOR discount sticks for the rest of the session window.
      const [maintRows] = await db.execute(sql`
        SELECT
          equipment_id,
          CASE MAX(CASE maintenance_type
                WHEN 'MAJOR_SERVICE' THEN 3
                WHEN 'MINOR_SERVICE' THEN 2
                ELSE 1
               END)
            WHEN 3 THEN 'MAJOR_SERVICE'
            WHEN 2 THEN 'MINOR_SERVICE'
            ELSE 'INSPECTION'
          END AS best_type,
          MIN(DATEDIFF(${cursorStr}, maintenance_date)) AS days_since
        FROM maintenance_events
        WHERE created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
          AND DATEDIFF(${cursorStr}, maintenance_date) BETWEEN 0 AND 30
        GROUP BY equipment_id
      `) as any;

      const maintMap = new Map<number, { type: string; days: number }>();
      for (const m of (maintRows || [])) {
        maintMap.set(Number(m.equipment_id), { type: m.best_type, days: Number(m.days_since) });
      }

      // Post-maintenance discount: reduce displayed probability to reflect that
      // the maintenance event addresses neglect/scheduling risk.  Physical wear
      // factors (age, hours) are unchanged, so we apply a partial reduction only.
      const HIGH = 0.60, MED = 0.30;
      const FACTORS: Record<string, number> = {
        MAJOR_SERVICE: 0.75,
        MINOR_SERVICE: 0.87,
        INSPECTION:    0.95,
      };
      const band = (p: number) => p >= HIGH ? 'HIGH' : p >= MED ? 'MEDIUM' : 'LOW';

      const result = rows.map((row: any) => {
        const maint = maintMap.get(Number(row.equipment_id));

        // Always enforce cumulative-probability monotonicity: P(fail≤10d) ≤ P(fail≤30d) ≤ P(fail≤60d)
        // Stale DB rows may violate this if they were stored before monotonicity enforcement was added.
        if (!maint) {
          const p10 = parseFloat(row.prob_10d);
          const p30 = Math.max(parseFloat(row.prob_30d), p10);
          const p60 = Math.max(parseFloat(row.prob_60d), p30);
          return {
            ...row,
            prob_10d:       p10.toFixed(4),
            prob_30d:       p30.toFixed(4),
            prob_60d:       p60.toFixed(4),
            risk_level_10d: band(p10),
            risk_level_30d: band(p30),
            risk_level_60d: band(p60),
            days_since_last_maint: null,
          };
        }

        const f = FACTORS[maint.type] ?? 1.0;
        const p10 = Math.max(0, parseFloat(row.prob_10d) * f);
        const p30 = Math.max(Math.max(0, parseFloat(row.prob_30d) * f), p10);
        const p60 = Math.max(Math.max(0, parseFloat(row.prob_60d) * f), p30);
        return {
          ...row,
          prob_10d:       p10.toFixed(4),
          prob_30d:       p30.toFixed(4),
          prob_60d:       p60.toFixed(4),
          risk_level_10d: band(p10),
          risk_level_30d: band(p30),
          risk_level_60d: band(p60),
          days_since_last_maint: maint.days,
        };
      });

      res.json(result);
    } catch (error) {
      res.status(500).json({ message: 'Failed to fetch latest predictions' });
    }
  });

  // ── PREDICTION FEEDBACK LOOP ──────────────────────────────────────────────
  // Measures model effectiveness: of assets flagged HIGH risk (30d horizon)
  // in the last 90 days, what % had a PREDICTIVE_INTERVENTION maintenance event
  // within 30 days of the prediction?
  app.get('/api/analytics/feedback-loop', requireAuth, async (req, res) => {
    try {
      // Distinct equipment flagged HIGH (30d) in last 90 days + their first prediction date
      const [flaggedRows] = await db.execute(sql`
        SELECT equipment_id, MIN(predicted_at) AS first_flagged_at
        FROM equipment_failure_predictions
        WHERE risk_level_30d = 'HIGH'
          AND predicted_at >= DATE_SUB(NOW(), INTERVAL 90 DAY)
        GROUP BY equipment_id
      `) as any;

      const flagged: Array<{ equipment_id: number; first_flagged_at: string }> = flaggedRows || [];
      const totalFlagged = flagged.length;

      if (totalFlagged === 0) {
        res.json({ totalFlagged: 0, actedOn: 0, rate: 0, windowDays: 30, lookbackDays: 90 });
        return;
      }

      // For each flagged equipment, check for a PREDICTIVE_INTERVENTION event
      // within 30 days of its first HIGH prediction
      const [actionRows] = await db.execute(sql`
        SELECT DISTINCT me.equipment_id
        FROM maintenance_events me
        JOIN (
          SELECT equipment_id, MIN(predicted_at) AS first_flagged_at
          FROM equipment_failure_predictions
          WHERE risk_level_30d = 'HIGH'
            AND predicted_at >= DATE_SUB(NOW(), INTERVAL 90 DAY)
          GROUP BY equipment_id
        ) fp ON me.equipment_id = fp.equipment_id
        WHERE me.event_source = 'PREDICTIVE_INTERVENTION'
          AND me.maintenance_date >= DATE(fp.first_flagged_at)
          AND DATEDIFF(me.maintenance_date, DATE(fp.first_flagged_at)) <= 30
      `) as any;

      const actedOn = (actionRows || []).length;
      const rate = Math.round((actedOn / totalFlagged) * 100);

      // Total PREDICTIVE_INTERVENTION events in the lookback window (any risk level)
      const [totalIntervRows] = await db.execute(sql`
        SELECT COUNT(*) AS cnt
        FROM maintenance_events
        WHERE event_source = 'PREDICTIVE_INTERVENTION'
          AND created_at >= DATE_SUB(NOW(), INTERVAL 90 DAY)
      `) as any;

      res.json({
        totalFlagged,
        actedOn,
        rate,
        totalPredictiveInterventions: Number((totalIntervRows as any[])[0]?.cnt ?? 0),
        windowDays: 30,
        lookbackDays: 90,
      });
    } catch (error) {
      res.status(500).json({ message: 'Failed to compute feedback loop metrics' });
    }
  });

  // ── PREDICTIVE MAINTENANCE ────────────────────────────────────────────────
  app.get('/api/equipment/:id/risk', requireAuth, async (req, res) => {
    try {
      const equipmentId = parseInt(req.params.id);
      let prediction = await predictiveMaintenanceService.getLatestPrediction(equipmentId);
      if (!prediction) prediction = await predictiveMaintenanceService.predictRisk(equipmentId);
      res.json(prediction);
    } catch (error) {
      res.status(500).json({ message: 'Failed to get risk prediction' });
    }
  });

  app.post('/api/predictive-maintenance/predict-all', requireAdmin, async (req, res) => {
    try {
      const predictions = await predictiveMaintenanceService.predictAllEquipment();
      res.json({ message: `Generated ${predictions.length} predictions`, count: predictions.length, predictions });
    } catch (error) {
      res.status(500).json({ message: 'Failed to run batch predictions' });
    }
  });

  app.get('/api/predictive-maintenance/fleet-risk', requireAuth, async (req, res) => {
    try {
      res.json(await predictiveMaintenanceService.getFleetRiskDistribution());
    } catch (error) {
      res.status(500).json({ message: 'Failed to get fleet risk distribution' });
    }
  });

  app.post('/api/predictive-maintenance/generate-snapshots', requireAdmin, async (req, res) => {
    try {
      if (req.body.snapshotDate) {
        const snapshotDate = new Date(req.body.snapshotDate);
        const snapshots = await featureEngineeringService.generateSnapshotsForAllEquipment(snapshotDate);
        for (const snapshot of snapshots) await featureEngineeringService.saveSnapshot(snapshot);
        return res.json({ message: `Generated ${snapshots.length} feature snapshots`, count: snapshots.length });
      }

      const SNAPSHOT_INTERVAL_DAYS = 7;
      const [rangeRow] = await db.execute(sql`SELECT MIN(DATE(timestamp)) as earliest, MAX(DATE(timestamp)) as latest FROM sensor_data_logs`) as any;
      const earliest = rangeRow[0]?.earliest ? new Date(rangeRow[0].earliest) : new Date('2024-01-01');
      const latest = await getSimulationDate();

      const [existingRows] = await db.execute(sql`SELECT DISTINCT DATE(snapshot_ts) as snap_date FROM asset_feature_snapshots`) as any;
      const existingDates = new Set((existingRows as any[]).map((r: any) => new Date(r.snap_date).toISOString().split('T')[0]));

      const datesToProcess: Date[] = [];
      const cursor = new Date(earliest);
      cursor.setDate(cursor.getDate() + 180);
      while (cursor <= latest) {
        const dateStr = cursor.toISOString().split('T')[0];
        if (!existingDates.has(dateStr)) datesToProcess.push(new Date(cursor));
        cursor.setDate(cursor.getDate() + SNAPSHOT_INTERVAL_DAYS);
      }

      console.log(`[BACKFILL] ${datesToProcess.length} dates to process`);

      const BATCH_SIZE = 10;
      let totalGenerated = 0;
      let totalFailed = 0;

      for (let i = 0; i < datesToProcess.length; i += BATCH_SIZE) {
        await Promise.all(datesToProcess.slice(i, i + BATCH_SIZE).map(async (snapshotDate) => {
          try {
            const snapshots = await featureEngineeringService.generateSnapshotsForAllEquipment(snapshotDate);
            for (const snapshot of snapshots) await featureEngineeringService.saveSnapshot(snapshot);
            totalGenerated += snapshots.length;
          } catch (err) {
            totalFailed++;
          }
        }));
        if ((i / BATCH_SIZE) % 5 === 0) console.log(`[BACKFILL] Progress: ${Math.min(i + BATCH_SIZE, datesToProcess.length)}/${datesToProcess.length}`);
      }

      res.json({ message: 'Historical backfill complete', count: totalGenerated, datesProcessed: datesToProcess.length, failed: totalFailed });
    } catch (error) {
      res.status(500).json({ message: 'Failed to generate snapshots' });
    }
  });

  app.post('/api/predictive-maintenance/label-snapshots', requireAdmin, async (req, res) => {
    try {
      const labeled = await featureEngineeringService.labelSnapshots();
      res.json({ message: `Labeled ${labeled} historical snapshots`, count: labeled });
    } catch (error) {
      res.status(500).json({ message: 'Failed to label snapshots' });
    }
  });

  app.get('/api/predictive-maintenance/equipment-with-risk', requireAuth, async (req, res) => {
    try {
      const allEquipment = await db.select().from(equipment);
      const equipmentWithRisk = await Promise.all(allEquipment.map(async (equip) => {
        const prediction = await predictiveMaintenanceService.getLatestPrediction(equip.id);
        return { ...equip, risk: prediction ? { riskBand: prediction.riskBand, failureProbability: prediction.failureProbability, recommendation: prediction.recommendation, predictedAt: prediction.snapshotTs, topDrivers: prediction.topDrivers } : null };
      }));
      res.json(equipmentWithRisk);
    } catch (error) {
      res.status(500).json({ message: 'Failed to get equipment with risk' });
    }
  });

  // ── ML METRICS ────────────────────────────────────────────────────────────
  app.get('/api/ml/model-metrics', requireAuth, async (req, res) => {
    try {
      const { modelTrainingMetrics, assetRiskPredictions } = await import('@shared/schema');
      const [latestMetrics] = await db.select().from(modelTrainingMetrics).orderBy(desc(modelTrainingMetrics.trainedAt)).limit(1);

      if (!latestMetrics) return res.json(getDefaultMetrics());

      const predictionHistory = await db.execute(sql`
        SELECT DATE_FORMAT(predicted_at, '%Y-%m') as month, COUNT(*) as total,
          SUM(CASE WHEN risk_band = 'HIGH' THEN 1 ELSE 0 END) as high,
          SUM(CASE WHEN risk_band = 'MEDIUM' THEN 1 ELSE 0 END) as medium,
          SUM(CASE WHEN risk_band = 'LOW' THEN 1 ELSE 0 END) as low
        FROM asset_risk_predictions
        GROUP BY DATE_FORMAT(predicted_at, '%Y-%m') ORDER BY month DESC LIMIT 12
      `);

      let featureImportance: { feature: string; importance: number; description: string }[] = [];
      try {
        const fs = await import('fs');
        const path = await import('path');
        const registryPath = path.join(process.cwd(), 'ml-service', 'registry');
        const files = fs.readdirSync(registryPath).filter((f: string) => f.startsWith('feature_importance_'));
        if (files.length > 0) {
          const latest = files.sort().reverse()[0];
          const raw = JSON.parse(fs.readFileSync(path.join(registryPath, latest), 'utf-8'));
          const featureLabels: Record<string, string> = {
            asset_age_years: 'Equipment Age', log_maintenance_cost_180d: 'Maintenance Cost 180d (log)',
            wear_rate_velocity: 'Wear Rate Velocity', log_total_hours_lifetime: 'Lifetime Hours (log)',
            log_mean_time_between_failures: 'MTBF (log)', mechanical_wear_score: 'Mechanical Wear Score',
            neglect_score: 'Maintenance Neglect Score', aging_factor: 'Aging Factor',
            log_cost_per_event: 'Cost Per Event (log)', days_since_last_maintenance: 'Days Since Last Service',
            wear_rate: 'Wear Rate', maintenance_events_90d: 'Maintenance Events 90d',
            category_encoded: 'Equipment Category', abuse_score: 'Operational Stress Score',
            vendor_reliability_score: 'Vendor Reliability Score', jobsite_risk_score: 'Job Site Risk Score',
            usage_trend: 'Usage Trend', usage_intensity: 'Usage Intensity',
            maint_frequency_trend: 'Maintenance Frequency Trend', cost_trend: 'Cost Trend',
            hours_velocity: 'Hours Velocity', neglect_acceleration: 'Neglect Acceleration',
            sensor_degradation_rate: 'Sensor Degradation Rate',
          };
          const featureDescriptions: Record<string, string> = {
            asset_age_years: 'Years since manufacture', log_maintenance_cost_180d: 'Log maintenance cost trajectory',
            log_total_hours_lifetime: 'Log cumulative operating hours',
            log_mean_time_between_failures: 'Log mean time between failures', mechanical_wear_score: 'Composite wear indicator (0-10)',
            neglect_score: 'Maintenance neglect composite (0-10)', days_since_last_maintenance: 'Days since last service',
            wear_rate: 'Rate of mechanical wear accumulation', vendor_reliability_score: 'Vendor failure frequency score (0-1)',
            jobsite_risk_score: 'Site utilization intensity risk (0-1)', usage_trend: 'Usage trajectory vs historical baseline',
            usage_intensity: 'Daily hours relative to equipment class', wear_rate_velocity: 'Rate of change in wear accumulation',
            maint_frequency_trend: 'Trending maintenance frequency', cost_trend: 'Trending maintenance cost',
            hours_velocity: 'Rate of change in operating hours', neglect_acceleration: 'Accelerating neglect signal',
            sensor_degradation_rate: 'Sensor signal quality degradation rate',
          };
          featureImportance = Object.entries(raw)
            .filter(([, v]) => (v as number) > 0.005)
            .sort(([, a], [, b]) => (b as number) - (a as number))
            .slice(0, 10)
            .map(([key, importance]) => ({
              feature: featureLabels[key] || key,
              importance: importance as number,
              description: featureDescriptions[key] || key,
            }));
        }
      } catch (e) {
        featureImportance = [
          { feature: 'Equipment Age', importance: 0.21, description: 'Years since manufacture' },
          { feature: 'Maintenance Cost 180d (log)', importance: 0.16, description: 'Log maintenance cost trajectory' },
          { feature: 'Wear Rate Velocity', importance: 0.14, description: 'Rate of change in wear accumulation' },
          { feature: 'Lifetime Hours (log)', importance: 0.12, description: 'Log cumulative operating hours' },
          { feature: 'MTBF (log)', importance: 0.12, description: 'Log mean time between failures' },
        ];
      }

      let hyperparameters = { algorithm: 'Random Forest (calibrated)', nEstimators: 200, maxDepth: 12, minSamplesSplit: 5, classWeight: 'balanced' };
      try {
        const fs = await import('fs');
        const path = await import('path');
        const registryPath = path.join(process.cwd(), 'ml-service', 'registry');
        const metaFiles = fs.readdirSync(registryPath).filter((f: string) => f.startsWith('metadata_30d_') && f.endsWith('.json'));
        if (metaFiles.length > 0) {
          const meta = JSON.parse(fs.readFileSync(path.join(registryPath, metaFiles.sort().reverse()[0]), 'utf-8'));
          if (meta.hyperparameters) {
            hyperparameters = {
              algorithm: meta.hyperparameters.algorithm ?? 'Random Forest (calibrated)',
              nEstimators: meta.hyperparameters.n_estimators ?? 200,
              maxDepth: meta.hyperparameters.max_depth ?? 12,
              minSamplesSplit: meta.hyperparameters.min_samples_split ?? 5,
              classWeight: meta.hyperparameters.class_weight ?? 'balanced',
            };
          }
        }
      } catch (e) { /* use defaults */ }

      res.json({
        version: latestMetrics.modelVersion,
        trainedAt: latestMetrics.trainedAt.toISOString(),
        datasetSize: latestMetrics.datasetSize,
        accuracy: Number(latestMetrics.accuracy),
        precision: { HIGH: Number(latestMetrics.precisionHigh), MEDIUM: Number(latestMetrics.precisionMedium), LOW: Number(latestMetrics.precisionLow) },
        recall: { HIGH: Number(latestMetrics.recallHigh), MEDIUM: Number(latestMetrics.recallMedium), LOW: Number(latestMetrics.recallLow) },
        f1Score: { HIGH: Number(latestMetrics.f1High), MEDIUM: Number(latestMetrics.f1Medium), LOW: Number(latestMetrics.f1Low) },
        confusionMatrix: {
          HIGH: { predictedHIGH: latestMetrics.highPredictedHigh, predictedMEDIUM: latestMetrics.highPredictedMedium, predictedLOW: latestMetrics.highPredictedLow },
          MEDIUM: { predictedHIGH: latestMetrics.mediumPredictedHigh, predictedMEDIUM: latestMetrics.mediumPredictedMedium, predictedLOW: latestMetrics.mediumPredictedLow },
          LOW: { predictedHIGH: latestMetrics.lowPredictedHigh, predictedMEDIUM: latestMetrics.lowPredictedMedium, predictedLOW: latestMetrics.lowPredictedLow },
        },
        featureImportance,
        predictionHistory: ((predictionHistory as any)[0] as any[]).map((row: any) => ({
          date: row.month, total: Number(row.total), high: Number(row.high), medium: Number(row.medium), low: Number(row.low),
        })),
        hyperparameters,
      });
    } catch (error) {
      console.error('Model metrics error:', error);
      res.status(500).json({ message: 'Failed to fetch model metrics' });
    }
  });

  app.get('/api/ml/feature-importance', requireAuth, async (req, res) => {
    res.json([
      { feature: 'Equipment Age', importance: 0.21, description: 'Years since manufacture' },
      { feature: 'Maintenance Cost 180d (log)', importance: 0.16, description: 'Log maintenance cost trajectory' },
      { feature: 'Wear Rate Velocity', importance: 0.14, description: 'Rate of change in wear accumulation' },
      { feature: 'Lifetime Hours (log)', importance: 0.12, description: 'Log cumulative operating hours' },
      { feature: 'MTBF (log)', importance: 0.12, description: 'Log mean time between failures' },
    ]);
  });

  app.get('/api/ml/pipeline-status', requireAuth, async (req, res) => {
    try {
      const { assetFeatureSnapshots, assetRiskPredictions } = await import('@shared/schema');
      const [snapshotStats] = await db.select({
        total: count(),
        labeled: sql<number>`SUM(CASE WHEN ${assetFeatureSnapshots.willFail30d} IS NOT NULL THEN 1 ELSE 0 END)`,
        unlabeled: sql<number>`SUM(CASE WHEN ${assetFeatureSnapshots.willFail30d} IS NULL THEN 1 ELSE 0 END)`,
      }).from(assetFeatureSnapshots);

      const [predictionStats] = await db.select({ total: count() }).from(assetRiskPredictions);
      const [snapshotDates] = await db.select({
        oldest: sql`MIN(${assetFeatureSnapshots.snapshotTs})`,
        newest: sql`MAX(${assetFeatureSnapshots.snapshotTs})`,
      }).from(assetFeatureSnapshots);
      const [predictionDates] = await db.select({
        oldest: sql`MIN(${assetRiskPredictions.predictedAt})`,
        newest: sql`MAX(${assetRiskPredictions.predictedAt})`,
      }).from(assetRiskPredictions);

      res.json({
        snapshots: {
          total: Number(snapshotStats?.total) || 0,
          labeled: Number(snapshotStats?.labeled) || 0,
          unlabeled: Number(snapshotStats?.unlabeled) || 0,
          oldestDate: snapshotDates?.oldest,
          newestDate: snapshotDates?.newest,
        },
        predictions: {
          total: Number(predictionStats?.total) || 0,
          oldestDate: predictionDates?.oldest,
          newestDate: predictionDates?.newest,
        },
        readyForTraining: (Number(snapshotStats?.labeled) || 0) > 100,
        modelStatus: await (async () => {
          try {
            const fs = await import('fs');
            const path = await import('path');
            const registryPath = path.join(process.cwd(), 'ml-service', 'registry');
            const files = fs.readdirSync(registryPath).filter((f: string) => f.startsWith('rf_30d_') && f.endsWith('.pkl'));
            if (files.length === 0) return 'rule-based';
            // Numeric sort to get true latest version
            const sorted = files.sort((a, b) => {
              const ma = a.match(/v(\d+)\.(\d+)/);
              const mb = b.match(/v(\d+)\.(\d+)/);
              if (!ma || !mb) return 0;
              return (parseInt(ma[1]) * 1000 + parseInt(ma[2])) - (parseInt(mb[1]) * 1000 + parseInt(mb[2]));
            });
            const match = sorted[sorted.length - 1].match(/rf_30d_(v[\d.]+)\.pkl/);
            return match ? `ml-${match[1]}` : 'ml';
          } catch { return 'rule-based'; }
        })(),
      });
    } catch (error) {
      res.status(500).json({ message: 'Failed to get pipeline status' });
    }
  });

  // ── PROJECTION ────────────────────────────────────────────────────────────
  app.get("/api/equipment/:id/projection", requireAuth, async (req, res) => {
    try {
      const equipmentId = parseInt(req.params.id);
      if (isNaN(equipmentId)) return res.status(400).json({ message: "Invalid equipment ID" });

      const snapshotTs = await getSimulationDate();
      const snapshot = await enhancedFeatureService.generateSnapshot(equipmentId, snapshotTs);

      const mlPayload = {
        equipment_id: snapshot.equipmentId, snapshot_ts: snapshot.snapshotTs,
        category: snapshot.category, asset_age_years: snapshot.assetAgeYears,
        total_hours_lifetime: snapshot.totalHoursLifetime, hours_used_30d: snapshot.hoursUsed30d,
        hours_used_90d: snapshot.hoursUsed90d, rental_days_30d: snapshot.rentalDays30d,
        rental_days_90d: snapshot.rentalDays90d, avg_rental_duration: snapshot.avgRentalDuration,
        maintenance_events_90d: snapshot.maintenanceEvents90d, maintenance_cost_180d: snapshot.maintenanceCost180d,
        avg_downtime_per_event: snapshot.avgDowntimePerEvent, days_since_last_maintenance: snapshot.daysSinceLastMaintenance,
        mean_time_between_failures: snapshot.meanTimeBetweenFailures, vendor_reliability_score: snapshot.vendorReliabilityScore,
        jobsite_risk_score: snapshot.jobSiteRiskScore, usage_intensity: snapshot.usageIntensity,
        usage_trend: snapshot.usageTrend, utilization_vs_expected: snapshot.utilizationVsExpected,
        wear_rate: snapshot.wearRate, aging_factor: snapshot.agingFactor, maint_overdue: snapshot.maintOverdue,
        cost_per_event: snapshot.costPerEvent, maint_burden: snapshot.maintBurden,
        mechanical_wear_score: snapshot.mechanicalWearScore, abuse_score: snapshot.abuseScore,
        neglect_score: snapshot.neglectScore, wear_rate_velocity: snapshot.wearRateVelocity,
        maint_frequency_trend: snapshot.maintFrequencyTrend, cost_trend: snapshot.costTrend,
        hours_velocity: snapshot.hoursVelocity, neglect_acceleration: snapshot.neglectAcceleration,
        sensor_degradation_rate: snapshot.sensorDegradationRate,
      };

      const mlResponse = await fetch("http://localhost:8000/predict/project", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(mlPayload),
      });

      if (!mlResponse.ok) return res.status(502).json({ message: `ML service error: ${await mlResponse.text()}` });
      res.json(await mlResponse.json());
    } catch (err: any) {
      console.error("[PROJECTION] Error:", err);
      res.status(500).json({ message: err.message || "Projection failed" });
    }
  });

  // ── FINANCIAL ─────────────────────────────────────────────────────────────
  app.get('/api/dashboard/revenue-summary', requireAuth, async (req, res) => {
    try {
      const cursor = await getSimulationDate();
      const cursorStr = cursor.toISOString().split('T')[0];

      const [rows] = await db.execute(sql`
        SELECT
          -- Accrual: daily_rate × days active within the 30-day window (matches daily chart)
          COALESCE(SUM(CASE
            WHEN r.id IS NOT NULL AND r.status IN ('ACTIVE','COMPLETED')
              AND r.receive_date IS NOT NULL
              AND r.receive_date <= ${cursorStr}
              AND (r.return_date IS NULL OR r.return_date >= DATE_SUB(${cursorStr}, INTERVAL 29 DAY))
            THEN GREATEST(0, DATEDIFF(
              LEAST(COALESCE(r.return_date, ${cursorStr}), ${cursorStr}),
              GREATEST(r.receive_date, DATE_SUB(${cursorStr}, INTERVAL 29 DAY))
            ) + 1) * CAST(e.daily_rate AS DECIMAL(10,2))
            ELSE 0 END), 0) AS revenue_30d,
          -- WTD accrual: days active in the rolling 7-day window
          COALESCE(SUM(CASE
            WHEN r.id IS NOT NULL AND r.status IN ('ACTIVE','COMPLETED')
              AND r.receive_date IS NOT NULL
              AND r.receive_date <= ${cursorStr}
              AND (r.return_date IS NULL OR r.return_date >= DATE_SUB(${cursorStr}, INTERVAL 6 DAY))
            THEN GREATEST(0, DATEDIFF(
              LEAST(COALESCE(r.return_date, ${cursorStr}), ${cursorStr}),
              GREATEST(r.receive_date, DATE_SUB(${cursorStr}, INTERVAL 6 DAY))
            ) + 1) * CAST(e.daily_rate AS DECIMAL(10,2))
            ELSE 0 END), 0) AS revenue_wtd,
          -- Outstanding A/R: completed uninvoiced rentals, full rental value
          COALESCE(SUM(CASE
            WHEN r.status = 'COMPLETED' AND r.receive_date IS NOT NULL AND r.return_date IS NOT NULL
              AND r.return_date >= r.receive_date
              AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.rental_id = r.id)
            THEN (DATEDIFF(r.return_date, r.receive_date) + 1) * CAST(e.daily_rate AS DECIMAL(10,2))
            ELSE 0 END), 0) AS outstanding_ar,
          COUNT(DISTINCT e.id) AS total_equipment,
          SUM(CASE WHEN e.status = 'RENTED' THEN 1 ELSE 0 END) AS rented_equipment
        FROM equipment e LEFT JOIN rentals r ON r.equipment_id = e.id
      `) as any;

      const [uninvoicedRows] = await db.execute(sql`
        SELECT COUNT(*) AS uninvoiced_count
        FROM rentals r
        WHERE r.status = 'COMPLETED'
          AND r.receive_date IS NOT NULL AND r.return_date IS NOT NULL
          AND r.return_date >= r.receive_date
          AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.rental_id = r.id)
      `) as any;

      const [utilRows] = await db.execute(sql`
        SELECT COALESCE(
          SUM(GREATEST(0, DATEDIFF(
            LEAST(COALESCE(r.return_date, ${cursorStr}), ${cursorStr}),
            GREATEST(r.receive_date, DATE_SUB(${cursorStr}, INTERVAL 29 DAY))
          ) + 1)),
          0
        ) / NULLIF((SELECT COUNT(*) FROM equipment) * 30, 0) * 100 AS avg_utilization_30d
        FROM rentals r
        WHERE r.receive_date <= ${cursorStr}
          AND (r.return_date IS NULL OR r.return_date >= DATE_SUB(${cursorStr}, INTERVAL 29 DAY))
          AND r.status IN ('ACTIVE', 'COMPLETED')
      `) as any;

      const data = (rows as any[])[0];
      const uninvoicedCount = Number((uninvoicedRows as any[])[0]?.uninvoiced_count || 0);
      const avgUtilization30d = Number((utilRows as any[])[0]?.avg_utilization_30d || 0);

      res.json({
        revenue30d: Number(data.revenue_30d || 0),
        revenueWtd: Number(data.revenue_wtd || 0),
        outstandingAr: Number(data.outstanding_ar || 0),
        uninvoicedCount,
        totalEquipment: Number(data.total_equipment || 0),
        rentedEquipment: Number(data.rented_equipment || 0),
        utilizationRate: data.total_equipment > 0 ? (data.rented_equipment / data.total_equipment) * 100 : 0,
        avgUtilization30d,
      });
    } catch (e: any) {
      res.status(500).json({ message: 'Failed to fetch revenue summary', error: e.message });
    }
  });

  app.get('/api/dashboard/daily-revenue', requireAuth, async (req, res) => {
    try {
      const cursor = await getSimulationDate();
      // Work entirely in UTC-parsed date strings to avoid local-timezone shifts
      const cursorStr = cursor.toISOString().split('T')[0];
      const MS_PER_DAY = 86400000;
      const cursorMs = new Date(cursorStr + 'T00:00:00Z').getTime();
      const windowStartMs = cursorMs - 29 * MS_PER_DAY;
      const windowStartStr = new Date(windowStartMs).toISOString().split('T')[0];

      // Build 30-day bucket array (index 0 = oldest day)
      const days: string[] = [];
      for (let i = 0; i < 30; i++) {
        days.push(new Date(windowStartMs + i * MS_PER_DAY).toISOString().split('T')[0]);
      }
      const buckets: Record<string, number> = {};
      for (const d of days) buckets[d] = 0;

      // Fetch all rentals that overlap the window
      const [rows] = await db.execute(sql`
        SELECT
          r.receive_date,
          r.return_date,
          CAST(e.daily_rate AS DECIMAL(10,2)) AS daily_rate
        FROM rentals r
        JOIN equipment e ON e.id = r.equipment_id
        WHERE r.receive_date IS NOT NULL
          AND r.receive_date <= ${cursorStr}
          AND (r.return_date IS NULL OR r.return_date >= ${windowStartStr})
          AND r.status IN ('ACTIVE', 'COMPLETED')
      `) as any;

      for (const row of rows as any[]) {
        const rate = Number(row.daily_rate || 0);
        if (!rate) continue;
        // mysql2 returns DATE columns as 'YYYY-MM-DD' strings
        const receiveStr: string = row.receive_date instanceof Date
          ? row.receive_date.toISOString().split('T')[0]
          : String(row.receive_date).substring(0, 10);
        const returnStr: string = row.return_date
          ? (row.return_date instanceof Date
              ? row.return_date.toISOString().split('T')[0]
              : String(row.return_date).substring(0, 10))
          : cursorStr;

        for (const day of days) {
          if (day >= receiveStr && day <= returnStr) {
            buckets[day] += rate;
          }
        }
      }

      res.json(days.map(day => ({ day, revenue: Math.round(buckets[day] * 100) / 100 })));
    } catch (e: any) {
      console.error('[daily-revenue]', e);
      res.status(500).json({ message: 'Failed to fetch daily revenue', error: e.message });
    }
  });

  app.get('/api/dashboard/monthly-trend', requireAuth, async (req, res) => {
    try {
      const cursor = await getSimulationDate();
      const cursorStr = cursor.toISOString().split('T')[0];

      // Build 12 calendar-month buckets ending at cursor month (oldest → newest)
      const months: string[] = [];
      const buckets: Record<string, number> = {};
      for (let i = 11; i >= 0; i--) {
        const d = new Date(Date.UTC(cursor.getFullYear(), cursor.getMonth() - i, 1));
        const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
        months.push(key);
        buckets[key] = 0;
      }
      const windowStart = months[0] + '-01';

      // Fetch all rentals that overlap the 12-month window (accrual — same logic as daily chart)
      const [rows] = await db.execute(sql`
        SELECT r.receive_date, r.return_date, CAST(e.daily_rate AS DECIMAL(10,2)) AS daily_rate
        FROM rentals r JOIN equipment e ON e.id = r.equipment_id
        WHERE r.receive_date IS NOT NULL
          AND r.receive_date <= ${cursorStr}
          AND (r.return_date IS NULL OR r.return_date >= ${windowStart})
          AND r.status IN ('ACTIVE', 'COMPLETED')
      `) as any;

      for (const row of (rows as any[])) {
        const rate = Number(row.daily_rate || 0);
        if (!rate) continue;
        const receiveStr: string = row.receive_date instanceof Date
          ? row.receive_date.toISOString().split('T')[0]
          : String(row.receive_date).substring(0, 10);
        const returnStr: string = row.return_date
          ? (row.return_date instanceof Date ? row.return_date.toISOString().split('T')[0] : String(row.return_date).substring(0, 10))
          : cursorStr;

        for (const monthKey of months) {
          const [y, m] = monthKey.split('-').map(Number);
          // First and last day of this calendar month (UTC)
          const monthStart = `${y}-${String(m).padStart(2, '0')}-01`;
          const monthEndDate = new Date(Date.UTC(y, m, 0)); // day 0 of next month = last day of this month
          const monthEnd = monthEndDate.toISOString().split('T')[0];

          const overlapStart = receiveStr > monthStart ? receiveStr : monthStart;
          const overlapEnd   = returnStr  < monthEnd   ? returnStr  : monthEnd;
          if (overlapStart <= overlapEnd) {
            const days =
              Math.round((new Date(overlapEnd + 'T00:00:00Z').getTime() - new Date(overlapStart + 'T00:00:00Z').getTime()) / 86400000) + 1;
            buckets[monthKey] += rate * days;
          }
        }
      }

      res.json(months.map(m => ({ month: m, revenue: Math.round(buckets[m]) })));
    } catch (e: any) {
      res.status(500).json({ message: 'Failed to fetch monthly trend', error: e.message });
    }
  });

  // ── ML TRAINING PROXY ─────────────────────────────────────────────────────
  app.post("/api/ml/train", requireAdmin, async (req, res) => {
    try {
      const mlRes = await fetch("http://localhost:8000/train", { method: "POST" });
      if (!mlRes.ok) return res.status(mlRes.status).json({ message: await mlRes.text() });
      res.json(await mlRes.json());
    } catch (e: any) {
      res.status(500).json({ message: "ML service unreachable", error: e.message });
    }
  });

  app.get("/api/ml/train/status", requireAuth, async (req, res) => {
    try {
      const mlRes = await fetch("http://localhost:8000/train/status");
      if (!mlRes.ok) return res.status(mlRes.status).json({ message: "Status unavailable" });
      res.json(await mlRes.json());
    } catch (e: any) {
      res.status(500).json({ message: "ML service unreachable", error: e.message });
    }
  });

  // ── DRIFT MONITORING ─────────────────────────────────────────────────────
  app.get("/api/ml/drift/latest", requireAuth, async (req, res) => {
    try {
      const mlRes = await fetch("http://localhost:8000/drift/latest");
      if (!mlRes.ok) return res.status(mlRes.status).json({ message: "Drift data unavailable" });
      res.json(await mlRes.json());
    } catch (e: any) {
      res.status(500).json({ message: "ML service unreachable", error: e.message });
    }
  });

  app.post("/api/ml/drift/compute-reference", requireAdmin, async (req, res) => {
    try {
      const mlRes = await fetch("http://localhost:8000/drift/compute-reference", { method: "POST" });
      if (!mlRes.ok) return res.status(mlRes.status).json({ message: await mlRes.text() });
      res.json(await mlRes.json());
    } catch (e: any) {
      res.status(500).json({ message: "ML service unreachable", error: e.message });
    }
  });

  // ── MAINTENANCE DUE SOON ──────────────────────────────────────────────────
  app.get('/api/maintenance/due-soon', requireAuth, async (req, res) => {
    try {
      const cursorDate = await getSimulationDate();
      const [rows] = await db.execute(sql`
        SELECT
          e.id,
          e.name,
          e.equipment_id   AS equipmentId,
          e.category,
          e.status,
          me.next_due_date AS nextDueDate,
          DATEDIFF(me.next_due_date, ${cursorDate}) AS daysUntilDue
        FROM equipment e
        JOIN maintenance_events me ON me.id = (
          SELECT id FROM maintenance_events m2
          WHERE m2.equipment_id = e.id AND m2.next_due_date IS NOT NULL
          ORDER BY m2.id DESC LIMIT 1
        )
        WHERE me.next_due_date <= DATE_ADD(${cursorDate}, INTERVAL 30 DAY)
        ORDER BY me.next_due_date ASC
      `);
      res.json((rows as unknown as any[]) || []);
    } catch (error) {
      res.status(500).json({ message: 'Failed to fetch due-soon maintenance' });
    }
  });

  // ── EQUIPMENT SWAPS ────────────────────────────────────────────────────────
  app.post('/api/rentals/:id/swap', requireAdmin, async (req, res) => {
    try {
      const rentalId = parseInt(req.params.id);
      const { replacementEquipmentId, reason, swappedBy, notes } = req.body;

      const rental = await storage.getRental(rentalId);
      if (!rental) return res.status(404).json({ message: 'Rental not found' });
      if (rental.status !== 'ACTIVE') return res.status(400).json({ message: 'Can only swap equipment on active rentals' });

      const replacement = await storage.getEquipment(replacementEquipmentId);
      if (!replacement) return res.status(404).json({ message: 'Replacement equipment not found' });
      if (replacement.status !== 'AVAILABLE') return res.status(400).json({ message: 'Replacement equipment is not available' });
      if (replacementEquipmentId === rental.equipmentId) return res.status(400).json({ message: 'Replacement must be different from current equipment' });

      const originalEquipmentId = rental.equipmentId;
      const simCursor = await getSimulationDate();
      const today = simCursor.toISOString().split('T')[0];

      await Promise.all([
        storage.updateEquipment(originalEquipmentId, { status: 'AVAILABLE' }),
        storage.updateEquipment(replacementEquipmentId, { status: 'RENTED' }),
        storage.updateRental(rentalId, { equipmentId: replacementEquipmentId }),
      ]);

      await storage.createSwap({
        rentalId,
        originalEquipmentId,
        replacementEquipmentId,
        swapDate: today,
        reason: reason || null,
        swappedBy: swappedBy || null,
        notes: notes || null,
      });

      res.json({ message: 'Equipment swapped successfully' });
    } catch (error) {
      console.error('Swap error:', error);
      res.status(500).json({ message: 'Failed to swap equipment' });
    }
  });

  app.get('/api/rentals/:id/swaps', requireAuth, async (req, res) => {
    try {
      const rentalId = parseInt(req.params.id);
      const swaps = await storage.listSwapsByRental(rentalId);
      res.json(swaps);
    } catch (error) {
      res.status(500).json({ message: 'Failed to fetch swap history' });
    }
  });

  // ── MAINTENANCE COST REPORT ────────────────────────────────────────────────
  app.get('/api/reports/maintenance-costs', requireAuth, async (req, res) => {
    try {
      const cursor = await getSimulationDate();
      const cursorStr = cursor.toISOString().split('T')[0];

      const [byEquipment] = await db.execute(sql`
        SELECT
          e.id,
          e.name,
          e.equipment_id  AS equipmentId,
          e.category,
          COUNT(me.id)    AS eventCount,
          COALESCE(SUM(CAST(me.cost AS DECIMAL(10,2))), 0) AS totalCost,
          COALESCE(AVG(CAST(me.cost AS DECIMAL(10,2))), 0) AS avgCostPerEvent
        FROM equipment e
        LEFT JOIN maintenance_events me ON me.equipment_id = e.id
        GROUP BY e.id, e.name, e.equipment_id, e.category
        HAVING eventCount > 0
        ORDER BY totalCost DESC
      `);

      const [byCategory] = await db.execute(sql`
        SELECT
          e.category,
          COUNT(me.id) AS eventCount,
          COALESCE(SUM(CAST(me.cost AS DECIMAL(10,2))), 0) AS totalCost
        FROM maintenance_events me
        JOIN equipment e ON e.id = me.equipment_id
        GROUP BY e.category
        ORDER BY totalCost DESC
      `);

      const [byMonth] = await db.execute(sql`
        SELECT
          DATE_FORMAT(me.maintenance_date, '%Y-%m') AS month,
          COUNT(*)  AS eventCount,
          COALESCE(SUM(CAST(me.cost AS DECIMAL(10,2))), 0) AS totalCost
        FROM maintenance_events me
        WHERE me.maintenance_date >= DATE_SUB(${cursorStr}, INTERVAL 12 MONTH)
          AND me.maintenance_date <= ${cursorStr}
        GROUP BY month
        ORDER BY month ASC
      `);

      const [summaryRows] = await db.execute(sql`
        SELECT
          COUNT(*)  AS totalEvents,
          COALESCE(SUM(CAST(cost AS DECIMAL(10,2))), 0) AS totalCost,
          COALESCE(AVG(CAST(cost AS DECIMAL(10,2))), 0) AS avgCostPerEvent
        FROM maintenance_events
      `);

      res.json({
        byEquipment: byEquipment as unknown as any[],
        byCategory: byCategory as unknown as any[],
        byMonth: byMonth as unknown as any[],
        summary: (summaryRows as unknown as any[])[0] || { totalEvents: 0, totalCost: 0, avgCostPerEvent: 0 },
      });
    } catch (error) {
      console.error('Maintenance cost report error:', error);
      res.status(500).json({ message: 'Failed to generate maintenance cost report' });
    }
  });

  // ── AGENT API ─────────────────────────────────────────────────────────────
  //
  // Bearer-token auth for programmatic / LLM agent access.
  // Set AGENT_API_KEY env var to a long random string to enable.
  // Agents pass: Authorization: Bearer <key>
  //
  function requireAgentKey(req: any, res: any, next: any) {
    const key = process.env.AGENT_API_KEY;
    if (!key) return res.status(503).json({ error: "Agent API not enabled — set AGENT_API_KEY env var" });
    const header = req.headers.authorization ?? "";
    if (header !== `Bearer ${key}`) return res.status(401).json({ error: "Invalid or missing agent API key" });
    next();
  }

  // GET /api/agent/model-health
  // Returns a single consolidated snapshot of model + drift + pipeline health
  // plus a machine-readable recommended_action field agents can act on.
  app.get("/api/agent/model-health", requireAgentKey, async (req, res) => {
    try {
      const { modelTrainingMetrics, assetFeatureSnapshots, assetRiskPredictions } = await import("@shared/schema");

      // ── model metrics ──────────────────────────────────────────────────────
      const [latestModel] = await db
        .select()
        .from(modelTrainingMetrics)
        .orderBy(desc(modelTrainingMetrics.trainedAt))
        .limit(1);

      // ── pipeline stats ─────────────────────────────────────────────────────
      const [snapStats] = await db.select({
        total: count(),
        labeled: sql<number>`SUM(CASE WHEN ${assetFeatureSnapshots.willFail30d} IS NOT NULL THEN 1 ELSE 0 END)`,
      }).from(assetFeatureSnapshots);

      const [predStats] = await db.select({ total: count() }).from(assetRiskPredictions);

      // ── drift ──────────────────────────────────────────────────────────────
      let drift: { overall: string; features: any[] } = { overall: "NO_DATA", features: [] };
      try {
        const mlRes = await fetch("http://localhost:8000/drift/latest");
        if (mlRes.ok) drift = await mlRes.json();
      } catch { /* ML service offline — surface NO_DATA */ }

      // ── training status ────────────────────────────────────────────────────
      let trainingRunning = false;
      try {
        const tr = await fetch("http://localhost:8000/train/status");
        if (tr.ok) { const d = await tr.json(); trainingRunning = d.running ?? false; }
      } catch { /* ignore */ }

      // ── recommended action ─────────────────────────────────────────────────
      let recommended_action: "none" | "retrain" | "compute_drift_reference" = "none";
      let reasoning = "Model is healthy and drift is within acceptable bounds.";

      if (drift.overall === "NO_DATA") {
        recommended_action = "compute_drift_reference";
        reasoning = "No drift reference baseline exists. Compute one before relying on drift monitoring.";
      } else if (drift.overall === "ALERT") {
        recommended_action = "retrain";
        reasoning = `Feature drift is in ALERT state (PSI ≥ 0.20 on ${drift.features.filter((f: any) => f.status === "ALERT").map((f: any) => f.feature).join(", ")}). Model predictions may be unreliable — retrain recommended.`;
      } else if (drift.overall === "WARNING") {
        recommended_action = "none";
        reasoning = "Feature drift is elevated (PSI 0.10–0.20). Monitor closely; retrain if drift continues to rise.";
      }

      if (trainingRunning) {
        recommended_action = "none";
        reasoning = "Training is currently in progress.";
      }

      res.json({
        model: latestModel ? {
          version: latestModel.modelVersion,
          trained_at: latestModel.trainedAt,
          accuracy: Number(latestModel.accuracy),
          dataset_size: latestModel.datasetSize,
        } : null,
        pipeline: {
          snapshots_total: Number(snapStats?.total) || 0,
          snapshots_labeled: Number(snapStats?.labeled) || 0,
          predictions_total: Number(predStats?.total) || 0,
          training_running: trainingRunning,
          ready_for_training: (Number(snapStats?.labeled) || 0) > 100,
        },
        drift: {
          overall: drift.overall,
          features: drift.features.map((f: any) => ({
            feature: f.feature,
            psi: f.psi,
            status: f.status,
            checked_at: f.checked_at,
          })),
        },
        recommended_action,
        reasoning,
        generated_at: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error("Agent model-health error:", error);
      res.status(500).json({ error: "Failed to assemble model health snapshot", detail: error.message });
    }
  });

  // POST /api/agent/actions
  // Body: { "action": "retrain" | "compute_drift_reference" }
  // Lets an agent trigger operations without a browser session.
  app.post("/api/agent/actions", requireAgentKey, async (req, res) => {
    const { action } = req.body ?? {};

    if (action === "retrain") {
      try {
        const mlRes = await fetch("http://localhost:8000/train", { method: "POST" });
        if (!mlRes.ok) return res.status(mlRes.status).json({ error: await mlRes.text() });
        return res.json({ action, status: "accepted", detail: await mlRes.json() });
      } catch (e: any) {
        return res.status(500).json({ error: "ML service unreachable", detail: e.message });
      }
    }

    if (action === "compute_drift_reference") {
      try {
        const mlRes = await fetch("http://localhost:8000/drift/compute-reference", { method: "POST" });
        if (!mlRes.ok) return res.status(mlRes.status).json({ error: await mlRes.text() });
        return res.json({ action, status: "accepted", detail: await mlRes.json() });
      } catch (e: any) {
        return res.status(500).json({ error: "ML service unreachable", detail: e.message });
      }
    }

    res.status(400).json({
      error: "Unknown action",
      allowed_actions: ["retrain", "compute_drift_reference"],
    });
  });

  return httpServer;
}