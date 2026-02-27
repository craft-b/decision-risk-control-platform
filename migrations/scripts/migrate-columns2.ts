import { db } from "./server/db.js";

const columns = [
  "ALTER TABLE asset_risk_predictions ADD COLUMN predicted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP",
  "ALTER TABLE asset_risk_predictions ADD COLUMN model_version VARCHAR(50) NULL",
];

for (const sql of columns) {
  try {
    await db.execute(sql);
    const col = sql.match(/ADD COLUMN (\w+)/)?.[1];
    console.log(`✓ Added: ${col}`);
  } catch (err: any) {
    if (err?.cause?.code === 'ER_DUP_FIELDNAME') {
      const col = sql.match(/ADD COLUMN (\w+)/)?.[1];
      console.log(`- Skipped: ${col}`);
    } else {
      console.error(err?.cause?.sqlMessage ?? err);
    }
  }
}
console.log("Done");
process.exit(0);
