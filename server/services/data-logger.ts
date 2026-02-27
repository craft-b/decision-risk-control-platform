// server/services/data-logger.ts
// Writes sensor readings to sensor_data_logs table.
// Used by sensor-simulator and ml-pipeline-orchestrator.

import { db } from "../db";
import { sql } from "drizzle-orm";

export interface SensorReading {
  equipmentId: number;
  timestamp: Date;
  operatingHours: number;
  engineTemperature?: number;
  oilPressure?: number;
  hydraulicPressure?: number;
  vibrationLevel?: number;
  fuelConsumption?: number;
  loadFactor?: number;
  rpmLevel?: number;
  warningFlag?: number;
  errorCode?: string;
  operatingMode?: string;
}

class DataLogger {
  /**
   * Ensure sensor_data_logs table exists.
   * Called once at system initialization.
   */
  async initializeSchema(): Promise<void> {
    try {
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
      console.log('[DataLogger] sensor_data_logs table ready');
    } catch (err) {
      console.error('[DataLogger] Schema init error:', err);
    }
  }

  async logReading(reading: SensorReading): Promise<void> {
    await db.execute(sql`
      INSERT INTO sensor_data_logs (
        equipment_id, timestamp, operating_hours,
        engine_temperature, oil_pressure, hydraulic_pressure,
        vibration_level, fuel_consumption, load_factor,
        rpm_level, warning_flag, error_code, operating_mode
      ) VALUES (
        ${reading.equipmentId}, ${reading.timestamp}, ${reading.operatingHours},
        ${reading.engineTemperature ?? null},
        ${reading.oilPressure ?? null},
        ${reading.hydraulicPressure ?? null},
        ${reading.vibrationLevel ?? null},
        ${reading.fuelConsumption ?? null},
        ${reading.loadFactor ?? null},
        ${reading.rpmLevel ?? null},
        ${reading.warningFlag ?? 0},
        ${reading.errorCode ?? null},
        ${reading.operatingMode ?? null}
      )
    `);
  }

  async logReadingsBatch(readings: SensorReading[]): Promise<void> {
    if (readings.length === 0) return;

    // Insert in chunks of 500 to avoid packet size limits
    const chunkSize = 500;
    for (let i = 0; i < readings.length; i += chunkSize) {
      const chunk = readings.slice(i, i + chunkSize);
      for (const reading of chunk) {
        await this.logReading(reading);
      }
    }
  }

  async getLatestReading(equipmentId: number): Promise<SensorReading | null> {
    try {
      const result = await db.execute(sql`
        SELECT * FROM sensor_data_logs
        WHERE equipment_id = ${equipmentId}
        ORDER BY timestamp DESC
        LIMIT 1
      `);

      const rows = Array.isArray(result) && Array.isArray(result[0]) ? result[0] : result;
      const row = (rows as any[])[0];

      if (!row) return null;

      return {
        equipmentId:       row.equipment_id,
        timestamp:         new Date(row.timestamp),
        operatingHours:    Number(row.operating_hours),
        engineTemperature: row.engine_temperature != null ? Number(row.engine_temperature) : undefined,
        oilPressure:       row.oil_pressure != null ? Number(row.oil_pressure) : undefined,
        hydraulicPressure: row.hydraulic_pressure != null ? Number(row.hydraulic_pressure) : undefined,
        vibrationLevel:    row.vibration_level != null ? Number(row.vibration_level) : undefined,
        fuelConsumption:   row.fuel_consumption != null ? Number(row.fuel_consumption) : undefined,
        loadFactor:        row.load_factor != null ? Number(row.load_factor) : undefined,
        rpmLevel:          row.rpm_level != null ? Number(row.rpm_level) : undefined,
        warningFlag:       Number(row.warning_flag || 0),
        errorCode:         row.error_code,
        operatingMode:     row.operating_mode,
      };
    } catch {
      return null;
    }
  }

  async clearAllData(): Promise<void> {
    await db.execute(sql`TRUNCATE TABLE sensor_data_logs`);
    console.log('[DataLogger] All sensor data cleared');
  }
}

export const dataLogger = new DataLogger();