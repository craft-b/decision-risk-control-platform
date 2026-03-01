import { mysqlTable, varchar, serial, bigint, int, timestamp, decimal, date, text, mysqlEnum} from "drizzle-orm/mysql-core";
import { relations } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// === TABLE DEFINITIONS ===

export const equipmentRiskScores = mysqlTable("equipment_risk_scores", {
  id: serial("id").primaryKey(),
  equipmentId: int("equipment_id").notNull(),
  riskScore: int("risk_score").notNull(), // 0-100
  riskLevel: varchar("risk_level", { length: 20, enum: ["LOW", "MEDIUM", "HIGH"] }).notNull(),
  drivers: text("drivers").notNull(), // JSON array of strings
  modelVersion: varchar("model_version", { length: 50 }).default("v1.0").notNull(),
  scoredAt: timestamp("scored_at").defaultNow().notNull(),
});

export const users = mysqlTable("users", {
  id: serial("id").primaryKey(),
  username: varchar("username", { length: 255 }).notNull().unique(),
  password: varchar("password", { length: 255 }).notNull(),
  role: varchar("role", { length: 50, enum: ["ADMINISTRATOR", "VIEWER"] }).default("VIEWER").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const jobSites = mysqlTable("job_sites", {
  id: serial("id").primaryKey(),
  jobId: varchar("job_id", { length: 100 }).notNull().unique(),
  name: varchar("name", { length: 255 }).notNull(),
  address: text("address"),
  contactPerson: varchar("contact_person", { length: 255 }),
  contactPhone: varchar("contact_phone", { length: 50 }),
  createdAt: timestamp("created_at").defaultNow(),
});

export const vendors = mysqlTable("vendors", {
  id: serial("id").primaryKey(),
  vendorId: varchar("vendor_id", { length: 100 }).notNull().unique(),
  name: varchar("name", { length: 255 }).notNull(),
  address: text("address"),
  salesPerson: varchar("sales_person", { length: 255 }),
  contact: varchar("contact", { length: 255 }),
  createdAt: timestamp("created_at").defaultNow(),
  
});

export const equipment = mysqlTable("equipment", {
  id: serial("id").primaryKey(),
  equipmentId: varchar("equipment_id", { length: 100 }).notNull().unique(),
  name: varchar("name", { length: 255 }).notNull(),
  category: varchar("category", { length: 100 }).notNull(),
  make: varchar("make", { length: 100 }),
  model: varchar("model", { length: 100 }),
  serialNumber: varchar("serial_number", { length: 100 }).unique(),
  status: varchar("status", { length: 50, enum: ["AVAILABLE", "RENTED", "MAINTENANCE"] }).default("AVAILABLE").notNull(),
  dailyRate: decimal("daily_rate", { precision: 10, scale: 2 }).notNull(),
  weeklyRate: decimal("weekly_rate", { precision: 10, scale: 2 }),
  monthlyRate: decimal("monthly_rate", { precision: 10, scale: 2 }),
  location: varchar("location", { length: 255 }),
  createdAt: timestamp("created_at").defaultNow(),
});

export const rentals = mysqlTable("rentals", {
  id: serial("id").primaryKey(),
  equipmentId: int("equipment_id").notNull(),
  jobSiteId: int("job_site_id").notNull(),
  vendorId: int("vendor_id"),
  poNumber: varchar("po_number", { length: 100 }),
  receiveDate: date("receive_date").notNull(),
  receiveHours: decimal("receive_hours", { precision: 10, scale: 2 }),
  receiveDocument: varchar("receive_document", { length: 255 }),
  returnDate: date("return_date"),
  returnHours: decimal("return_hours", { precision: 10, scale: 2 }),
  returnDocument: varchar("return_document", { length: 255 }),
  buyRent: varchar("buy_rent", { length: 10, enum: ["BUY", "RENT"] }).default("RENT").notNull(),
  status: varchar("status", { length: 50, enum: ["ACTIVE", "COMPLETED", "CANCELLED"] }).default("ACTIVE").notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const invoices = mysqlTable("invoices", {
  id: serial("id").primaryKey(),
  rentalId: int("rental_id").notNull(),
  invoiceNumber: varchar("invoice_number", { length: 100 }).notNull().unique(),
  invoiceDate: date("invoice_date").notNull(),
  periodFrom: date("period_from").notNull(),
  periodTo: date("period_to").notNull(),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const maintenanceEvents = mysqlTable("maintenance_events", {
  id: serial("id").primaryKey(),
  equipmentId: int("equipment_id").notNull(),
  maintenanceDate: date("maintenance_date").notNull(),
  maintenanceType: varchar("maintenance_type", { 
    length: 50, 
    enum: ["INSPECTION", "MINOR_SERVICE", "MAJOR_SERVICE"] 
  }).notNull(),
  description: text("description"),
  performedBy: varchar("performed_by", { length: 255 }),
  cost: decimal("cost", { precision: 10, scale: 2 }),
  nextDueDate: date("next_due_date"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const maintenanceConfig = mysqlTable("maintenance_config", {
  id: serial("id").primaryKey(),
  equipmentCategory: varchar("equipment_category", { length: 100 }).notNull().unique(),
  recommendedIntervalDays: int("recommended_interval_days").notNull().default(180),
  inspectionResetFactor: decimal("inspection_reset_factor", { precision: 3, scale: 2 }).default("0.90"),
  minorServiceResetFactor: decimal("minor_service_reset_factor", { precision: 3, scale: 2 }).default("0.60"),
  majorServiceResetFactor: decimal("major_service_reset_factor", { precision: 3, scale: 2 }).default("0.20"),
  createdAt: timestamp("created_at").defaultNow(),
});



// === RELATIONS === (DECLARE ONCE ONLY)

export const equipmentRiskScoresRelations = relations(equipmentRiskScores, ({ one }) => ({
  equipment: one(equipment, { fields: [equipmentRiskScores.equipmentId], references: [equipment.id] }),
}));

export const rentalsRelations = relations(rentals, ({ one, many }) => ({
  equipment: one(equipment, { fields: [rentals.equipmentId], references: [equipment.id] }),
  jobSite: one(jobSites, { fields: [rentals.jobSiteId], references: [jobSites.id] }),
  vendor: one(vendors, { fields: [rentals.vendorId], references: [vendors.id] }),
  invoices: many(invoices),
}));

export const equipmentRelations = relations(equipment, ({ many }) => ({
  rentals: many(rentals),
  maintenanceEvents: many(maintenanceEvents),
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

export const maintenanceEventsRelations = relations(maintenanceEvents, ({ one }) => ({
  equipment: one(equipment, { 
    fields: [maintenanceEvents.equipmentId], 
    references: [equipment.id] 
  }),
}));

// === PREDICTIVE MAINTENANCE TABLES ===

// Feature snapshot table - time-aware feature store
export const assetFeatureSnapshots = mysqlTable("asset_feature_snapshots", {
  id: bigint("id", { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
  equipmentId: bigint("equipment_id", { mode: 'number', unsigned: true }).notNull(),
  snapshotTs: timestamp("snapshot_ts").notNull(),
  
  // Asset metadata
  assetAgeYears: decimal("asset_age_years", { precision: 10, scale: 2 }),
  category: varchar("category", { length: 100 }),
  
  // Usage features
  totalHoursLifetime: decimal("total_hours_lifetime", { precision: 10, scale: 2 }),
  hoursUsed30d: decimal("hours_used_30d", { precision: 10, scale: 2 }),
  hoursUsed90d: decimal("hours_used_90d", { precision: 10, scale: 2 }),
  
  // Rental intensity
  rentalDays30d: int("rental_days_30d"),
  rentalDays90d: int("rental_days_90d"),
  avgRentalDuration: decimal("avg_rental_duration", { precision: 10, scale: 2 }),
  
  // Maintenance features
  maintenanceEvents90d: int("maintenance_events_90d"),
  maintenanceCost180d: decimal("maintenance_cost_180d", { precision: 10, scale: 2 }),
  avgDowntimePerEvent: decimal("avg_downtime_per_event", { precision: 10, scale: 2 }),
  daysSinceLastMaintenance: int("days_since_last_maintenance"),
  
  // Reliability features
  meanTimeBetweenFailures: int("mean_time_between_failures"),
  
  // Context features
  vendorReliabilityScore: decimal("vendor_reliability_score", { precision: 3, scale: 2 }),
  jobSiteRiskScore: decimal("jobsite_risk_score", { precision: 3, scale: 2 }),
  
  // Label (computed post-hoc for training)
  willFail30d: int("will_fail_30d"), // 0, 1, or NULL (unknown)
  
  createdAt: timestamp("created_at").defaultNow(),
});

// Risk predictions table - inference results
export const assetRiskPredictions = mysqlTable("asset_risk_predictions", {
  id: bigint("id", { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
  equipmentId: bigint("equipment_id", { mode: 'number', unsigned: true }).notNull(),
  snapshotTs: timestamp("snapshot_ts").notNull(),
  
  // Model outputs
  failureProbability: decimal("failure_probability", { precision: 5, scale: 4 }).notNull(),
  riskBand: mysqlEnum("risk_band", ["LOW", "MEDIUM", "HIGH"]).notNull(),
  
  // Explainability
  topDriver1: varchar("top_driver_1", { length: 100 }),
  topDriver1Impact: decimal("top_driver_1_impact", { precision: 5, scale: 4 }),
  topDriver2: varchar("top_driver_2", { length: 100 }),
  topDriver2Impact: decimal("top_driver_2_impact", { precision: 5, scale: 4 }),
  topDriver3: varchar("top_driver_3", { length: 100 }),
  topDriver3Impact: decimal("top_driver_3_impact", { precision: 5, scale: 4 }),
  recommendation: text("recommendation"),
  
  // Metadata
  modelVersion: varchar("model_version", { length: 50 }).notNull(),
  predictedAt: timestamp("predicted_at").defaultNow().notNull(),
});

// Model metadata & versioning
export const mlModels = mysqlTable("ml_models", {
  id: bigint("id", { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
  modelVersion: varchar("model_version", { length: 50 }).notNull().unique(),
  modelType: varchar("model_type", { length: 50 }).notNull(),
  
  // Training metadata
  trainedAt: timestamp("trained_at").notNull(),
  trainingDataStart: date("training_data_start").notNull(),
  trainingDataEnd: date("training_data_end").notNull(),
  trainingRecords: int("training_records").notNull(),
  
  // Performance metrics
  rocAuc: decimal("roc_auc", { precision: 5, scale: 4 }),
  precision: decimal("precision", { precision: 5, scale: 4 }),
  recall: decimal("recall", { precision: 5, scale: 4 }),
  
  // Feature metadata
  featureSchema: text("feature_schema"),
  
  // Status
  status: mysqlEnum("status", ["ACTIVE", "ARCHIVED", "TESTING"]).default("ACTIVE").notNull(),
  
  createdAt: timestamp("created_at").defaultNow(),
});

export const modelTrainingMetrics = mysqlTable("model_training_metrics", {
  id: int("id").primaryKey().autoincrement(), // Changed from serial to int
  modelVersion: varchar("model_version", { length: 50 }).notNull(),
  trainedAt: timestamp("trained_at").notNull(),
  datasetSize: int("dataset_size").notNull(),
  
  accuracy: decimal("accuracy", { precision: 5, scale: 4 }).notNull(),
  
  precisionHigh: decimal("precision_high", { precision: 5, scale: 4 }).notNull(),
  recallHigh: decimal("recall_high", { precision: 5, scale: 4 }).notNull(),
  f1High: decimal("f1_high", { precision: 5, scale: 4 }).notNull(),
  
  precisionMedium: decimal("precision_medium", { precision: 5, scale: 4 }).notNull(),
  recallMedium: decimal("recall_medium", { precision: 5, scale: 4 }).notNull(),
  f1Medium: decimal("f1_medium", { precision: 5, scale: 4 }).notNull(),
  
  precisionLow: decimal("precision_low", { precision: 5, scale: 4 }).notNull(),
  recallLow: decimal("recall_low", { precision: 5, scale: 4 }).notNull(),
  f1Low: decimal("f1_low", { precision: 5, scale: 4 }).notNull(),
  
  highPredictedHigh: int("high_predicted_high").notNull(),
  highPredictedMedium: int("high_predicted_medium").notNull(),
  highPredictedLow: int("high_predicted_low").notNull(),
  mediumPredictedHigh: int("medium_predicted_high").notNull(),
  mediumPredictedMedium: int("medium_predicted_medium").notNull(),
  mediumPredictedLow: int("medium_predicted_low").notNull(),
  lowPredictedHigh: int("low_predicted_high").notNull(),
  lowPredictedMedium: int("low_predicted_medium").notNull(),
  lowPredictedLow: int("low_predicted_low").notNull(),
  
  createdAt: timestamp("created_at").defaultNow(),
});

// Admin overrides & feedback loop
export const maintenanceOverrides = mysqlTable("maintenance_overrides", {
  id: bigint("id", { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
  equipmentId: bigint("equipment_id", { mode: 'number', unsigned: true }).notNull(),
  predictionId: bigint("prediction_id", { mode: 'number', unsigned: true }),
  
  overriddenBy: bigint("overridden_by", { mode: 'number', unsigned: true }).notNull(), // Changed from int
  originalRiskBand: varchar("original_risk_band", { length: 20 }),
  overrideRiskBand: varchar("override_risk_band", { length: 20 }).notNull(),
  reason: text("reason"),
  actionTaken: text("action_taken"),
  
  createdAt: timestamp("created_at").defaultNow(),
});

// === RELATIONS ===

export const assetFeatureSnapshotsRelations = relations(assetFeatureSnapshots, ({ one }) => ({
  equipment: one(equipment, { 
    fields: [assetFeatureSnapshots.equipmentId], 
    references: [equipment.id] 
  }),
}));

export const assetRiskPredictionsRelations = relations(assetRiskPredictions, ({ one }) => ({
  equipment: one(equipment, { 
    fields: [assetRiskPredictions.equipmentId], 
    references: [equipment.id] 
  }),
}));

export const maintenanceOverridesRelations = relations(maintenanceOverrides, ({ one }) => ({
  equipment: one(equipment, { 
    fields: [maintenanceOverrides.equipmentId], 
    references: [equipment.id] 
  }),
  prediction: one(assetRiskPredictions, {
    fields: [maintenanceOverrides.predictionId],
    references: [assetRiskPredictions.id],
  }),
  user: one(users, {
    fields: [maintenanceOverrides.overriddenBy],
    references: [users.id],
  }),
}));

// === SCHEMAS ===

export const insertRiskScoreSchema = createInsertSchema(equipmentRiskScores).omit({ id: true, scoredAt: true });

export const insertUserSchema = createInsertSchema(users).omit({ id: true, createdAt: true }).extend({
  password: z.string().min(6, "Password must be at least 6 characters"),
});

export const insertJobSiteSchema = createInsertSchema(jobSites)
  .omit({ 
    id: true, 
    createdAt: true, 
    jobId: true  // Auto-generated by backend
  })
  .extend({
    // All fields optional except name
    name: z.string().min(1, "Name is required"),
    address: z.string().optional().nullable(),
    contactPerson: z.string().optional().nullable(),
    contactPhone: z.string().optional().nullable(),
  });

export const insertVendorSchema = createInsertSchema(vendors)
  .omit({ 
    id: true, 
    createdAt: true, 
    vendorId: true  // Auto-generated by backend
  })
  .extend({
    // All fields optional except name
    name: z.string().min(1, "Name is required"),
    address: z.string().optional().nullable(),
    salesPerson: z.string().optional().nullable(),
    contact: z.string().optional().nullable(),
  });
  
export const insertEquipmentSchema = createInsertSchema(equipment).omit({ id: true, createdAt: true });

export const insertRentalSchema = createInsertSchema(rentals)
  .omit({ id: true, createdAt: true })
  .extend({
    receiveDate: z.string(),
    returnDate: z.string().nullable().optional(),
  });

export const insertInvoiceSchema = createInsertSchema(invoices).omit({ id: true, createdAt: true });

export const insertMaintenanceEventSchema = createInsertSchema(maintenanceEvents)
  .omit({ id: true, createdAt: true })
  .extend({
    maintenanceDate: z.string(),
    nextDueDate: z.string().nullable().optional(),
  });

export const insertMaintenanceConfigSchema = createInsertSchema(maintenanceConfig)
  .omit({ id: true, createdAt: true });

export const insertAssetFeatureSnapshotSchema = createInsertSchema(assetFeatureSnapshots)
  .omit({ id: true, createdAt: true });

export const insertAssetRiskPredictionSchema = createInsertSchema(assetRiskPredictions)
  .omit({ id: true, predictedAt: true });

export const insertMlModelSchema = createInsertSchema(mlModels)
  .omit({ id: true, createdAt: true });

export const insertMaintenanceOverrideSchema = createInsertSchema(maintenanceOverrides)
  .omit({ id: true, createdAt: true });

export const simulationState = mysqlTable("simulation_state", {
  id:            int("id").primaryKey().autoincrement(),
  cursorDate:    varchar("cursor_date", { length: 10 }).notNull(), // YYYY-MM-DD
  totalDaysRun:  int("total_days_run").notNull().default(0),
  updatedAt:     timestamp("updated_at").defaultNow(),
});

export const insertModelTrainingMetricsSchema = createInsertSchema(modelTrainingMetrics)
  .omit({ id: true, createdAt: true });


// === EXPLICIT TYPES ===

export type EquipmentRiskScore = typeof equipmentRiskScores.$inferSelect;
export type InsertRiskScore = z.infer<typeof insertRiskScoreSchema>;

export type User = typeof users.$inferSelect;
export type JobSite = typeof jobSites.$inferSelect;
export type Vendor = typeof vendors.$inferSelect;
export type Equipment = typeof equipment.$inferSelect;
export type Rental = typeof rentals.$inferSelect;
export type Invoice = typeof invoices.$inferSelect;
export type MaintenanceEvent = typeof maintenanceEvents.$inferSelect;
export type MaintenanceConfig = typeof maintenanceConfig.$inferSelect;

export type InsertUser = z.infer<typeof insertUserSchema>;
export type InsertJobSite = z.infer<typeof insertJobSiteSchema>;
export type InsertVendor = z.infer<typeof insertVendorSchema>;
export type InsertEquipment = z.infer<typeof insertEquipmentSchema>;
export type InsertRental = z.infer<typeof insertRentalSchema>;
export type InsertInvoice = z.infer<typeof insertInvoiceSchema>;
export type InsertMaintenanceEvent = z.infer<typeof insertMaintenanceEventSchema>;
export type InsertMaintenanceConfig = z.infer<typeof insertMaintenanceConfigSchema>;

export type AssetFeatureSnapshot = typeof assetFeatureSnapshots.$inferSelect;
export type AssetRiskPrediction = typeof assetRiskPredictions.$inferSelect;
export type MlModel = typeof mlModels.$inferSelect;
export type MaintenanceOverride = typeof maintenanceOverrides.$inferSelect;

export type InsertAssetFeatureSnapshot = z.infer<typeof insertAssetFeatureSnapshotSchema>;
export type InsertAssetRiskPrediction = z.infer<typeof insertAssetRiskPredictionSchema>;
export type InsertMlModel = z.infer<typeof insertMlModelSchema>;
export type InsertMaintenanceOverride = z.infer<typeof insertMaintenanceOverrideSchema>;

export type ModelTrainingMetrics = typeof modelTrainingMetrics.$inferSelect;
export type InsertModelTrainingMetrics = z.infer<typeof insertModelTrainingMetricsSchema>;
