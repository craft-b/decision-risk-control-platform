// Unit tests for RiskScoringService's core scoring logic (computeScore,
// getRiskLevel, explainScore). These are private methods reached via the
// service instance directly, since the class has no DB-free constructor seam
// — calculateRiskScore()/batchCalculate() are DB-coupled and out of scope here.

import { describe, it, expect, vi } from "vitest";

// server/db.ts throws at import time if DATABASE_URL isn't set — stub it out
// so importing the service module doesn't require a real database.
vi.mock("../db", () => ({ db: {}, pool: {} }));

import { riskScoringService } from "./risk-scoring";

const service = riskScoringService as any;

function baseFeatures(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    daysRentedLast30: 0,
    daysRentedLast60: 0,
    equipmentAgeYears: 0,
    lateReturnsLast30: 0,
    status: "AVAILABLE",
    daysSinceLastMaintenance: 10,
    maintenanceOverdue: false,
    lastMaintenanceType: "INSPECTION",
    recommendedInterval: 180,
    effectiveMaintenanceDays: 10,
    ...overrides,
  };
}

describe("computeScore", () => {
  it("scores a brand-new, unused, well-maintained asset near zero", () => {
    const score = service.computeScore(baseFeatures());
    expect(score).toBeLessThan(5);
  });

  it("increases with utilization (days rented in last 60d)", () => {
    const low = service.computeScore(baseFeatures({ daysRentedLast60: 5 }));
    const high = service.computeScore(baseFeatures({ daysRentedLast60: 45 }));
    expect(high).toBeGreaterThan(low);
  });

  it("increases with equipment age", () => {
    const young = service.computeScore(baseFeatures({ equipmentAgeYears: 1 }));
    const old = service.computeScore(baseFeatures({ equipmentAgeYears: 12 }));
    expect(old).toBeGreaterThan(young);
  });

  it("applies an extra penalty when maintenance is overdue", () => {
    const onTime = service.computeScore(
      baseFeatures({ effectiveMaintenanceDays: 170, recommendedInterval: 180, maintenanceOverdue: false })
    );
    const overdue = service.computeScore(
      baseFeatures({ effectiveMaintenanceDays: 270, recommendedInterval: 180, maintenanceOverdue: true })
    );
    expect(overdue).toBeGreaterThan(onTime);
  });

  it("never exceeds 100", () => {
    const score = service.computeScore(
      baseFeatures({
        daysRentedLast60: 200,
        equipmentAgeYears: 50,
        lateReturnsLast30: 20,
        effectiveMaintenanceDays: 5000,
        recommendedInterval: 30,
        maintenanceOverdue: true,
      })
    );
    expect(score).toBeLessThanOrEqual(100);
  });
});

describe("getRiskLevel", () => {
  it("classifies boundary and mid-range scores correctly", () => {
    expect(service.getRiskLevel(0)).toBe("LOW");
    expect(service.getRiskLevel(30)).toBe("LOW");
    expect(service.getRiskLevel(31)).toBe("MEDIUM");
    expect(service.getRiskLevel(60)).toBe("MEDIUM");
    expect(service.getRiskLevel(61)).toBe("HIGH");
    expect(service.getRiskLevel(100)).toBe("HIGH");
  });
});

describe("explainScore", () => {
  it("always reports at least one driver — the maintenance-history line is unconditional", () => {
    // Note: explainScore's `drivers.length === 0` fallback ("Low activity, well
    // maintained") is unreachable in practice — the lastMaintenanceType
    // if/else above it always pushes exactly one driver first.
    const drivers = service.explainScore(baseFeatures(), { status: "AVAILABLE" });
    expect(drivers.length).toBeGreaterThan(0);
    expect(drivers[0]).toContain("Last service: inspection");
  });

  it("flags overdue maintenance with the days-overdue count", () => {
    const drivers: string[] = service.explainScore(
      baseFeatures({
        maintenanceOverdue: true,
        effectiveMaintenanceDays: 200,
        recommendedInterval: 180,
      }),
      { status: "AVAILABLE" }
    );
    expect(drivers.some((d) => d.includes("Maintenance overdue by 20 days"))).toBe(true);
  });

  it("flags high utilization and equipment age when both exceed thresholds", () => {
    const drivers: string[] = service.explainScore(
      baseFeatures({ daysRentedLast60: 40, equipmentAgeYears: 6 }),
      { status: "AVAILABLE" }
    );
    expect(drivers.some((d) => d.includes("High utilization"))).toBe(true);
    expect(drivers.some((d) => d.includes("Equipment age"))).toBe(true);
  });

  it("flags missing maintenance history explicitly", () => {
    const drivers: string[] = service.explainScore(
      baseFeatures({ lastMaintenanceType: null }),
      { status: "AVAILABLE" }
    );
    expect(drivers.some((d) => d.includes("No maintenance history recorded"))).toBe(true);
  });
});
