/**
 * seed-snapshots.ts — Seeds asset_feature_snapshots with labeled training data.
 * Generates realistic snapshots at 14-day intervals per equipment item.
 * Labels (will_fail_10d/30d/60d) are set based on whether a REACTIVE_REPAIR
 * maintenance event occurs within that window after the snapshot date.
 *
 * Run: npx tsx scripts/seed-snapshots.ts
 * Requires: DATABASE_URL env var pointing at the Railway public MySQL URL.
 */
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { assetFeatureSnapshots, equipment, maintenanceEvents } from "../shared/schema";
import { eq, and, gte, lte, sql } from "drizzle-orm";

const connection = await mysql.createConnection(process.env.DATABASE_URL!);
const db = drizzle(connection, { mode: "default" });

// ── helpers ──────────────────────────────────────────────────────────────────

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function dateStr(d: Date) { return d.toISOString().split("T")[0]; }

function clamp(v: number, lo: number, hi: number) { return Math.min(Math.max(v, lo), hi); }

// ── load data ─────────────────────────────────────────────────────────────────

const allEquipment = await db.select().from(equipment);
const allMaint     = await db.select().from(maintenanceEvents);

// Build per-equipment maintenance index
const maintByEquip = new Map<number, typeof allMaint>();
for (const m of allMaint) {
  if (!maintByEquip.has(m.equipmentId)) maintByEquip.set(m.equipmentId, []);
  maintByEquip.get(m.equipmentId)!.push(m);
}

// ── snapshot generation ───────────────────────────────────────────────────────

const INTERVAL_DAYS  = 14;
const START_DATE     = new Date("2028-06-01");   // well after earliest maintenance
const END_DATE       = new Date("2032-04-01");   // just before simulation cursor

const rows: any[] = [];

for (const equip of allEquipment) {
  const mEvents = (maintByEquip.get(equip.id) ?? []).sort(
    (a, b) => new Date(a.maintenanceDate!).getTime() - new Date(b.maintenanceDate!).getTime()
  );

  const purchaseDate = equip.purchaseDate
    ? new Date(equip.purchaseDate)
    : new Date(`${equip.yearManufactured ?? 2018}-01-01`);

  let cursor = new Date(START_DATE);

  while (cursor <= END_DATE) {
    const snapTs  = new Date(cursor);
    const d30     = addDays(snapTs, -30);
    const d90     = addDays(snapTs, -90);
    const d180    = addDays(snapTs, -180);

    // ── feature computation from seeded maintenance history ──────────────
    const maint90  = mEvents.filter(m => {
      const d = new Date(m.maintenanceDate!);
      return d >= d90 && d <= snapTs;
    });
    const maint180 = mEvents.filter(m => {
      const d = new Date(m.maintenanceDate!);
      return d >= d180 && d <= snapTs;
    });
    const lastMaint = [...mEvents]
      .reverse()
      .find(m => new Date(m.maintenanceDate!) <= snapTs);

    const assetAgeYears     = (snapTs.getTime() - purchaseDate.getTime()) / (365.25 * 86400000);
    const currentMileage    = parseFloat(equip.currentMileage ?? "0");
    const totalHoursLifetime = currentMileage;                // mileage proxy for hours

    const maintenanceEvents90d  = Math.min(maint90.length, 6);
    const maintenanceCost180d   = maint180.reduce((s, m) => s + Number(m.cost ?? 0), 0);
    const avgDowntimePerEvent   = maint90.length > 0 ? 8 : 0;

    const daysSinceLastMaint = lastMaint
      ? (snapTs.getTime() - new Date(lastMaint.maintenanceDate!).getTime()) / 86400000
      : 999;

    // MTBF from gap between consecutive events
    let mtbf: number | null = null;
    if (mEvents.length >= 2) {
      const gaps: number[] = [];
      for (let i = 1; i < mEvents.length; i++) {
        gaps.push(
          (new Date(mEvents[i].maintenanceDate!).getTime() -
           new Date(mEvents[i - 1].maintenanceDate!).getTime()) / 86400000
        );
      }
      mtbf = Math.max(gaps.reduce((a, b) => a + b, 0) / gaps.length, 14);
    }

    // Simulate rental intensity from mileage + age
    const rentalDays30d = clamp(Math.round(assetAgeYears * 2.5 + Math.random() * 8), 0, 28);
    const rentalDays90d = clamp(Math.round(rentalDays30d * 2.8), 0, 85);
    const avgRentalDuration = rentalDays90d > 0 ? rentalDays90d / Math.max(1, Math.round(rentalDays90d / 12)) : 0;

    const hoursUsed30d = rentalDays30d * 8;
    const hoursUsed90d = rentalDays90d * 8;

    const usageIntensity = rentalDays30d > 0 ? clamp(hoursUsed30d / 30, 0, 12) : 0;
    const usageTrend     = hoursUsed30d > 0 && hoursUsed90d > 0 ? (hoursUsed30d * 3) / hoursUsed90d : 1.0;
    const wearRate       = assetAgeYears > 0 ? totalHoursLifetime / (assetAgeYears * 8760) : 0;
    const agingFactor    = clamp(assetAgeYears / 10, 0, 1);
    const maintOverdue   = daysSinceLastMaint > 90 ? 1 : 0;
    const costPerEvent   = maintenanceEvents90d > 0 ? maintenanceCost180d / maintenanceEvents90d : 0;
    const effectiveHours = totalHoursLifetime > 0 ? totalHoursLifetime : assetAgeYears * 500;
    const maintBurden    = maintenanceCost180d / Math.max(effectiveHours, 100);

    const hoursFactor    = clamp(totalHoursLifetime / 5000, 0, 1);
    const mechanicalWearScore = clamp(hoursFactor * 5 + agingFactor * 5, 0, 10);
    const abuseScore     = clamp(clamp(usageIntensity / 10, 0, 1) * 6 + clamp((usageTrend - 1) / 0.5, 0, 1) * 4, 0, 10);
    const neglectScore   = clamp(clamp(daysSinceLastMaint / 120, 0, 1) * 7 + (maintOverdue ? 3 : 0), 0, 10);

    const failuresPerYear = mEvents.length > 0 && assetAgeYears > 0 ? mEvents.length / assetAgeYears : 0;
    const vendorReliabilityScore = clamp(0.95 - (failuresPerYear - 4) * 0.04, 0.40, 0.95);
    const utilizationVsExpected  = hoursUsed30d / 160;
    const jobSiteRiskScore       = clamp(0.30 + utilizationVsExpected * 0.30 + (clamp(usageTrend, 1, 3) - 1) * 0.15, 0.20, 0.95);

    // Trend velocity features
    const hoursAt90dAgo    = Math.max(0, totalHoursLifetime - hoursUsed90d);
    const ageAt90dAgo      = Math.max(0.01, assetAgeYears - 90 / 365.25);
    const wearRate90dAgo   = hoursAt90dAgo / (ageAt90dAgo * 8760);
    const wearRateVelocity = (wearRate - wearRate90dAgo) * 30;

    const maint30Count       = maint90.filter(m => new Date(m.maintenanceDate!) >= d30).length;
    const maintFrequencyTrend = maint90.length > 0
      ? (maint30Count * 12) / (maint90.length * (365 / 90))
      : 1.0;

    const avgCostRecent = maint90.length > 0
      ? maint90.reduce((s, m) => s + Number(m.cost ?? 0), 0) / maint90.length : 0;
    const maint90to180  = maint180.filter(m => new Date(m.maintenanceDate!) < d90);
    const avgCostPrior  = maint90to180.length > 0
      ? maint90to180.reduce((s, m) => s + Number(m.cost ?? 0), 0) / maint90to180.length
      : avgCostRecent;
    const costTrend     = avgCostPrior > 0 ? avgCostRecent / avgCostPrior : 1.0;

    const hoursPerDay30d  = rentalDays30d > 0 ? hoursUsed30d / 30 : 0;
    const hoursPerDay90d  = rentalDays90d > 0 ? hoursUsed90d / 90 : 0;
    const hoursVelocity   = hoursPerDay90d > 0 ? hoursPerDay30d / hoursPerDay90d : 1.0;
    const neglectAcceleration = daysSinceLastMaint / Math.max(90, mtbf ?? 90);

    // ── LABELS: 1 if REACTIVE_REPAIR within window after snapshot ────────
    const reactiveAfter = (days: number) =>
      mEvents.some(m =>
        m.eventSource === "REACTIVE_REPAIR" &&
        new Date(m.maintenanceDate!) > snapTs &&
        new Date(m.maintenanceDate!) <= addDays(snapTs, days)
      );

    const willFail10d = reactiveAfter(10)  ? 1 : 0;
    const willFail30d = reactiveAfter(30)  ? 1 : 0;
    const willFail60d = reactiveAfter(60)  ? 1 : 0;

    rows.push({
      equipmentId:            equip.id,
      snapshotTs:             snapTs,
      assetAgeYears:          assetAgeYears.toFixed(2),
      category:               equip.category,
      totalHoursLifetime:     totalHoursLifetime.toFixed(2),
      hoursUsed30d:           hoursUsed30d.toFixed(2),
      hoursUsed90d:           hoursUsed90d.toFixed(2),
      rentalDays30d:          rentalDays30d,
      rentalDays90d:          rentalDays90d,
      avgRentalDuration:      avgRentalDuration.toFixed(2),
      maintenanceEvents90d:   maintenanceEvents90d,
      maintenanceCost180d:    maintenanceCost180d.toFixed(2),
      avgDowntimePerEvent:    avgDowntimePerEvent.toFixed(2),
      daysSinceLastMaintenance: Math.round(daysSinceLastMaint),
      meanTimeBetweenFailures:  mtbf !== null ? Math.round(mtbf) : null,
      vendorReliabilityScore:  vendorReliabilityScore.toFixed(2),
      jobSiteRiskScore:        jobSiteRiskScore.toFixed(2),
      wearRateVelocity:        wearRateVelocity.toFixed(4),
      maintFrequencyTrend:     maintFrequencyTrend.toFixed(4),
      costTrend:               costTrend.toFixed(4),
      hoursVelocity:           hoursVelocity.toFixed(4),
      neglectAcceleration:     clamp(neglectAcceleration, 0, 3).toFixed(4),
      sensorDegradationRate:   "0.0000",
      willFail10d,
      willFail30d,
      willFail60d,
    });

    cursor = addDays(cursor, INTERVAL_DAYS);
  }
}

// ── insert in batches ─────────────────────────────────────────────────────────

const BATCH = 50;
let inserted = 0;
for (let i = 0; i < rows.length; i += BATCH) {
  await db.insert(assetFeatureSnapshots).values(rows.slice(i, i + BATCH));
  inserted += rows.slice(i, i + BATCH).length;
  process.stdout.write(`\rInserted ${inserted}/${rows.length} snapshots...`);
}

console.log(`\nDone! ${rows.length} snapshots seeded.`);
const positives = rows.filter(r => r.willFail30d === 1).length;
console.log(`Label rate (30d): ${(positives / rows.length * 100).toFixed(1)}% positive (${positives}/${rows.length})`);

await connection.end();
