// ─────────────────────────────────────────────────────────────────────────────
// Shared risk formatting — one source of truth for the risk color tokens and the
// plain-language driver dictionary, used by the command center and the
// predictive-maintenance dashboard (DESIGN_SPEC §5).
//
//   • Semantic risk is the ONLY saturated color family (HIGH/MEDIUM/LOW).
//   • Driver phrases are mechanic-facing, never raw model feature keys.
// ─────────────────────────────────────────────────────────────────────────────

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH";

// Badge / outline treatment (surface + text + border).
export const RISK_COLORS: Record<RiskLevel, string> = {
  HIGH:   "bg-risk-high-surface text-risk-high border-risk-high",
  MEDIUM: "bg-risk-medium-surface text-risk-medium border-risk-medium",
  LOW:    "bg-risk-low-surface text-risk-low border-risk-low",
};

// Solid fills — bars, status dots.
export const RISK_FILL: Record<RiskLevel, string> = {
  HIGH:   "bg-risk-high",
  MEDIUM: "bg-risk-medium",
  LOW:    "bg-risk-low",
};

// Subtle row hovers — token-driven so they stay AA-correct in both themes.
export const RISK_HOVER: Record<RiskLevel, string> = {
  HIGH:   "hover:bg-risk-high/[0.06]",
  MEDIUM: "hover:bg-risk-medium/[0.06]",
  LOW:    "hover:bg-risk-low/[0.06]",
};

// Plain-language fallback dictionary. The ML service already emits descriptive
// phrases ("Asset age: 13.4 years …"); this dictionary only kicks in if a raw
// snake_case feature key ever reaches the UI, so nothing shows as "wear_rate".
export const DRIVER_LABELS: Record<string, string> = {
  wear_rate:                   "Wear rate accelerating",
  wear_rate_velocity:          "Wear accelerating faster",
  mechanical_wear_score:       "High mechanical wear",
  days_since_last_maintenance: "Overdue for service",
  maint_overdue:               "Maintenance overdue",
  maintenance_events_90d:      "Frequent recent repairs",
  maint_frequency_trend:       "Repairs trending up",
  maintenance_cost_180d:       "Rising maintenance cost",
  maint_burden:                "Heavy maintenance burden",
  cost_per_event:              "Costly repairs",
  cost_trend:                  "Repair costs climbing",
  avg_downtime_per_event:      "Long downtime per repair",
  mean_time_between_failures:  "Short time between failures",
  usage_intensity:             "Intense duty cycle",
  usage_trend:                 "Usage trending up",
  hours_used_30d:              "Heavy recent hours",
  hours_used_90d:              "Sustained heavy use",
  hours_velocity:              "Hours accumulating fast",
  utilization_vs_expected:     "Over-utilized vs. plan",
  total_hours_lifetime:        "High lifetime hours",
  asset_age_years:             "Aging asset",
  aging_factor:                "Age-related risk",
  abuse_score:                 "Signs of hard use",
  neglect_score:               "Signs of neglect",
  neglect_acceleration:        "Neglect worsening",
  jobsite_risk_score:          "Harsh jobsite conditions",
  vendor_reliability_score:    "Lower-reliability vendor",
  sensor_degradation_rate:     "Sensor degradation detected",
  avg_rental_duration:         "Long rental exposure",
  rental_days_30d:             "High recent rental days",
  rental_days_90d:             "Sustained rental exposure",
};

/** Turn a driver token into a clean, mechanic-facing phrase. */
export function humanizeDriver(key: string): string {
  if (!key) return key;
  // Scrub encoding artifacts: emoji / em-dashes that were stored as "?" or the
  // Unicode replacement char, so an investor never sees "?? Maintenance overdue".
  let s = key
    .replace(/�/g, "")
    .replace(/^[\s?]*\?\s*/, "")   // leading "?? " warning glyph
    .replace(/\s\?\s/g, " — ")      // stray " ? " that was an em-dash
    .trim();
  // Already a human-readable phrase (has whitespace or a colon)? Pass through.
  if (/[\s:]/.test(s)) return s;
  // Otherwise treat as a raw model feature key.
  if (DRIVER_LABELS[s]) return DRIVER_LABELS[s];
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

type DriverCarrier = { top_risk_drivers?: Record<string, number> | string[] } | undefined | null;

/** The single most important driver for a prediction, as a plain phrase. */
export function topDriverLabel(pred: DriverCarrier): string | null {
  if (!pred) return null;
  const drivers = pred.top_risk_drivers ?? {};
  const keys = Array.isArray(drivers) ? drivers : Object.keys(drivers);
  return keys.length ? humanizeDriver(keys[0]) : null;
}
