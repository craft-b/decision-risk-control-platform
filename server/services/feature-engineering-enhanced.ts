// server/services/feature-engineering-enhanced.ts
// Enhanced feature engineering service that reads from sensor_data_logs
// and computes ML-ready feature snapshots for each equipment item.

import { db } from "../db";
import { equipment, rentals, maintenanceEvents, maintenanceConfig } from "../../shared/schema";
import { eq, sql, and, gte, lte, desc } from "drizzle-orm";

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface EnhancedFeatureSnapshot {
  equipmentId: number;
  snapshotTs: Date;
  category: string;

  // Age & usage
  assetAgeYears: number;
  totalHoursLifetime: number;
  hoursUsed30d: number;
  hoursUsed90d: number;

  // Rental activity
  rentalDays30d: number;
  rentalDays90d: number;
  avgRentalDuration: number;

  // Maintenance
  maintenanceEvents90d: number;
  maintenanceCost180d: number;
  avgDowntimePerEvent: number;
  daysSinceLastMaintenance: number | null;
  meanTimeBetweenFailures: number | null;

  // Context
  vendorReliabilityScore: number;
  jobSiteRiskScore: number;

  // Derived intensity features
  usageIntensity: number;      // hrs/day
  usageTrend: number;          // ratio 90d vs 30d
  utilizationVsExpected: number;
  wearRate: number;
  agingFactor: number;
  maintOverdue: number;        // 0 or 1
  costPerEvent: number;
  maintBurden: number;

  // Composite risk scores (0–10)
  mechanicalWearScore: number;
  abuseScore: number;
  neglectScore: number;

  // Optional sensor readings
  avgVibration?: number;
  maxVibration?: number;
  avgEngineTemp?: number;
  avgOilPressure?: number;
  avgHydraulicPressure?: number;
  errorCodeCount?: number;
  warningCount?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// SERVICE
// ─────────────────────────────────────────────────────────────────────────────

class EnhancedFeatureEngineeringService {

  async generateSnapshot(
    equipmentId: number,
    snapshotDate: Date
  ): Promise<EnhancedFeatureSnapshot> {
    const [equip] = await db
      .select()
      .from(equipment)
      .where(eq(equipment.id, equipmentId))
      .limit(1);

    if (!equip) {
      throw new Error(`Equipment ${equipmentId} not found`);
    }

    const now = snapshotDate;
    const d30 = new Date(now); d30.setDate(d30.getDate() - 30);
    const d90 = new Date(now); d90.setDate(d90.getDate() - 90);
    const d180 = new Date(now); d180.setDate(d180.getDate() - 180);

    // ── Asset age ────────────────────────────────────────────────────────
    const equipAny = equip as any;

    // Use purchase_date → year_manufactured → created_at → default 3yr
    let purchaseDate: Date;
    if (equipAny.purchaseDate || equipAny.purchase_date) {
      purchaseDate = new Date(equipAny.purchaseDate ?? equipAny.purchase_date);
    } else if (equipAny.yearManufactured || equipAny.year_manufactured) {
      const year = Number(equipAny.yearManufactured ?? equipAny.year_manufactured);
      purchaseDate = new Date(`${year}-01-01`);
    } else if (equipAny.createdAt || equipAny.created_at) {
      purchaseDate = new Date(equipAny.createdAt ?? equipAny.created_at);
    } else {
      purchaseDate = new Date(now);
      purchaseDate.setFullYear(purchaseDate.getFullYear() - 3);
    }

    const assetAgeYears = (now.getTime() - purchaseDate.getTime()) / (365.25 * 24 * 3600 * 1000);

    // ── Hours from equipment record ──────────────────────────────────────
    const totalHoursLifetime = Number(equipAny.currentMileage ?? equipAny.totalHours ?? 0);
    const initialHours = Number(equipAny.initialMileage ?? 0);

    // ── Rental activity ──────────────────────────────────────────────────
    const rentals30 = await db
      .select()
      .from(rentals)
      .where(
        and(
          eq(rentals.equipmentId, equipmentId),
          sql`${rentals.receiveDate} >= ${d30.toISOString().split('T')[0]}`
        )
      );

    const rentals90 = await db
      .select()
      .from(rentals)
      .where(
        and(
          eq(rentals.equipmentId, equipmentId),
          sql`${rentals.receiveDate} >= ${d30.toISOString().split('T')[0]}`
        )
      );

    const rentalDays30d = rentals30.reduce((sum, r) => {
      if (!r.receiveDate) return sum;
      const end = r.returnDate ? new Date(r.returnDate) : now;
      return sum + Math.max(0, (end.getTime() - new Date(r.receiveDate).getTime()) / (24 * 3600 * 1000));
    }, 0);

    const rentalDays90d = rentals90.reduce((sum, r) => {
      if (!r.receiveDate) return sum;
      const end = r.returnDate ? new Date(r.returnDate) : now;
      return sum + Math.max(0, (end.getTime() - new Date(r.receiveDate).getTime()) / (24 * 3600 * 1000));
    }, 0);

    const avgRentalDuration = rentals90.length > 0 ? rentalDays90d / rentals90.length : 0;

    // ── Maintenance events ───────────────────────────────────────────────
    const maint90 = await db
      .select()
      .from(maintenanceEvents)
      .where(
        and(
          eq(maintenanceEvents.equipmentId, equipmentId),
          sql`${maintenanceEvents.maintenanceDate} >= ${d90.toISOString().split('T')[0]}`,
          sql`${maintenanceEvents.maintenanceType} IN ('MAJOR_SERVICE', 'MINOR_SERVICE')`
        )
      );

    const maint180 = await db
      .select()
      .from(maintenanceEvents)
      .where(
        and(
          eq(maintenanceEvents.equipmentId, equipmentId),
          sql`${maintenanceEvents.maintenanceDate} >= ${d180.toISOString().split('T')[0]}`,
          sql`${maintenanceEvents.maintenanceType} IN ('MAJOR_SERVICE', 'MINOR_SERVICE')`
        )
      );

    // Cap at realistic max — simulated data can produce unrealistically high counts
    const maintenanceEvents90d = Math.min(maint90.length, 6);
    // Use per-event average cost × capped count to avoid inflated totals
    const rawCost180d = maint180.reduce((sum, e) => sum + Number(e.cost || 0), 0);
    const avgEventCost = maint180.length > 0 ? rawCost180d / maint180.length : 0;
    const maintenanceCost180d = avgEventCost * Math.min(maint180.length, 12);
    const avgDowntimePerEvent = maint90.length > 0 ? 8 : 0;

    // Days since last maintenance
    const [lastMaint] = await db
      .select()
      .from(maintenanceEvents)
      .where(eq(maintenanceEvents.equipmentId, equipmentId))
      .orderBy(desc(maintenanceEvents.maintenanceDate))
      .limit(1);

    const daysSinceLastMaintenance = lastMaint?.maintenanceDate
      ? Math.max(0, (now.getTime() - new Date(lastMaint.maintenanceDate).getTime()) / (24 * 3600 * 1000))
      : null;

    // Mean time between failures
    const allMaint = await db
      .select()
      .from(maintenanceEvents)
      .where(
        and(
          eq(maintenanceEvents.equipmentId, equipmentId),
          sql`${maintenanceEvents.maintenanceType} IN ('MAJOR_SERVICE', 'MINOR_SERVICE')`
        )
      )
      .orderBy(maintenanceEvents.maintenanceDate);

    let meanTimeBetweenFailures: number | null = null;
    if (allMaint.length >= 2) {
      const gaps: number[] = [];
      for (let i = 1; i < allMaint.length; i++) {
        const prev = new Date(allMaint[i - 1].maintenanceDate!).getTime();
        const curr = new Date(allMaint[i].maintenanceDate!).getTime();
        gaps.push((curr - prev) / (24 * 3600 * 1000));
      }
      meanTimeBetweenFailures = Math.max(
        gaps.reduce((a, b) => a + b, 0) / gaps.length,
        14  // minimum 14 days between failures — anything lower is data noise
      );
    }

    // ── Sensor data ──────────────────────────────────────────────────────
    const sensorStats = await this.getSensorStats(equipmentId, d30, now);

    // ── Derived features ─────────────────────────────────────────────────
    const hoursUsed30d = rentalDays30d * 8;  // estimate 8 operating hrs per rental day
    const hoursUsed90d = rentalDays90d * 8;

    const usageIntensity = rentalDays30d > 0 ? Math.min(hoursUsed30d / 30, 12) : 0;
    const usageTrend = hoursUsed30d > 0 && hoursUsed90d > 0
      ? (hoursUsed30d * 3) / hoursUsed90d  // annualise 30d vs 90d
      : 1.0;

    const expectedMonthlyHours = 160; // 8hr/day * 20 working days
    const utilizationVsExpected = hoursUsed30d / expectedMonthlyHours;

    const wearRate = assetAgeYears > 0 ? totalHoursLifetime / (assetAgeYears * 8760) : 0;
    const agingFactor = Math.min(assetAgeYears / 10, 1.0);

    const configRecord = await db
      .select()
      .from(maintenanceConfig)
      .where(eq(maintenanceConfig.equipmentCategory, equip.category || 'Default'))
      .limit(1);

    const intervalDays = (configRecord[0] as any)?.inspectionIntervalDays ?? 90;
    const maintOverdue = daysSinceLastMaintenance !== null && daysSinceLastMaintenance > intervalDays ? 1 : 0;

    const costPerEvent = maintenanceEvents90d > 0 ? maintenanceCost180d / maintenanceEvents90d : 0;
    // Use asset age in hours as denominator when lifetime hours unavailable
    const effectiveHours = totalHoursLifetime > 0 ? totalHoursLifetime : assetAgeYears * 500;
    const maintBurden = maintenanceCost180d / Math.max(effectiveHours, 100);

    // ── Composite risk scores ────────────────────────────────────────────
    const hoursFactor = Math.min(totalHoursLifetime / 5000, 1);
    const ageFactor = Math.min(assetAgeYears / 8, 1);
    const mechanicalWearScore = Math.min((hoursFactor * 5 + ageFactor * 5), 10);

    const intensityFactor = Math.min(usageIntensity / 10, 1);
    const trendFactor = Math.max(0, Math.min((usageTrend - 1) / 0.5, 1));
    const abuseScore = Math.min((intensityFactor * 6 + trendFactor * 4), 10);

    const neglectDaysFactor = daysSinceLastMaintenance !== null
      ? Math.min(daysSinceLastMaintenance / 120, 1)
      : 0.5;
    const neglectScore = Math.min(
      Math.max(0, neglectDaysFactor * 7 + (maintOverdue ? 3 : 0)),
      10
    );

    // ── Context scores ────────────────────────────────────────────────────
    const vendorReliabilityScore = 0.80; // default — could be computed from vendor data
    const jobSiteRiskScore = 0.50;       // default — could be computed from job site data

    return {
      equipmentId,
      snapshotTs: now,
      category: equip.category || 'Unknown',
      assetAgeYears,
      totalHoursLifetime,
      hoursUsed30d,
      hoursUsed90d,
      rentalDays30d,
      rentalDays90d,
      avgRentalDuration,
      maintenanceEvents90d,
      maintenanceCost180d,
      avgDowntimePerEvent,
      daysSinceLastMaintenance,
      meanTimeBetweenFailures,
      vendorReliabilityScore,
      jobSiteRiskScore,
      usageIntensity,
      usageTrend,
      utilizationVsExpected,
      wearRate,
      agingFactor,
      maintOverdue,
      costPerEvent,
      maintBurden,
      mechanicalWearScore,
      abuseScore,
      neglectScore,
      ...sensorStats,
    };
  }

  private async getSensorStats(
    equipmentId: number,
    from: Date,
    to: Date
  ): Promise<Partial<EnhancedFeatureSnapshot>> {
    try {
      const result = await db.execute(sql`
        SELECT
          AVG(vibration_level)      as avg_vibration,
          MAX(vibration_level)      as max_vibration,
          AVG(engine_temperature)   as avg_engine_temp,
          AVG(oil_pressure)         as avg_oil_pressure,
          AVG(hydraulic_pressure)   as avg_hydraulic_pressure,
          SUM(CASE WHEN error_code IS NOT NULL AND error_code != '' THEN 1 ELSE 0 END) as error_code_count,
          SUM(CASE WHEN warning_flag = 1 THEN 1 ELSE 0 END) as warning_count
        FROM sensor_data_logs
        WHERE equipment_id = ${equipmentId}
          AND timestamp BETWEEN ${from} AND ${to}
      `);

      const rows = Array.isArray(result) && Array.isArray(result[0]) ? result[0] : result;
      const row = (rows as any[])[0] || {};

      return {
        avgVibration:       row.avg_vibration != null ? Number(row.avg_vibration) : undefined,
        maxVibration:       row.max_vibration != null ? Number(row.max_vibration) : undefined,
        avgEngineTemp:      row.avg_engine_temp != null ? Number(row.avg_engine_temp) : undefined,
        avgOilPressure:     row.avg_oil_pressure != null ? Number(row.avg_oil_pressure) : undefined,
        avgHydraulicPressure: row.avg_hydraulic_pressure != null ? Number(row.avg_hydraulic_pressure) : undefined,
        errorCodeCount:     row.error_code_count != null ? Number(row.error_code_count) : 0,
        warningCount:       row.warning_count != null ? Number(row.warning_count) : 0,
      };
    } catch {
      // sensor_data_logs may not exist yet — return empty
      return {};
    }
  }
}

export const enhancedFeatureService = new EnhancedFeatureEngineeringService();