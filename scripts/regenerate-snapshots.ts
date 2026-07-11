/**
 * regenerate-snapshots.ts — ML-1 remediation.
 *
 * Rebuilds the entire feature store with point-in-time-correct (snapshot-
 * bounded) feature queries, then relabels under the ML-2/ML-11 rules
 * (REACTIVE_REPAIR-only positives, day-1 window start, intervention censoring
 * via label_status).
 *
 * The previous snapshots were computed with unbounded window queries and are
 * contaminated by post-snapshot information (including the label event); they
 * cannot be repaired in place. The pre-fix rows are preserved in
 * asset_feature_snapshots_backup_pre_ml1 for before/after comparison.
 *
 * Run: npx tsx scripts/regenerate-snapshots.ts
 */
import { db } from "../server/db";
import { sql } from "drizzle-orm";
import { featureEngineeringService } from "../server/services/feature-engineering";

const SNAPSHOT_INTERVAL_DAYS = 7;

async function main() {
  // ── 1. Backup, then wipe ──────────────────────────────────────────────────
  const [bk] = await db.execute(
    sql`SHOW TABLES LIKE 'asset_feature_snapshots_backup_pre_ml1'`
  ) as any;
  if ((bk as any[]).length === 0) {
    console.log("[REGEN] Backing up existing snapshots → asset_feature_snapshots_backup_pre_ml1");
    await db.execute(sql`
      CREATE TABLE asset_feature_snapshots_backup_pre_ml1
      AS SELECT * FROM asset_feature_snapshots
    `);
  } else {
    console.log("[REGEN] Backup table already exists — leaving it untouched");
  }
  await db.execute(sql`TRUNCATE TABLE asset_feature_snapshots`);

  // ── 2. Weekly grid — mirrors /api/predictive-maintenance/generate-snapshots ─
  const [maintRange] = await db.execute(
    sql`SELECT MIN(DATE(maintenance_date)) as earliest FROM maintenance_events`
  ) as any;
  const earliest = maintRange[0]?.earliest
    ? new Date(maintRange[0].earliest)
    : new Date("2028-01-01");
  const [stateRows] = await db.execute(
    sql`SELECT cursor_date FROM simulation_state WHERE id = 1`
  ) as any;
  const latest = stateRows[0]?.cursor_date
    ? new Date(stateRows[0].cursor_date)
    : new Date();

  const cursor = new Date(earliest);
  cursor.setDate(cursor.getDate() + 180);
  const dates: Date[] = [];
  while (cursor <= latest) {
    dates.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + SNAPSHOT_INTERVAL_DAYS);
  }
  console.log(
    `[REGEN] ${dates.length} weekly snapshot dates from ` +
    `${dates[0]?.toISOString().split("T")[0]} to ${dates[dates.length - 1]?.toISOString().split("T")[0]}`
  );

  let total = 0;
  let skippedPreExistence = 0;
  const t0 = Date.now();
  for (let i = 0; i < dates.length; i++) {
    const snaps = await featureEngineeringService.generateSnapshotsForAllEquipment(dates[i]);
    for (const s of snaps) {
      // An asset cannot have a feature vector before it exists
      if (s.assetAgeYears <= 0) { skippedPreExistence++; continue; }
      await featureEngineeringService.saveSnapshot(s);
      total++;
    }
    if (i % 25 === 0 || i === dates.length - 1) {
      console.log(`[REGEN] ${i + 1}/${dates.length} dates · ${total} snapshots · ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    }
  }
  console.log(`[REGEN] Generated ${total} snapshots (${skippedPreExistence} pre-existence rows skipped)`);

  // ── 3. Label under ML-2/ML-11 rules ───────────────────────────────────────
  console.log("[REGEN] Labeling…");
  const labeled = await featureEngineeringService.labelSnapshots();
  console.log(`[REGEN] ${labeled} snapshots labeled/censored`);

  const [dist] = await db.execute(sql`
    SELECT label_status,
           COUNT(*)                 AS n,
           ROUND(AVG(will_fail_10d), 4) AS p10,
           ROUND(AVG(will_fail_30d), 4) AS p30,
           ROUND(AVG(will_fail_60d), 4) AS p60
    FROM asset_feature_snapshots
    GROUP BY label_status
  `) as any;
  console.log("[REGEN] Label distribution:");
  for (const row of dist as any[]) {
    console.log(`  ${row.label_status ?? "NULL"}: n=${row.n} p10=${row.p10} p30=${row.p30} p60=${row.p60}`);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
