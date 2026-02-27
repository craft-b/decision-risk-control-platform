import { users, equipment, rentals, jobSites, vendors, invoices, type User, type InsertUser, type Equipment, type InsertEquipment, type Rental, type InsertRental, type JobSite, type InsertJobSite, type Vendor, type InsertVendor, type Invoice, type InsertInvoice, EquipmentRiskScore, equipmentRiskScores, InsertRiskScore, InsertMaintenanceEvent, MaintenanceConfig, MaintenanceEvent, InsertModelTrainingMetrics, ModelTrainingMetrics } from "@shared/schema";
import { db } from "./db";
import { eq, ilike, and, or, SQL, sql, desc } from "drizzle-orm";
import { maintenanceEvents, maintenanceConfig, modelTrainingMetrics } from "@shared/schema";

function generateJobId(): string {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  return `JOB-${year}${month}-${random}`;
}

function generateVendorId(): string {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  return `VEND-${year}${month}-${random}`;
}


export interface IStorage {
  // Auth
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;

  // Job Sites
  getJobSite(id: number): Promise<JobSite | undefined>;
  listJobSites(): Promise<JobSite[]>;
  createJobSite(site: InsertJobSite): Promise<JobSite>;
  updateJobSite(id: number, updates: Partial<InsertJobSite>): Promise<JobSite>; 
  deleteJobSite(id: number): Promise<void>;

  // Vendors
  getVendor(id: number): Promise<Vendor | undefined>;
  listVendors(): Promise<Vendor[]>;
  createVendor(vendor: InsertVendor): Promise<Vendor>;
  updateVendor(id: number, updates: Partial<InsertVendor>): Promise<Vendor>;
  deleteVendor(id: number): Promise<void>; 

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

  // Risk Scores
  createRiskScore(score: InsertRiskScore): Promise<EquipmentRiskScore>;
  getRiskScoreHistory(equipmentId: number): Promise<EquipmentRiskScore[]>;
  getLatestRiskScore(equipmentId: number): Promise<EquipmentRiskScore | undefined>;

  createMaintenanceEvent(event: InsertMaintenanceEvent): Promise<MaintenanceEvent>;
  getMaintenanceHistory(equipmentId: number): Promise<MaintenanceEvent[]>;
  getMaintenanceConfig(category: string): Promise<MaintenanceConfig | undefined>;

  // Model Metrics
  saveModelMetrics(metrics: any): Promise<ModelTrainingMetrics>;
  getLatestModelMetrics(): Promise<any | undefined>;
  getModelMetricsHistory(): Promise<any[]>;
  

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
    const result = await db.insert(users).values(insertUser);
    const [user] = await db.select().from(users).where(eq(users.id, result[0].insertId));
    return user!;
  }

  async getJobSite(id: number): Promise<JobSite | undefined> {
    const [site] = await db.select().from(jobSites).where(eq(jobSites.id, id));
    return site;
  }

  async listJobSites(): Promise<JobSite[]> {
    return await db.select().from(jobSites);
  }

  async createJobSite(site: InsertJobSite): Promise<JobSite> {
    // Generate unique jobId
    let jobId = generateJobId();
    let attempts = 0;
    
    // Ensure uniqueness (retry if collision)
    while (attempts < 5) {
      const [existing] = await db
        .select()
        .from(jobSites)
        .where(eq(jobSites.jobId, jobId))
        .limit(1);
      
      if (!existing) break;
      jobId = generateJobId();
      attempts++;
    }

    const result = await db.insert(jobSites).values({
      ...site,
      jobId,
    });
    
    const [newSite] = await db.select().from(jobSites).where(eq(jobSites.id, result[0].insertId));
    return newSite!;
  }

  async updateJobSite(id: number, updates: Partial<InsertJobSite>): Promise<JobSite> {
    await db.update(jobSites).set(updates).where(eq(jobSites.id, id));
    const [updated] = await db.select().from(jobSites).where(eq(jobSites.id, id));
    return updated!;
  }

  async deleteJobSite(id: number): Promise<void> {
    await db.delete(jobSites).where(eq(jobSites.id, id));
  }


  async getVendor(id: number): Promise<Vendor | undefined> {
    const [v] = await db.select().from(vendors).where(eq(vendors.id, id));
    return v;
  }

  async listVendors(): Promise<Vendor[]> {
    return await db.select().from(vendors);
  }

  async createVendor(vendor: InsertVendor): Promise<Vendor> {
    // Generate unique vendorId
    let vendorId = generateVendorId();
    let attempts = 0;
    
    // Ensure uniqueness (retry if collision)
    while (attempts < 5) {
      const [existing] = await db
        .select()
        .from(vendors)
        .where(eq(vendors.vendorId, vendorId))
        .limit(1);
      
      if (!existing) break;
      vendorId = generateVendorId();
      attempts++;
    }

    const result = await db.insert(vendors).values({
      ...vendor,
      vendorId,
    });
    
    const [newVendor] = await db.select().from(vendors).where(eq(vendors.id, result[0].insertId));
    return newVendor!;
  }
  
  async updateVendor(id: number, updates: Partial<InsertVendor>): Promise<Vendor> {
    await db.update(vendors).set(updates).where(eq(vendors.id, id));
    const [updated] = await db.select().from(vendors).where(eq(vendors.id, id));
    return updated!;
  }

  async deleteVendor(id: number): Promise<void> {
    await db.delete(vendors).where(eq(vendors.id, id));
  }

  async getEquipment(id: number): Promise<Equipment | undefined> {
    const [equip] = await db.select().from(equipment).where(eq(equipment.id, id));
    return equip;
  }

  async listEquipment(search?: string, status?: string): Promise<Equipment[]> {
    let q = db.select().from(equipment);
    
    let conditions: SQL[] = [];
    if (status) {
      conditions.push(eq(equipment.status, status as any));
    }
    
    if (search) {
      conditions.push(or(
        sql`${equipment.name} LIKE ${`%${search}%`}`,
        sql`${equipment.equipmentId} LIKE ${`%${search}%`}`
      )!);
    }
    
    if (conditions.length > 0) {
      q = q.where(and(...conditions)) as any;
    }
    
    return await q;
  }

  async createEquipment(equip: InsertEquipment): Promise<Equipment> {
    const result = await db.insert(equipment).values(equip);
    const [newEquip] = await db.select().from(equipment).where(eq(equipment.id, result[0].insertId));
    return newEquip!;
  }

  async updateEquipment(id: number, equip: Partial<InsertEquipment>): Promise<Equipment> {
    const updateData: any = { ...equip };
    if (updateData.purchaseDate && typeof updateData.purchaseDate === 'string') {
      updateData.purchaseDate = new Date(updateData.purchaseDate);
    }
    await db.update(equipment).set(updateData).where(eq(equipment.id, id));
    const [updated] = await db.select().from(equipment).where(eq(equipment.id, id));
    return updated!;
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
    // Convert date strings to Date objects for MySQL
    const insertData: any = { ...rental };
    
    if (insertData.receiveDate && typeof insertData.receiveDate === 'string') {
      insertData.receiveDate = new Date(insertData.receiveDate);
    }
    
    if (insertData.returnDate && typeof insertData.returnDate === 'string') {
      insertData.returnDate = new Date(insertData.returnDate);
    }
    
    const result = await db.insert(rentals).values(insertData);
    const [newRental] = await db.select().from(rentals).where(eq(rentals.id, result[0].insertId));
    return newRental!;
  }

  async updateRental(id: number, rental: Partial<InsertRental>): Promise<Rental> {
  // Convert date strings to Date objects for MySQL
  const updateData: any = { ...rental };
  
  if (updateData.receiveDate && typeof updateData.receiveDate === 'string') {
    updateData.receiveDate = new Date(updateData.receiveDate);
  }
  
  if (updateData.returnDate && typeof updateData.returnDate === 'string') {
    updateData.returnDate = new Date(updateData.returnDate);
  }
  
  await db.update(rentals).set(updateData).where(eq(rentals.id, id));
  const [updated] = await db.select().from(rentals).where(eq(rentals.id, id));
  return updated!;
}

  async createInvoice(invoice: InsertInvoice): Promise<Invoice> {
    const result = await db.insert(invoices).values(invoice);
    const [newInvoice] = await db.select().from(invoices).where(eq(invoices.id, result[0].insertId));
    return newInvoice!;
  }

  async createRiskScore(score: InsertRiskScore): Promise<EquipmentRiskScore> {
    const result = await db.insert(equipmentRiskScores).values(score);
    const [newScore] = await db.select().from(equipmentRiskScores).where(eq(equipmentRiskScores.id, result[0].insertId));
    return newScore!;
  }

  async getRiskScoreHistory(equipmentId: number): Promise<EquipmentRiskScore[]> {
    return await db.select()
      .from(equipmentRiskScores)
      .where(eq(equipmentRiskScores.equipmentId, equipmentId))
      .orderBy(sql`${equipmentRiskScores.scoredAt} DESC`)
      .limit(10);
  }

  async getLatestRiskScore(equipmentId: number): Promise<EquipmentRiskScore | undefined> {
    const [score] = await db.select()
      .from(equipmentRiskScores)
      .where(eq(equipmentRiskScores.equipmentId, equipmentId))
      .orderBy(sql`${equipmentRiskScores.scoredAt} DESC`)
      .limit(1);
    return score;
  }

  async createMaintenanceEvent(event: any): Promise<MaintenanceEvent> {
    const eventData: any = { ...event };

    console.log('Storage: Creating maintenance event', eventData); // Debug log

    
    if (eventData.maintenanceDate && typeof eventData.maintenanceDate === 'string') {
      eventData.maintenanceDate = new Date(eventData.maintenanceDate);
    }
    if (eventData.nextDueDate && typeof eventData.nextDueDate === 'string') {
      eventData.nextDueDate = new Date(eventData.nextDueDate);
    }
    
    const result = await db.insert(maintenanceEvents).values(eventData);
    const [newEvent] = await db.select().from(maintenanceEvents).where(eq(maintenanceEvents.id, result[0].insertId));
    return newEvent!;
  }

  async getMaintenanceHistory(equipmentId: number): Promise<MaintenanceEvent[]> {
    return await db.select()
      .from(maintenanceEvents)
      .where(eq(maintenanceEvents.equipmentId, equipmentId))
      .orderBy(desc(maintenanceEvents.maintenanceDate));
  }

  async getMaintenanceConfig(category: string): Promise<MaintenanceConfig | undefined> {
    const [config] = await db.select()
      .from(maintenanceConfig)
      .where(eq(maintenanceConfig.equipmentCategory, category));
    return config;
  }

  async saveModelMetrics(metrics: InsertModelTrainingMetrics): Promise<ModelTrainingMetrics> {
    const result = await db.insert(modelTrainingMetrics).values(metrics);
    const [newMetrics] = await db
      .select()
      .from(modelTrainingMetrics)
      .where(eq(modelTrainingMetrics.id, result[0].insertId));
    return newMetrics!;
  }

  async getLatestModelMetrics(): Promise<ModelTrainingMetrics | undefined> {
    const [metrics] = await db
      .select()
      .from(modelTrainingMetrics)
      .orderBy(desc(modelTrainingMetrics.trainedAt))
      .limit(1);
    return metrics;
  }

  async getModelMetricsHistory(limit: number = 10): Promise<ModelTrainingMetrics[]> {
    return await db
      .select()
      .from(modelTrainingMetrics)
      .orderBy(desc(modelTrainingMetrics.trainedAt))
      .limit(limit);
  }
}

export const storage = new DatabaseStorage();