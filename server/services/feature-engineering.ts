
import { db } from "../db";
import { 
  equipment, 
  rentals, 
  maintenanceEvents, 
  assetFeatureSnapshots,
  vendors,
  jobSites
} from "@shared/schema";
import { eq, and, sql, gte, lte, count, sum, avg } from "drizzle-orm";
import { enhancedFeatureService } from './feature-engineering-enhanced';

export interface FeatureSnapshot {
  equipmentId: number;
  snapshotTs: Date;
  
  // Asset metadata
  assetAgeYears: number;
  category: string;
  
  // Usage features
  totalHoursLifetime: number;
  hoursUsed30d: number;
  hoursUsed90d: number;
  
  // Rental intensity
  rentalDays30d: number;
  rentalDays90d: number;
  avgRentalDuration: number;
  
  // Maintenance features
  maintenanceEvents90d: number;
  maintenanceCost180d: number;
  avgDowntimePerEvent: number;
  daysSinceLastMaintenance: number | null;
  
  // Reliability
  meanTimeBetweenFailures: number | null;
  
  // Context
  vendorReliabilityScore: number;
  jobSiteRiskScore: number;

  // Derived scores
  usageIntensity: number;
  usageTrend: number;
  utilizationVsExpected: number;
  wearRate: number;
  agingFactor: number;
  maintOverdue: number;
  costPerEvent: number;
  maintBurden: number;
  mechanicalWearScore: number;
  abuseScore: number;
  neglectScore: number;

  // Trend velocity features (v2)
  wearRateVelocity: number;
  maintFrequencyTrend: number;
  costTrend: number;
  hoursVelocity: number;
  neglectAcceleration: number;
  sensorDegradationRate: number;
}

class FeatureEngineeringService {
  /**
   * Generate a feature snapshot for a specific equipment at a specific time
   * CRITICAL: Only uses data available BEFORE snapshotTs (no future leakage)
   */
  async generateSnapshot(equipmentId: number, snapshotTs: Date): Promise<FeatureSnapshot> {
    // Get equipment metadata
    const [equip] = await db
      .select()
      .from(equipment)
      .where(eq(equipment.id, equipmentId));
    
    if (!equip) {
      throw new Error(`Equipment ${equipmentId} not found`);
    }
    
    // Calculate asset age
    const assetAgeYears = equip.createdAt 
      ? (snapshotTs.getTime() - new Date(equip.createdAt).getTime()) / (365.25 * 24 * 60 * 60 * 1000)
      : 0;
    
    // Calculate date windows (all BEFORE snapshotTs)
    const ts30dAgo = new Date(snapshotTs.getTime() - 30 * 24 * 60 * 60 * 1000);
    const ts90dAgo = new Date(snapshotTs.getTime() - 90 * 24 * 60 * 60 * 1000);
    const ts180dAgo = new Date(snapshotTs.getTime() - 180 * 24 * 60 * 60 * 1000);
    
    // === RENTAL FEATURES ===
    const rentalsLast90d = await db
      .select({
        count: count(),
        avgDuration: avg(sql`DATEDIFF(return_date, receive_date)`),
        totalHours: sum(rentals.returnHours),
      })
      .from(rentals)
      .where(
        and(
          eq(rentals.equipmentId, equipmentId),
          lte(rentals.receiveDate, snapshotTs),
          gte(rentals.receiveDate, ts90dAgo)
        )
      );
    
    const rentalsLast30d = await db
      .select({ count: count() })
      .from(rentals)
      .where(
        and(
          eq(rentals.equipmentId, equipmentId),
          lte(rentals.receiveDate, snapshotTs),
          gte(rentals.receiveDate, ts30dAgo)
        )
      );
    
    // Calculate rental days
    const rentalDays30d = rentalsLast30d[0]?.count || 0;
    const rentalDays90d = rentalsLast90d[0]?.count || 0;
    const avgRentalDuration = Number(rentalsLast90d[0]?.avgDuration) || 0;
    
    // Usage hours
    const hoursUsed30d = 0; // Simplified - calculate from rental hours if available
    const hoursUsed90d = Number(rentalsLast90d[0]?.totalHours) || 0;
    const totalHoursLifetime = hoursUsed90d; // Simplified - would need cumulative tracking
    
    // === MAINTENANCE FEATURES ===
    const maintenanceLast90d = await db
      .select({
        count: count(),
        totalCost: sum(maintenanceEvents.cost),
      })
      .from(maintenanceEvents)
      .where(
        and(
          eq(maintenanceEvents.equipmentId, equipmentId),
          lte(maintenanceEvents.maintenanceDate, snapshotTs),
          gte(maintenanceEvents.maintenanceDate, ts90dAgo)
        )
      );
    
    const maintenanceLast180d = await db
      .select({
        totalCost: sum(maintenanceEvents.cost),
      })
      .from(maintenanceEvents)
      .where(
        and(
          eq(maintenanceEvents.equipmentId, equipmentId),
          lte(maintenanceEvents.maintenanceDate, snapshotTs),
          gte(maintenanceEvents.maintenanceDate, ts180dAgo)
        )
      );
    
    const maintenanceEvents90d = maintenanceLast90d[0]?.count || 0;
    const maintenanceCost180d = Number(maintenanceLast180d[0]?.totalCost) || 0;
    
    // Days since last maintenance
    const [lastMaintenance] = await db
      .select({ date: maintenanceEvents.maintenanceDate })
      .from(maintenanceEvents)
      .where(
        and(
          eq(maintenanceEvents.equipmentId, equipmentId),
          lte(maintenanceEvents.maintenanceDate, snapshotTs)
        )
      )
      .orderBy(sql`${maintenanceEvents.maintenanceDate} DESC`)
      .limit(1);
    
    const daysSinceLastMaintenance = lastMaintenance?.date
      ? Math.floor((snapshotTs.getTime() - new Date(lastMaintenance.date).getTime()) / (24 * 60 * 60 * 1000))
      : null;
    
    // Simplified metrics
    const avgDowntimePerEvent = maintenanceEvents90d > 0 ? 2.5 : 0; // Placeholder
    const meanTimeBetweenFailures = daysSinceLastMaintenance || null;
    
    // === CONTEXT FEATURES ===
    // Vendor reliability (simplified heuristic)
    const vendorReliabilityScore = 0.75; // Placeholder - calculate from vendor maintenance history
    
    // Job site risk (simplified heuristic)
    const jobSiteRiskScore = 0.50; // Placeholder - calculate from site damage rates
    
    return {
      equipmentId,
      snapshotTs,
      assetAgeYears,
      category: equip.category,
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
      usageIntensity: 0,
      usageTrend: 1,
      utilizationVsExpected: 1,
      wearRate: 0,
      agingFactor: 0,
      maintOverdue: 0,
      costPerEvent: 0,
      maintBurden: 0,
      mechanicalWearScore: 0,
      abuseScore: 0,
      neglectScore: 0,
      wearRateVelocity: 0,
      maintFrequencyTrend: 1,
      costTrend: 1,
      hoursVelocity: 1,
      neglectAcceleration: 1,
      sensorDegradationRate: 0,
    
    };
  }
  
  /**
   * Generate snapshots for ALL equipment at a specific time
   */
  async generateSnapshotsForAllEquipment(snapshotTs: Date): Promise<FeatureSnapshot[]> {
    const allEquipment = await db.select({ id: equipment.id }).from(equipment);
    
    const snapshots: FeatureSnapshot[] = [];
    
    for (const equip of allEquipment) {
      try {
        const snapshot = await enhancedFeatureService.generateSnapshot(equip.id, snapshotTs);
        snapshots.push(snapshot);
      } catch (error) {
        console.error(`Failed to generate snapshot for equipment ${equip.id}:`, error);
      }
    }
    
    return snapshots;
  }
  
  /**
   * Save snapshot to database
   */
  async saveSnapshot(snapshot: FeatureSnapshot): Promise<void> {
    await db.insert(assetFeatureSnapshots).values([{
      equipmentId: snapshot.equipmentId,
      snapshotTs: snapshot.snapshotTs,
      assetAgeYears: snapshot.assetAgeYears.toString(),
      category: snapshot.category,
      totalHoursLifetime: snapshot.totalHoursLifetime.toString(),
      hoursUsed30d: snapshot.hoursUsed30d.toString(),
      hoursUsed90d: snapshot.hoursUsed90d.toString(),
      rentalDays30d: snapshot.rentalDays30d,
      rentalDays90d: snapshot.rentalDays90d,
      avgRentalDuration: snapshot.avgRentalDuration.toString(),
      maintenanceEvents90d: snapshot.maintenanceEvents90d,
      maintenanceCost180d: snapshot.maintenanceCost180d.toString(),
      avgDowntimePerEvent: snapshot.avgDowntimePerEvent.toString(),
      daysSinceLastMaintenance: snapshot.daysSinceLastMaintenance,
      meanTimeBetweenFailures: snapshot.meanTimeBetweenFailures,
      vendorReliabilityScore: snapshot.vendorReliabilityScore.toString(),
      jobSiteRiskScore: snapshot.jobSiteRiskScore.toString(),
      wearRateVelocity:      snapshot.wearRateVelocity.toString(),
      maintFrequencyTrend:   snapshot.maintFrequencyTrend.toString(),
      costTrend:             snapshot.costTrend.toString(),
      hoursVelocity:         snapshot.hoursVelocity.toString(),
      neglectAcceleration:   snapshot.neglectAcceleration.toString(),
      sensorDegradationRate: snapshot.sensorDegradationRate.toString(),
      willFail10d: null,
      willFail30d: null,
      willFail60d: null,
    }]);
  }
  
  /**
   * Label historical snapshots with failure events
   * CRITICAL: Only labels snapshots where we know the outcome (30 days have passed)
   */
  async labelSnapshots(): Promise<number> {
    // Use simulation cursor as reference, not wall clock
    const [stateRows] = await db.execute(
      sql`SELECT cursor_date FROM simulation_state WHERE id = 1`
    ) as any;
    const simCursor = stateRows[0]?.cursor_date
      ? new Date(stateRows[0].cursor_date)
      : new Date();

    // Only label snapshots where full 60d outcome window has elapsed
    const cutoffDate = new Date(simCursor.getTime() - 60 * 24 * 60 * 60 * 1000);
      // Get unlabeled snapshots older than 60 days (need full window to label all horizons)
      const unlabeledSnapshots = await db
        .select()
        .from(assetFeatureSnapshots)
        .where(
          and(
            sql`${assetFeatureSnapshots.willFail60d} IS NULL`,
            lte(assetFeatureSnapshots.snapshotTs, cutoffDate)
          )
        );
    
    let labeled = 0;
    
    for (const snapshot of unlabeledSnapshots) {
      const snapshotDate = new Date(snapshot.snapshotTs);
      const windowEnd = new Date(snapshotDate.getTime() + 30 * 24 * 60 * 60 * 1000);     
      const window10End = new Date(snapshotDate.getTime() + 10 * 24 * 60 * 60 * 1000);
        const window60End = new Date(snapshotDate.getTime() + 60 * 24 * 60 * 60 * 1000);

        // Only MAJOR_SERVICE counts as a failure event
        // Minor service and inspections are routine PM — not failure predictions
        const [maint10] = await db.select({ count: count() }).from(maintenanceEvents).where(
          and(
            eq(maintenanceEvents.equipmentId, snapshot.equipmentId),
            gte(maintenanceEvents.maintenanceDate, snapshotDate),
            lte(maintenanceEvents.maintenanceDate, window10End),
            sql`${maintenanceEvents.maintenanceType} = 'MAJOR_SERVICE'`
          )
        );
        const [maintenanceInWindow] = await db
          .select({ count: count() })
          .from(maintenanceEvents)
          .where(
            and(
              eq(maintenanceEvents.equipmentId, snapshot.equipmentId),
              gte(maintenanceEvents.maintenanceDate, snapshotDate),
              lte(maintenanceEvents.maintenanceDate, windowEnd),
              sql`${maintenanceEvents.maintenanceType} = 'MAJOR_SERVICE'`
            )
          );
        const [maint60] = await db.select({ count: count() }).from(maintenanceEvents).where(
          and(
            eq(maintenanceEvents.equipmentId, snapshot.equipmentId),
            gte(maintenanceEvents.maintenanceDate, snapshotDate),
            lte(maintenanceEvents.maintenanceDate, window60End),
            sql`${maintenanceEvents.maintenanceType} = 'MAJOR_SERVICE'`
          )
        );

        const label10 = (maint10?.count || 0) > 0 ? 1 : 0;
        const label30 = (maintenanceInWindow?.count || 0) > 0 ? 1 : 0;
        const label60 = (maint60?.count || 0) > 0 ? 1 : 0;

        await db
          .update(assetFeatureSnapshots)
          .set({ willFail10d: label10, willFail30d: label30, willFail60d: label60 })
          .where(eq(assetFeatureSnapshots.id, snapshot.id));
        labeled++;
    }
    
    return labeled;
  }
}

export const featureEngineeringService = new FeatureEngineeringService();