import { db } from "./server/db.js";
const result = await db.execute("SHOW TABLES LIKE '%simulation%'");
console.log(JSON.stringify(result[0], null, 2));
process.exit(0);
