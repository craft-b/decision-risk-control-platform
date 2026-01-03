import { pgTable, text, serial, integer, boolean, timestamp, numeric, date } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// === TABLE DEFINITIONS ===

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  role: text("role", { enum: ["ADMINISTRATOR", "VIEWER"] }).default("VIEWER").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const equipment = pgTable("equipment", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  category: text("category").notNull(), // e.g., 'Excavator', 'Lift'
  serialNumber: text("serial_number").unique(),
  status: text("status", { enum: ["AVAILABLE", "RENTED", "MAINTENANCE"] }).default("AVAILABLE").notNull(),
  dailyRate: numeric("daily_rate").notNull(), // using numeric for currency
  condition: text("condition"),
  location: text("location"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const rentals = pgTable("rentals", {
  id: serial("id").primaryKey(),
  equipmentId: integer("equipment_id").references(() => equipment.id).notNull(),
  customerName: text("customer_name").notNull(),
  jobSite: text("job_site"),
  startDate: date("start_date").notNull(),
  endDate: date("end_date"),
  status: text("status", { enum: ["ACTIVE", "COMPLETED", "CANCELLED"] }).default("ACTIVE").notNull(),
  totalCost: numeric("total_cost"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
});

// === SCHEMAS ===

export const insertUserSchema = createInsertSchema(users).omit({ id: true, createdAt: true }).extend({
  password: z.string().min(6, "Password must be at least 6 characters"),
});
export const insertEquipmentSchema = createInsertSchema(equipment).omit({ id: true, createdAt: true });
export const insertRentalSchema = createInsertSchema(rentals).omit({ id: true, createdAt: true, totalCost: true });

// === EXPLICIT TYPES ===

export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;

export type Equipment = typeof equipment.$inferSelect;
export type InsertEquipment = z.infer<typeof insertEquipmentSchema>;

export type Rental = typeof rentals.$inferSelect;
export type InsertRental = z.infer<typeof insertRentalSchema>;

// === API REQUEST/RESPONSE TYPES ===

export type CreateEquipmentRequest = InsertEquipment;
export type UpdateEquipmentRequest = Partial<InsertEquipment>;

export type CreateRentalRequest = InsertRental;
export type UpdateRentalRequest = Partial<InsertRental>;
export type CompleteRentalRequest = { endDate: string; notes?: string };

export type LoginRequest = { username: string; password: string };
export type LoginResponse = { user: User; token?: string }; // Token if using JWT, or just user if session

export type EquipmentResponse = Equipment;
export type RentalResponse = Rental & { equipment?: Equipment };
