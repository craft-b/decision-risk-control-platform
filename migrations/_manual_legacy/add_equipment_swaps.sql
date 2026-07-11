CREATE TABLE IF NOT EXISTS equipment_swaps (
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
);
