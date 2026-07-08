// server/services/db-initializer.ts
// Startup DB check: verifies the Drizzle-managed schema is present and reports
// row counts. ARCH-1 — Drizzle migrations own ALL DDL; this file never creates
// tables (it used to hand-create sensor_data_logs). If tables are missing the
// operator is told to run `drizzle-kit migrate`.

import { db } from "../db";
import { sql } from "drizzle-orm";

export async function initializeDatabase(): Promise<void> {
  console.log('[DB-INIT] Verifying database schema...');

  try {
    // Verify Drizzle-managed tables exist (schema is owned by migrations/)
    const tables = [
      'users', 'equipment', 'rentals', 'job_sites', 'vendors', 'invoices',
      'maintenance_events', 'maintenance_config',
      'asset_feature_snapshots', 'asset_risk_predictions',
      'ml_models', 'model_training_metrics', 'model_metrics',
      'sensor_data_logs', 'drift_metrics',
    ];

    const missing: string[] = [];
    for (const table of tables) {
      try {
        await db.execute(sql.raw(`SELECT 1 FROM \`${table}\` LIMIT 1`));
      } catch {
        missing.push(table);
      }
    }

    if (missing.length > 0) {
      console.warn(`[DB-INIT] ⚠️  Missing tables: ${missing.join(', ')}`);
      console.warn('[DB-INIT] Run: npx drizzle-kit migrate to create the schema (Drizzle owns DDL)');
    } else {
      console.log('[DB-INIT] ✅ All schema tables verified');
    }

    // Report row counts for key tables
    const countResult = await db.execute(sql`
      SELECT
        (SELECT COUNT(*) FROM equipment)              as equipment,
        (SELECT COUNT(*) FROM asset_feature_snapshots) as snapshots,
        (SELECT COUNT(*) FROM asset_risk_predictions) as predictions,
        (SELECT COUNT(*) FROM sensor_data_logs)       as sensor_readings
    `);
    const rows = Array.isArray(countResult) && Array.isArray(countResult[0])
      ? countResult[0]
      : countResult;
    const counts = (rows as any[])[0] || {};

    console.log('[DB-INIT] Row counts:', {
      equipment:       Number(counts.equipment       || 0),
      snapshots:       Number(counts.snapshots       || 0),
      predictions:     Number(counts.predictions     || 0),
      sensorReadings:  Number(counts.sensor_readings || 0),
    });

    console.log('[DB-INIT] Database initialization complete ✅');
  } catch (err) {
    console.error('[DB-INIT] ❌ Error during initialization:', err);
  }
}