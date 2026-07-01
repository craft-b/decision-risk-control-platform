// Unit tests for the pure derived-feature formulas in feature-engineering-enhanced.ts.
// These formulas feed directly into the ML feature vector (wear_rate_velocity,
// maint_frequency_trend, cost_trend, etc. in the README's 31-feature list), so
// regressions here silently change model input distributions.

import { describe, it, expect, vi } from "vitest";

// server/db.ts throws at import time if DATABASE_URL isn't set — stub it out
// so importing the service module doesn't require a real database.
vi.mock("../db", () => ({ db: {}, pool: {} }));

import {
  computeWearRateVelocity,
  computeMaintFrequencyTrend,
  computeCostTrend,
  computeHoursVelocity,
  computeMechanicalWearScore,
  computeAbuseScore,
  computeNeglectScore,
  computeNeglectAcceleration,
} from "./feature-engineering-enhanced";

describe("computeWearRateVelocity", () => {
  it("is positive when wear is accelerating", () => {
    expect(computeWearRateVelocity(0.6, 0.5)).toBeCloseTo(3.0, 5);
  });

  it("is negative when wear is decelerating", () => {
    expect(computeWearRateVelocity(0.4, 0.5)).toBeCloseTo(-3.0, 5);
  });

  it("is zero when wear rate is unchanged", () => {
    expect(computeWearRateVelocity(0.5, 0.5)).toBe(0);
  });
});

describe("computeMaintFrequencyTrend", () => {
  it("returns 1.0 (neutral) when there is no 90d maintenance history", () => {
    expect(computeMaintFrequencyTrend(0, 0)).toBe(1.0);
  });

  it("returns >1 when 30d-annualised rate exceeds 90d-annualised rate", () => {
    expect(computeMaintFrequencyTrend(24, 12)).toBe(2);
  });
});

describe("computeCostTrend", () => {
  it("falls back to 1.0 (neutral) when there is no prior-period cost", () => {
    expect(computeCostTrend(500, 0)).toBe(1.0);
  });

  it("reflects rising cost per event", () => {
    expect(computeCostTrend(600, 300)).toBe(2);
  });
});

describe("computeHoursVelocity", () => {
  it("falls back to 1.0 when there is no 90d baseline usage", () => {
    expect(computeHoursVelocity(5, 0)).toBe(1.0);
  });

  it("reflects usage speeding up", () => {
    expect(computeHoursVelocity(8, 4)).toBe(2);
  });
});

describe("computeMechanicalWearScore", () => {
  it("is 0 for brand-new, unused equipment", () => {
    expect(computeMechanicalWearScore(0, 0)).toBe(0);
  });

  it("caps at 10 for heavily used, old equipment", () => {
    expect(computeMechanicalWearScore(50000, 20)).toBe(10);
  });

  it("scales linearly within bounds (hours dominate at 5x the age contribution weight per unit)", () => {
    // hoursFactor = 2500/5000 = 0.5 -> 2.5 pts; ageFactor = 4/8 = 0.5 -> 2.5 pts
    expect(computeMechanicalWearScore(2500, 4)).toBeCloseTo(5, 5);
  });
});

describe("computeAbuseScore", () => {
  it("is 0 for low intensity, flat usage trend", () => {
    expect(computeAbuseScore(0, 1)).toBe(0);
  });

  it("caps at 10 for extreme intensity and steep upward trend", () => {
    expect(computeAbuseScore(50, 5)).toBe(10);
  });

  it("ignores a declining usage trend rather than penalizing it", () => {
    // trendFactor clamps at 0 for usageTrend < 1
    expect(computeAbuseScore(0, 0.2)).toBe(0);
  });
});

describe("computeNeglectScore", () => {
  it("uses a neutral 0.5 day-factor when maintenance history is unknown", () => {
    // neglectDaysFactor=0.5 -> 3.5, maintOverdue=0 -> no bonus
    expect(computeNeglectScore(null, 0)).toBeCloseTo(3.5, 5);
  });

  it("adds a fixed overdue penalty on top of the days factor", () => {
    // days=60 -> daysFactor=0.5 -> 3.5, overdue bonus +3 = 6.5
    expect(computeNeglectScore(60, 1)).toBeCloseTo(6.5, 5);
  });

  it("caps at 10 for long-neglected, overdue equipment", () => {
    expect(computeNeglectScore(1000, 1)).toBe(10);
  });
});

describe("computeNeglectAcceleration", () => {
  it("returns neutral 1.0 when maintenance history or interval is unknown", () => {
    expect(computeNeglectAcceleration(null, 90)).toBe(1.0);
    expect(computeNeglectAcceleration(45, 0)).toBe(1.0);
  });

  it("returns 1.0 exactly at the maintenance interval", () => {
    expect(computeNeglectAcceleration(90, 90)).toBe(1.0);
  });

  it("caps at 3.0 for severely overdue equipment", () => {
    expect(computeNeglectAcceleration(900, 90)).toBe(3.0);
  });
});
