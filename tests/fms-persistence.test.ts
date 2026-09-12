import assert from "node:assert/strict";
import test, { after, describe } from "node:test";
import pg from "pg";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../db/schema";
import { eq, and, desc } from "drizzle-orm";

const DATABASE_URL =
  process.env.FMS_DATABASE_URL ??
  "postgresql://fms_admin:***@localhost:5439/fms_db";

let client: pg.Client;
let db: ReturnType<typeof drizzle<typeof schema>>;
let sql: ReturnType<typeof postgres>;

describe("FMS PostgreSQL Persistence Tests (T1-T10)", () => {
  // ─── SETUP ──────────────────────────────────────────────────────
  test("setup: connect to database", async () => {
    client = new pg.Client({ connectionString: DATABASE_URL });
    await client.connect();
    sql = postgres(DATABASE_URL, { max: 5 });
    db = drizzle(sql, { schema });
    assert.ok(true, "Connected to fms-postgres");
  });

  // ─── T1: DATABASE CONNECTIVITY ──────────────────────────────────
  test("T1: database connectivity", async () => {
    const res = await client.query("SELECT current_database(), version()");
    assert.equal(res.rows[0].current_database, "fms_db");
    assert.ok(res.rows[0].version.includes("PostgreSQL"));
    console.log(`  ✓ T1 PASS — ${res.rows[0].current_database}, ${res.rows[0].version.slice(0, 30)}...`);
  });

  // ─── T2: MIGRATION/SCHEMA ──────────────────────────────────────
  test("T2: migration/schema — all 6 tables exist with correct columns", async () => {
    const tables = await client.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name LIKE 'fms_%' ORDER BY table_name"
    );
    const tableNames = tables.rows.map((r) => r.table_name);
    assert.ok(tableNames.includes("fms_units"), "fms_units exists");
    assert.ok(tableNames.includes("fms_shift_assignments"), "fms_shift_assignments exists");
    assert.ok(tableNames.includes("fms_p2h_checks"), "fms_p2h_checks exists");
    assert.ok(tableNames.includes("fms_canonical_events"), "fms_canonical_events exists");
    assert.ok(tableNames.includes("fms_hourly_control"), "fms_hourly_control exists");
    assert.ok(tableNames.includes("fms_raw_telemetry"), "fms_raw_telemetry exists");

    // Verify fms_raw_telemetry columns
    const cols = await client.query(
      "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'fms_raw_telemetry' ORDER BY ordinal_position"
    );
    const colNames = cols.rows.map((r) => r.column_name);
    assert.ok(colNames.includes("id"), "has id");
    assert.ok(colNames.includes("device_id"), "has device_id");
    assert.ok(colNames.includes("unit"), "has unit");
    assert.ok(colNames.includes("server_time"), "has server_time");
    assert.ok(colNames.includes("fix_time"), "has fix_time");
    assert.ok(colNames.includes("latitude"), "has latitude");
    assert.ok(colNames.includes("longitude"), "has longitude");
    assert.ok(colNames.includes("speed"), "has speed");
    assert.ok(colNames.includes("course"), "has course");
    assert.ok(colNames.includes("altitude"), "has altitude");
    assert.ok(colNames.includes("ignition"), "has ignition");
    assert.ok(colNames.includes("raw_payload"), "has raw_payload");
    assert.ok(colNames.includes("received_at"), "has received_at");

    // Verify indexes
    const indexes = await client.query(
      "SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'fms_raw_telemetry'"
    );
    const idxNames = indexes.rows.map((r) => r.indexname);
    assert.ok(idxNames.includes("idx_raw_tel_unit_time"), "has unit+time index");
    assert.ok(idxNames.includes("idx_raw_tel_device_time"), "has device+time index");
    assert.ok(idxNames.includes("idx_raw_lat_lon"), "has lat/lon index");

    console.log(`  ✓ T2 PASS — ${tableNames.filter(n => n.startsWith('fms_')).length} FMS tables, ${idxNames.length} indexes on raw_telemetry`);
  });

  // ─── T3: SHIFT ASSIGNMENT POST/GET ──────────────────────────────
  test("T3: shift assignment POST/GET", async () => {
    const now = new Date();
    const row = {
      id: crypto.randomUUID(),
      tanggal: "2026-09-08",
      shift: "DAY",
      siteProject: "Metro Mining",
      loader: "EX-501",
      operatorLoader: "Norman",
      hauler: "DT-3055",
      operatorHauler: "Nurul",
      loadingPoint: "PIT BR23",
      dumpingPoint: "OPD_02",
      material: "Limonite",
      statusAssignment: "ASSIGNED",
      sourceName: "Digital Shift Board",
      createdBy: "test",
      createdAt: now,
      updatedAt: now,
    };

    await db.insert(schema.fmsShiftAssignments).values(row);
    const found = await db
      .select()
      .from(schema.fmsShiftAssignments)
      .where(
        and(
          eq(schema.fmsShiftAssignments.tanggal, "2026-09-08"),
          eq(schema.fmsShiftAssignments.shift, "DAY")
        )
      );

    assert.ok(found.length >= 1, "At least 1 assignment found");
    const match = found.find((r) => r.id === row.id);
    assert.ok(match, "Inserted assignment found");
    assert.equal(match.hauler, "DT-3055");
    assert.equal(match.loader, "EX-501");
    assert.equal(match.operatorHauler, "Nurul");
    assert.equal(match.statusAssignment, "ASSIGNED");

    console.log(`  ✓ T3 PASS — Shift assignment inserted and retrieved`);
  });

  // ─── T4: P2H PERSISTENCE ────────────────────────────────────────
  test("T4: P2H persistence", async () => {
    const row = {
      id: crypto.randomUUID(),
      tanggal: "2026-09-08",
      shift: "DAY",
      namaOperator: "Nurul",
      nrp: "NR-001",
      unit: "DT-3055",
      hmAwal: 4001.5,
      kmAwal: 19827.3,
      checklistJson: JSON.stringify({ engine: true, tire: true, brake: true }),
      remarks: "All clear",
      keputusanP2h: "LAYAK DIOPERASIKAN",
      keputusanOleh: "Human",
      sourceName: "Digital P2H",
      createdAt: new Date(),
    };

    await db.insert(schema.fmsP2hChecks).values(row);
    const found = await db
      .select()
      .from(schema.fmsP2hChecks)
      .where(eq(schema.fmsP2hChecks.unit, "DT-3055"))
      .orderBy(desc(schema.fmsP2hChecks.createdAt))
      .limit(1);

    assert.equal(found.length, 1);
    assert.equal(found[0].keputusanP2h, "LAYAK DIOPERASIKAN");
    assert.equal(found[0].hmAwal, 4001.5);
    assert.equal(found[0].keputusanOleh, "Human");

    console.log(`  ✓ T4 PASS — P2H check persisted with HM/KM/keputusan`);
  });

  // ─── T5: TELEMETRY INSERT ───────────────────────────────────────
  test("T5: raw telemetry insert", async () => {
    const row = {
      id: crypto.randomUUID(),
      deviceId: 2001,
      unit: "DT-3055",
      serverTime: new Date("2026-09-08T01:00:00Z"),
      deviceTime: new Date("2026-09-08T01:00:00Z"),
      fixTime: new Date("2026-09-08T01:00:00Z"),
      latitude: -3.01643,
      longitude: 121.85414,
      speed: 10.5,
      course: 90,
      altitude: 150,
      ignition: true,
      rawPayload: { source: "test", tick: 1 },
    };

    await db.insert(schema.fmsRawTelemetry).values(row);
    const found = await db
      .select()
      .from(schema.fmsRawTelemetry)
      .where(eq(schema.fmsRawTelemetry.id, row.id));

    assert.equal(found.length, 1);
    assert.equal(found[0].deviceId, 2001);
    assert.equal(found[0].unit, "DT-3055");
    assert.equal(found[0].latitude, -3.01643);
    assert.equal(found[0].ignition, true);
    assert.deepEqual(found[0].rawPayload, { source: "test", tick: 1 });

    // Insert 100 more telemetry rows to simulate batch write
    const batch = Array.from({ length: 100 }, (_, i) => {
      const totalSec = i + 1;
      const mm = String(Math.floor(totalSec / 60)).padStart(2, "0");
      const ss = String(totalSec % 60).padStart(2, "0");
      const ts = `2026-09-08T01:${mm}:${ss}Z`;
      return {
        id: crypto.randomUUID(),
        deviceId: 2001,
        unit: "DT-3055",
        serverTime: new Date(ts),
        fixTime: new Date(ts),
        latitude: -3.01643 + i * 0.00001,
        longitude: 121.85414 + i * 0.00001,
        speed: 10 + Math.random() * 5,
        ignition: true,
        rawPayload: { tick: i + 1 },
      };
    });

    await db.insert(schema.fmsRawTelemetry).values(batch);
    const count = await client.query(
      "SELECT COUNT(*) as cnt FROM fms_raw_telemetry WHERE unit = 'DT-3055'"
    );
    assert.ok(parseInt(count.rows[0].cnt) >= 101, `At least 101 rows, got ${count.rows[0].cnt}`);

    console.log(`  ✓ T5 PASS — ${count.rows[0].cnt} telemetry rows inserted (single + batch)`);
  });

  // ─── T6: CANONICAL EVENT PERSISTENCE ────────────────────────────
  test("T6: canonical event persistence", async () => {
    const row = {
      eventId: `lokasi:2001:${Date.now()}`,
      eventType: "Lokasi",
      waktu: new Date("2026-09-08T01:00:00Z"),
      tanggalOperasional: "2026-09-08",
      shift: "DAY",
      unit: "DT-3055",
      operator: "Nurul",
      sourceType: "FMC650/Traccar",
      sourceName: "Traccar:2001",
      authorityStatus: "PROVISIONAL",
      payloadJson: { latitude: -3.01643, longitude: 121.85414 },
      receivedAt: new Date(),
      recordStatus: "RAW",
    };

    await db.insert(schema.fmsCanonicalEvents).values(row);
    const found = await db
      .select()
      .from(schema.fmsCanonicalEvents)
      .where(eq(schema.fmsCanonicalEvents.unit, "DT-3055"));

    assert.ok(found.length >= 1);
    const match = found.find((r) => r.eventId === row.eventId);
    assert.ok(match, "Inserted event found");
    assert.equal(match.eventType, "Lokasi");
    assert.equal(match.authorityStatus, "PROVISIONAL");

    console.log(`  ✓ T6 PASS — Canonical event persisted with JSONB payload`);
  });

  // ─── T7: DUPLICATE/IDEMPOTENCY ──────────────────────────────────
  test("T7: duplicate/idempotency — onConflictDoNothing", async () => {
    const eventId = `dup-test-${Date.now()}`;
    const row = {
      eventId,
      eventType: "HM",
      waktu: new Date("2026-09-08T02:00:00Z"),
      tanggalOperasional: "2026-09-08",
      shift: "DAY",
      unit: "DT-3055",
      sourceType: "FMC650/Traccar",
      sourceName: "Traccar:2001",
      authorityStatus: "PROVISIONAL",
      payloadJson: { hm: 4001.5 },
      receivedAt: new Date(),
      recordStatus: "RAW",
    };

    // First insert
    await db.insert(schema.fmsCanonicalEvents).values(row).onConflictDoNothing();
    // Second insert (duplicate) — should not throw
    await db.insert(schema.fmsCanonicalEvents).values(row).onConflictDoNothing();

    const found = await client.query(
      "SELECT COUNT(*) as cnt FROM fms_canonical_events WHERE event_id = $1",
      [eventId]
    );
    assert.equal(parseInt(found.rows[0].cnt), 1, "Only 1 row exists (idempotent)");

    // Test duplicate unit — should allow (different id)
    const unitRow = {
      id: crypto.randomUUID(),
      unit: `DUP-TEST-${Date.now()}`,
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await db.insert(schema.fmsUnits).values(unitRow);
    // Same unit name should fail (unique constraint)
    let threw = false;
    try {
      await db.insert(schema.fmsUnits).values({ ...unitRow, id: crypto.randomUUID() });
    } catch {
      threw = true;
    }
    assert.ok(threw, "Duplicate unit name throws unique constraint error");

    console.log(`  ✓ T7 PASS — Canonical events idempotent, unit names unique`);
  });

  // ─── T8: UNIT ISOLATION ────────────────────────────────────────
  test("T8: unit isolation — queries scoped to unit", async () => {
    // Insert telemetry for two different units
    const unitA = `ISO-A-${Date.now()}`;
    const unitB = `ISO-B-${Date.now()}`;

    const rowsA = Array.from({ length: 5 }, (_, i) => ({
      id: crypto.randomUUID(),
      deviceId: 9001,
      unit: unitA,
      serverTime: new Date(`2026-09-08T03:${String(i).padStart(2, "0")}:00Z`),
      fixTime: new Date(`2026-09-08T03:${String(i).padStart(2, "0")}:00Z`),
      latitude: -3.0,
      longitude: 121.0,
      speed: 10,
    }));

    const rowsB = Array.from({ length: 3 }, (_, i) => ({
      id: crypto.randomUUID(),
      deviceId: 9002,
      unit: unitB,
      serverTime: new Date(`2026-09-08T03:${String(i).padStart(2, "0")}:00Z`),
      fixTime: new Date(`2026-09-08T03:${String(i).padStart(2, "0")}:00Z`),
      latitude: -4.0,
      longitude: 122.0,
      speed: 15,
    }));

    await db.insert(schema.fmsRawTelemetry).values([...rowsA, ...rowsB]);

    const countA = await client.query(
      "SELECT COUNT(*) as cnt FROM fms_raw_telemetry WHERE unit = $1",
      [unitA]
    );
    const countB = await client.query(
      "SELECT COUNT(*) as cnt FROM fms_raw_telemetry WHERE unit = $1",
      [unitB]
    );

    assert.equal(parseInt(countA.rows[0].cnt), 5, "Unit A has 5 rows");
    assert.equal(parseInt(countB.rows[0].cnt), 3, "Unit B has 3 rows");

    console.log(`  ✓ T8 PASS — Unit isolation verified (${unitA}:5, ${unitB}:3)`);
  });

  // ─── T9: RESTART PERSISTENCE ────────────────────────────────────
  test("T9: restart persistence — data survives container restart", async () => {
    // Count telemetry rows before restart (T8 inserted ISO-A/ISO-B into fms_raw_telemetry)
    const before = await client.query("SELECT COUNT(*) as cnt FROM fms_raw_telemetry WHERE unit LIKE 'ISO-%'");
    const countBefore = parseInt(before.rows[0].cnt);

    // Restart container
    console.log("  ⏳ Restarting fms-postgres container...");
    const { execSync } = await import("node:child_process");
    execSync("docker restart fms-postgres", { timeout: 30000 });

    // Wait for ready
    let ready = false;
    for (let i = 0; i < 15; i++) {
      try {
        const testClient = new pg.Client({ connectionString: DATABASE_URL });
        await testClient.connect();
        await testClient.end();
        ready = true;
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
    assert.ok(ready, "Database ready after restart");

    // Reconnect
    client = new pg.Client({ connectionString: DATABASE_URL });
    await client.connect();
    sql = postgres(DATABASE_URL, { max: 5 });
    db = drizzle(sql, { schema });

    const after = await client.query("SELECT COUNT(*) as cnt FROM fms_raw_telemetry WHERE unit LIKE 'ISO-%'");
    const countAfter = parseInt(after.rows[0].cnt);
    assert.equal(countAfter, countBefore, `Row count preserved: ${countBefore} → ${countAfter}`);

    // Verify specific data survived
    const unitCheck = await client.query(
      "SELECT DISTINCT unit FROM fms_raw_telemetry WHERE unit LIKE 'ISO-%' ORDER BY unit"
    );
    assert.ok(unitCheck.rows.length >= 2, "Test units survived restart");

    console.log(`  ✓ T9 PASS — Data survives container restart (${countAfter} telemetry rows)`);
  });

  // ─── T10: CCR READ CONSISTENCY ──────────────────────────────────
  test("T10: CCR read consistency — writes visible immediately", async () => {
    const uniqueUnit = `CCR-${Date.now()}`;

    // Write
    await db.insert(schema.fmsUnits).values({
      id: crypto.randomUUID(),
      unit: uniqueUnit,
      tipeUnit: "Excavator",
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Read immediately (same connection)
    const found = await db
      .select()
      .from(schema.fmsUnits)
      .where(eq(schema.fmsUnits.unit, uniqueUnit));

    assert.equal(found.length, 1);
    assert.equal(found[0].unit, uniqueUnit);
    assert.equal(found[0].tipeUnit, "Excavator");

    // Read from raw SQL (different connection)
    const rawFound = await client.query(
      "SELECT unit, tipe_unit FROM fms_units WHERE unit = $1",
      [uniqueUnit]
    );
    assert.equal(rawFound.rows.length, 1);
    assert.equal(rawFound.rows[0].unit, uniqueUnit);

    console.log(`  ✓ T10 PASS — Write-then-read consistent across connections`);
  });

  // ─── TEARDOWN ───────────────────────────────────────────────────
  after(async () => {
    // Clean up test data (keep schema, remove test rows)
    await client.query("DELETE FROM fms_raw_telemetry WHERE unit LIKE 'ISO-%' OR unit = 'DT-3055'");
    await client.query("DELETE FROM fms_canonical_events WHERE unit = 'DT-3055' OR event_id LIKE 'dup-test-%'");
    await client.query("DELETE FROM fms_shift_assignments WHERE created_by = 'test'");
    await client.query("DELETE FROM fms_p2h_checks WHERE unit = 'DT-3055'");
    await client.query("DELETE FROM fms_units WHERE unit LIKE 'ISO-%' OR unit LIKE 'CCR-%' OR unit LIKE 'DUP-TEST-%'");
    await client.end();
    await sql.end();
    console.log("\n  🧹 Test data cleaned up");
  });
});
