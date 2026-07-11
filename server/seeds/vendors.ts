import { db } from "../db";
import { sql } from "drizzle-orm";

export async function seedVendors(): Promise<number[]> {
  const vendors = [
    { name: "CatRent Equipment Solutions", contactName: "James Pruitt",   contactEmail: "jpruitt@catrent.com",     contactPhone: "800-555-0101", address: "500 Equipment Way, Chicago, IL 60601",      rating: "4.8" },
    { name: "United Rentals Corp",          contactName: "Maria Delgado",  contactEmail: "mdelgado@unitedrent.com", contactPhone: "800-555-0202", address: "1 United Dr, Stamford, CT 06902",           rating: "4.6" },
    { name: "BlueLine Rental",              contactName: "Steve Holloway", contactEmail: "s.holloway@bluelinerent.com",contactPhone: "877-555-0303",address: "200 BlueLine Blvd, Atlanta, GA 30301",      rating: "4.4" },
    { name: "Sunbelt Rentals",              contactName: "Tanya Brooks",   contactEmail: "tbrooks@sunbeltrent.com", contactPhone: "800-555-0404", address: "10 Sunbelt Pkwy, Charlotte, NC 28201",      rating: "4.5" },
  ];

  const ids: number[] = [];
  for (const v of vendors) {
    try {
      await db.execute(sql`
        INSERT INTO vendors (name, contact_name, contact_email, contact_phone, address, rating)
        VALUES (${v.name}, ${v.contactName}, ${v.contactEmail}, ${v.contactPhone}, ${v.address}, ${v.rating})
      `);
      const [row] = await db.execute(sql`SELECT LAST_INSERT_ID() as id`) as any;
      ids.push(Number(row[0].id));
    } catch {
      const [existing] = await db.execute(sql`SELECT id FROM vendors WHERE name = ${v.name}`) as any;
      if (existing[0]) ids.push(Number(existing[0].id));
    }
  }
  return ids;
}
