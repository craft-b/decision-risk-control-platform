/**
 * promote-admin.ts — Sets a user's role to ADMINISTRATOR.
 * Usage: npx tsx scripts/promote-admin.ts <username>
 * Requires DATABASE_URL env var pointing at the public Railway MySQL URL.
 */
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { users } from "../shared/schema";
import { eq } from "drizzle-orm";

const username = process.argv[2];
if (!username) {
  console.error("Usage: npx tsx scripts/promote-admin.ts <username>");
  process.exit(1);
}

const connection = await mysql.createConnection(process.env.DATABASE_URL!);
const db = drizzle(connection);

const result = await db.update(users)
  .set({ role: "ADMINISTRATOR" })
  .where(eq(users.username, username));

console.log(`User "${username}" promoted to ADMINISTRATOR.`);
await connection.end();
