
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
        const snapshot = await this.generateSnapshot(equip.id, snapshotTs);
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
    await db.insert(assetFeatureSnapshots).values({
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
      willFail30d: null, // Labels added later
    });
  }
  
  /**
   * Label historical snapshots with failure events
   * CRITICAL: Only labels snapshots where we know the outcome (30 days have passed)
   */
  async labelSnapshots(): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 30);
    
    // Get unlabeled snapshots older than 30 days
    const unlabeledSnapshots = await db
      .select()
      .from(assetFeatureSnapshots)
      .where(
        and(
          sql`${assetFeatureSnapshots.willFail30d} IS NULL`,
          lte(assetFeatureSnapshots.snapshotTs, cutoffDate)
        )
      );
    
    let labeled = 0;
    
    for (const snapshot of unlabeledSnapshots) {
      const snapshotDate = new Date(snapshot.snapshotTs);
      const windowEnd = new Date(snapshotDate.getTime() + 30 * 24 * 60 * 60 * 1000);
      
      // Check if ANY maintenance event occurred in next 30 days
      const [maintenanceInWindow] = await db
        .select({ count: count() })
        .from(maintenanceEvents)
        .where(
          and(
            eq(maintenanceEvents.equipmentId, snapshot.equipmentId),
            gte(maintenanceEvents.maintenanceDate, snapshotDate),
            lte(maintenanceEvents.maintenanceDate, windowEnd)
          )
        );
      
      const label = (maintenanceInWindow?.count || 0) > 0 ? 1 : 0;
      
      await db
        .update(assetFeatureSnapshots)
        .set({ willFail30d: label })
        .where(eq(assetFeatureSnapshots.id, snapshot.id));
      
      labeled++;
    }
    
    return labeled;
  }
}

export const featureEngineeringService = new FeatureEngineeringService();