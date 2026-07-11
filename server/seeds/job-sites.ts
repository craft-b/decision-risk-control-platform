import { db } from "../db";
import { sql } from "drizzle-orm";

export async function seedJobSites(): Promise<number[]> {
  const sites = [
    { name: "Riverside Industrial Park",   address: "1200 Riverside Dr, Newark, NJ 07102",    contactPerson: "Mike Torres",    contactPhone: "201-555-0142", projectType: "Commercial",      status: "ACTIVE" },
    { name: "Downtown Tower Project",       address: "450 5th Ave, New York, NY 10018",         contactPerson: "Sandra Lee",     contactPhone: "212-555-0198", projectType: "Construction",    status: "ACTIVE" },
    { name: "Highway 9 Expansion",          address: "Rte 9 & County Rd 12, Freehold, NJ 07728",contactPerson: "Dave Kowalski",  contactPhone: "732-555-0167", projectType: "Infrastructure",  status: "ACTIVE" },
    { name: "Northside Warehouse Complex",  address: "88 Commerce Blvd, Linden, NJ 07036",     contactPerson: "Rachel Nguyen",  contactPhone: "908-555-0211", projectType: "Commercial",      status: "ACTIVE" },
    { name: "Metro Rail Extension",         address: "Junction Rd & Main St, Secaucus, NJ 07094",contactPerson: "Tom Brannigan", contactPhone: "201-555-0309", projectType: "Infrastructure",  status: "ACTIVE" },
    { name: "Lakeside Resort Development",  address: "22 Lake Shore Rd, Hopatcong, NJ 07843",  contactPerson: "Amy Castello",   contactPhone: "973-555-0088", projectType: "Residential",     status: "ACTIVE" },
  ];

  const ids: number[] = [];
  for (const site of sites) {
    try {
      await db.execute(sql`
        INSERT INTO job_sites (name, address, contact_person, contact_phone, project_type, status)
        VALUES (${site.name}, ${site.address}, ${site.contactPerson}, ${site.contactPhone}, ${site.projectType}, ${site.status})
      `);
      const [row] = await db.execute(sql`SELECT LAST_INSERT_ID() as id`) as any;
      ids.push(Number(row[0].id));
    } catch {
      const [existing] = await db.execute(sql`SELECT id FROM job_sites WHERE name = ${site.name}`) as any;
      if (existing[0]) ids.push(Number(existing[0].id));
    }
  }
  return ids;
}
