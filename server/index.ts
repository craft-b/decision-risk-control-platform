import dotenv from 'dotenv';
dotenv.config();

import { seedMaintenanceConfig } from './seeds/maintenance-config';
import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { db } from "./db";
import { equipment, equipmentFailurePredictions } from "@shared/schema";
import { desc, sql } from "drizzle-orm";
import { enhancedFeatureService } from "./services/feature-engineering-enhanced";

const app = express();
const httpServer = createServer(app);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }
      log(logLine);
    }
  });

  next();
});

// ─────────────────────────────────────────────────────────────────────────────
// NIGHTLY DRIFT CRON
// Keeps risk scores fresh without manual prediction runs.
//
// Strategy (risk-prioritized):
//   HIGH / MEDIUM units — rescore every night (scores drift fastest)
//   LOW units           — rescore every 3 days (stable, lower urgency)
//
// Runs at real midnight. Non-blocking — failures are logged, never crash server.
// Uses the simulation cursor date for feature engineering so scores reflect
// the current simulated state, not real-world time.
// ─────────────────────────────────────────────────────────────────────────────

async function runDriftRescore() {
  log("[CRON] Nightly drift rescore starting...", "cron");

  try {
    // Get simulation cursor date for feature engineering
    const [stateRows] = await db.execute(
      sql`SELECT cursor_date FROM simulation_state WHERE id = 1`
    ) as any;
    const snapshotDate = stateRows[0]?.cursor_date
      ? new Date(stateRows[0].cursor_date)
      : new Date();

    // Get all active equipment
    const allEquipment = await db.select({
      id: equipment.id,
      equipmentId: equipment.equipmentId,
    }).from(equipment);

    // Get latest prediction per unit to determine rescore priority
    const latestPreds = await db.execute(sql`
      SELECT equipment_id, risk_level_30d, predicted_at
      FROM equipment_failure_predictions
      WHERE id IN (
        SELECT MAX(id)
        FROM equipment_failure_predictions
        GROUP BY equipment_id
      )
    `) as any;

    const predMap = new Map<number, { riskLevel: string; predictedAt: Date }>();
    for (const row of (latestPreds as any)[0] ?? []) {
      predMap.set(Number(row.equipment_id), {
        riskLevel: row.risk_level_30d,
        predictedAt: new Date(row.predicted_at),
      });
    }

    const now = new Date();
    const ONE_DAY_MS  = 24 * 60 * 60 * 1000;
    const THREE_DAY_MS = 3 * ONE_DAY_MS;

    // Determine which units need rescoring
    const toRescore: number[] = [];
    for (const equip of allEquipment) {
      const pred = predMap.get(equip.id);

      if (!pred) {
        // Never scored — always include
        toRescore.push(equip.id);
        continue;
      }

      const age = now.getTime() - pred.predictedAt.getTime();
      const isHighOrMedium = pred.riskLevel === "HIGH" || pred.riskLevel === "MEDIUM";

      if (isHighOrMedium && age >= ONE_DAY_MS) {
        toRescore.push(equip.id);
      } else if (!isHighOrMedium && age >= THREE_DAY_MS) {
        toRescore.push(equip.id);
      }
    }

    log(`[CRON] ${toRescore.length} / ${allEquipment.length} units queued for rescore`, "cron");

    if (toRescore.length === 0) {
      log("[CRON] All scores fresh — nothing to rescore", "cron");
      return;
    }

    // Build payloads and call FastAPI
    let rescored = 0;
    let failed = 0;

    for (const equipId of toRescore) {
      try {
        const snapshot = await enhancedFeatureService.generateSnapshot(equipId, snapshotDate);

        const payload = {
          equipment_id:                equipId,
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

        const fastapiRes = await fetch("http://localhost:8000/predict/multi-horizon", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        if (fastapiRes.ok) {
          const pred = await fastapiRes.json();
          const p = pred.predictions;
          await db.insert(equipmentFailurePredictions).values({
            equipmentId:    equipId,
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
          rescored++;
        } else {
          failed++;
          log(`[CRON] FastAPI error for EQ-${equipId}: ${fastapiRes.status}`, "cron");
        }
      } catch (err: any) {
        failed++;
        log(`[CRON] Failed to rescore EQ-${equipId}: ${err.message}`, "cron");
      }
    }

    log(
      `[CRON] Drift rescore complete — ${rescored} rescored, ${failed} failed`,
      "cron"
    );

  } catch (err: any) {
    log(`[CRON] Drift rescore FATAL: ${err.message}`, "cron");
  }
}

// Schedule nightly at midnight using setInterval
// Calculates ms until next midnight and fires then, then repeats every 24h
function scheduleNightlyRescore() {
  const now = new Date();
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0); // next midnight
  const msUntilMidnight = midnight.getTime() - now.getTime();

  log(
    `[CRON] Nightly drift rescore scheduled — first run in ${Math.round(msUntilMidnight / 60000)} minutes`,
    "cron"
  );

  setTimeout(() => {
    runDriftRescore();
    // After first run, repeat every 24 hours
    setInterval(runDriftRescore, 24 * 60 * 60 * 1000);
  }, msUntilMidnight);
}

// ─────────────────────────────────────────────────────────────────────────────
// SERVER STARTUP
// ─────────────────────────────────────────────────────────────────────────────

(async () => {
  await registerRoutes(httpServer, app);
  await seedMaintenanceConfig();

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";
    res.status(status).json({ message });
    throw err;
  });

  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(port, "0.0.0.0", () => {
    log(`serving on port ${port}`);
    // Start nightly drift rescore after server is listening
    scheduleNightlyRescore();
  });
})();