// server/services/predictive-maintenance.ts
//
// Thin HTTP client — delegates all ML inference to the FastAPI service.
// Maintains the same public interface as the previous rule-based implementation
// so routes.ts requires zero changes.
//
// Flow:
//   routes.ts → predictiveMaintenanceService → FastAPI /predict → DB

import { db } from "../db";
import { assetRiskPredictions, equipment } from "@shared/schema";
import { eq, desc } from "drizzle-orm";
import { enhancedFeatureService as featureEngineeringService } from "./feature-engineering-enhanced";
const ML_SERVICE_URL = process.env.ML_SERVICE_URL || "http://localhost:8000";
const ML_TIMEOUT_MS  = 10_000;

// ── Public types (unchanged from previous implementation) ─────────────────────

export interface RiskPrediction {
  equipmentId:        number;
  failureProbability: number;
  riskBand:           "LOW" | "MEDIUM" | "HIGH";
  riskScore:          number;
  confidence:         number;
  topDrivers:         Array<{ feature: string; impact: number; description: string }>;
  snapshotTs:         Date;
  modelVersion:       string;
  recommendation:     string | null;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

async function callMLService(
  snapshot: Record<string, unknown>
): Promise<{
  equipment_id:       number;
  failure_probability: number;
  predicted_failure:  boolean;
  risk_level:         "LOW" | "MEDIUM" | "HIGH";
  model_version:      string;
  top_risk_drivers:   Record<string, number> | string[];
  recommendation:     string | null;
}> {
  const controller = new AbortController();
  const timeout    = setTimeout(() => controller.abort(), ML_TIMEOUT_MS);

  try {
    const response = await fetch(`${ML_SERVICE_URL}/predict`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(snapshot),
      signal:  controller.signal,
    });

    if (!response.ok) {
      const text = await response.text();
      console.error(`[PM] ML service ${response.status} error body:`, text);
      // Pretty-print if JSON
      try {
        console.error(`[PM] Parsed:`, JSON.stringify(JSON.parse(text), null, 2));
      } catch {}
      throw new Error(`ML service returned ${response.status}: ${text}`);
    }

    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function checkMLServiceHealth(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout    = setTimeout(() => controller.abort(), 3_000);
    const response   = await fetch(`${ML_SERVICE_URL}/health`, { signal: controller.signal });
    clearTimeout(timeout);
    return response.ok;
  } catch {
    return false;
  }
}

function buildSnapshotPayload(
  equipmentId: number,
  snapshot: Record<string, unknown>
): Record<string, unknown> {
  const safe = (val: unknown, fallback: number): number => {
    const n = Number(val);
    return isNaN(n) || val === null || val === undefined ? fallback : n;
  };

  return {
    equipment_id:                equipmentId,
    asset_age_years:             safe(snapshot.assetAgeYears, 1),
    category:                    String(snapshot.category ?? "Unknown"),
    total_hours_lifetime:        safe(snapshot.totalHoursLifetime, 0),
    hours_used_30d:              safe(snapshot.hoursUsed30d, 0),
    hours_used_90d:              safe(snapshot.hoursUsed90d, 0),
    rental_days_30d:             Math.round(safe(snapshot.rentalDays30d, 0)),
    rental_days_90d:             Math.round(safe(snapshot.rentalDays90d, 0)),
    avg_rental_duration:         safe(snapshot.avgRentalDuration, 1),
    maintenance_events_90d:      safe(snapshot.maintenanceEvents90d, 0),
    maintenance_cost_180d:       safe(snapshot.maintenanceCost180d, 0),
    avg_downtime_per_event:      safe(snapshot.avgDowntimePerEvent, 0),
    days_since_last_maintenance: Math.max(0, safe(snapshot.daysSinceLastMaintenance, 999)),
    vendor_reliability_score:    safe(snapshot.vendorReliabilityScore, 0.5),
    jobsite_risk_score:          safe(snapshot.jobSiteRiskScore, 0.5),
    usage_intensity:             Math.min(safe(snapshot.usageIntensity, 1), 12),
    usage_trend:                 Math.min(Math.max(safe(snapshot.usageTrend, 1), 0.5), 3.0),
    utilization_vs_expected:     safe(snapshot.utilizationVsExpected, 1),
    wear_rate:                   safe(snapshot.wearRate, 0),
    aging_factor:                Math.min(safe(snapshot.agingFactor, 0.1), 1.0),
    maint_overdue:               safe(snapshot.maintOverdue, 0),
    cost_per_event:              safe(snapshot.costPerEvent, 0),
    maint_burden:                safe(snapshot.maintBurden, 0),
    mechanical_wear_score:       Math.min(safe(snapshot.mechanicalWearScore, 1), 10),
    abuse_score:                 Math.min(safe(snapshot.abuseScore, 1), 10),
    neglect_score:               Math.min(Math.max(0, safe(snapshot.neglectScore, 1)), 10),    mean_time_between_failures:  safe(snapshot.meanTimeBetweenFailures, 500),
  };
}

async function savePrediction(
  prediction: RiskPrediction,
  rawDrivers?: Record<string, number> | string[]
): Promise<void> {
  // Use raw impact scores from ML service if available
  const driverEntries = rawDrivers && !Array.isArray(rawDrivers)
    ? Object.entries(rawDrivers)
    : prediction.topDrivers.map(d => [d.feature, d.impact] as [string, number]);

  await db.insert(assetRiskPredictions).values({
    equipmentId:        prediction.equipmentId,
    snapshotTs:         prediction.snapshotTs,
    failureProbability: prediction.failureProbability.toFixed(4),
    riskBand:           prediction.riskBand,
    topDriver1:         driverEntries[0]?.[0] ?? null,
    topDriver1Impact:   driverEntries[0]?.[1]?.toFixed(4) ?? null,
    topDriver2:         driverEntries[1]?.[0] ?? null,
    topDriver2Impact:   driverEntries[1]?.[1]?.toFixed(4) ?? null,
    topDriver3:         driverEntries[2]?.[0] ?? null,
    topDriver3Impact:   driverEntries[2]?.[1]?.toFixed(4) ?? null,
    modelVersion:       prediction.modelVersion,
    recommendation:     prediction.recommendation,
  });
}

function convertMLResponse(
  result: Awaited<ReturnType<typeof callMLService>>,
  snapshotTs: Date
): RiskPrediction {
  return {
    equipmentId:        result.equipment_id,
    failureProbability: result.failure_probability,
    riskBand:           result.risk_level,
    riskScore:          Math.round(result.failure_probability * 100),
    confidence:         0.85, // FastAPI model confidence — could be added to API response later
    topDrivers: (() => {
      const drivers = result.top_risk_drivers;
      if (Array.isArray(drivers)) {
        return drivers.map(d => ({ feature: d, impact: 0, description: d }));
      }
      return Object.entries(drivers).map(([key, val]) => ({
        feature:     key,
        impact:      typeof val === 'number' ? val : Number(val),
        description: key,
      }));
    })(),
    snapshotTs,
    modelVersion:  result.model_version,
    recommendation: result.recommendation,
  };
}

// ── Public service class ──────────────────────────────────────────────────────

class PredictiveMaintenanceService {

  /**
   * Primary entry point — generates a fresh snapshot, calls FastAPI,
   * persists the result, and returns the prediction.
   */
  async predictRisk(equipmentId: number): Promise<RiskPrediction> {
    const healthy = await checkMLServiceHealth();
    console.log(`[PM] Health check result: ${healthy}`);
    if (!healthy) {
      throw new Error(
        `ML service unavailable at ${ML_SERVICE_URL}. ` +
        `Ensure the FastAPI service is running: cd ml-service && python run.py`
      );
    }

    const snapshot = await featureEngineeringService.generateSnapshot(equipmentId, new Date());
    const payload  = buildSnapshotPayload(equipmentId, snapshot as unknown as Record<string, unknown>);
    console.log(`[PM] RAW PAYLOAD:`, JSON.stringify(payload));
    // ── Debug: catch NaNs and log full payload before sending ──
    const invalidFields = Object.entries(payload).filter(([, v]) =>
      typeof v === 'number' && isNaN(v as number)
    );
    if (invalidFields.length > 0) {
      console.error(`[PM] NaN fields in payload for EQ-${equipmentId}:`, invalidFields.map(([k]) => k));
    }
    console.log(`[PM] Payload for EQ-${equipmentId}:`, JSON.stringify(payload, null, 2));

    const result     = await callMLService(payload);
    const prediction = convertMLResponse(result, snapshot.snapshotTs);

    await savePrediction(prediction, result.top_risk_drivers);

    console.log(
      `[PM] EQ-${equipmentId} → ${prediction.riskBand} ` +
      `(${(prediction.failureProbability * 100).toFixed(1)}%)`
    );

    return prediction;
  }

  /**
   * Returns the latest stored prediction for an equipment item.
   * If none exists, runs a fresh prediction.
   */
  async getLatestPrediction(equipmentId: number): Promise<RiskPrediction | null> {
    const [stored] = await db
      .select()
      .from(assetRiskPredictions)
      .where(eq(assetRiskPredictions.equipmentId, equipmentId))
      .orderBy(desc(assetRiskPredictions.predictedAt))      .limit(1);

    if (!stored) return null;

    // Parse stored top risk drivers
    const topDrivers: RiskPrediction["topDrivers"] = [
      stored.topDriver1 ? { feature: stored.topDriver1, impact: Number(stored.topDriver1Impact ?? 0), description: stored.topDriver1 } : null,
      stored.topDriver2 ? { feature: stored.topDriver2, impact: Number(stored.topDriver2Impact ?? 0), description: stored.topDriver2 } : null,
      stored.topDriver3 ? { feature: stored.topDriver3, impact: Number(stored.topDriver3Impact ?? 0), description: stored.topDriver3 } : null,
    ].filter(Boolean) as RiskPrediction["topDrivers"];
     
    return {
      equipmentId:        stored.equipmentId,
      failureProbability: Number(stored.failureProbability),
      riskBand:           (stored.riskBand ?? "LOW") as "LOW" | "MEDIUM" | "HIGH",
      riskScore:          Math.round(Number(stored.failureProbability) * 100),
      confidence:         0.85,
      topDrivers,
      snapshotTs:         stored.snapshotTs,
      modelVersion:       stored.modelVersion ?? "v1.0",
      recommendation:     stored.recommendation ?? null,
    };
  }

  /**
   * Runs predictions for all equipment. Skips individual failures gracefully.
   */
  async predictAllEquipment(): Promise<RiskPrediction[]> {
    const healthy = await checkMLServiceHealth();
    if (!healthy) {
      console.warn(`[PM] ML service unavailable — skipping batch predictions`);
      return [];
    }

    const allEquipment = await db.select({ id: equipment.id }).from(equipment);
    const predictions: RiskPrediction[] = [];

    for (const equip of allEquipment) {
      try {
        predictions.push(await this.predictRisk(equip.id));
      } catch (err) {
        console.error(`[PM] Failed prediction for equipment ${equip.id}:`, err);
      }
    }

    console.log(`[PM] Batch complete — ${predictions.length}/${allEquipment.length} succeeded`);
    return predictions;
  }

  /**
   * Returns fleet-wide risk distribution from the latest stored predictions.
   * Reads from DB rather than recalculating — fast and suitable for dashboards.
   */
  async getFleetRiskDistribution(): Promise<{
    low: number; medium: number; high: number; total: number;
  }> {
    const allEquipment = await db.select({ id: equipment.id }).from(equipment);
    let low = 0, medium = 0, high = 0;

    for (const equip of allEquipment) {
      const prediction = await this.getLatestPrediction(equip.id);
      if (!prediction) continue;

      if      (prediction.riskBand === "LOW")    low++;
      else if (prediction.riskBand === "MEDIUM") medium++;
      else                                        high++;
    }

    return { low, medium, high, total: low + medium + high };
  }
}

export const predictiveMaintenanceService = new PredictiveMaintenanceService();