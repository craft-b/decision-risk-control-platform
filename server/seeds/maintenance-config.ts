import { db } from "../db";
import { maintenanceConfig } from "@shared/schema";

export async function seedMaintenanceConfig() {
  const configs = [
    { equipmentCategory: "Excavator", recommendedIntervalDays: 180 },
    { equipmentCategory: "Lift", recommendedIntervalDays: 90 },
    { equipmentCategory: "Dozer", recommendedIntervalDays: 180 },
    { equipmentCategory: "Loader", recommendedIntervalDays: 150 },
    { equipmentCategory: "Generator", recommendedIntervalDays: 120 },
  ];

  for (const config of configs) {
    try {
      await db.insert(maintenanceConfig).values(config);
      console.log(`✓ Seeded config for ${config.equipmentCategory}`);
    } catch (error) {
      console.log(`Config for ${config.equipmentCategory} already exists`);
    }
  }
}