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
import { featureEngineeringService } from "./feature-engineering-enhanced";

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
  top_risk_drivers:   string[];
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
  // Map camelCase TypeScript snapshot → snake_case Python API
  return {
    equipment_id:                 equipmentId,
    asset_age_years:              snapshot.assetAgeYears,
    category:                     snapshot.category ?? "Unknown",
    total_hours_lifetime:         snapshot.totalHoursLifetime,
    hours_used_30d:               snapshot.hoursUsed30d,
    hours_used_90d:               snapshot.hoursUsed90d,
    rental_days_30d:              snapshot.rentalDays30d,
    rental_days_90d:              snapshot.rentalDays90d,
    avg_rental_duration:          snapshot.avgRentalDuration,
    maintenance_events_90d:       snapshot.maintenanceEvents90d,
    maintenance_cost_180d:        snapshot.maintenanceCost180d,
    avg_downtime_per_event:       snapshot.avgDowntimePerEvent,
    days_since_last_maintenance:  snapshot.daysSinceLastMaintenance ?? 999,
    mean_time_between_failures:   snapshot.meanTimeBetweenFailures ?? 500,
    vendor_reliability_score:     snapshot.vendorReliabilityScore,
    jobsite_risk_score:           snapshot.jobSiteRiskScore,
    usage_intensity:              snapshot.usageIntensity,
    usage_trend:                  snapshot.usageTrend,
    utilization_vs_expected:      snapshot.utilizationVsExpected,
    wear_rate:                    snapshot.wearRate,
    aging_factor:                 snapshot.agingFactor,
    maint_overdue:                snapshot.maintOverdue,
    cost_per_event:               snapshot.costPerEvent,
    maint_burden:                 snapshot.maintBurden,
    mechanical_wear_score:        snapshot.mechanicalWearScore,
    abuse_score:                  snapshot.abuseScore,
    neglect_score:                snapshot.neglectScore,
  };
}

async function savePrediction(prediction: RiskPrediction): Promise<void> {
  await db.insert(assetRiskPredictions).values({
    equipmentId:        prediction.equipmentId,
    failureProbability: prediction.failureProbability.toFixed(4),
    riskLevel:          prediction.riskBand,
    topRiskDrivers:     JSON.stringify(prediction.topDrivers.map(d => d.feature)),
    recommendation:     prediction.recommendation,
    modelVersion:       prediction.modelVersion,
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
    topDrivers:         result.top_risk_drivers.map(d => ({
      feature:     d,
      impact:      0,
      description: d,
    })),
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
    if (!healthy) {
      throw new Error(
        `ML service unavailable at ${ML_SERVICE_URL}. ` +
        `Ensure the FastAPI service is running: cd ml-service && python run.py`
      );
    }

    const snapshot    = await featureEngineeringService.generateSnapshot(equipmentId, new Date());
    const payload     = buildSnapshotPayload(equipmentId, snapshot as unknown as Record<string, unknown>);
    const result      = await callMLService(payload);
    const prediction  = convertMLResponse(result, snapshot.snapshotTs);

    await savePrediction(prediction);

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
      .orderBy(desc(assetRiskPredictions.predictionTs))
      .limit(1);

    if (!stored) return null;

    // Parse stored top risk drivers
    let topDrivers: RiskPrediction["topDrivers"] = [];
    try {
      const drivers = JSON.parse(stored.topRiskDrivers ?? "[]") as string[];
      topDrivers = drivers.map(d => ({ feature: d, impact: 0, description: d }));
    } catch {
      topDrivers = [];
    }

    return {
      equipmentId:        stored.equipmentId,
      failureProbability: Number(stored.failureProbability),
      riskBand:           (stored.riskLevel ?? "LOW") as "LOW" | "MEDIUM" | "HIGH",
      riskScore:          Math.round(Number(stored.failureProbability) * 100),
      confidence:         0.85,
      topDrivers,
      snapshotTs:         stored.predictionTs,
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