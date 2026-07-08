-- Schema drift repair (ARCH-1 symptom): shared/schema.ts declares
-- job_sites.distance_miles but the live DB never received it (drizzle-kit push
-- was not run after the column was added). Every /api/rentals call crashed the
-- server with ER_BAD_FIELD_ERROR until applied. Group 2 (ARCH-1) replaces these
-- ad-hoc files with a real Drizzle migration baseline.
ALTER TABLE job_sites
  ADD COLUMN distance_miles DECIMAL(6,1) DEFAULT 25.0
  AFTER contact_phone;
