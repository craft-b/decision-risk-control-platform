// QA-1 cross-language contract (Node → pydantic direction).
//
// The Node payload assembled for the ML service must carry every field the
// FastAPI SnapshotInput schema requires. If a payload site drifts (the audit
// found four that had), this test fails before a NaN or a 422 reaches
// production. The Python side (test_qa_guards.py) guards schema ↔ trainer.

import { describe, it, expect, vi } from "vitest";

vi.mock("../db", () => ({ db: {}, pool: {} }));
vi.mock("./ml-client", () => ({ mlFetch: vi.fn(), ML_SERVICE_URL: "http://test" }));

import { buildSnapshotPayload } from "./predictive-maintenance-fixed";

// Required (non-defaulted) fields of api/schemas/prediction.py::SnapshotInput.
// Kept in sync with that schema — the trainer-side coverage of FEATURE_COLS is
// asserted in ml-service/tests/test_qa_guards.py::TestContract.
const REQUIRED_PYDANTIC_FIELDS = [
  "equipment_id",
  "asset_age_years", "category", "total_hours_lifetime",
  "hours_used_30d", "hours_used_90d", "rental_days_30d", "rental_days_90d",
  "avg_rental_duration", "maintenance_events_90d", "maintenance_cost_180d",
  "days_since_last_maintenance", "mean_time_between_failures",
  "usage_intensity", "usage_trend", "utilization_vs_expected", "wear_rate",
  "aging_factor", "maint_overdue", "cost_per_event", "maint_burden",
  "mechanical_wear_score", "abuse_score", "neglect_score",
];

describe("Node → pydantic snapshot contract", () => {
  it("payload carries every required SnapshotInput field", () => {
    const snapshot: Record<string, unknown> = {
      assetAgeYears: 6.2, category: "Excavator", totalHoursLifetime: 8200,
      hoursUsed30d: 160, hoursUsed90d: 470, rentalDays30d: 20, rentalDays90d: 62,
      avgRentalDuration: 4, maintenanceEvents90d: 2, maintenanceCost180d: 3400,
      avgDowntimePerEvent: 8, daysSinceLastMaintenance: 88, meanTimeBetweenFailures: 130,
      vendorReliabilityScore: 0.6, jobSiteRiskScore: 0.7, usageIntensity: 6,
      usageTrend: 1.2, utilizationVsExpected: 1.1, wearRate: 0.12, agingFactor: 0.62,
      maintOverdue: 0, costPerEvent: 1700, maintBurden: 3.5,
      mechanicalWearScore: 5.4, abuseScore: 3.1, neglectScore: 3.9,
    };
    const payload = buildSnapshotPayload(101, snapshot);
    const missing = REQUIRED_PYDANTIC_FIELDS.filter((k) => !(k in payload));
    expect(missing).toEqual([]);
  });

  it("emits no NaN for a sparse snapshot (defaults fill the gaps)", () => {
    const payload = buildSnapshotPayload(102, { category: "Crane" });
    const nanFields = Object.entries(payload)
      .filter(([, v]) => typeof v === "number" && Number.isNaN(v))
      .map(([k]) => k);
    expect(nanFields).toEqual([]);
  });

  it("imputes MTBF=500 / days_since=999 (matches the trainer COALESCE)", () => {
    const payload = buildSnapshotPayload(103, { category: "Crane" });
    expect(payload.mean_time_between_failures).toBe(500);
    expect(payload.days_since_last_maintenance).toBe(999);
  });
});
