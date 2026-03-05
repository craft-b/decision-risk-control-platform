import { db } from "./server/db.js";
import { sql } from "drizzle-orm";
const result = await db.execute(sql`SELECT COUNT(*) as total FROM maintenance_events WHERE maintenance_date >= '2024-02-28'`);
console.log(JSON.stringify((result as any)[0], null, 2));
process.exit(0);
