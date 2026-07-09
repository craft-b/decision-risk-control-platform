// QA-1 — point-in-time correctness (the ML-1 regression guard).
//
// The property: a snapshot built for time T must be byte-identical whether or
// not events dated AFTER T exist in the database. If a window query loses its
// `<= snapshotTs` bound (ML-1), a future maintenance/rental row leaks into the
// features — including, at training time, the very event that becomes the label.
//
// This is inherently DB-backed. It runs against the configured database and
// SKIPS cleanly when DATABASE_URL is unset (e.g. a DB-less CI job). Everything
// it writes is under a dedicated synthetic equipment id and is cleaned up.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import dotenv from "dotenv";

dotenv.config();

const RUN = !!process.env.DATABASE_URL;
const suite = RUN ? describe : describe.skip;

const TEST_EQ_ID = 990117; // high id, unlikely to collide with seeded fleet

suite("point-in-time correctness (ML-1)", () => {
  let db: any;
  let sql: any;
  let pool: any;
  let enhancedFeatureService: any;

  beforeAll(async () => {
    ({ db, pool } = await import("../db"));
    ({ sql } = await import("drizzle-orm"));
    ({ enhancedFeatureService } = await import("./feature-engineering-enhanced"));

    await cleanup();
    // A unit that exists well before T, with one past maintenance event.
    await db.execute(sql`
      INSERT INTO equipment (id, equipment_id, name, category, status,
        daily_rate, weekly_rate, monthly_rate, year_manufactured, purchase_date,
        current_mileage, initial_mileage)
      VALUES (${TEST_EQ_ID}, 'PIT-TEST', 'PIT Test Excavator', 'Excavator', 'AVAILABLE',
        500, 3000, 10000, 2018, '2018-06-15', 6000, 0)
    `);
    await db.execute(sql`
      INSERT INTO maintenance_events (equipment_id, maintenance_date, maintenance_type,
        event_source, cost, description)
      VALUES (${TEST_EQ_ID}, '2030-05-01', 'MAJOR_SERVICE', 'REACTIVE_REPAIR', 2000, 'past event')
    `);
  });

  afterAll(async () => {
    if (!RUN) return;
    await cleanup();
    await pool.end();
  });

  async function cleanup() {
    await db.execute(sql`DELETE FROM maintenance_events WHERE equipment_id = ${TEST_EQ_ID}`);
    await db.execute(sql`DELETE FROM equipment WHERE id = ${TEST_EQ_ID}`);
  }

  it("a future breakdown does not change a snapshot built at T", async () => {
    const T = new Date("2030-06-01T00:00:00Z");

    const before = await enhancedFeatureService.generateSnapshot(TEST_EQ_ID, T);

    // A breakdown strictly AFTER T — this is the label-leakage case: at training
    // time this MAJOR_SERVICE/REACTIVE_REPAIR row is the event that becomes the
    // positive label. If ML-1 regresses it inflates maintenance_cost_180d and
    // resets days_since_last_maintenance to a leaked value.
    await db.execute(sql`
      INSERT INTO maintenance_events (equipment_id, maintenance_date, maintenance_type,
        event_source, cost, description)
      VALUES (${TEST_EQ_ID}, '2030-06-15', 'MAJOR_SERVICE', 'REACTIVE_REPAIR', 9000, 'FUTURE event')
    `);

    const after = await enhancedFeatureService.generateSnapshot(TEST_EQ_ID, T);

    // Bit-identical: the post-T row must be invisible to a snapshot at T.
    expect(after).toEqual(before);
    expect(after.maintenanceCost180d).toBe(before.maintenanceCost180d);
    expect(after.daysSinceLastMaintenance).toBe(before.daysSinceLastMaintenance);
    expect(after.meanTimeBetweenFailures).toBe(before.meanTimeBetweenFailures);
  });
});
