// server/seed-sites-vendors.ts
// Run with: npx tsx server/seed-sites-vendors.ts

import dotenv from 'dotenv';
dotenv.config();

import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import * as schema from "../shared/schema";

const pool = mysql.createPool(process.env.DATABASE_URL!);
const db = drizzle(pool, { schema, mode: 'default' });

function generateJobId(index: number): string {
  return `JOB-2026${String(index).padStart(4, '0')}`;
}

function generateVendorId(index: number): string {
  return `VEND-2026${String(index).padStart(4, '0')}`;
}

const jobSitesToSeed = [
  { name: "Riverside Bridge Expansion", address: "1200 River Rd, Memphis, TN 38103", contactPerson: "Dale Hurst", contactPhone: "901-555-0101" },
  { name: "Downtown Office Tower Phase 2", address: "450 Main St, Nashville, TN 37219", contactPerson: "Carla Voss", contactPhone: "615-555-0192" },
  { name: "Highway 40 Overpass Repair", address: "I-40 MM 214, Jackson, TN 38301", contactPerson: "Marcus Webb", contactPhone: "731-555-0344" },
  { name: "Lakewood Industrial Park", address: "8800 Industrial Blvd, Knoxville, TN 37920", contactPerson: "Sandra Pierce", contactPhone: "865-555-0288" },
  { name: "Eastside Mixed-Use Development", address: "3300 Commerce Ave, Chattanooga, TN 37406", contactPerson: "Tony Ruiz", contactPhone: "423-555-0177" },
  { name: "Airport Terminal C Expansion", address: "2600 Airport Dr, Nashville, TN 37214", contactPerson: "Brenda Kim", contactPhone: "615-555-0555" },
  { name: "Southgate Mall Demolition & Rebuild", address: "5500 Southgate Pkwy, Murfreesboro, TN 37130", contactPerson: "Frank Deleon", contactPhone: "615-555-0621" },
  { name: "Water Treatment Plant Upgrade", address: "900 Utility Rd, Clarksville, TN 37040", contactPerson: "Irene Stafford", contactPhone: "931-555-0403" },
  { name: "Cumberland River Levee Project", address: "1 Levee Way, Clarksville, TN 37043", contactPerson: "Jerome Watts", contactPhone: "931-555-0812" },
  { name: "Blue Ridge Solar Farm", address: "County Rd 88, Bristol, TN 37620", contactPerson: "Nora Patel", contactPhone: "423-555-0936" },
  { name: "Central High School Rebuild", address: "300 Education Dr, Columbia, TN 38401", contactPerson: "Harold Greene", contactPhone: "931-555-0234" },
  { name: "Grandview Residential Estate", address: "1100 Grandview Ln, Franklin, TN 37067", contactPerson: "Lisa Monroe", contactPhone: "615-555-0783" },
];

const vendorsToSeed = [
  { name: "Sunbelt Rentals", address: "1275 Peachtree St NE, Atlanta, GA 30309", salesPerson: "Kyle Lawson", contact: "kyle.lawson@sunbelt.com" },
  { name: "United Rentals", address: "100 First Stamford Pl, Stamford, CT 06902", salesPerson: "Michelle Torres", contact: "m.torres@unitedrentals.com" },
  { name: "BlueLine Rental", address: "7020 AC Skinner Pkwy, Jacksonville, FL 32256", salesPerson: "Andrew Becker", contact: "a.becker@bluelinerental.com" },
  { name: "Neff Rentals", address: "3750 NW 87th Ave, Miami, FL 33178", salesPerson: "Patricia Odom", contact: "p.odom@neffrentals.com" },
  { name: "H&E Equipment Services", address: "11100 Mead Rd, Baton Rouge, LA 70816", salesPerson: "Curtis Floyd", contact: "c.floyd@hequip.com" },
  { name: "Maxim Crane Works", address: "2315 Babcock Blvd, Pittsburgh, PA 15237", salesPerson: "Rachel Summers", contact: "r.summers@maximcrane.com" },
  { name: "Volvo CE North America", address: "One Volvo Dr, Shippensburg, PA 17257", salesPerson: "Derek Olson", contact: "d.olson@volvo.com" },
  { name: "Caterpillar Financial Products", address: "2120 Diamond Pkwy, Nashville, TN 37210", salesPerson: "Angela Davis", contact: "a.davis@cat.com" },
  { name: "Komatsu America Corp", address: "1701 W Golf Rd, Rolling Meadows, IL 60008", salesPerson: "Samuel Park", contact: "s.park@komatsu.com" },
  { name: "Ring Power Corporation", address: "7399 Philips Hwy, Jacksonville, FL 32256", salesPerson: "Tiffany Brooks", contact: "t.brooks@ringpower.com" },
];

async function seed() {
  console.log("Seeding job sites...");
  for (let i = 0; i < jobSitesToSeed.length; i++) {
    const site = jobSitesToSeed[i];
    const jobId = generateJobId(i + 10); // start at 10 to avoid collisions
    try {
      await db.insert(schema.jobSites).values({ ...site, jobId });
      console.log(`  ✓ ${site.name}`);
    } catch (err: any) {
      if (err.code === 'ER_DUP_ENTRY') {
        console.log(`  ~ skipped (duplicate): ${site.name}`);
      } else {
        throw err;
      }
    }
  }

  console.log("\nSeeding vendors...");
  for (let i = 0; i < vendorsToSeed.length; i++) {
    const vendor = vendorsToSeed[i];
    const vendorId = generateVendorId(i + 10);
    try {
      await db.insert(schema.vendors).values({ ...vendor, vendorId });
      console.log(`  ✓ ${vendor.name}`);
    } catch (err: any) {
      if (err.code === 'ER_DUP_ENTRY') {
        console.log(`  ~ skipped (duplicate): ${vendor.name}`);
      } else {
        throw err;
      }
    }
  }

  console.log("\nDone.");
  await pool.end();
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
