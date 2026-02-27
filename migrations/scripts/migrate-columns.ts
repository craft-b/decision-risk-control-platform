import { db } from "./server/db.js";

const columns = [
  "ALTER TABLE asset_risk_predictions ADD COLUMN snapshot_ts TIMESTAMP NULL",
  "ALTER TABLE asset_risk_predictions ADD COLUMN risk_band ENUM('LOW','MEDIUM','HIGH') NULL",
  "ALTER TABLE asset_risk_predictions ADD COLUMN top_driver_1 VARCHAR(100) NULL",
  "ALTER TABLE asset_risk_predictions ADD COLUMN top_driver_1_impact DECIMAL(5,4) NULL",
  "ALTER TABLE asset_risk_predictions ADD COLUMN top_driver_2 VARCHAR(100) NULL",
  "ALTER TABLE asset_risk_predictions ADD COLUMN top_driver_2_impact DECIMAL(5,4) NULL",
  "ALTER TABLE asset_risk_predictions ADD COLUMN top_driver_3 VARCHAR(100) NULL",
  "ALTER TABLE asset_risk_predictions ADD COLUMN top_driver_3_impact DECIMAL(5,4) NULL",
];

for (const sql of columns) {
  try {
    await db.execute(sql);
    const col = sql.match(/ADD COLUMN (\w+)/)?.[1];
    console.log(`✓ Added: ${col}`);
  } catch (err: any) {
    if (err?.cause?.code === 'ER_DUP_FIELDNAME') {
      const col = sql.match(/ADD COLUMN (\w+)/)?.[1];
      console.log(`- Skipped (already exists): ${col}`);
    } else {
      console.error(`✗ Failed: ${sql}`);
      console.error(err?.cause?.sqlMessage ?? err);
    }
  }
}

console.log("\nDone");
process.exit(0);