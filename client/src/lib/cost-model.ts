import type { ProjectionPoint } from "@/pages/predictive-maintenance-dashboard";

// PM cost estimates by equipment category (USD)
// Derived from industry averages for construction rental fleets
const PM_COST_BY_CATEGORY: Record<string, number> = {
  "Excavator":          850,
  "Bulldozer":          900,
  "Crane":             1200,
  "Forklift":           600,
  "Compactor":          500,
  "Generator":          400,
  "Skid Steer":         650,
  "Loader":             750,
  "Grader":             850,
  "Trencher":           550,
};
const DEFAULT_PM_COST = 700;

// Assumed downtime days if failure occurs (unplanned breakdown)
const FAILURE_DOWNTIME_DAYS = 7;

export interface CostModelResult {
  optimalDay: number | null;       // day to intervene; null = already past or never crosses
  expectedSavings: number;         // failure_cost - pm_cost at optimal day
  pmCost: number;                  // scheduled PM cost used
  failureCostAtOptimal: number;    // P(failure|optimalDay) × failure_cost
  breakEvenProbability: number;    // pm_cost / failure_cost
  alreadyHighRisk: boolean;        // day 0 probability already above HIGH threshold
}

export function computeOptimalIntervention(
  curve: ProjectionPoint[],
  dailyRate: number,                // from equipment.dailyRate
  category: string,
): CostModelResult {
  const pmCost = PM_COST_BY_CATEGORY[category] ?? DEFAULT_PM_COST;
  const failureCost = dailyRate * FAILURE_DOWNTIME_DAYS;
  const breakEvenProbability = pmCost / failureCost;

  const alreadyHighRisk = curve.length > 0 && curve[0]["60d"] >= 0.60;

  // Walk the curve — find first day where P(60d) × failure_cost > pm_cost
  let optimalDay: number | null = null;
  let failureCostAtOptimal = 0;

  for (const point of curve) {
    const expectedFailureCost = point["60d"] * failureCost;
    if (expectedFailureCost > pmCost) {
      optimalDay = point.day;
      failureCostAtOptimal = expectedFailureCost;
      break;
    }
  }

  const expectedSavings = optimalDay !== null
    ? Math.round(failureCostAtOptimal - pmCost)
    : 0;

  return {
    optimalDay,
    expectedSavings,
    pmCost,
    failureCostAtOptimal: Math.round(failureCostAtOptimal),
    breakEvenProbability,
    alreadyHighRisk,
  };
}