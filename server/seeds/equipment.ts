// server/seeds/equipment.ts
// Adds 10 diverse equipment items spanning different ages, categories,
// and condition levels to exercise LOW / MEDIUM / HIGH risk tiers.
// Run with: npx tsx server/seeds/equipment.ts

import { db } from "../db.js";
import { equipment, maintenanceEvents } from "../../shared/schema.js";

const equipmentData = [
  // ── HIGH RISK candidates ─────────────────────────────────────────────
  {
    equipmentId: "EQ-004",
    name: "Liebherr Tower Crane",
    category: "Crane",
    make: "Liebherr",
    model: "81K.1",
    serialNumber: "LH-81K-2013-0042",
    status: "AVAILABLE" as const,
    dailyRate: "850.00",
    weeklyRate: "5200.00",
    monthlyRate: "18000.00",
    location: "Yard A",
    // 12 years old, high hours → expect HIGH risk
    manufactureYear: 2013,
    usageHours: 9800,
  },
  {
    equipmentId: "EQ-005",
    name: "Caterpillar Motor Grader",
    category: "Grader",
    make: "Caterpillar",
    model: "140M3",
    serialNumber: "CAT-140M3-2014-0091",
    status: "AVAILABLE" as const,
    dailyRate: "620.00",
    weeklyRate: "3800.00",
    monthlyRate: "13500.00",
    location: "Yard B",
    // 11 years old, heavy use
    manufactureYear: 2014,
    usageHours: 8200,
  },
  {
    equipmentId: "EQ-006",
    name: "JLG Telescopic Boom Lift",
    category: "Lift",
    make: "JLG",
    model: "1350SJP",
    serialNumber: "JLG-1350-2015-0033",
    status: "MAINTENANCE" as const,
    dailyRate: "480.00",
    weeklyRate: "2900.00",
    monthlyRate: "9800.00",
    location: "Workshop",
    // In maintenance, 10 years old
    manufactureYear: 2015,
    usageHours: 7100,
  },

  // ── MEDIUM RISK candidates ───────────────────────────────────────────
  {
    equipmentId: "EQ-007",
    name: "Komatsu Hydraulic Excavator",
    category: "Excavator",
    make: "Komatsu",
    model: "PC290LC-11",
    serialNumber: "KMT-PC290-2018-0077",
    status: "AVAILABLE" as const,
    dailyRate: "520.00",
    weeklyRate: "3100.00",
    monthlyRate: "10800.00",
    location: "Yard A",
    // 7 years, moderate hours
    manufactureYear: 2018,
    usageHours: 4800,
  },
  {
    equipmentId: "EQ-008",
    name: "Manitowoc Crawler Crane",
    category: "Crane",
    make: "Manitowoc",
    model: "MLC100",
    serialNumber: "MAN-MLC100-2017-0019",
    status: "AVAILABLE" as const,
    dailyRate: "1200.00",
    weeklyRate: "7200.00",
    monthlyRate: "25000.00",
    location: "Yard C",
    // 8 years, crane category = higher baseline risk
    manufactureYear: 2017,
    usageHours: 5200,
  },
  {
    equipmentId: "EQ-009",
    name: "Volvo Articulated Hauler",
    category: "Hauler",
    make: "Volvo",
    model: "A40G",
    serialNumber: "VCE-A40G-2019-0055",
    status: "RENTED" as const,
    dailyRate: "750.00",
    weeklyRate: "4500.00",
    monthlyRate: "15500.00",
    location: "Site 3",
    // 6 years, high usage intensity
    manufactureYear: 2019,
    usageHours: 4200,
  },
  {
    equipmentId: "EQ-010",
    name: "Atlas Copco Air Compressor",
    category: "Compressor",
    make: "Atlas Copco",
    model: "XRHS396",
    serialNumber: "AC-XRHS-2016-0088",
    status: "AVAILABLE" as const,
    dailyRate: "180.00",
    weeklyRate: "1050.00",
    monthlyRate: "3600.00",
    location: "Yard B",
    // 9 years, overdue maintenance
    manufactureYear: 2016,
    usageHours: 6300,
  },

  // ── LOW RISK candidates ──────────────────────────────────────────────
  {
    equipmentId: "EQ-011",
    name: "Bobcat Skid Steer Loader",
    category: "Loader",
    make: "Bobcat",
    model: "S770",
    serialNumber: "BOB-S770-2022-0014",
    status: "AVAILABLE" as const,
    dailyRate: "280.00",
    weeklyRate: "1650.00",
    monthlyRate: "5600.00",
    location: "Yard A",
    // 3 years, low hours
    manufactureYear: 2022,
    usageHours: 1100,
  },
  {
    equipmentId: "EQ-012",
    name: "Wacker Neuson Vibratory Roller",
    category: "Compactor",
    make: "Wacker Neuson",
    model: "RD27",
    serialNumber: "WN-RD27-2023-0006",
    status: "AVAILABLE" as const,
    dailyRate: "220.00",
    weeklyRate: "1300.00",
    monthlyRate: "4400.00",
    location: "Yard B",
    // 2 years, almost new
    manufactureYear: 2023,
    usageHours: 580,
  },
  {
    equipmentId: "EQ-013",
    name: "Generac Industrial Generator",
    category: "Generator",
    make: "Generac",
    model: "SG200",
    serialNumber: "GEN-SG200-2021-0029",
    status: "AVAILABLE" as const,
    dailyRate: "320.00",
    weeklyRate: "1900.00",
    monthlyRate: "6500.00",
    location: "Yard C",
    // 4 years, well maintained
    manufactureYear: 2021,
    usageHours: 2100,
  },
];

// Maintenance history — older/higher-hours equipment gets sparse history (neglect)
// newer equipment gets recent service (well maintained)
const maintenanceData = [
  // EQ-004 Crane — last service 280 days ago (overdue)
  { equipmentId: "EQ-004", daysAgo: 280, type: "Preventive", cost: 4200 },
  { equipmentId: "EQ-004", daysAgo: 520, type: "Corrective", cost: 8900 },

  // EQ-005 Grader — last service 195 days ago
  { equipmentId: "EQ-005", daysAgo: 195, type: "Preventive", cost: 3100 },
  { equipmentId: "EQ-005", daysAgo: 410, type: "Corrective", cost: 5600 },

  // EQ-006 Boom Lift — currently in maintenance
  { equipmentId: "EQ-006", daysAgo: 5, type: "Corrective", cost: 6200 },
  { equipmentId: "EQ-006", daysAgo: 180, type: "Preventive", cost: 2800 },

  // EQ-007 Excavator — last service 85 days ago
  { equipmentId: "EQ-007", daysAgo: 85, type: "Preventive", cost: 1900 },
  { equipmentId: "EQ-007", daysAgo: 260, type: "Preventive", cost: 1750 },

  // EQ-008 Crawler Crane — last service 110 days ago
  { equipmentId: "EQ-008", daysAgo: 110, type: "Preventive", cost: 5500 },
  { equipmentId: "EQ-008", daysAgo: 290, type: "Corrective", cost: 12000 },

  // EQ-009 Hauler — last service 60 days ago
  { equipmentId: "EQ-009", daysAgo: 60, type: "Preventive", cost: 2200 },
  { equipmentId: "EQ-009", daysAgo: 200, type: "Preventive", cost: 2100 },

  // EQ-010 Compressor — last service 210 days ago (overdue for 90-day interval)
  { equipmentId: "EQ-010", daysAgo: 210, type: "Preventive", cost: 980 },
  { equipmentId: "EQ-010", daysAgo: 450, type: "Corrective", cost: 3400 },

  // EQ-011 Skid Steer — recently serviced
  { equipmentId: "EQ-011", daysAgo: 25, type: "Preventive", cost: 420 },
  { equipmentId: "EQ-011", daysAgo: 115, type: "Preventive", cost: 380 },

  // EQ-012 Roller — brand new, one service
  { equipmentId: "EQ-012", daysAgo: 30, type: "Preventive", cost: 280 },

  // EQ-013 Generator — recently serviced
  { equipmentId: "EQ-013", daysAgo: 20, type: "Preventive", cost: 650 },
  { equipmentId: "EQ-013", daysAgo: 140, type: "Preventive", cost: 620 },
];

async function seed() {
  console.log("Seeding equipment...");

  // Insert equipment
  const insertedIds: Record<string, number> = {};

  for (const equip of equipmentData) {
    const { manufactureYear, usageHours, ...equipFields } = equip;
    try {
      const [result] = await db.insert(equipment).values(equipFields).$returningId();
      insertedIds[equip.equipmentId] = result.id;
      console.log(`✓ ${equip.equipmentId} — ${equip.name}`);
    } catch (err: any) {
      if (err?.cause?.code === "ER_DUP_ENTRY") {
        console.log(`- Skipped (exists): ${equip.equipmentId}`);
        // Fetch existing ID
        const existing = await db.select({ id: equipment.id, equipmentId: equipment.equipmentId })
          .from(equipment);
        const found = existing.find(e => e.equipmentId === equip.equipmentId);
        if (found) insertedIds[equip.equipmentId] = found.id;
      } else {
        console.error(`✗ Failed: ${equip.equipmentId}`, err?.cause?.sqlMessage ?? err);
      }
    }
  }

  // Insert maintenance history
  console.log("\nSeeding maintenance history...");

  for (const maint of maintenanceData) {
    const equipDbId = insertedIds[maint.equipmentId];
    if (!equipDbId) {
      console.log(`- Skipping maintenance for ${maint.equipmentId} (no DB id)`);
      continue;
    }

    const maintDate = new Date();
    maintDate.setDate(maintDate.getDate() - maint.daysAgo);

    try {
      await db.insert(maintenanceEvents).values({
        equipmentId: equipDbId,
        maintenanceType: maint.type,
        maintenanceDate: maintDate.toISOString().split("T")[0],
        cost: maint.cost.toFixed(2),
        description: `${maint.type} service`,
        nextDueDate: new Date(maintDate.getTime() + 180 * 24 * 60 * 60 * 1000)
            .toISOString().split("T")[0],
        } as any);
      console.log(`✓ Maintenance for ${maint.equipmentId} (${maint.daysAgo} days ago)`);
    } catch (err: any) {
      console.error(`✗ Failed maintenance for ${maint.equipmentId}:`, err?.cause?.sqlMessage ?? err);
    }
  }

  console.log("\nDone. Run predict-all to score the new equipment.");
  process.exit(0);
}

seed().catch(err => {
  console.error(err);
  process.exit(1);
});