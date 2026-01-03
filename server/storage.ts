import { users, equipment, rentals, jobSites, vendors, invoices, type User, type InsertUser, type Equipment, type InsertEquipment, type Rental, type InsertRental, type JobSite, type InsertJobSite, type Vendor, type InsertVendor, type Invoice, type InsertInvoice } from "@shared/schema";
import { db } from "./db";
import { eq, ilike, and, or } from "drizzle-orm";

export interface IStorage {
  // Auth
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;

  // Job Sites
  getJobSite(id: number): Promise<JobSite | undefined>;
  listJobSites(): Promise<JobSite[]>;
  createJobSite(site: InsertJobSite): Promise<JobSite>;

  // Vendors
  getVendor(id: number): Promise<Vendor | undefined>;
  listVendors(): Promise<Vendor[]>;
  createVendor(vendor: InsertVendor): Promise<Vendor>;

  // Equipment
  getEquipment(id: number): Promise<Equipment | undefined>;
  listEquipment(search?: string, status?: string): Promise<Equipment[]>;
  createEquipment(equip: InsertEquipment): Promise<Equipment>;
  updateEquipment(id: number, equip: Partial<InsertEquipment>): Promise<Equipment>;

  // Rentals
  getRental(id: number): Promise<(Rental & { equipment: Equipment, jobSite: JobSite, vendor: Vendor | null, invoices: Invoice[] }) | undefined>;
  listRentals(): Promise<(Rental & { equipment: Equipment, jobSite: JobSite, vendor: Vendor | null })[]>;
  createRental(rental: InsertRental): Promise<Rental>;
  updateRental(id: number, rental: Partial<InsertRental>): Promise<Rental>;

  // Invoices
  createInvoice(invoice: InsertInvoice): Promise<Invoice>;
}

export class DatabaseStorage implements IStorage {
  async getUser(id: number): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db.insert(users).values(insertUser).returning();
    return user;
  }

  async getJobSite(id: number): Promise<JobSite | undefined> {
    const [site] = await db.select().from(jobSites).where(eq(jobSites.id, id));
    return site;
  }

  async listJobSites(): Promise<JobSite[]> {
    return await db.select().from(jobSites);
  }

  async createJobSite(site: InsertJobSite): Promise<JobSite> {
    const [newSite] = await db.insert(jobSites).values(site).returning();
    return newSite;
  }

  async getVendor(id: number): Promise<Vendor | undefined> {
    const [v] = await db.select().from(vendors).where(eq(vendors.id, id));
    return v;
  }

  async listVendors(): Promise<Vendor[]> {
    return await db.select().from(vendors);
  }

  async createVendor(vendor: InsertVendor): Promise<Vendor> {
    const [newVendor] = await db.insert(vendors).values(vendor).returning();
    return newVendor;
  }

  async getEquipment(id: number): Promise<Equipment | undefined> {
    const [equip] = await db.select().from(equipment).where(eq(equipment.id, id));
    return equip;
  }

  async listEquipment(search?: string, status?: string): Promise<Equipment[]> {
    let q = db.select().from(equipment);
    if (status) q = q.where(eq(equipment.status, status)) as any;
    if (search) q = q.where(or(ilike(equipment.name, `%${search}%`), ilike(equipment.equipmentId, `%${search}%`))) as any;
    return await q;
  }

  async createEquipment(equip: InsertEquipment): Promise<Equipment> {
    const [newEquip] = await db.insert(equipment).values(equip).returning();
    return newEquip;
  }

  async updateEquipment(id: number, equip: Partial<InsertEquipment>): Promise<Equipment> {
    const [updated] = await db.update(equipment).set(equip).where(eq(equipment.id, id)).returning();
    return updated;
  }

  async getRental(id: number): Promise<(Rental & { equipment: Equipment, jobSite: JobSite, vendor: Vendor | null, invoices: Invoice[] }) | undefined> {
    const rental = await db.query.rentals.findFirst({
      where: eq(rentals.id, id),
      with: {
        equipment: true,
        jobSite: true,
        vendor: true,
        invoices: true,
      }
    });
    return rental as any;
  }

  async listRentals(): Promise<(Rental & { equipment: Equipment, jobSite: JobSite, vendor: Vendor | null })[]> {
    const results = await db.query.rentals.findMany({
      with: {
        equipment: true,
        jobSite: true,
        vendor: true,
      }
    });
    return results as any;
  }

  async createRental(rental: InsertRental): Promise<Rental> {
    const [newRental] = await db.insert(rentals).values(rental).returning();
    return newRental;
  }

  async updateRental(id: number, rental: Partial<InsertRental>): Promise<Rental> {
    const [updated] = await db.update(rentals).set(rental).where(eq(rentals.id, id)).returning();
    return updated;
  }

  async createInvoice(invoice: InsertInvoice): Promise<Invoice> {
    const [newInvoice] = await db.insert(invoices).values(invoice).returning();
    return newInvoice;
  }
}

export const storage = new DatabaseStorage();
