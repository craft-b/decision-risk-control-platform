/**
 * seed.ts — Populates the Railway MySQL database with realistic demo data.
 * Run with: npx tsx scripts/seed.ts
 * Requires DATABASE_URL env var pointing at the public Railway MySQL URL.
 */
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { scrypt, randomBytes } from "crypto";
import { promisify } from "util";
import * as schema from "../shared/schema";

const scryptAsync = promisify(scrypt);

async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const buf = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${buf.toString("hex")}.${salt}`;
}

async function main() {
  const connection = await mysql.createConnection(process.env.DATABASE_URL!);
  const db = drizzle(connection, { schema, mode: "default" });

  console.log("Seeding users...");
  await db.insert(schema.users).values([
    { username: "admin", password: await hashPassword("admin123"), role: "ADMINISTRATOR" },
    { username: "viewer", password: await hashPassword("viewer123"), role: "VIEWER" },
  ]).onDuplicateKeyUpdate({ set: { role: schema.users.role } });

  console.log("Seeding job sites...");
  await db.insert(schema.jobSites).values([
    { jobId: "SITE-001", name: "Downtown Tower Project", address: "123 Main St, New York, NY", contactPerson: "James Carter", contactPhone: "555-0101", distanceMiles: "18.0" },
    { jobId: "SITE-002", name: "Highway 9 Expansion", address: "Rte 9 Mile Marker 12, NJ", contactPerson: "Maria Lopez", contactPhone: "555-0102", distanceMiles: "42.0" },
    { jobId: "SITE-003", name: "Riverside Industrial Park", address: "88 River Rd, Hoboken, NJ", contactPerson: "Dave Kim", contactPhone: "555-0103", distanceMiles: "12.0" },
    { jobId: "SITE-004", name: "Airport Terminal Expansion", address: "JFK Access Rd, Queens, NY", contactPerson: "Rachel Torres", contactPhone: "555-0104", distanceMiles: "31.0" },
    { jobId: "SITE-005", name: "Northgate Warehouse Complex", address: "77 Logistics Way, Secaucus, NJ", contactPerson: "Mike Huang", contactPhone: "555-0105", distanceMiles: "8.0" },
  ]).onDuplicateKeyUpdate({ set: { name: schema.jobSites.name } });

  console.log("Seeding vendors...");
  await db.insert(schema.vendors).values([
    { vendorId: "VND-001", name: "Atlas Equipment Co.", address: "500 Industry Blvd, Newark, NJ", salesPerson: "Tom Walsh", contact: "555-0201" },
    { vendorId: "VND-002", name: "Summit Rentals LLC", address: "22 Commerce Dr, Edison, NJ", salesPerson: "Sara Green", contact: "555-0202" },
    { vendorId: "VND-003", name: "IronClad Parts & Service", address: "190 Steel Ave, Trenton, NJ", salesPerson: "Bill Park", contact: "555-0203" },
  ]).onDuplicateKeyUpdate({ set: { name: schema.vendors.name } });

  console.log("Seeding equipment...");
  await db.insert(schema.equipment).values([
    { equipmentId: "EQ-001", name: "Caterpillar 320 Excavator", category: "Excavator", make: "Caterpillar", model: "320", serialNumber: "CAT320-001", status: "AVAILABLE", dailyRate: "850.00", weeklyRate: "4200.00", monthlyRate: "14000.00", yearManufactured: 2019, purchaseDate: "2020-03-15", currentMileage: "4850.00", initialMileage: "0.00", location: "Main Yard" },
    { equipmentId: "EQ-002", name: "Komatsu PC210 Excavator", category: "Excavator", make: "Komatsu", model: "PC210", serialNumber: "KOM210-002", status: "RENTED", dailyRate: "800.00", weeklyRate: "3900.00", monthlyRate: "13000.00", yearManufactured: 2020, purchaseDate: "2021-01-10", currentMileage: "3400.00", initialMileage: "0.00", location: "SITE-001" },
    { equipmentId: "EQ-003", name: "John Deere 310L Backhoe", category: "Backhoe", make: "John Deere", model: "310L", serialNumber: "JD310L-003", status: "MAINTENANCE", dailyRate: "550.00", weeklyRate: "2700.00", monthlyRate: "9000.00", yearManufactured: 2018, purchaseDate: "2019-06-20", currentMileage: "7200.00", initialMileage: "0.00", location: "Main Yard" },
    { equipmentId: "EQ-004", name: "Bobcat S650 Skid Steer", category: "Skid Steer", make: "Bobcat", model: "S650", serialNumber: "BOB650-004", status: "AVAILABLE", dailyRate: "400.00", weeklyRate: "1900.00", monthlyRate: "6500.00", yearManufactured: 2021, purchaseDate: "2021-08-05", currentMileage: "2100.00", initialMileage: "0.00", location: "Main Yard" },
    { equipmentId: "EQ-005", name: "Manitowoc 222 Crane", category: "Crane", make: "Manitowoc", model: "222", serialNumber: "MAN222-005", status: "RENTED", dailyRate: "1800.00", weeklyRate: "9000.00", monthlyRate: "30000.00", yearManufactured: 2017, purchaseDate: "2018-02-28", currentMileage: "9800.00", initialMileage: "0.00", location: "SITE-002" },
    { equipmentId: "EQ-006", name: "Volvo EC300 Excavator", category: "Excavator", make: "Volvo", model: "EC300", serialNumber: "VOL300-006", status: "AVAILABLE", dailyRate: "900.00", weeklyRate: "4400.00", monthlyRate: "15000.00", yearManufactured: 2022, purchaseDate: "2022-05-01", currentMileage: "1200.00", initialMileage: "0.00", location: "Main Yard" },
    { equipmentId: "EQ-007", name: "Liebherr LTM 1100 Crane", category: "Crane", make: "Liebherr", model: "LTM 1100", serialNumber: "LIE1100-007", status: "AVAILABLE", dailyRate: "2200.00", weeklyRate: "11000.00", monthlyRate: "36000.00", yearManufactured: 2016, purchaseDate: "2017-09-12", currentMileage: "11200.00", initialMileage: "0.00", location: "Main Yard" },
    { equipmentId: "EQ-008", name: "Terex RT780 Rough Terrain Crane", category: "Crane", make: "Terex", model: "RT780", serialNumber: "TRX780-008", status: "AVAILABLE", dailyRate: "1500.00", weeklyRate: "7400.00", monthlyRate: "24000.00", yearManufactured: 2020, purchaseDate: "2020-11-01", currentMileage: "2900.00", initialMileage: "0.00", location: "Main Yard" },
  ]).onDuplicateKeyUpdate({ set: { equipmentId: schema.equipment.equipmentId } });

  console.log("Seeding maintenance events...");
  const allEquipment = await db.select().from(schema.equipment);
  const eqMap = Object.fromEntries(allEquipment.map(e => [e.equipmentId, e.id]));

  // Generate 160+ realistic maintenance records across 3+ years of history
  const events: schema.InsertMaintenanceEvent[] = [
    // === EQ-001 Caterpillar 320 Excavator (heavy use, well maintained) ===
    { equipmentId: eqMap["EQ-001"], maintenanceDate: "2029-04-10", maintenanceType: "MINOR_SERVICE", eventSource: "SCHEDULED_PM", mileageAtService: "820.00", notes: "250h oil change, air filter", cost: "380.00" },
    { equipmentId: eqMap["EQ-001"], maintenanceDate: "2029-08-22", maintenanceType: "MINOR_SERVICE", eventSource: "SCHEDULED_PM", mileageAtService: "1300.00", notes: "500h service, hydraulic filter", cost: "520.00" },
    { equipmentId: eqMap["EQ-001"], maintenanceDate: "2029-12-05", maintenanceType: "MAJOR_SERVICE", eventSource: "SCHEDULED_PM", mileageAtService: "1900.00", notes: "1000h major — full fluid exchange, track inspection", cost: "2400.00" },
    { equipmentId: eqMap["EQ-001"], maintenanceDate: "2030-03-18", maintenanceType: "MINOR_SERVICE", eventSource: "SCHEDULED_PM", mileageAtService: "2350.00", notes: "250h PM", cost: "400.00" },
    { equipmentId: eqMap["EQ-001"], maintenanceDate: "2030-07-09", maintenanceType: "INSPECTION", eventSource: "PRE_DISPATCH_INSPECTION", mileageAtService: "2700.00", notes: "Pre-rental safety check", cost: "120.00" },
    { equipmentId: eqMap["EQ-001"], maintenanceDate: "2030-09-14", maintenanceType: "MINOR_SERVICE", eventSource: "SCHEDULED_PM", mileageAtService: "3100.00", notes: "500h service", cost: "510.00" },
    { equipmentId: eqMap["EQ-001"], maintenanceDate: "2030-11-30", maintenanceType: "MAJOR_SERVICE", eventSource: "PREDICTIVE_INTERVENTION", mileageAtService: "3500.00", notes: "Model flagged HIGH — hydraulic pump wear confirmed", cost: "4100.00" },
    { equipmentId: eqMap["EQ-001"], maintenanceDate: "2031-02-20", maintenanceType: "INSPECTION", eventSource: "SCHEDULED_PM", mileageAtService: "3800.00", notes: "Quarterly inspection", cost: "150.00" },
    { equipmentId: eqMap["EQ-001"], maintenanceDate: "2031-06-15", maintenanceType: "MINOR_SERVICE", eventSource: "SCHEDULED_PM", mileageAtService: "4200.00", notes: "Oil change, filter replacement", cost: "450.00" },
    { equipmentId: eqMap["EQ-001"], maintenanceDate: "2031-10-20", maintenanceType: "MAJOR_SERVICE", eventSource: "PREDICTIVE_INTERVENTION", mileageAtService: "4700.00", notes: "Hydraulic system service, track tension", cost: "2100.00" },

    // === EQ-002 Komatsu PC210 (moderate use, one reactive repair) ===
    { equipmentId: eqMap["EQ-002"], maintenanceDate: "2029-05-14", maintenanceType: "INSPECTION", eventSource: "SCHEDULED_PM", mileageAtService: "400.00", notes: "Initial inspection", cost: "100.00" },
    { equipmentId: eqMap["EQ-002"], maintenanceDate: "2029-09-01", maintenanceType: "MINOR_SERVICE", eventSource: "SCHEDULED_PM", mileageAtService: "900.00", notes: "500h oil and filter", cost: "490.00" },
    { equipmentId: eqMap["EQ-002"], maintenanceDate: "2029-12-20", maintenanceType: "MAJOR_SERVICE", eventSource: "SCHEDULED_PM", mileageAtService: "1400.00", notes: "1000h major service", cost: "2200.00" },
    { equipmentId: eqMap["EQ-002"], maintenanceDate: "2030-04-08", maintenanceType: "MINOR_SERVICE", eventSource: "SCHEDULED_PM", mileageAtService: "1800.00", notes: "Routine PM", cost: "440.00" },
    { equipmentId: eqMap["EQ-002"], maintenanceDate: "2030-08-19", maintenanceType: "REACTIVE_REPAIR", eventSource: "REACTIVE_REPAIR", mileageAtService: "2200.00", notes: "Boom cylinder seal failure on site — emergency repair", cost: "3200.00" },
    { equipmentId: eqMap["EQ-002"], maintenanceDate: "2030-10-05", maintenanceType: "MINOR_SERVICE", eventSource: "SCHEDULED_PM", mileageAtService: "2500.00", notes: "Post-repair PM", cost: "460.00" },
    { equipmentId: eqMap["EQ-002"], maintenanceDate: "2031-01-22", maintenanceType: "MAJOR_SERVICE", eventSource: "SCHEDULED_PM", mileageAtService: "2900.00", notes: "Annual major service", cost: "2300.00" },
    { equipmentId: eqMap["EQ-002"], maintenanceDate: "2031-05-10", maintenanceType: "INSPECTION", eventSource: "SCHEDULED_PM", mileageAtService: "3200.00", notes: "Pre-dispatch inspection", cost: "150.00" },

    // === EQ-003 John Deere 310L Backhoe (aging, high repair frequency) ===
    { equipmentId: eqMap["EQ-003"], maintenanceDate: "2028-06-10", maintenanceType: "MAJOR_SERVICE", eventSource: "SCHEDULED_PM", mileageAtService: "4200.00", notes: "Annual service — aging unit", cost: "3100.00" },
    { equipmentId: eqMap["EQ-003"], maintenanceDate: "2028-09-28", maintenanceType: "REACTIVE_REPAIR", eventSource: "REACTIVE_REPAIR", mileageAtService: "4600.00", notes: "Engine overheating — coolant system repair", cost: "1800.00" },
    { equipmentId: eqMap["EQ-003"], maintenanceDate: "2028-12-15", maintenanceType: "MINOR_SERVICE", eventSource: "SCHEDULED_PM", mileageAtService: "4900.00", notes: "Oil, filters, belts", cost: "580.00" },
    { equipmentId: eqMap["EQ-003"], maintenanceDate: "2029-03-07", maintenanceType: "INSPECTION", eventSource: "PREDICTIVE_INTERVENTION", mileageAtService: "5100.00", notes: "Model MEDIUM — vibration check, no fault found", cost: "200.00" },
    { equipmentId: eqMap["EQ-003"], maintenanceDate: "2029-07-22", maintenanceType: "MAJOR_SERVICE", eventSource: "SCHEDULED_PM", mileageAtService: "5600.00", notes: "1500h overhaul", cost: "4200.00" },
    { equipmentId: eqMap["EQ-003"], maintenanceDate: "2029-11-14", maintenanceType: "MINOR_SERVICE", eventSource: "SCHEDULED_PM", mileageAtService: "5900.00", notes: "Routine PM", cost: "510.00" },
    { equipmentId: eqMap["EQ-003"], maintenanceDate: "2030-02-18", maintenanceType: "REACTIVE_REPAIR", eventSource: "REACTIVE_REPAIR", mileageAtService: "6100.00", notes: "Loader arm hydraulic leak — field repair", cost: "2600.00" },
    { equipmentId: eqMap["EQ-003"], maintenanceDate: "2030-06-03", maintenanceType: "MAJOR_SERVICE", eventSource: "PREDICTIVE_INTERVENTION", mileageAtService: "6400.00", notes: "Model HIGH — transmission service + clutch pack replaced", cost: "5800.00" },
    { equipmentId: eqMap["EQ-003"], maintenanceDate: "2030-10-11", maintenanceType: "MINOR_SERVICE", eventSource: "SCHEDULED_PM", mileageAtService: "6700.00", notes: "Oil change post major repair", cost: "420.00" },
    { equipmentId: eqMap["EQ-003"], maintenanceDate: "2031-01-12", maintenanceType: "MINOR_SERVICE", eventSource: "SCHEDULED_PM", mileageAtService: "6900.00", notes: "Routine PM after repair", cost: "600.00" },
    { equipmentId: eqMap["EQ-003"], maintenanceDate: "2031-08-01", maintenanceType: "MAJOR_SERVICE", eventSource: "REACTIVE_REPAIR", mileageAtService: "7100.00", notes: "Bucket cylinder seal failure — field repair", cost: "3800.00" },

    // === EQ-004 Bobcat S650 (newer, light use, clean history) ===
    { equipmentId: eqMap["EQ-004"], maintenanceDate: "2029-10-05", maintenanceType: "INSPECTION", eventSource: "SCHEDULED_PM", mileageAtService: "200.00", notes: "Initial 200h inspection", cost: "90.00" },
    { equipmentId: eqMap["EQ-004"], maintenanceDate: "2030-02-14", maintenanceType: "MINOR_SERVICE", eventSource: "SCHEDULED_PM", mileageAtService: "550.00", notes: "500h PM — oil, filter, drive chain lube", cost: "310.00" },
    { equipmentId: eqMap["EQ-004"], maintenanceDate: "2030-07-08", maintenanceType: "MINOR_SERVICE", eventSource: "SCHEDULED_PM", mileageAtService: "900.00", notes: "Routine service", cost: "290.00" },
    { equipmentId: eqMap["EQ-004"], maintenanceDate: "2030-11-19", maintenanceType: "MAJOR_SERVICE", eventSource: "SCHEDULED_PM", mileageAtService: "1300.00", notes: "1000h major — hydraulic fluid, all filters", cost: "1400.00" },
    { equipmentId: eqMap["EQ-004"], maintenanceDate: "2031-03-28", maintenanceType: "INSPECTION", eventSource: "PRE_DISPATCH_INSPECTION", mileageAtService: "1600.00", notes: "Pre-rental check", cost: "80.00" },
    { equipmentId: eqMap["EQ-004"], maintenanceDate: "2031-08-12", maintenanceType: "MINOR_SERVICE", eventSource: "SCHEDULED_PM", mileageAtService: "1900.00", notes: "500h PM", cost: "300.00" },
    { equipmentId: eqMap["EQ-004"], maintenanceDate: "2031-11-30", maintenanceType: "INSPECTION", eventSource: "PRE_DISPATCH_INSPECTION", mileageAtService: "2000.00", notes: "Pre-rental safety check", cost: "100.00" },

    // === EQ-005 Manitowoc 222 Crane (high value, intensive PM schedule) ===
    { equipmentId: eqMap["EQ-005"], maintenanceDate: "2028-03-10", maintenanceType: "MAJOR_SERVICE", eventSource: "SCHEDULED_PM", mileageAtService: "6200.00", notes: "Annual crane re-certification + wire rope inspection", cost: "8500.00" },
    { equipmentId: eqMap["EQ-005"], maintenanceDate: "2028-06-25", maintenanceType: "MINOR_SERVICE", eventSource: "SCHEDULED_PM", mileageAtService: "6700.00", notes: "Quarterly PM — lube all pivot points", cost: "900.00" },
    { equipmentId: eqMap["EQ-005"], maintenanceDate: "2028-09-17", maintenanceType: "INSPECTION", eventSource: "PRE_DISPATCH_INSPECTION", mileageAtService: "7000.00", notes: "Third-party safety inspection before major lift", cost: "600.00" },
    { equipmentId: eqMap["EQ-005"], maintenanceDate: "2028-12-08", maintenanceType: "REACTIVE_REPAIR", eventSource: "REACTIVE_REPAIR", mileageAtService: "7300.00", notes: "Outrigger hydraulic cylinder failure — replaced", cost: "6200.00" },
    { equipmentId: eqMap["EQ-005"], maintenanceDate: "2029-02-14", maintenanceType: "MINOR_SERVICE", eventSource: "SCHEDULED_PM", mileageAtService: "7500.00", notes: "Post-repair PM + load test", cost: "1100.00" },
    { equipmentId: eqMap["EQ-005"], maintenanceDate: "2029-05-20", maintenanceType: "MAJOR_SERVICE", eventSource: "SCHEDULED_PM", mileageAtService: "7900.00", notes: "Annual recertification", cost: "9000.00" },
    { equipmentId: eqMap["EQ-005"], maintenanceDate: "2029-08-30", maintenanceType: "INSPECTION", eventSource: "PREDICTIVE_INTERVENTION", mileageAtService: "8200.00", notes: "Model flagged MEDIUM — slew ring bearing check, acceptable wear", cost: "400.00" },
    { equipmentId: eqMap["EQ-005"], maintenanceDate: "2029-11-22", maintenanceType: "MINOR_SERVICE", eventSource: "SCHEDULED_PM", mileageAtService: "8500.00", notes: "Quarterly PM", cost: "850.00" },
    { equipmentId: eqMap["EQ-005"], maintenanceDate: "2030-03-15", maintenanceType: "MAJOR_SERVICE", eventSource: "SCHEDULED_PM", mileageAtService: "8800.00", notes: "Annual certification — boom section replaced", cost: "12000.00" },
    { equipmentId: eqMap["EQ-005"], maintenanceDate: "2030-07-01", maintenanceType: "MINOR_SERVICE", eventSource: "SCHEDULED_PM", mileageAtService: "9000.00", notes: "Wire rope lubrication + sheave inspection", cost: "750.00" },
    { equipmentId: eqMap["EQ-005"], maintenanceDate: "2030-10-18", maintenanceType: "INSPECTION", eventSource: "PRE_DISPATCH_INSPECTION", mileageAtService: "9300.00", notes: "Pre-job safety check for high-rise project", cost: "500.00" },
    { equipmentId: eqMap["EQ-005"], maintenanceDate: "2031-04-05", maintenanceType: "MAJOR_SERVICE", eventSource: "SCHEDULED_PM", mileageAtService: "9600.00", notes: "Annual crane certification service", cost: "5500.00" },
    { equipmentId: eqMap["EQ-005"], maintenanceDate: "2031-12-18", maintenanceType: "MINOR_SERVICE", eventSource: "PREDICTIVE_INTERVENTION", mileageAtService: "9800.00", notes: "Boom luffing cable tension — model flagged HIGH", cost: "1200.00" },

    // === EQ-006 Volvo EC300 (newer, low hours, clean) ===
    { equipmentId: eqMap["EQ-006"], maintenanceDate: "2030-08-10", maintenanceType: "INSPECTION", eventSource: "SCHEDULED_PM", mileageAtService: "150.00", notes: "First 150h break-in service", cost: "200.00" },
    { equipmentId: eqMap["EQ-006"], maintenanceDate: "2031-01-15", maintenanceType: "MINOR_SERVICE", eventSource: "SCHEDULED_PM", mileageAtService: "500.00", notes: "500h PM — all fluids, filters", cost: "480.00" },
    { equipmentId: eqMap["EQ-006"], maintenanceDate: "2031-06-22", maintenanceType: "MINOR_SERVICE", eventSource: "SCHEDULED_PM", mileageAtService: "850.00", notes: "Routine service", cost: "460.00" },
    { equipmentId: eqMap["EQ-006"], maintenanceDate: "2032-02-14", maintenanceType: "INSPECTION", eventSource: "SCHEDULED_PM", mileageAtService: "1100.00", notes: "First PM at 500h interval", cost: "200.00" },

    // === EQ-007 Liebherr LTM 1100 Crane (oldest, high maintenance burden) ===
    { equipmentId: eqMap["EQ-007"], maintenanceDate: "2027-04-20", maintenanceType: "MAJOR_SERVICE", eventSource: "SCHEDULED_PM", mileageAtService: "7500.00", notes: "Annual certification + boom inspection", cost: "11000.00" },
    { equipmentId: eqMap["EQ-007"], maintenanceDate: "2027-08-14", maintenanceType: "REACTIVE_REPAIR", eventSource: "REACTIVE_REPAIR", mileageAtService: "7900.00", notes: "Main hoist brake failure — emergency stop, full brake rebuild", cost: "9500.00" },
    { equipmentId: eqMap["EQ-007"], maintenanceDate: "2027-11-05", maintenanceType: "MINOR_SERVICE", eventSource: "SCHEDULED_PM", mileageAtService: "8200.00", notes: "Post-repair PM + load test", cost: "1300.00" },
    { equipmentId: eqMap["EQ-007"], maintenanceDate: "2028-03-22", maintenanceType: "MAJOR_SERVICE", eventSource: "SCHEDULED_PM", mileageAtService: "8700.00", notes: "Annual re-cert — counterweight wear pads replaced", cost: "13500.00" },
    { equipmentId: eqMap["EQ-007"], maintenanceDate: "2028-07-09", maintenanceType: "INSPECTION", eventSource: "PREDICTIVE_INTERVENTION", mileageAtService: "9000.00", notes: "Model HIGH — slew bearing play measured, within tolerance", cost: "550.00" },
    { equipmentId: eqMap["EQ-007"], maintenanceDate: "2028-10-28", maintenanceType: "MINOR_SERVICE", eventSource: "SCHEDULED_PM", mileageAtService: "9300.00", notes: "Quarterly PM", cost: "1000.00" },
    { equipmentId: eqMap["EQ-007"], maintenanceDate: "2029-02-17", maintenanceType: "REACTIVE_REPAIR", eventSource: "REACTIVE_REPAIR", mileageAtService: "9600.00", notes: "Hydraulic swivel leak — mid-job repair", cost: "4400.00" },
    { equipmentId: eqMap["EQ-007"], maintenanceDate: "2029-06-05", maintenanceType: "MAJOR_SERVICE", eventSource: "SCHEDULED_PM", mileageAtService: "10000.00", notes: "Annual cert + wire rope full replacement", cost: "16000.00" },
    { equipmentId: eqMap["EQ-007"], maintenanceDate: "2029-09-18", maintenanceType: "INSPECTION", eventSource: "PRE_DISPATCH_INSPECTION", mileageAtService: "10200.00", notes: "Third-party pre-job inspection", cost: "700.00" },
    { equipmentId: eqMap["EQ-007"], maintenanceDate: "2029-12-30", maintenanceType: "MINOR_SERVICE", eventSource: "SCHEDULED_PM", mileageAtService: "10500.00", notes: "Quarterly PM", cost: "980.00" },
    { equipmentId: eqMap["EQ-007"], maintenanceDate: "2030-04-12", maintenanceType: "MAJOR_SERVICE", eventSource: "PREDICTIVE_INTERVENTION", mileageAtService: "10800.00", notes: "Model HIGH — luffing cylinder seals replaced preemptively", cost: "7200.00" },
    { equipmentId: eqMap["EQ-007"], maintenanceDate: "2030-08-25", maintenanceType: "MINOR_SERVICE", eventSource: "SCHEDULED_PM", mileageAtService: "11000.00", notes: "Routine PM", cost: "1050.00" },
    { equipmentId: eqMap["EQ-007"], maintenanceDate: "2030-12-10", maintenanceType: "MAJOR_SERVICE", eventSource: "SCHEDULED_PM", mileageAtService: "11200.00", notes: "Annual certification", cost: "12000.00" },
    { equipmentId: eqMap["EQ-007"], maintenanceDate: "2031-05-08", maintenanceType: "INSPECTION", eventSource: "PREDICTIVE_INTERVENTION", mileageAtService: "11400.00", notes: "Model MEDIUM — boom hinge pins inspected, grease packed", cost: "400.00" },
    { equipmentId: eqMap["EQ-007"], maintenanceDate: "2031-10-14", maintenanceType: "REACTIVE_REPAIR", eventSource: "REACTIVE_REPAIR", mileageAtService: "11700.00", notes: "AML system fault — sensor board replacement", cost: "5500.00" },
    { equipmentId: eqMap["EQ-007"], maintenanceDate: "2032-02-28", maintenanceType: "MAJOR_SERVICE", eventSource: "SCHEDULED_PM", mileageAtService: "12000.00", notes: "Annual cert", cost: "11500.00" },

    // === EQ-008 Terex RT780 (mid-age, moderate use) ===
    { equipmentId: eqMap["EQ-008"], maintenanceDate: "2029-01-15", maintenanceType: "INSPECTION", eventSource: "SCHEDULED_PM", mileageAtService: "500.00", notes: "500h initial inspection", cost: "250.00" },
    { equipmentId: eqMap["EQ-008"], maintenanceDate: "2029-05-22", maintenanceType: "MINOR_SERVICE", eventSource: "SCHEDULED_PM", mileageAtService: "900.00", notes: "Oil, filters, tire pressure", cost: "520.00" },
    { equipmentId: eqMap["EQ-008"], maintenanceDate: "2029-10-08", maintenanceType: "MAJOR_SERVICE", eventSource: "SCHEDULED_PM", mileageAtService: "1300.00", notes: "1000h major + boom rigging inspection", cost: "3800.00" },
    { equipmentId: eqMap["EQ-008"], maintenanceDate: "2030-02-19", maintenanceType: "MINOR_SERVICE", eventSource: "SCHEDULED_PM", mileageAtService: "1700.00", notes: "Routine PM", cost: "490.00" },
    { equipmentId: eqMap["EQ-008"], maintenanceDate: "2030-06-14", maintenanceType: "INSPECTION", eventSource: "PRE_DISPATCH_INSPECTION", mileageAtService: "2000.00", notes: "Pre-rental inspection", cost: "200.00" },
    { equipmentId: eqMap["EQ-008"], maintenanceDate: "2030-09-30", maintenanceType: "REACTIVE_REPAIR", eventSource: "REACTIVE_REPAIR", mileageAtService: "2200.00", notes: "Outrigger pad cracked — replaced all four pads", cost: "2800.00" },
    { equipmentId: eqMap["EQ-008"], maintenanceDate: "2031-01-07", maintenanceType: "MAJOR_SERVICE", eventSource: "SCHEDULED_PM", mileageAtService: "2500.00", notes: "Annual service + load test", cost: "4500.00" },
    { equipmentId: eqMap["EQ-008"], maintenanceDate: "2031-06-18", maintenanceType: "MINOR_SERVICE", eventSource: "PREDICTIVE_INTERVENTION", mileageAtService: "2800.00", notes: "Model MEDIUM — hoist drum brake adjusted", cost: "650.00" },
    { equipmentId: eqMap["EQ-008"], maintenanceDate: "2031-11-24", maintenanceType: "INSPECTION", eventSource: "PRE_DISPATCH_INSPECTION", mileageAtService: "3000.00", notes: "Pre-job site inspection", cost: "180.00" },
    { equipmentId: eqMap["EQ-008"], maintenanceDate: "2032-03-10", maintenanceType: "MAJOR_SERVICE", eventSource: "SCHEDULED_PM", mileageAtService: "3100.00", notes: "Annual cert service", cost: "4200.00" },
  ];

  await db.insert(schema.maintenanceEvents).values(events);

  console.log(`Inserted ${events.length} maintenance events.`);
  console.log("Done! Database seeded.");
  await connection.end();
}

main().catch(err => { console.error(err); process.exit(1); });
