// server/services/db-initializer.ts
// One-time database initialization: creates tables not managed by Drizzle,
// validates schema integrity, and reports DB status.

import { db } from "../db";
import { sql } from "drizzle-orm";

export async function initializeDatabase(): Promise<void> {
  console.log('[DB-INIT] Initializing database...');

  try {
    // Verify core Drizzle-managed tables exist
    const tables = [
      'users', 'equipment', 'rentals', 'job_sites', 'vendors', 'invoices',
      'maintenance_events', 'maintenance_config',
      'asset_feature_snapshots', 'asset_risk_predictions',
      'ml_models', 'model_training_metrics',
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
      console.warn('[DB-INIT] Run: npm run db:push to create missing tables');
    } else {
      console.log('[DB-INIT] ✅ All core tables verified');
    }

    // Create sensor_data_logs (not in Drizzle schema — too large for migrations)
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS sensor_data_logs (
        id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        equipment_id        BIGINT UNSIGNED NOT NULL,
        timestamp           DATETIME NOT NULL,
        operating_hours     DECIMAL(10, 2) DEFAULT 0,
        engine_temperature  DECIMAL(6, 2),
        oil_pressure        DECIMAL(6, 2),
        hydraulic_pressure  DECIMAL(6, 2),
        vibration_level     DECIMAL(6, 4),
        fuel_consumption    DECIMAL(6, 2),
        load_factor         DECIMAL(4, 3),
        rpm_level           INT,
        warning_flag        TINYINT DEFAULT 0,
        error_code          VARCHAR(50),
        operating_mode      VARCHAR(20),
        created_at          DATETIME DEFAULT NOW(),
        INDEX idx_equipment_ts (equipment_id, timestamp),
        INDEX idx_timestamp (timestamp)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log('[DB-INIT] ✅ sensor_data_logs ready');

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