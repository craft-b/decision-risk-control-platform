import { pgTable, text, serial, integer, boolean, timestamp, numeric, date } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
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

export const jobSites = pgTable("job_sites", {
  id: serial("id").primaryKey(),
  jobId: text("job_id").notNull().unique(), // User-facing ID
  name: text("name").notNull(),
  address: text("address"),
  contactPerson: text("contact_person"),
  contactPhone: text("contact_phone"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const vendors = pgTable("vendors", {
  id: serial("id").primaryKey(),
  vendorId: text("vendor_id").notNull().unique(), // User-facing ID
  name: text("name").notNull(),
  address: text("address"),
  salesPerson: text("sales_person"),
  contact: text("contact"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const equipment = pgTable("equipment", {
  id: serial("id").primaryKey(),
  equipmentId: text("equipment_id").notNull().unique(), // User-facing ID
  name: text("name").notNull(),
  category: text("category").notNull(),
  make: text("make"),
  model: text("model"),
  serialNumber: text("serial_number").unique(),
  status: text("status", { enum: ["AVAILABLE", "RENTED", "MAINTENANCE"] }).default("AVAILABLE").notNull(),
  dailyRate: numeric("daily_rate").notNull(),
  weeklyRate: numeric("weekly_rate"),
  monthlyRate: numeric("monthly_rate"),
  location: text("location"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const rentals = pgTable("rentals", {
  id: serial("id").primaryKey(),
  equipmentId: integer("equipment_id").references(() => equipment.id).notNull(),
  jobSiteId: integer("job_site_id").references(() => jobSites.id).notNull(),
  vendorId: integer("vendor_id").references(() => vendors.id),
  poNumber: text("po_number"),
  receiveDate: date("receive_date").notNull(),
  receiveHours: numeric("receive_hours"),
  receiveDocument: text("receive_document"),
  returnDate: date("return_date"),
  returnHours: numeric("return_hours"),
  returnDocument: text("return_document"),
  buyRent: text("buy_rent", { enum: ["BUY", "RENT"] }).default("RENT").notNull(),
  status: text("status", { enum: ["ACTIVE", "COMPLETED", "CANCELLED"] }).default("ACTIVE").notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const invoices = pgTable("invoices", {
  id: serial("id").primaryKey(),
  rentalId: integer("rental_id").references(() => rentals.id).notNull(),
  invoiceNumber: text("invoice_number").notNull().unique(),
  invoiceDate: date("invoice_date").notNull(),
  periodFrom: date("period_from").notNull(),
  periodTo: date("period_to").notNull(),
  amount: numeric("amount").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

// === RELATIONS ===

export const rentalsRelations = relations(rentals, ({ one, many }) => ({
  equipment: one(equipment, { fields: [rentals.equipmentId], references: [equipment.id] }),
  jobSite: one(jobSites, { fields: [rentals.jobSiteId], references: [jobSites.id] }),
  vendor: one(vendors, { fields: [rentals.vendorId], references: [vendors.id] }),
  invoices: many(invoices),
}));

export const equipmentRelations = relations(equipment, ({ many }) => ({
  rentals: many(rentals),
}));

export const jobSitesRelations = relations(jobSites, ({ many }) => ({
  rentals: many(rentals),
}));

export const vendorsRelations = relations(vendors, ({ many }) => ({
  rentals: many(rentals),
}));

export const invoicesRelations = relations(invoices, ({ one }) => ({
  rental: one(rentals, { fields: [invoices.rentalId], references: [rentals.id] }),
}));

// === SCHEMAS ===

export const insertUserSchema = createInsertSchema(users).omit({ id: true, createdAt: true }).extend({
  password: z.string().min(6, "Password must be at least 6 characters"),
});
export const insertJobSiteSchema = createInsertSchema(jobSites).omit({ id: true, createdAt: true });
export const insertVendorSchema = createInsertSchema(vendors).omit({ id: true, createdAt: true });
export const insertEquipmentSchema = createInsertSchema(equipment).omit({ id: true, createdAt: true });
export const insertRentalSchema = createInsertSchema(rentals).omit({ id: true, createdAt: true });
export const insertInvoiceSchema = createInsertSchema(invoices).omit({ id: true, createdAt: true });

// === EXPLICIT TYPES ===

export type User = typeof users.$inferSelect;
export type JobSite = typeof jobSites.$inferSelect;
export type Vendor = typeof vendors.$inferSelect;
export type Equipment = typeof equipment.$inferSelect;
export type Rental = typeof rentals.$inferSelect;
export type Invoice = typeof invoices.$inferSelect;

export type InsertUser = z.infer<typeof insertUserSchema>;
export type InsertJobSite = z.infer<typeof insertJobSiteSchema>;
export type InsertVendor = z.infer<typeof insertVendorSchema>;
export type InsertEquipment = z.infer<typeof insertEquipmentSchema>;
export type InsertRental = z.infer<typeof insertRentalSchema>;
export type InsertInvoice = z.infer<typeof insertInvoiceSchema>;
