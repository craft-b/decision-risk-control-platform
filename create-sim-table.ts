import { db } from "./server/db.js";
await db.execute(`
  CREATE TABLE IF NOT EXISTS simulation_state (
    id INT PRIMARY KEY AUTO_INCREMENT,
    cursor_date VARCHAR(10) NOT NULL,
    total_days_run INT NOT NULL DEFAULT 0,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  )
`);
// Seed initial cursor date = 2 years ago
await db.execute(`
  INSERT IGNORE INTO simulation_state (id, cursor_date, total_days_run)
  VALUES (1, DATE_FORMAT(DATE_SUB(NOW(), INTERVAL 2 YEAR), '%Y-%m-%d'), 0)
`);
console.log("simulation_state table created");
process.exit(0);
