// server/services/imputation.ts
//
// ML-10: one imputation contract, shared by every ML payload-assembly site.
//
// Before this module the defaults disagreed by code path — MTBF was 500 in the
// training SQL and single-predict path but 999 in the batch route and nightly
// cron; cold-start heuristics were duplicated with different fake model
// versions (v1.4 vs v1.14) and were never labeled as heuristics, so a rule
// score looked identical to a real model score in the stored predictions.
//
// These defaults MUST match the COALESCE fallbacks in
// train_model_multihorizon.load_training_data() so serve-time imputation
// equals train-time imputation.

/** Imputation defaults for nullable model features (mirror the training SQL). */
export const IMPUTATION_DEFAULTS = {
  days_since_last_maintenance: 999,
  mean_time_between_failures: 500, // 500 everywhere — was inconsistently 999
  wear_rate_velocity: 0,
  maint_frequency_trend: 1.0,
  cost_trend: 1.0,
  hours_velocity: 1.0,
  neglect_acceleration: 1.0,
  sensor_degradation_rate: 0,
} as const;

// ── Cold-start rule ───────────────────────────────────────────────────────────
// Brand-new assets (age < 1y and < 500 lifetime hours) sit outside the training
// distribution, so the model is not asked to score them. A deterministic rule
// assigns a low baseline risk instead. Its output is tagged so it can never be
// mistaken for a model prediction: modelVersion carries the `rule:` prefix and
// the live API payload carries scored_by: 'rule'.

export const COLD_START = {
  maxAgeYears: 1,
  maxLifetimeHours: 500,
  /** Marker written to the modelVersion column so storage is self-documenting. */
  modelTag: "rule:cold-start-v1",
  probability: 0.05,
  riskBand: "LOW" as const,
} as const;

export function isColdStart(assetAgeYears: number, totalHoursLifetime: number): boolean {
  return assetAgeYears < COLD_START.maxAgeYears && totalHoursLifetime < COLD_START.maxLifetimeHours;
}

/** A cold-start prediction shaped like the FastAPI multi-horizon response. */
export function coldStartMultiHorizon(equipmentId: number) {
  const band = { failure_probability: COLD_START.probability, risk_level: COLD_START.riskBand, risk_score: 5, scored_by: "rule" as const };
  return {
    equipment_id: equipmentId,
    model_version: COLD_START.modelTag,
    scored_by: "rule" as const,
    risk_trend: "STABLE" as const,
    predictions: {
      "10d": { ...band, model_confidence: "rule (out-of-distribution: new unit)", top_risk_drivers: { "New unit — minimal hours": 0.01 } },
      "30d": { ...band, model_confidence: "rule (out-of-distribution: new unit)", top_risk_drivers: { "Recent inspection completed": 0.01 } },
      "60d": { ...band, model_confidence: "rule (out-of-distribution: new unit)", top_risk_drivers: { "Low operational age": 0.01 } },
    },
    recommendation: "New unit within safe operating parameters. Continue standard inspection schedule.",
  };
}
