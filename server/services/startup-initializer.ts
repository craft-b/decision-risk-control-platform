// server/services/startup-initializer.ts
// Runs once when the Node.js server starts.
// Checks DB health, seeds defaults, and logs system status.

import { db } from "../db";
import { equipment, maintenanceConfig } from "../../shared/schema";
import { sql } from "drizzle-orm";

export async function runStartupChecks(): Promise<void> {
  console.log('[STARTUP] Running startup checks...');

  try {
    // 1. DB connectivity
    await db.execute(sql`SELECT 1`);
    console.log('[STARTUP] ✅ Database connected');

    // 2. Equipment count
    const [countResult] = await db.execute(sql`SELECT COUNT(*) as count FROM equipment`);
    const rows = Array.isArray(countResult) ? countResult : [countResult];
    const equipCount = Number((rows as any[])[0]?.count ?? 0);
    console.log(`[STARTUP] ✅ ${equipCount} equipment records found`);

    // 3. Sensor data table
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
    console.log('[STARTUP] ✅ sensor_data_logs table ready');

    // 4. Maintenance config defaults
    await seedMaintenanceConfig();
    console.log('[STARTUP] ✅ Maintenance config ready');

    console.log('[STARTUP] All checks passed ✅');
  } catch (err) {
    console.error('[STARTUP] ❌ Startup check failed:', err);
    // Don't crash the server — log and continue
  }
}

async function seedMaintenanceConfig(): Promise<void> {
  const defaults = [
    { equipmentCategory: 'Excavator',  inspectionIntervalDays: 90,  minorServiceIntervalDays: 180, majorServiceIntervalDays: 365 },
    { equipmentCategory: 'Dozer',      inspectionIntervalDays: 60,  minorServiceIntervalDays: 120, majorServiceIntervalDays: 365 },
    { equipmentCategory: 'Loader',     inspectionIntervalDays: 90,  minorServiceIntervalDays: 180, majorServiceIntervalDays: 365 },
    { equipmentCategory: 'Crane',      inspectionIntervalDays: 30,  minorServiceIntervalDays: 90,  majorServiceIntervalDays: 180 },
    { equipmentCategory: 'Compactor',  inspectionIntervalDays: 60,  minorServiceIntervalDays: 120, majorServiceIntervalDays: 365 },
    { equipmentCategory: 'Default',    inspectionIntervalDays: 90,  minorServiceIntervalDays: 180, majorServiceIntervalDays: 365 },
  ];

  for (const config of defaults) {
    await db.execute(sql`
      INSERT INTO maintenance_config (equipment_category, inspection_interval_days, minor_service_interval_days, major_service_interval_days)
      VALUES (
        ${config.equipmentCategory},
        ${config.inspectionIntervalDays},
        ${config.minorServiceIntervalDays},
        ${config.majorServiceIntervalDays}
      )
      ON DUPLICATE KEY UPDATE
        inspection_interval_days    = VALUES(inspection_interval_days),
        minor_service_interval_days = VALUES(minor_service_interval_days),
        major_service_interval_days = VALUES(major_service_interval_days)
    `);
  }
}