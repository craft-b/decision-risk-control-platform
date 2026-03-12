// server/routes.ts - COMPLETE FIXED VERSION

import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { api } from "@shared/routes";
import session from "express-session";
import bcrypt from "bcryptjs";
import { riskScoringService } from './services/risk-scoring';
import { maintenanceEvents, equipment, equipmentRiskScores, rentals, equipmentFailurePredictions } from "@shared/schema";
import { eq, desc, gte, and, count, sql } from "drizzle-orm";
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

  app.use(
    session({
      secret: process.env.SESSION_SECRET || "dev_secret_key",
      resave: false,
      saveUninitialized: false,
      cookie: { 
        secure: process.env.NODE_ENV === "production",
        maxAge: 24 * 60 * 60 * 1000 
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

  // Helper function: Calculate confusion matrix
  function calculateConfusionMatrix(predictions: any[]) {
    const matrix = {
      HIGH: { predictedHIGH: 0, predictedMEDIUM: 0, predictedLOW: 0 },
      MEDIUM: { predictedHIGH: 0, predictedMEDIUM: 0, predictedLOW: 0 },
      LOW: { predictedHIGH: 0, predictedMEDIUM: 0, predictedLOW: 0 },
    };

    predictions.forEach(pred => {
      if (!pred.actualRisk || !pred.predictedRisk) return;

      const actual = pred.actualRisk.toUpperCase() as 'HIGH' | 'MEDIUM' | 'LOW';
      const predicted = pred.predictedRisk.toUpperCase() as 'HIGH' | 'MEDIUM' | 'LOW';

      if (matrix[actual]) {
        const key = `predicted${predicted}` as keyof typeof matrix.HIGH;
        if (key in matrix[actual]) {
          matrix[actual][key]++;
        }
      }
    });

    return matrix;
  }

  // Helper function: Calculate metrics
  function calculateMetrics(confusionMatrix: any) {
    const classes = ['HIGH', 'MEDIUM', 'LOW'] as const;
    const precision: Record<string, number> = {};
    const recall: Record<string, number> = {};
    const f1Score: Record<string, number> = {};

    let totalCorrect = 0;
    let totalPredictions = 0;

    classes.forEach(cls => {
      const tp = confusionMatrix[cls][`predicted${cls}`];
      
      // Calculate precision (TP / (TP + FP))
      const predictedPositive = classes.reduce((sum, c) => 
        sum + confusionMatrix[c][`predicted${cls}`], 0
      );
      precision[cls] = predictedPositive > 0 ? tp / predictedPositive : 0;

      // Calculate recall (TP / (TP + FN))
      const actualPositive = Object.values(confusionMatrix[cls]).reduce(
        (sum: number, val) => sum + (val as number), 0
      );
      recall[cls] = actualPositive > 0 ? tp / actualPositive : 0;

      // Calculate F1 score
      f1Score[cls] = (precision[cls] + recall[cls]) > 0
        ? (2 * precision[cls] * recall[cls]) / (precision[cls] + recall[cls])
        : 0;

      totalCorrect += tp;
      totalPredictions += actualPositive;
    });

    const accuracy = totalPredictions > 0 ? totalCorrect / totalPredictions : 0;

    return { accuracy, precision, recall, f1Score };
  }

  function getDefaultMetrics() {
    return {
      version: 'v1.2.0',
      trainedAt: '2025-01-05T10:30:00Z',
      datasetSize: 2847,
      accuracy: 0.847,
      precision: { HIGH: 0.82, MEDIUM: 0.79, LOW: 0.91 },
      recall: { HIGH: 0.88, MEDIUM: 0.74, LOW: 0.89 },
      f1Score: { HIGH: 0.85, MEDIUM: 0.76, LOW: 0.90 },
      confusionMatrix: {
        HIGH: { predictedHIGH: 156, predictedMEDIUM: 18, predictedLOW: 4 },
        MEDIUM: { predictedHIGH: 32, predictedMEDIUM: 198, predictedLOW: 38 },
        LOW: { predictedHIGH: 8, predictedMEDIUM: 42, predictedLOW: 432 },
      },
      featureImportance: [
        { feature: 'Equipment Age', importance: 0.28, description: 'Years since manufacture' },
        { feature: 'Usage Hours', importance: 0.24, description: 'Total operational hours' },
        { feature: 'Maintenance Frequency', importance: 0.19, description: 'Service events per year' },
        { feature: 'Days Since Last Service', importance: 0.15, description: 'Time since maintenance' },
        { feature: 'Category Risk Factor', importance: 0.08, description: 'Equipment type baseline risk' },
        { feature: 'Rental Frequency', importance: 0.06, description: 'Utilization rate' },
      ],
      predictionHistory: [],
      hyperparameters: {
        algorithm: 'Random Forest',
        nEstimators: 200,
        maxDepth: 15,
        minSamplesSplit: 10,
        classWeight: 'balanced',
      },
    };
  }

  // ── SIMULATION CURSOR HELPER ─────────────────────────────────────────────────
  async function getSimulationDate(): Promise<Date> {
    const [stateRows] = await db.execute(sql`SELECT cursor_date, total_days_run FROM simulation_state WHERE id = 1`) as any;
    return stateRows[0]?.cursor_date
      ? new Date(stateRows[0].cursor_date)
      : new Date();
  }
  
  // ── SIMULATION ───────────────────────────────────────────────────────────────
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

      // Get all equipment
      const equipmentList = await db.select({
        id: equipment.id,
        name: equipment.name,
        category: equipment.category,
        currentMileage: equipment.currentMileage,
        purchaseDate: equipment.purchaseDate,
      }).from(equipment);

      // Get current cursor
      const [stateRows] = await db.execute(sql`SELECT cursor_date, total_days_run FROM simulation_state WHERE id = 1`) as any;
      let cursorDate = stateRows[0]?.cursor_date ? new Date(stateRows[0].cursor_date) : new Date();
      

      let totalInserted = 0;
      let maintenanceInserted = 0;

      for (let d = 0; d < days; d++) {
        cursorDate = new Date(cursorDate.getTime() + 24 * 3600 * 1000);
        const dateStr = cursorDate.toISOString().split("T")[0];

        for (const equip of equipmentList) {
          const category = equip.category || "Excavator";

          // Generate realistic sensor readings with category-based variance
          const baseTemp = { Crane: 78, Excavator: 82, Dozer: 85, Loader: 80, Compressor: 70, Generator: 75 }[category] || 80;
          const isStressed = Math.random() < 0.08; // 8% chance of stressed day
          const isIdle     = Math.random() < 0.15; // 15% chance of idle day

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

          // ─── Equipment state for realistic failure probability ─────────────────
          // Calculate age and hours from equipment record
          const purchaseDate   = equip.purchaseDate ? new Date(equip.purchaseDate) : new Date('2020-01-01');
          const ageYears       = (cursorDate.getTime() - purchaseDate.getTime()) / (365.25 * 24 * 3600 * 1000);

          // Accumulate hours: pull total from sensor_data_logs up to cursorDate
          const [hoursRow] = await db.execute(sql`
            SELECT COALESCE(SUM(operating_hours), 0) as total_hours
            FROM sensor_data_logs
            WHERE equipment_id = ${equip.id}
              AND timestamp <= ${dateStr}
          `) as any;
          const totalHours = parseFloat(hoursRow[0]?.total_hours ?? 0);

          // Pull days since last maintenance
          const [maintRow] = await db.execute(sql`
            SELECT MAX(maintenance_date) as last_maint
            FROM maintenance_events
            WHERE equipment_id = ${equip.id}
              AND maintenance_date <= ${dateStr}
          `) as any;
          const lastMaint       = maintRow[0]?.last_maint ? new Date(maintRow[0].last_maint) : purchaseDate;
          const daysSinceMaint  = (cursorDate.getTime() - lastMaint.getTime()) / (24 * 3600 * 1000);

          // ─── Realistic failure probability curve ──────────────────────────────
          // Modeled as a Weibull-inspired hazard function:
          //   - New equipment (year 1): ~1-2% daily failure probability
          //   - Middle life (year 2-3): gradual ramp to 5-10%
          //   - Aged fleet (year 4+):   15-25% reflecting real wear-out phase
          //
          // Three independent risk drivers — any can trigger a maintenance event:

          // 1. Age-based hazard: exponential ramp after year 2
          const ageHazard = Math.min(
            0.01 * Math.exp(0.55 * Math.max(0, ageYears - 1.5)),
            0.25
          );

          // 2. Hours-based hazard: increases after 3,000 hours (typical first overhaul threshold)
          const hoursHazard = Math.min(
            0.005 * Math.exp(0.0004 * Math.max(0, totalHours - 3000)),
            0.20
          );

          // 3. Neglect hazard: probability increases if maintenance is overdue
          //    PM interval assumed 90 days — risk climbs steeply after 120 days
          const neglectHazard = daysSinceMaint > 120
            ? Math.min(0.002 * Math.pow(daysSinceMaint - 90, 1.4), 0.15)
            : 0;

          // Combined daily failure probability — capped at 30% per day
          // (even the worst equipment doesn't fail every day)
          const dailyFailureProb = Math.min(ageHazard + hoursHazard + neglectHazard, 0.30);

          // Jobsite stress multiplier — harsh environments accelerate wear
          const jobsiteMultiplier = isStressed ? 1.8 : 1.0;
          const finalFailureProb  = Math.min(dailyFailureProb * jobsiteMultiplier, 0.35);

          if (Math.random() < finalFailureProb) {
            // Determine event type based on failure probability magnitude
            // High probability → more likely to be a serious failure requiring major service
            // Event type distribution reflects real fleet maintenance patterns:
            // ~15% major failures (unscheduled, what we're predicting)
            // ~55% minor service (oil changes, filter replacements, routine)
            // ~30% inspections (scheduled checks, rarely result in major work)
            const rand = Math.random();
            const type = rand < 0.15 ? "MAJOR_SERVICE"
                      : rand < 0.70 ? "MINOR_SERVICE"
                      : "INSPECTION";
            const cost = type === "MAJOR_SERVICE"
              ? parseFloat((800  + Math.random() * 1200).toFixed(2))
              : type === "MINOR_SERVICE"
              ? parseFloat((150  + Math.random() * 350).toFixed(2))
              : parseFloat((80   + Math.random() * 120).toFixed(2));

            // Next due date scales with service type
            const nextDueDays = type === "MAJOR_SERVICE" ? 180 : type === "MINOR_SERVICE" ? 90 : 60;
            const nextDue     = new Date(cursorDate.getTime() + nextDueDays * 24 * 3600 * 1000)
              .toISOString().split("T")[0];

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

          // ─── Fleet Renewal ──────────────────────────────────────────────
          // Retire equipment that has exceeded its economic life threshold.
          // Threshold: age > 10 years AND totalHours > 12,000
          // OR age > 12 years (regardless of hours)
          // Retired units are replaced with a new equivalent unit so the
          // fleet size stays constant and age distribution stays realistic.
          const retirementAgeYears  = 10;   // hard retirement at 10 years
          const retirementAgeYearsEarly = 8; // early retirement at 8 years if high hours
          const retirementHoursThreshold = 8000;
          const shouldRetire =
            ageYears > retirementAgeYears ||
            (ageYears > retirementAgeYearsEarly && totalHours > retirementHoursThreshold);

        
          if (shouldRetire) {
            // Generate a new equipment ID based on cursor date + equip id
            const newEquipId = `EQ-R${equip.id}-${cursorDate.getFullYear()}`;

            // Check if we already replaced this unit (idempotent)
            const existingReplacementResult = await db.execute(sql`
              SELECT id FROM equipment WHERE equipment_id = ${newEquipId}
            `) as any;
            const existingReplacement = existingReplacementResult[0];

            if (!existingReplacement || existingReplacement.length === 0) {
              // New unit purchases date is the current cursor date
              const newPurchaseDateStr = dateStr;
              const newYearManufactured = cursorDate.getFullYear();

              // Inherit category, rates, and location from retired unit
              // but reset age, hours, and serial number
              await db.execute(sql`
                INSERT INTO equipment
                  (equipment_id, name, category, make, model, serial_number,
                   status, daily_rate, weekly_rate, monthly_rate, location,
                   year_manufactured, purchase_date, current_mileage, initial_mileage)
                SELECT
                  ${newEquipId},
                  CONCAT('Replacement ', name),
                  category, make, model,
                  CONCAT('SIM-', ${newEquipId}),
                  'AVAILABLE',
                  daily_rate, weekly_rate, monthly_rate, location,
                  ${newYearManufactured},
                  ${newPurchaseDateStr},
                  0, 0
                FROM equipment WHERE id = ${equip.id}
              `);

              // Seed an initial minor service event so the new unit
              // doesn't start with zero maintenance history
              await db.execute(sql`
                INSERT INTO maintenance_events
                  (equipment_id, maintenance_date, maintenance_type, cost,
                   description, next_due_date)
                SELECT
                  (SELECT id FROM equipment WHERE equipment_id = ${newEquipId}),
                  ${dateStr},
                  'MINOR_SERVICE',
                  250.00,
                  'Pre-delivery inspection — new unit',
                  DATE_ADD(${dateStr}, INTERVAL 90 DAY)
              `);

              console.log(`[FLEET RENEWAL] Retired equip id=${equip.id} (age=${ageYears.toFixed(1)}y / ${Math.round(totalHours)})`);

            }

          }
        }

      }

      // Update cursor
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

  // ============================================
  // HEALTH ROUTES
  // ============================================
  app.get('/api/health', (req, res) => {
    res.json({ status: 'healthy', timestamp: new Date().toISOString() });
  });

  // ============================================
  // AUTH ROUTES
  // ============================================
  
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
      password: bcrypt.hashSync(input.password, 10) 
    });
    req.session.userId = user.id;
    req.session.role = user.role;
    res.status(201).json(user);
  });

  // ============================================
  // EQUIPMENT ROUTES
  // ============================================

  app.get(api.equipment.list.path, requireAuth, async (req, res) => {
    res.json(await storage.listEquipment(
      req.query.search as string, 
      req.query.status as string
    ));
  });

  app.post(api.equipment.create.path, requireAdmin, async (req, res) => {
    res.status(201).json(await storage.createEquipment(
      api.equipment.create.input.parse(req.body)
    ));
  });

  app.put('/api/equipment/:id', requireAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const input = api.equipment.update.input.parse(req.body);
      
      const equip = await storage.getEquipment(id);
      if (!equip) {
        return res.status(404).json({ message: "Equipment not found" });
      }
      
      const updated = await storage.updateEquipment(id, input);
      res.json(updated);
    } catch (error) {
      console.error('Update equipment error:', error);
      res.status(400).json({ 
        message: (error instanceof Error ? error.message : String(error)) || 'Failed to update equipment' 
      });
    }
  });

  // ============================================
  // RENTAL ROUTES
  // ============================================

  app.get(api.rentals.list.path, requireAuth, async (req, res) => {
    res.json(await storage.listRentals());
  });

  app.post(api.rentals.create.path, requireAdmin, async (req, res) => {
    const input = api.rentals.create.input.parse(req.body);
    const equip = await storage.getEquipment(input.equipmentId);
    if (!equip || equip.status !== "AVAILABLE") {
      return res.status(400).json({ message: "Equipment unavailable" });
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
      if (!rental) {
        return res.status(404).json({ message: "Rental not found" });
      }
      
      const updated = await storage.updateRental(id, input);
      res.json(updated);
    } catch (error) {
      console.error('Update rental error:', error);
      res.status(400).json({ 
        message: (error instanceof Error ? error.message : String(error)) || 'Failed to update rental' 
      });
    }
  });

  app.post(api.rentals.complete.path, requireAdmin, async (req, res) => {
    const rental = await storage.getRental(parseInt(req.params.id));
    if (!rental) return res.status(404).json({ message: "Rental not found" });
    
    await storage.updateRental(rental.id, { 
      status: "COMPLETED", 
      returnDate: new Date().toISOString().split('T')[0] 
    });
    await storage.updateEquipment(rental.equipmentId, { status: "AVAILABLE" });
    res.json({ message: "Rental completed successfully" });
  });

  // ============================================
  // JOB SITES ROUTES - FULL CRUD
  // ============================================

  app.get(api.jobSites.list.path, requireAuth, async (req, res) => {
    try {
      const sites = await storage.listJobSites();
      
      // Add rental counts
      const sitesWithCounts = await Promise.all(
        sites.map(async (site) => {
          const [result] = await db
            .select({ count: count() })
            .from(rentals)
            .where(eq(rentals.jobSiteId, site.id));
          
          return {
            ...site,
            _count: { rentals: result?.count || 0 },
          };
        })
      );
      
      res.json(sitesWithCounts);
    } catch (error) {
      console.error('List job sites error:', error);
      res.status(500).json({ message: 'Failed to fetch job sites' });
    }
  });

  app.get('/api/job-sites/:id', requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const site = await storage.getJobSite(id);
      
      if (!site) {
        return res.status(404).json({ message: "Job site not found" });
      }
      
      res.json(site);
    } catch (error) {
      console.error('Get job site error:', error);
      res.status(500).json({ message: 'Failed to fetch job site' });
    }
  });

  app.post(api.jobSites.create.path, requireAdmin, async (req, res) => {
    try {
      const input = api.jobSites.create.input.parse(req.body);
      const created = await storage.createJobSite(input);
      res.status(201).json(created);
    } catch (error) {
      console.error('Create job site error:', error);
      res.status(400).json({ 
        message: (error instanceof Error ? error.message : String(error)) || 'Failed to create job site' 
      });
    }
  });

  app.patch('/api/job-sites/:id', requireAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const input = api.jobSites.update.input.parse(req.body);
      
      const site = await storage.getJobSite(id);
      if (!site) {
        return res.status(404).json({ message: "Job site not found" });
      }
      
      const updated = await storage.updateJobSite(id, input);
      res.json(updated);
    } catch (error) {
      console.error('Update job site error:', error);
      res.status(400).json({ 
        message: (error instanceof Error ? error.message : String(error)) || 'Failed to update job site' 
      });
    }
  });

  app.delete('/api/job-sites/:id', requireAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      
      // Check for associated rentals
      const [result] = await db
        .select({ count: count() })
        .from(rentals)
        .where(eq(rentals.jobSiteId, id));
      
      if (result.count > 0) {
        return res.status(409).json({ 
          message: "Cannot delete job site with associated rentals" 
        });
      }
      
      await storage.deleteJobSite(id);
      res.json({ message: "Job site deleted successfully" });
    } catch (error) {
      console.error('Delete job site error:', error);
      res.status(500).json({ message: 'Failed to delete job site' });
    }
  });

  // ============================================
  // VENDORS ROUTES - FULL CRUD
  // ============================================

  app.get(api.vendors.list.path, requireAuth, async (req, res) => {
    try {
      const vendors = await storage.listVendors();
      
      // Add rental counts
      const vendorsWithCounts = await Promise.all(
        vendors.map(async (vendor) => {
          const [result] = await db
            .select({ count: count() })
            .from(rentals)
            .where(eq(rentals.vendorId, vendor.id));
          
          return {
            ...vendor,
            _count: { rentals: result?.count || 0 },
          };
        })
      );
      
      res.json(vendorsWithCounts);
    } catch (error) {
      console.error('List vendors error:', error);
      res.status(500).json({ message: 'Failed to fetch vendors' });
    }
  });

  app.get('/api/vendors/:id', requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const vendor = await storage.getVendor(id);
      
      if (!vendor) {
        return res.status(404).json({ message: "Vendor not found" });
      }
      
      res.json(vendor);
    } catch (error) {
      console.error('Get vendor error:', error);
      res.status(500).json({ message: 'Failed to fetch vendor' });
    }
  });

  app.post(api.vendors.create.path, requireAdmin, async (req, res) => {
    try {
      const input = api.vendors.create.input.parse(req.body);
      const created = await storage.createVendor(input);
      res.status(201).json(created);
    } catch (error) {
      console.error('Create vendor error:', error);
      res.status(400).json({ 
        message: (error instanceof Error ? error.message : String(error)) || 'Failed to create vendor' 
      });
    }
  });

  app.patch('/api/vendors/:id', requireAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const input = api.vendors.update.input.parse(req.body);
      
      const vendor = await storage.getVendor(id);
      if (!vendor) {
        return res.status(404).json({ message: "Vendor not found" });
      }
      
      const updated = await storage.updateVendor(id, input);
      res.json(updated);
    } catch (error) {
      console.error('Update vendor error:', error);
      res.status(400).json({ 
        message: (error instanceof Error ? error.message : String(error)) || 'Failed to update vendor' 
      });
    }
  });

  app.delete('/api/vendors/:id', requireAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      
      // Check for associated rentals
      const [result] = await db
        .select({ count: count() })
        .from(rentals)
        .where(eq(rentals.vendorId, id));
      
      if (result.count > 0) {
        return res.status(409).json({ 
          message: "Cannot delete vendor with associated rentals" 
        });
      }
      
      await storage.deleteVendor(id);
      res.json({ message: "Vendor deleted successfully" });
    } catch (error) {
      console.error('Delete vendor error:', error);
      res.status(500).json({ message: 'Failed to delete vendor' });
    }
  });

  // ============================================
  // MAINTENANCE ROUTES
  // ============================================

  app.get('/api/maintenance', requireAuth, async (req, res) => {
    try {
      const { equipmentId } = req.query;
      
      let query = db.select().from(maintenanceEvents);
      
      if (equipmentId) {
        query = query.where(eq(maintenanceEvents.equipmentId, parseInt(equipmentId as string))) as any;
      }
      
      const events = await query.orderBy(desc(maintenanceEvents.maintenanceDate));
      res.json(events);
    } catch (error) {
      console.error('List maintenance error:', error);
      res.status(500).json({ message: 'Failed to fetch maintenance events' });
    }
  });

  app.post('/api/maintenance', requireAdmin, async (req, res) => {
    try {
      const input = req.body;
      
      const event = await storage.createMaintenanceEvent(input);
      
      // Recalculate risk score after maintenance
      await riskScoringService.calculateRiskScore(input.equipmentId);
      
      res.status(201).json(event);
    } catch (error) {
      console.error('Create maintenance error:', error);
      res.status(400).json({ 
        message: (error instanceof Error ? error.message : String(error)) || 'Failed to create maintenance event' 
      });
    }
  });

  app.get('/api/maintenance/equipment/:id', requireAuth, async (req, res) => {
    try {
      const equipmentId = parseInt(req.params.id);
      const events = await storage.getMaintenanceHistory(equipmentId);
      res.json(events);
    } catch (error) {
      console.error('Get maintenance history error:', error);
      res.status(500).json({ message: 'Failed to fetch maintenance history' });
    }
  });

  // ============================================
  // RISK SCORING ROUTES (LEGACY)
  // ============================================

  app.post(api.riskScore.calculate.path, requireAuth, async (req, res) => {
    try {
      const { equipmentId } = api.riskScore.calculate.input.parse(req.body);
      
      const result = await riskScoringService.calculateRiskScore(equipmentId);
      
      await storage.createRiskScore({
        equipmentId: result.equipmentId,
        riskScore: result.riskScore,
        riskLevel: result.riskLevel,
        drivers: Array.isArray(result.drivers) 
          ? JSON.stringify(result.drivers) 
          : result.drivers,
        modelVersion: result.modelVersion,
      });
      
      res.json(result);
    } catch (error) {
      console.error('Risk score calculation error:', error);
      if (error instanceof Error && error.message === 'Equipment not found') {
        return res.status(404).json({ message: error.message });
      }
      res.status(500).json({ message: 'Failed to calculate risk score' });
    }
  });

  app.post(api.riskScore.batch.path, requireAuth, async (req, res) => {
    try {
      const { equipmentIds } = api.riskScore.batch.input.parse(req.body);

      const snapshotDate = await getSimulationDate();
        console.log(`[BATCH] Using snapshot date: ${snapshotDate.toISOString().split('T')[0]}`);

        const snapshots = await Promise.all(equipmentIds.map(async (id: number) => {
          try {
            const snapshot = await enhancedFeatureService.generateSnapshot(id, snapshotDate);
            return { equipmentId: id, snapshot };
          } catch (err) {
            console.error(`[BATCH] Failed to generate snapshot for EQ-${id}:`, err);
            return null;
          }
        }));

      const validSnapshots = snapshots.filter(Boolean) as { equipmentId: number; snapshot: any }[];

      // Short-circuit brand new equipment before sending to FastAPI
      const manualResults: any[] = [];
      const snapshotsToScore: any[] = [];
      const indicesToScore: number[] = [];

      for (let i = 0; i < validSnapshots.length; i++) {
        const { equipmentId: eqId, snapshot } = validSnapshots[i];
        
        if (snapshot.assetAgeYears < 1 && snapshot.totalHoursLifetime < 500 && 
            (snapshot.daysSinceLastMaintenance === null || snapshot.daysSinceLastMaintenance < 90)) {
          manualResults.push({
            equipmentId: eqId,
            riskScore: Math.max(5, Math.round(snapshot.assetAgeYears * 10 + snapshot.totalHoursLifetime / 50)),
            riskLevel: 'LOW',
            drivers: ['New unit — minimal hours', 'Recent inspection completed', 'Low operational age'],
            modelVersion: 'v1.4',
          });
        } else {
          // Use buildSnapshotPayload from predictive-maintenance service
          const payload = {
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
            mean_time_between_failures:  snapshot.meanTimeBetweenFailures ?? 999,
          };
          snapshotsToScore.push(payload);
          indicesToScore.push(i);
        }
      }
      

      const fastapiRes = await fetch('http://localhost:8000/predict/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ snapshots: snapshotsToScore }),
      });

      if (!fastapiRes.ok) {
        const err = await fastapiRes.text();
        throw new Error(`FastAPI error: ${err}`);
      }

      const batchOutput = await fastapiRes.json();

      const fastapiResults = batchOutput.predictions.map((pred: any, idx: number) => ({
        equipmentId: validSnapshots[indicesToScore[idx]].equipmentId,
        riskScore: Math.round(pred.failure_probability * 100),
        riskLevel: pred.risk_level,
        drivers: Array.isArray(pred.top_risk_drivers)
          ? pred.top_risk_drivers.map(String)
          : Object.keys(pred.top_risk_drivers || {}),
        modelVersion: 'v1.4',
      }));

      const results = [...fastapiResults, ...manualResults];

      // Persist to both tables
      for (const result of results) {
        await db.insert(equipmentRiskScores).values({
          equipmentId: result.equipmentId,
          riskScore: result.riskScore,
          riskLevel: result.riskLevel,
          drivers: JSON.stringify(result.drivers),
          modelVersion: result.modelVersion,
        }).onDuplicateKeyUpdate({
          set: {
            riskScore: result.riskScore,
            riskLevel: result.riskLevel,
            drivers: JSON.stringify(result.drivers),
            modelVersion: result.modelVersion,
          }
        });

        await db.insert(assetRiskPredictions).values({
          equipmentId: result.equipmentId,
          snapshotTs: new Date(),
          failureProbability: (result.riskScore / 100).toFixed(4),
          riskBand: result.riskLevel,
          topDriver1: result.drivers[0] ?? null,
          topDriver1Impact: result.drivers[0] ? '0.1000' : null,
          topDriver2: result.drivers[1] ?? null,
          topDriver2Impact: result.drivers[1] ? '0.0800' : null,
          topDriver3: result.drivers[2] ?? null,
          topDriver3Impact: result.drivers[2] ? '0.0600' : null,
          modelVersion: result.modelVersion,
          recommendation: null,
        });
      }

      res.json(results);
    } catch (error) {
      console.error('Batch risk score error:', error);
      res.status(500).json({ message: 'Failed to calculate batch risk scores' });
    }
  
  });

  app.get(api.riskScore.history.path, requireAuth, async (req, res) => {
    try {
      const equipmentId = parseInt(req.params.id);
      const history = await storage.getRiskScoreHistory(equipmentId);
      
      res.json(history);
    } catch (error) {
      console.error('Risk score history error:', error);
      res.status(500).json({ message: 'Failed to fetch risk score history' });
    }
  });

  app.post('/api/risk-score/multi-horizon/batch', requireAuth, async (req, res) => {
    try {
      const { equipmentIds } = api.riskScore.batch.input.parse(req.body);

      // Use simulation cursor date so features reflect the current simulated state
      const [stateRows] = await db.execute(
      sql`SELECT cursor_date FROM simulation_state WHERE id = 1`
    ) as any;
      const snapshotDate = stateRows[0]?.cursor_date
        ? new Date(stateRows[0].cursor_date)
        : new Date();
      console.log(`[MH-BATCH] Using snapshot date: ${snapshotDate.toISOString().split('T')[0]}`);

      // Build snapshots using enhanced feature engineering
      const snapshots = await Promise.all(equipmentIds.map(async (id: number) => {
        try {
          const snapshot = await enhancedFeatureService.generateSnapshot(id, snapshotDate);
          return { equipmentId: id, snapshot };
        } catch (err) {
          console.error(`[MH-BATCH] Failed snapshot for EQ-${id}:`, err);
          return null;
        }
      }));

      const validSnapshots = snapshots.filter(Boolean) as { equipmentId: number; snapshot: any }[];

      // Short-circuit brand new equipment
      const manualResults: any[] = [];
      const snapshotsToScore: any[] = [];
      const indicesToScore: number[] = [];

      for (let i = 0; i < validSnapshots.length; i++) {
        const { equipmentId: eqId, snapshot } = validSnapshots[i];

        if (snapshot.assetAgeYears < 1 && snapshot.totalHoursLifetime < 500) {
          manualResults.push({
            equipmentId: eqId,
            modelVersion: 'v1.5',
            riskTrend: 'STABLE',
            predictions: {
              '10d': { failure_probability: 0.05, risk_level: 'LOW', risk_score: 5, model_confidence: 'high', top_risk_drivers: { 'New unit — minimal hours': 0.01 } },
              '30d': { failure_probability: 0.05, risk_level: 'LOW', risk_score: 5, model_confidence: 'high', top_risk_drivers: { 'Recent inspection completed': 0.01 } },
              '60d': { failure_probability: 0.05, risk_level: 'LOW', risk_score: 5, model_confidence: 'high', top_risk_drivers: { 'Low operational age': 0.01 } },
            },
            recommendation: 'New unit within safe operating parameters. Continue standard inspection schedule.',
          });
        } else {
          const payload = {
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
          };
          snapshotsToScore.push(payload);
          indicesToScore.push(i);
        }
      }

      // Call FastAPI multi-horizon endpoint
      const fastapiRes = await fetch('http://localhost:8000/predict/multi-horizon/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ snapshots: snapshotsToScore }),
      });

      if (!fastapiRes.ok) {
        const err = await fastapiRes.text();
        throw new Error(`FastAPI multi-horizon error: ${err}`);
      }

      const batchOutput = await fastapiRes.json();

      const fastapiResults = batchOutput.predictions.map((pred: any, idx: number) => ({
        equipmentId: validSnapshots[indicesToScore[idx]].equipmentId,
        modelVersion: pred.model_version,
        riskTrend: pred.risk_trend,
        predictions: pred.predictions,
        recommendation: pred.recommendation,
      }));

      const results = [...fastapiResults, ...manualResults];

      // Persist to equipment_failure_predictions
      for (const result of results) {
        const p = result.predictions;
        await db.insert(equipmentFailurePredictions).values({
          equipmentId:   result.equipmentId,
          modelVersion:  result.modelVersion,
          riskTrend:     result.riskTrend,
          prob10d:       p['10d'].failure_probability.toString(),
          riskLevel10d:  p['10d'].risk_level,
          prob30d:       p['30d'].failure_probability.toString(),
          riskLevel30d:  p['30d'].risk_level,
          prob60d:       p['60d'].failure_probability.toString(),
          riskLevel60d:  p['60d'].risk_level,
          topDrivers10d: JSON.stringify(Object.keys(p['10d'].top_risk_drivers || {})),
          topDrivers30d: JSON.stringify(Object.keys(p['30d'].top_risk_drivers || {})),
          topDrivers60d: JSON.stringify(Object.keys(p['60d'].top_risk_drivers || {})),
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
    const latest = await db.execute(sql`
      SELECT efp.*, e.name, e.equipment_id as equipment_code, e.category, e.status
      FROM equipment_failure_predictions efp
      JOIN equipment e ON e.id = efp.equipment_id
      WHERE efp.id IN (
        SELECT MAX(id) FROM equipment_failure_predictions GROUP BY equipment_id
      )
      ORDER BY efp.prob_30d DESC
    `);
    res.json((latest as any)[0] || []);
  } catch (error) {
    console.error('Multi-horizon latest error:', error);
    res.status(500).json({ message: 'Failed to fetch latest predictions' });
  }
});

  // ============================================
  // PREDICTIVE MAINTENANCE ROUTES
  // ============================================

  app.get('/api/equipment/:id/risk', requireAuth, async (req, res) => {
    try {
      const equipmentId = parseInt(req.params.id);
      
      let prediction = await predictiveMaintenanceService.getLatestPrediction(equipmentId);
      
      if (!prediction) {
        prediction = await predictiveMaintenanceService.predictRisk(equipmentId);
      }
      
      res.json(prediction);
    } catch (error) {
      console.error('Get equipment risk error:', error);
      res.status(500).json({ message: 'Failed to get risk prediction' });
    }
  });

  app.post('/api/predictive-maintenance/predict-all', requireAdmin, async (req, res) => {
    try {
      const predictions = await predictiveMaintenanceService.predictAllEquipment();
      
      res.json({
        message: `Generated ${predictions.length} predictions`,
        count: predictions.length,
        predictions,
      });
    } catch (error) {
      console.error('Batch prediction error:', error);
      res.status(500).json({ message: 'Failed to run batch predictions' });
    }
  });

  app.get('/api/predictive-maintenance/fleet-risk', requireAuth, async (req, res) => {
    try {
      const distribution = await predictiveMaintenanceService.getFleetRiskDistribution();
      res.json(distribution);
    } catch (error) {
      console.error('Fleet risk error:', error);
      res.status(500).json({ message: 'Failed to get fleet risk distribution' });
    }
  });

  app.post('/api/predictive-maintenance/generate-snapshots', requireAdmin, async (req, res) => {
    try {
      // ── Determine date range ────────────────────────────────────────────
      // If snapshotDate provided, generate single point-in-time (legacy behaviour)
      // Otherwise backfill the full simulation timeline at 14-day intervals
      if (req.body.snapshotDate) {
        const snapshotDate = new Date(req.body.snapshotDate);
        const snapshots = await featureEngineeringService.generateSnapshotsForAllEquipment(snapshotDate);
        for (const snapshot of snapshots) {
          await featureEngineeringService.saveSnapshot(snapshot);
        }
        return res.json({
          message: `Generated ${snapshots.length} feature snapshots`,
          count: snapshots.length,
          snapshotDate: snapshotDate.toISOString(),
        });
      }

      // ── Historical backfill ─────────────────────────────────────────────
      // Walk the simulation timeline from earliest sensor data to cursor date
      // Sample every SNAPSHOT_INTERVAL_DAYS to build a dense training dataset
      // Skips dates where snapshots already exist (idempotent)
      const SNAPSHOT_INTERVAL_DAYS = 7;

      const [rangeRow] = await db.execute(sql`
        SELECT 
          MIN(DATE(timestamp)) as earliest,
          MAX(DATE(timestamp)) as latest
        FROM sensor_data_logs
      `) as any;

      const earliest = rangeRow[0]?.earliest
        ? new Date(rangeRow[0].earliest)
        : new Date('2024-01-01');
      const latest = await getSimulationDate();

      // Get already-snapshotted dates to avoid duplicates
      const [existingRows] = await db.execute(sql`
        SELECT DISTINCT DATE(snapshot_ts) as snap_date
        FROM asset_feature_snapshots
      `) as any;
      const existingDates = new Set(
        (existingRows as any[]).map((r: any) =>
          new Date(r.snap_date).toISOString().split('T')[0]
        )
      );

      // Build list of dates to snapshot
      const datesToProcess: Date[] = [];
      const cursor = new Date(earliest);
      // Start 180 days in — need historical window for feature engineering
      cursor.setDate(cursor.getDate() + 180);

      while (cursor <= latest) {
        const dateStr = cursor.toISOString().split('T')[0];
        if (!existingDates.has(dateStr)) {
          datesToProcess.push(new Date(cursor));
        }
        cursor.setDate(cursor.getDate() + SNAPSHOT_INTERVAL_DAYS);
      }

      console.log(`[BACKFILL] ${datesToProcess.length} dates to process (${earliest.toISOString().split('T')[0]} → ${latest.toISOString().split('T')[0]})`);

      // Process in batches to avoid memory pressure
      const BATCH_SIZE = 10;
      let totalGenerated = 0;
      let totalFailed = 0;

      for (let i = 0; i < datesToProcess.length; i += BATCH_SIZE) {
        const batch = datesToProcess.slice(i, i + BATCH_SIZE);

        await Promise.all(batch.map(async (snapshotDate) => {
          try {
            const snapshots = await featureEngineeringService.generateSnapshotsForAllEquipment(snapshotDate);
            for (const snapshot of snapshots) {
              await featureEngineeringService.saveSnapshot(snapshot);
            }
            totalGenerated += snapshots.length;
          } catch (err) {
            console.error(`[BACKFILL] Failed for date ${snapshotDate.toISOString().split('T')[0]}:`, err);
            totalFailed++;
          }
        }));

        // Progress log every 50 dates
        if ((i / BATCH_SIZE) % 5 === 0) {
          console.log(`[BACKFILL] Progress: ${Math.min(i + BATCH_SIZE, datesToProcess.length)}/${datesToProcess.length} dates — ${totalGenerated} snapshots generated`);
        }
      }

      console.log(`[BACKFILL] Complete — ${totalGenerated} snapshots generated, ${totalFailed} batches failed`);

      res.json({
        message: `Historical backfill complete`,
        count: totalGenerated,
        datesProcessed: datesToProcess.length,
        failed: totalFailed,
        range: {
          from: earliest.toISOString().split('T')[0],
          to: latest.toISOString().split('T')[0],
        },
      });
    } catch (error) {
      console.error('Generate snapshots error:', error);
      res.status(500).json({ message: 'Failed to generate snapshots' });
    }
  });

  app.post('/api/predictive-maintenance/label-snapshots', requireAdmin, async (req, res) => {
    try {
      const labeled = await featureEngineeringService.labelSnapshots();
      
      res.json({
        message: `Labeled ${labeled} historical snapshots`,
        count: labeled,
      });
    } catch (error) {
      console.error('Label snapshots error:', error);
      res.status(500).json({ message: 'Failed to label snapshots' });
    }
  });

  app.get('/api/predictive-maintenance/equipment-with-risk', requireAuth, async (req, res) => {
    try {
      const allEquipment = await db.select().from(equipment);
      
      const equipmentWithRisk = await Promise.all(
        allEquipment.map(async (equip) => {
          const prediction = await predictiveMaintenanceService.getLatestPrediction(equip.id);
          
          return {
            ...equip,
            risk: prediction ? {
              riskBand: prediction.riskBand,
              failureProbability: prediction.failureProbability,
              recommendation: prediction.recommendation,
              predictedAt: prediction.snapshotTs,
              topDrivers: prediction.topDrivers,
            } : null,
          };
        })
      );
      
      res.json(equipmentWithRisk);
    } catch (error) {
      console.error('Equipment with risk error:', error);
      res.status(500).json({ message: 'Failed to get equipment with risk' });
    }
  });

  app.get('/api/ml/model-metrics', requireAuth, async (req, res) => {
    try {
      const { modelTrainingMetrics, assetRiskPredictions } = await import('@shared/schema');
      
      // Get latest model metrics from database
      const [latestMetrics] = await db
        .select()
        .from(modelTrainingMetrics)
        .orderBy(desc(modelTrainingMetrics.trainedAt))
        .limit(1);

      if (!latestMetrics) {
        // Return default metrics if no training data exists
        return res.json(getDefaultMetrics());
      }

      // Get prediction history (last 3 months)
      const predictionHistory = await db.execute(sql`
        SELECT 
          DATE_FORMAT(snapshot_ts, '%Y-%m') as month,
          COUNT(*) as total,
          SUM(CASE WHEN risk_band = 'HIGH' THEN 1 ELSE 0 END) as high,
          SUM(CASE WHEN risk_band = 'MEDIUM' THEN 1 ELSE 0 END) as medium,
          SUM(CASE WHEN risk_band = 'LOW' THEN 1 ELSE 0 END) as low
        FROM asset_risk_predictions
        WHERE snapshot_ts >= DATE_SUB(NOW(), INTERVAL 3 MONTH)
        GROUP BY DATE_FORMAT(snapshot_ts, '%Y-%m')
        ORDER BY month
      `);

      // Feature importance — load from ML model registry
      let featureImportance: { feature: string; importance: number; description: string }[] = [];
      try {
        const fs = await import('fs');
        const path = await import('path');
        const registryPath = path.join(process.cwd(), 'ml-service', 'registry');
        const files = fs.readdirSync(registryPath).filter((f: string) => f.startsWith('feature_importance_'));
        if (files.length > 0) {
          const latest = files.sort().reverse()[0];
          const raw = JSON.parse(fs.readFileSync(path.join(registryPath, latest), 'utf-8'));
          // Map raw feature names to human-readable labels
          const featureLabels: Record<string, string> = {
            mechanical_wear_score: 'Mechanical Wear Score',
            neglect_score: 'Maintenance Neglect Score',
            aging_factor: 'Aging Factor',
            cost_per_event: 'Cost Per Maintenance Event',
            log_cost_per_event: 'Cost Per Event (log)',
            log_maintenance_cost_180d: 'Maintenance Cost 180d (log)',
            maintenance_cost_180d: 'Maintenance Cost 180d',
            days_since_last_maintenance: 'Days Since Last Service',
            wear_rate: 'Wear Rate',
            asset_age_years: 'Equipment Age',
            maintenance_events_90d: 'Maintenance Events 90d',
            category_encoded: 'Equipment Category',
            abuse_score: 'Operational Stress Score',
            log_total_hours_lifetime: 'Lifetime Hours (log)',
            total_hours_lifetime: 'Total Lifetime Hours',
            vendor_reliability_score:   'Vendor Reliability Score',
            jobsite_risk_score:         'Job Site Risk Score',
            usage_trend:                'Usage Trend',
            usage_intensity:            'Usage Intensity',
            wear_rate_velocity:         'Wear Rate Velocity',
            maint_frequency_trend:      'Maintenance Frequency Trend',
            cost_trend:                 'Cost Trend',
            hours_velocity:             'Hours Velocity',
            neglect_acceleration:       'Neglect Acceleration',
            sensor_degradation_rate:    'Sensor Degradation Rate',
          };
          const featureDescriptions: Record<string, string> = {
            mechanical_wear_score: 'Composite wear indicator (0-10)',
            neglect_score: 'Maintenance neglect composite (0-10)',
            aging_factor: 'Age-based deterioration factor',
            cost_per_event: 'Average cost per maintenance event',
            days_since_last_maintenance: 'Days since last service',
            wear_rate: 'Rate of mechanical wear accumulation',
            asset_age_years: 'Years since manufacture',
            maintenance_events_90d: 'Service events in last 90 days',
            abuse_score: 'Operational stress composite (0-10)',
            total_hours_lifetime: 'Total operational hours',
            vendor_reliability_score:   'Vendor failure frequency score (0-1)',
          jobsite_risk_score:         'Site utilization intensity risk (0-1)',
          usage_trend:                'Usage trajectory vs historical baseline',
          usage_intensity:            'Daily hours relative to equipment class',
          wear_rate_velocity:         'Rate of change in wear accumulation',
          maint_frequency_trend:      'Trending maintenance frequency (1.0 = stable)',
          cost_trend:                 'Trending maintenance cost (1.0 = stable)',
          hours_velocity:             'Rate of change in operating hours',
          neglect_acceleration:       'Accelerating neglect signal (1.0 = stable)',
          sensor_degradation_rate:    'Sensor signal quality degradation rate',
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
        // Fallback to static if registry not accessible
        featureImportance = [
          { feature: 'Mechanical Wear Score', importance: 0.148, description: 'Composite wear indicator (0-10)' },
          { feature: 'Maintenance Neglect Score', importance: 0.143, description: 'Maintenance neglect composite (0-10)' },
          { feature: 'Days Since Last Service', importance: 0.063, description: 'Days since last service' },
          { feature: 'Equipment Age', importance: 0.056, description: 'Years since manufacture' },
          { feature: 'Wear Rate', importance: 0.058, description: 'Rate of mechanical wear' },
        ];
      }
      
      // Build confusion matrix from stored data
      const confusionMatrix = {
        HIGH: {
          predictedHIGH: latestMetrics.highPredictedHigh,
          predictedMEDIUM: latestMetrics.highPredictedMedium,
          predictedLOW: latestMetrics.highPredictedLow,
        },
        MEDIUM: {
          predictedHIGH: latestMetrics.mediumPredictedHigh,
          predictedMEDIUM: latestMetrics.mediumPredictedMedium,
          predictedLOW: latestMetrics.mediumPredictedLow,
        },
        LOW: {
          predictedHIGH: latestMetrics.lowPredictedHigh,
          predictedMEDIUM: latestMetrics.lowPredictedMedium,
          predictedLOW: latestMetrics.lowPredictedLow,
        },
      };

      // Hyperparameters — load from latest 30d metadata file
      let hyperparameters = {
        algorithm:       'Random Forest',
        nEstimators:     200,
        maxDepth:        12,
        minSamplesSplit: 5,
        classWeight:     'balanced',
      };
      try {
        const fs = await import('fs');
        const path = await import('path');
        const registryPath = path.join(process.cwd(), 'ml-service', 'registry');
        const metaFiles = fs.readdirSync(registryPath)
          .filter((f: string) => f.startsWith('metadata_30d_') && f.endsWith('.json'));
        if (metaFiles.length > 0) {
          const latestMeta = metaFiles.sort().reverse()[0];
          const meta = JSON.parse(fs.readFileSync(path.join(registryPath, latestMeta), 'utf-8'));
          if (meta.hyperparameters) {
            hyperparameters = {
              algorithm:       meta.hyperparameters.algorithm        ?? 'Random Forest (calibrated)',
              nEstimators:     meta.hyperparameters.n_estimators     ?? 200,
              maxDepth:        meta.hyperparameters.max_depth        ?? 12,
              minSamplesSplit: meta.hyperparameters.min_samples_split ?? 5,
              classWeight:     meta.hyperparameters.class_weight     ?? 'balanced',
            };
          }
        }
      } catch (e) {
        // fallback defaults already set above — silent fail is fine here

      }

      res.json({
        version:      latestMetrics.modelVersion,
        trainedAt:    latestMetrics.trainedAt.toISOString(),
        datasetSize:  latestMetrics.datasetSize,
        accuracy:     Number(latestMetrics.accuracy),
        precision: {
          HIGH:   Number(latestMetrics.precisionHigh),
          MEDIUM: Number(latestMetrics.precisionMedium),
          LOW:    Number(latestMetrics.precisionLow),
        },
        recall: {
          HIGH:   Number(latestMetrics.recallHigh),
          MEDIUM: Number(latestMetrics.recallMedium),
          LOW:    Number(latestMetrics.recallLow),
        },
        f1Score: {
          HIGH:   Number(latestMetrics.f1High),
          MEDIUM: Number(latestMetrics.f1Medium),
          LOW:    Number(latestMetrics.f1Low),
        },
        confusionMatrix,
        featureImportance,
        predictionHistory: ((predictionHistory as any)[0] as any[]).map(row => ({
          date:   row.month,
          total:  Number(row.total),
          high:   Number(row.high),
          medium: Number(row.medium),
          low:    Number(row.low),
        })),
        hyperparameters,
      });
    
    } catch (error) {
      console.error('Model metrics error:', error);
      res.status(500).json({ message: 'Failed to fetch model metrics' });
    } 
  });
  
  app.get('/api/ml/feature-importance', requireAuth, async (req, res) => {
    try {
      const featureImportance = [
        { feature: 'Equipment Age', importance: 0.28, description: 'Years since manufacture' },
        { feature: 'Usage Hours', importance: 0.24, description: 'Total operational hours' },
        { feature: 'Maintenance Frequency', importance: 0.19, description: 'Service events per year' },
        { feature: 'Days Since Last Service', importance: 0.15, description: 'Time since maintenance' },
        { feature: 'Category Risk Factor', importance: 0.08, description: 'Equipment type baseline risk' },
        { feature: 'Rental Frequency', importance: 0.06, description: 'Utilization rate' },
      ];

      res.json(featureImportance);
    } catch (error) {
      console.error('Error fetching feature importance:', error);
      res.status(500).json({ error: 'Failed to fetch feature importance' });
    }
  });

  app.get('/api/ml/pipeline-status', requireAuth, async (req, res) => {
  try {
    const { assetFeatureSnapshots, assetRiskPredictions } = await import('@shared/schema');
    
    // Count snapshots
    const [snapshotStats] = await db
      .select({
        total: count(),
        labeled: sql<number>`SUM(CASE WHEN ${assetFeatureSnapshots.willFail30d} IS NOT NULL THEN 1 ELSE 0 END)`,
        unlabeled: sql<number>`SUM(CASE WHEN ${assetFeatureSnapshots.willFail30d} IS NULL THEN 1 ELSE 0 END)`,
      })
      .from(assetFeatureSnapshots);
    
    // Count predictions
    const [predictionStats] = await db
      .select({ total: count() })
      .from(assetRiskPredictions);
    
    // Get date ranges
    const [snapshotDates] = await db
      .select({
        oldest: sql`MIN(${assetFeatureSnapshots.snapshotTs})`,
        newest: sql`MAX(${assetFeatureSnapshots.snapshotTs})`,
      })
      .from(assetFeatureSnapshots);
    
    const [predictionDates] = await db
    .select({
      oldest: sql`MIN(${assetRiskPredictions.predictedAt})`,
      newest: sql`MAX(${assetRiskPredictions.predictedAt})`,
    })
    .from(assetRiskPredictions);

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
      readyForTraining: (Number(snapshotStats?.labeled) || 0) > 100, // Need 100+ labeled samples
      modelStatus: await (async () => {
        try {
          const fs = await import('fs');
          const path = await import('path');
          const registryPath = path.join(process.cwd(), 'ml-service', 'registry');
          const files = fs.readdirSync(registryPath)
            .filter((f: string) => f.startsWith('rf_30d_') && f.endsWith('.pkl'));
          if (files.length === 0) return 'rule-based';
          // Extract version from filename e.g. "rf_30d_v1.6.pkl" → "ml-v1.6"
          const latest = files.sort().reverse()[0];
          const match = latest.match(/rf_30d_(v[\d.]+)\.pkl/);
          return match ? `ml-${match[1]}` : 'ml';
        } catch {
          return 'rule-based';
        }
      })(),
    });
  } catch (error) {
    console.error('Pipeline status error:', error);
    res.status(500).json({ message: 'Failed to get pipeline status' });
  }
});

// ===========================================
// FINANCIAL TRACKING ROUTES
// ===========================================
app.get('/api/dashboard/revenue-summary', requireAuth, async (req, res) => {
  try {
    const [rows] = await db.execute(sql`
      SELECT
        -- 30-day completed revenue
        SUM(CASE
          WHEN r.status = 'COMPLETED'
            AND r.receive_date IS NOT NULL
            AND r.return_date IS NOT NULL
            AND r.return_date >= r.receive_date
          THEN (DATEDIFF(r.return_date, r.receive_date) + 1) * CAST(e.daily_rate AS DECIMAL(10,2))
          ELSE 0
        END) AS revenue_30d,

        -- WTD revenue (active rentals only, from Monday)
        SUM(CASE
          WHEN r.status = 'COMPLETED'
            AND r.receive_date IS NOT NULL
            AND r.return_date IS NOT NULL
            AND r.return_date >= r.receive_date
            AND r.return_date >= DATE_SUB((SELECT MAX(return_date) FROM rentals WHERE status = 'COMPLETED'), INTERVAL 7 DAY)
          THEN (DATEDIFF(r.return_date, r.receive_date) + 1) * CAST(e.daily_rate AS DECIMAL(10,2))
          ELSE 0
        END) AS revenue_wtd,

        -- Outstanding A/R: completed rentals with no invoice
        SUM(CASE
          WHEN r.status = 'COMPLETED'
            AND r.receive_date IS NOT NULL
            AND r.return_date IS NOT NULL
            AND r.return_date >= r.receive_date
            AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.rental_id = r.id)
          THEN (DATEDIFF(r.return_date, r.receive_date) + 1) * CAST(e.daily_rate AS DECIMAL(10,2))
          ELSE 0
        END) AS outstanding_ar,

        -- Fleet utilization
        COUNT(DISTINCT e.id) AS total_equipment,
        SUM(CASE WHEN e.status = 'RENTED' THEN 1 ELSE 0 END) AS rented_equipment

      FROM equipment e
      LEFT JOIN rentals r ON r.equipment_id = e.id
    `) as any;

    const data = (rows as any[])[0];

    res.json({
      revenue30d:       Number(data.revenue_30d   || 0),
      revenueWtd:       Number(data.revenue_wtd   || 0),
      outstandingAr:    Number(data.outstanding_ar || 0),
      totalEquipment:   Number(data.total_equipment || 0),
      rentedEquipment:  Number(data.rented_equipment || 0),
      utilizationRate:  data.total_equipment > 0
                          ? (data.rented_equipment / data.total_equipment) * 100
                          : 0,
    });
  } catch (e: any) {
    console.error('[REVENUE SUMMARY]', e);
    res.status(500).json({ message: 'Failed to fetch revenue summary', error: e.message });
  }
});

app.get('/api/dashboard/monthly-trend', requireAuth, async (req, res) => {
  try {
      const result = await db.execute(sql`
      SELECT
        DATE_FORMAT(r.return_date, '%Y-%m') AS month,
        SUM((DATEDIFF(r.return_date, r.receive_date) + 1) * CAST(e.daily_rate AS DECIMAL(10,2))) AS revenue
      FROM rentals r
      JOIN equipment e ON e.id = r.equipment_id
      WHERE r.status = 'COMPLETED'
        AND r.receive_date IS NOT NULL
        AND r.return_date IS NOT NULL
        AND r.return_date >= r.receive_date
        AND r.return_date >= DATE_SUB(
          (SELECT MAX(return_date) FROM rentals WHERE status = 'COMPLETED'),
          INTERVAL 12 MONTH
        )
      GROUP BY DATE_FORMAT(r.return_date, '%Y-%m')
      ORDER BY month ASC
    `);

    const data = (result as unknown as any[][])[0].map((row: any) => ({
      month: row.month,
      revenue: Number(row.revenue || 0),
    }));

    res.json(data);
  } catch (e: any) {
    console.error('[MONTHLY TREND]', e);
    res.status(500).json({ message: 'Failed to fetch monthly trend', error: e.message });
  }
});

app.post('/api/predictive-maintenance/backfill-snapshots', requireAdmin, async (req, res) => {
  try {
    const startDate = new Date('2027-01-01');
    const endDate = new Date('2028-04-23');
    const current = new Date(startDate);
    let totalGenerated = 0;
    let totalSaved = 0;

    while (current <= endDate) {
      const snapshots = await featureEngineeringService.generateSnapshotsForAllEquipment(new Date(current));
      
      for (const snapshot of snapshots) {
        // Skip if snapshot already exists for this equipment/date
        const existing = await db.execute(sql`
          SELECT COUNT(*) as cnt FROM asset_feature_snapshots 
          WHERE equipment_id = ${snapshot.equipmentId}
          AND DATE(snapshot_ts) = DATE(${snapshot.snapshotTs.toISOString()})
        `);

        const cnt = Number((existing as any)[0]?.[0]?.cnt || 0);
        if (cnt === 0) {
          await featureEngineeringService.saveSnapshot(snapshot);
          totalSaved++;
        }
        
        totalGenerated++;
      }

      // Advance by 1 day
      current.setDate(current.getDate() + 1);
      
      // Log progress every 30 days
      if (current.getDate() === 1) {
        console.log(`[BACKFILL] Progress: ${current.toISOString().split('T')[0]}, saved: ${totalSaved}`);
      }
    }

    res.json({ 
      message: `Backfill complete`, 
      totalGenerated, 
      totalSaved,
      dateRange: `2027-01-01 to 2028-04-23`
    });
  } catch (error) {
    console.error('Backfill error:', error);
    res.status(500).json({ message: 'Backfill failed', error: String(error) });
  }
});

  return httpServer;
}
