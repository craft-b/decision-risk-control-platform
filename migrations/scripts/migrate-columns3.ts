import { db } from "../../server/db.js";
await db.execute("ALTER TABLE asset_risk_predictions ADD COLUMN recommendation TEXT NULL");
console.log("✓ Added recommendation column");
process.exit(0);
