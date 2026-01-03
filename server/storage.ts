import { users, equipment, rentals, type User, type InsertUser, type Equipment, type InsertEquipment, type Rental, type InsertRental } from "@shared/schema";
import { db } from "./db";
import { eq, ilike } from "drizzle-orm";

export interface IStorage {
  // Auth
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;

  // Equipment
  getEquipment(id: number): Promise<Equipment | undefined>;
  listEquipment(search?: string, status?: string): Promise<Equipment[]>;
  createEquipment(equip: InsertEquipment): Promise<Equipment>;
  updateEquipment(id: number, equip: Partial<InsertEquipment>): Promise<Equipment>;

  // Rentals
  listRentals(): Promise<(Rental & { equipment: Equipment | null })[]>;
  createRental(rental: InsertRental): Promise<Rental>;
  updateRental(id: number, rental: Partial<InsertRental>): Promise<Rental>;
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

  async getEquipment(id: number): Promise<Equipment | undefined> {
    const [equip] = await db.select().from(equipment).where(eq(equipment.id, id));
    return equip;
  }

  async listEquipment(search?: string, status?: string): Promise<Equipment[]> {
    let query = db.select().from(equipment);
    
    // Simple dynamic filtering
    if (status) {
      // @ts-ignore
      query = query.where(eq(equipment.status, status));
    }
    
    if (search) {
       // @ts-ignore
       query = query.where(ilike(equipment.name, `%${search}%`));
    }
    
    return await query;
  }

  async createEquipment(equip: InsertEquipment): Promise<Equipment> {
    const [newEquip] = await db.insert(equipment).values(equip).returning();
    return newEquip;
  }

  async updateEquipment(id: number, equip: Partial<InsertEquipment>): Promise<Equipment> {
    const [updated] = await db.update(equipment).set(equip).where(eq(equipment.id, id)).returning();
    return updated;
  }

  async listRentals(): Promise<(Rental & { equipment: Equipment | null })[]> {
    // Join not directly supported in this simple select pattern for basic storage, 
    // but Drizzle query builder supports it. Let's use db.query if schema relations were set up, 
    // or just manual join.
    // For simplicity in this 'Lite' mode, I'll fetch and map or use a join query.
    
    const rows = await db.select({
      rental: rentals,
      equipment: equipment
    })
    .from(rentals)
    .leftJoin(equipment, eq(rentals.equipmentId, equipment.id));

    return rows.map(row => ({
      ...row.rental,
      equipment: row.equipment
    }));
  }

  async createRental(rental: InsertRental): Promise<Rental> {
    const [newRental] = await db.insert(rentals).values(rental).returning();
    return newRental;
  }

  async updateRental(id: number, rental: Partial<InsertRental>): Promise<Rental> {
    const [updated] = await db.update(rentals).set(rental).where(eq(rentals.id, id)).returning();
    return updated;
  }
}

export const storage = new DatabaseStorage();
