import { db } from "./server/db.js";
const result = await db.execute("DESCRIBE sensor_data_logs");
console.log(JSON.stringify(result[0], null, 2));
process.exit(0);
