import { db } from "../../server/db.js";
import { sql } from "drizzle-orm";

const statements = [
  // rental form additions
  "ALTER TABLE rentals ADD COLUMN operator_name VARCHAR(255) NULL AFTER notes",
  "ALTER TABLE rentals ADD COLUMN delivery_method ENUM('CUSTOMER_PICKUP','COMPANY_DELIVERY') NOT NULL DEFAULT 'CUSTOMER_PICKUP' AFTER operator_name",
  // equipment swaps table
  `CREATE TABLE IF NOT EXISTS equipment_swaps (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    rental_id INT NOT NULL,
    original_equipment_id INT NOT NULL,
    replacement_equipment_id INT NOT NULL,
    swap_date DATE NOT NULL,
    reason TEXT NULL,
    swapped_by VARCHAR(255) NULL,
    notes TEXT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_rental_id (rental_id),
    INDEX idx_original_equipment (original_equipment_id),
    INDEX idx_replacement_equipment (replacement_equipment_id)
  )`,
];

for (const statement of statements) {
  const label = statement.slice(0, 60).replace(/\s+/g, ' ');
  try {
    await db.execute(sql.raw(statement));
    console.log(`✓ ${label}`);
  } catch (err: any) {
    const code = err?.cause?.code ?? err?.code;
    const msg  = err?.cause?.sqlMessage ?? err?.message ?? String(err);
    if (code === 'ER_DUP_FIELDNAME' || code === 'ER_TABLE_EXISTS_ERROR') {
      console.log(`- Skipped (already exists): ${label}`);
    } else {
      console.error(`✗ Failed: ${label}`);
      console.error(msg);
    }
  }
}

console.log("\nDone");
process.exit(0);
