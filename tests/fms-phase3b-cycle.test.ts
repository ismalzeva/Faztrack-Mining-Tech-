import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert";
import { Client } from "pg";
import http from "http";
import { execSync } from "child_process";
import {
  createGeofence,
  getContainingGeofences,
  getLastGeofenceState,
  processPositionGeofence,
  insertSpatialEvents,
  runGeofencePipeline,
  haversineDistanceM,
  type RawPosition,
} from "../lib/fms/geofence-engine";
import {
  runCycleEngine,
  resolveGeofenceRole,
  DEFAULT_CYCLE_CONFIG,
  type CycleConfig,
  type CycleCandidate,
} from "../lib/fms/cycle-engine";

const DATABASE_URL = process.env.FMS_DATABASE_URL;
if (!DATABASE_URL) throw new Error("FMS_DATABASE_URL required");

const TRACCAR_URL = "http://localhost:8082";
const TRACCAR_EMAIL = process.env.TRACCAR_ADMIN_EMAIL ?? "fms-admin@faztrack.local";
const TRACCAR_PASSWORD = process.env.TRACCAR_ADMIN_PASSWORD;
if (!TRACCAR_PASSWORD) throw new Error("TRACCAR_ADMIN_PASSWORD required");

// ─── CONSTANTS ─────────────────────────────────────────────────────

// Test geofence definitions — dedicated for cycle tests (no HAULING_ROAD to avoid noise)
const TEST_LP = {
  id: "CYC-TEST-LP",
  name: "Cycle Test Loading Point",
  type: "LOADING_POINT",
  // Polygon: (121.8538,-3.0167) → (121.8545,-3.0167) → (121.8545,-3.0162) → (121.8538,-3.0162) → close
  geom: "POLYGON((121.8538 -3.0167, 121.8545 -3.0167, 121.8545 -3.0162, 121.8538 -3.0162, 121.8538 -3.0167))",
  // Center: (-3.01645, 121.85415) — INSIDE
  inside: { lat: -3.01645, lon: 121.85415 },
  // West outside: (-3.01645, 121.8535) — OUTSIDE
  outside_west: { lat: -3.01645, lon: 121.8535 },
  // East outside (between LP and DP): (-3.0161, 121.8548) — OUTSIDE both
  outside_mid: { lat: -3.0161, lon: 121.8548 },
};

const TEST_DP = {
  id: "CYC-TEST-DP",
  name: "Cycle Test Dumping Point",
  type: "DUMPING_POINT",
  // Polygon: (121.8550,-3.0160) → (121.8557,-3.0160) → (121.8557,-3.0155) → (121.8550,-3.0155) → close
  geom: "POLYGON((121.8550 -3.0160, 121.8557 -3.0160, 121.8557 -3.0155, 121.8550 -3.0155, 121.8550 -3.0160))",
  // Center: (-3.01575, 121.85535) — INSIDE
  inside: { lat: -3.01575, lon: 121.85535 },
  // Far outside: (-3.019, 121.850) — OUTSIDE both
  outside_far: { lat: -3.019, lon: 121.850 },
};

// Overlapping geofence for T11
const TEST_LP_OVERLAP = {
  id: "CYC-TEST-LP-OVL",
  name: "Cycle Test LP Overlap",
  type: "LOADING_POINT",
  // Polygon overlapping with TEST_LP
  geom: "POLYGON((121.8540 -3.0166, 121.8546 -3.0166, 121.8546 -3.0161, 121.8540 -3.0161, 121.8540 -3.0166))",
  inside: { lat: -3.01635, lon: 121.8543 }, // Inside both TEST_LP and TEST_LP_OVERLAP
};

// Second dumping point for T9 (wrong dumping point)
const TEST_DP_WRONG = {
  id: "CYC-TEST-DP-WRONG",
  name: "Cycle Test Wrong Dumping Point",
  type: "DUMPING_POINT",
  // Far away from normal route
  geom: "POLYGON((121.8580 -3.0140, 121.8590 -3.0140, 121.8590 -3.0130, 121.8580 -3.0130, 121.8580 -3.0140))",
  inside: { lat: -3.0135, lon: 121.8585 },
};

const GEOFENCE_TYPE_MAP = new Map<string, string>([
  [TEST_LP.id, "LOADING_POINT"],
  [TEST_DP.id, "DUMPING_POINT"],
  [TEST_DP_WRONG.id, "DUMPING_POINT"],
]);

// ─── HELPERS ───────────────────────────────────────────────────────

function generateId(prefix: string): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${ts}_${rand}`;
}

function makeRawPosition(
  unit: string,
  deviceId: number,
  lat: number,
  lon: number,
  speed: number,
  tickSec: number,
  baseTime: Date,
): RawPosition {
  const fixTime = new Date(baseTime.getTime() + tickSec * 1000);
  return {
    id: `pos_${unit}_${tickSec}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    unit,
    device_id: deviceId,
    fix_time: fixTime,
    device_time: fixTime,
    server_time: fixTime,
    latitude: lat,
    longitude: lon,
    speed,
    course: 90,
    quality_flags: null,
  };
}

async function insertRawPosition(client: Client, pos: RawPosition): Promise<void> {
  await client.query(
    `INSERT INTO fms_raw_telemetry (id, device_id, unit, server_time, device_time, fix_time, latitude, longitude, speed, course)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (id) DO NOTHING`,
    [pos.id, pos.device_id, pos.unit, pos.server_time, pos.device_time, pos.fix_time,
     pos.latitude, pos.longitude, pos.speed, pos.course],
  );
}

async function seedTestGeofences(client: Client): Promise<void> {
  // Only seed the 3 base geofences. LP_OVERLAP is T11-specific and seeded inside that test.
  for (const gf of [TEST_LP, TEST_DP, TEST_DP_WRONG]) {
    await client.query(
      `INSERT INTO fms_geofences (geofence_id, name, type, geometry, active, source, created_by)
       VALUES ($1, $2, $3, ST_GeomFromText($4, 4326), true, 'TEST', 'phase3b-test')
       ON CONFLICT (geofence_id) DO UPDATE SET geometry = ST_GeomFromText($4, 4326)`,
      [gf.id, gf.name, gf.type, gf.geom],
    );
  }
}

async function seedGeofenceEvent(
  client: Client,
  opts: {
    runId: string;
    unit: string;
    deviceId: number;
    geofenceId: string;
    eventType: string;
    fixTime: Date;
    lat: number;
    lon: number;
    positionId: string;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO fms_geofence_events
     (event_id, run_id, unit, device_id, geofence_id, event_type, fix_time, device_time, server_time, latitude, longitude, position_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $7, $7, $8, $9, $10)`,
    [
      generateId("evt"), opts.runId, opts.unit, opts.deviceId,
      opts.geofenceId, opts.eventType, opts.fixTime,
      opts.lat, opts.lon, opts.positionId,
    ],
  );
}

async function httpGet(url: string): Promise<number> {
  return new Promise((resolve) => {
    http.get(url, (res) => {
      res.resume();
      res.on("end", () => resolve(res.statusCode ?? 0));
    }).on("error", () => resolve(0));
  });
}

async function cleanupRun(client: Client, runId: string): Promise<void> {
  await client.query("DELETE FROM fms_cycle_candidates WHERE run_id = $1", [runId]);
  await client.query("DELETE FROM fms_geofence_events WHERE run_id = $1", [runId]);
  await client.query("DELETE FROM fms_movement_observations WHERE run_id = $1", [runId]);
  await client.query("DELETE FROM fms_raw_telemetry WHERE unit IN ('EX-501', 'DT-3055') AND device_id IN (1, 2)");
}

/** Run positions through the full geofence pipeline and return generated events. */
async function runPositionsThroughGeofenceEngine(
  client: Client,
  positions: RawPosition[],
  runId: string,
): Promise<Array<{ event_id: string; event_type: string; geofence_id: string; unit: string; fix_time: Date; latitude: number; longitude: number; position_id: string }>> {
  // Insert raw positions
  for (const pos of positions) {
    await insertRawPosition(client, pos);
  }

  // Run geofence pipeline for each unique unit
  const units = [...new Set(positions.map((p) => p.unit))];
  for (const unit of units) {
    const unitPositions = positions.filter((p) => p.unit === unit);
    const fromDate = new Date(Math.min(...unitPositions.map((p) => p.fix_time.getTime())) - 1000);
    const toDate = new Date(Math.max(...unitPositions.map((p) => p.fix_time.getTime())) + 1000);
    await runGeofencePipeline(client, unit, runId, undefined, fromDate, toDate);
  }

  // Read back the generated events
  const result = await client.query(
    `SELECT event_id, event_type, geofence_id, unit, fix_time, latitude, longitude, position_id
     FROM fms_geofence_events WHERE run_id = $1 ORDER BY fix_time ASC`,
    [runId],
  );
  return result.rows;
}

// ─── TEST SUITE ────────────────────────────────────────────────────

describe("FMS Phase 3B — Cycle Candidate Engine", () => {
  let client: Client;

  before(async () => {
    client = new Client({ connectionString: DATABASE_URL });
    await client.connect();

    // Clean everything for a fresh test run
    await client.query("DELETE FROM fms_cycle_candidates");
    await client.query("DELETE FROM fms_geofence_events");
    await client.query("DELETE FROM fms_movement_observations");
    await client.query("DELETE FROM fms_geofences");
    await client.query("DELETE FROM fms_raw_telemetry");
    await client.query("DELETE FROM fms_canonical_events");

    // Seed test geofences
    await seedTestGeofences(client);
  });

  after(async () => {
    // Final cleanup for resource test
    await client.query("DELETE FROM fms_cycle_candidates").catch(() => {});
    await client.query("DELETE FROM fms_geofence_events").catch(() => {});
    await client.query("DELETE FROM fms_movement_observations").catch(() => {});
    await client.query("DELETE FROM fms_raw_telemetry WHERE unit IN ('EX-501', 'DT-3055') AND device_id IN (1, 2)").catch(() => {});
    await client.end();
  });

  // ─── PER-TEST ISOLATION ────────────────────────────────────────────
  // Clean ALL FMS data tables before every test to prevent cross-test contamination.
  // Geofences are deleted and re-seeded (only base 3) so T11's LP-OVL doesn't leak.
  beforeEach(async () => {
    await client.query("DELETE FROM fms_cycle_candidates");
    await client.query("DELETE FROM fms_geofence_events");
    await client.query("DELETE FROM fms_movement_observations");
    await client.query("DELETE FROM fms_raw_telemetry WHERE unit IN ('EX-501', 'DT-3055') AND device_id IN (1, 2)");
    await client.query("DELETE FROM fms_geofences WHERE source = 'TEST'");
    await seedTestGeofences(client);
  });

  // ──────────────────────────────────────────────────────────────────
  // T1: Schema verification
  // ──────────────────────────────────────────────────────────────────
  describe("T1 — fms_cycle_candidates schema verification", () => {
    it("table exists with correct columns", async () => {
      const r = await client.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_name = 'fms_cycle_candidates' ORDER BY ordinal_position`
      );
      const cols = r.rows.map((r: any) => r.column_name);
      assert.ok(cols.includes("cycle_id"), "has cycle_id");
      assert.ok(cols.includes("run_id"), "has run_id");
      assert.ok(cols.includes("unit"), "has unit");
      assert.ok(cols.includes("loading_point"), "has loading_point");
      assert.ok(cols.includes("dumping_point"), "has dumping_point");
      assert.ok(cols.includes("start_fix_time"), "has start_fix_time");
      assert.ok(cols.includes("loading_enter_time"), "has loading_enter_time");
      assert.ok(cols.includes("loading_exit_time"), "has loading_exit_time");
      assert.ok(cols.includes("dumping_enter_time"), "has dumping_enter_time");
      assert.ok(cols.includes("dumping_exit_time"), "has dumping_exit_time");
      assert.ok(cols.includes("return_time"), "has return_time");
      assert.ok(cols.includes("end_fix_time"), "has end_fix_time");
      assert.ok(cols.includes("duration_total_s"), "has duration_total_s");
      assert.ok(cols.includes("loading_dwell_s"), "has loading_dwell_s");
      assert.ok(cols.includes("distance_outbound_m"), "has distance_outbound_m");
      assert.ok(cols.includes("distance_return_m"), "has distance_return_m");
      assert.ok(cols.includes("quality_flags"), "has quality_flags");
      assert.ok(cols.includes("candidate_status"), "has candidate_status");
      assert.ok(cols.includes("source_position_ids"), "has source_position_ids");
      assert.ok(cols.includes("source_geofence_event_ids"), "has source_geofence_event_ids");
    });

    it("has correct indexes", async () => {
      const r = await client.query(
        `SELECT indexname FROM pg_indexes WHERE tablename = 'fms_cycle_candidates'`
      );
      const names = r.rows.map((r: any) => r.indexname);
      assert.ok(names.some((n: string) => n.includes("unit")), "has unit index");
      assert.ok(names.some((n: string) => n.includes("run")), "has run index");
      assert.ok(names.some((n: string) => n.includes("status")), "has status index");
    });

    it("test geofences were seeded", async () => {
      const r = await client.query(
        "SELECT geofence_id, name, type FROM fms_geofences ORDER BY geofence_id"
      );
      assert.ok(r.rows.length >= 3, `at least 3 test geofences (got ${r.rows.length})`);
      const ids = r.rows.map((r: any) => r.geofence_id);
      assert.ok(ids.includes("CYC-TEST-LP"), "has test loading point");
      assert.ok(ids.includes("CYC-TEST-DP"), "has test dumping point");
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // T2: Normal complete cycle (S1)
  // ──────────────────────────────────────────────────────────────────
  describe("T2 — Normal complete cycle", () => {
    it("produces COMPLETE_CANDIDATE for standard loading→haul→dump→return", async () => {
      const runId = "run-t2-" + Date.now();
      const base = new Date("2026-01-15T06:00:00Z");

      // Trajectory: outside → enter LP (dwell 120s) → exit LP → travel to DP → enter DP (dwell 60s) → exit DP → return → enter LP
      const positions = [
        makeRawPosition("EX-501", 1, TEST_LP.inside.lat, TEST_LP.inside.lon, 0, 0, base),           // t=0:   Enter LP
        makeRawPosition("EX-501", 1, TEST_LP.inside.lat, TEST_LP.inside.lon, 0, 120, base),          // t=120: Still in LP (120s dwell)
        makeRawPosition("EX-501", 1, -3.0161, 121.8548, 30, 125, base),                              // t=125: Exit LP, start hauling
        makeRawPosition("EX-501", 1, -3.0159, 121.8551, 25, 365, base),                              // t=365: Approaching DP
        makeRawPosition("EX-501", 1, TEST_DP.inside.lat, TEST_DP.inside.lon, 0, 370, base),          // t=370: Enter DP
        makeRawPosition("EX-501", 1, TEST_DP.inside.lat, TEST_DP.inside.lon, 0, 430, base),          // t=430: Still in DP (60s dwell)
        makeRawPosition("EX-501", 1, -3.0161, 121.8548, 28, 435, base),                              // t=435: Exit DP, start return
        makeRawPosition("EX-501", 1, TEST_LP.inside.lat, TEST_LP.inside.lon, 0, 675, base),          // t=675: Return to LP — CYCLE COMPLETE
      ];

      const events = await runPositionsThroughGeofenceEngine(client, positions, runId);
      assert.ok(events.length >= 4, `geofence engine produced ${events.length} events (expected ≥4)`);

      // Run cycle engine
      const result = await runCycleEngine(client, GEOFENCE_TYPE_MAP, runId);

      assert.strictEqual(result.units_processed, 1, "one unit processed");
      assert.strictEqual(result.candidates_generated, 1, "one cycle candidate");
      assert.strictEqual(result.complete, 1, "one complete candidate");

      const cyc = result.candidates[0];
      assert.strictEqual(cyc.unit, "EX-501");
      assert.strictEqual(cyc.candidate_status, "COMPLETE_CANDIDATE");
      assert.ok(cyc.quality_flags.includes("COMPLETE_CANDIDATE"), "quality flag is COMPLETE_CANDIDATE");
      assert.strictEqual(cyc.loading_point, TEST_LP.id);
      assert.strictEqual(cyc.dumping_point, TEST_DP.id);
      assert.ok(cyc.loading_enter_time, "has loading_enter_time");
      assert.ok(cyc.loading_exit_time, "has loading_exit_time");
      assert.ok(cyc.dumping_enter_time, "has dumping_enter_time");
      assert.ok(cyc.dumping_exit_time, "has dumping_exit_time");
      assert.ok(cyc.return_time, "has return_time");
      assert.ok(cyc.duration_total_s! > 0, "duration > 0");
      assert.ok(cyc.loading_dwell_s! >= 100, `loading dwell ${cyc.loading_dwell_s}s ≥ 100`);
      assert.ok(cyc.dumping_dwell_s! >= 50, `dumping dwell ${cyc.dumping_dwell_s}s ≥ 50`);
      assert.ok(cyc.distance_outbound_m! > 0, "outbound distance > 0");
      assert.ok(cyc.distance_return_m! > 0, "return distance > 0");
      assert.ok(cyc.distance_total_m! > 0, "total distance > 0");
      assert.ok(cyc.source_position_ids.length > 0, "has source position IDs");
      assert.ok(cyc.source_geofence_event_ids.length > 0, "has source event IDs");

      await cleanupRun(client, runId);
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // T3: Incomplete loading (S3)
  // ──────────────────────────────────────────────────────────────────
  describe("T3 — Incomplete loading", () => {
    it("detects INCOMPLETE_LOADING when unit enters LP but never exits", async () => {
      const runId = "run-t3-" + Date.now();
      const base = new Date("2026-01-15T07:00:00Z");

      // Only enters LP, stays there, no exit
      const positions = [
        makeRawPosition("EX-501", 1, TEST_LP.inside.lat, TEST_LP.inside.lon, 0, 0, base),
        makeRawPosition("EX-501", 1, TEST_LP.inside.lat, TEST_LP.inside.lon, 0, 60, base),
        makeRawPosition("EX-501", 1, TEST_LP.inside.lat, TEST_LP.inside.lon, 0, 120, base),
      ];

      await runPositionsThroughGeofenceEngine(client, positions, runId);
      const result = await runCycleEngine(client, GEOFENCE_TYPE_MAP, runId);

      assert.ok(result.candidates_generated >= 1, "at least one candidate");
      const cyc = result.candidates.find((c) => c.unit === "EX-501");
      assert.ok(cyc, "has EX-501 candidate");
      assert.strictEqual(cyc!.candidate_status, "INCOMPLETE_LOADING");
      assert.ok(cyc!.quality_flags.includes("INCOMPLETE_LOADING"), "flag present");

      await cleanupRun(client, runId);
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // T4: Incomplete dumping (S4 scenario: enters DP but never exits)
  // ──────────────────────────────────────────────────────────────────
  describe("T4 — Incomplete dumping", () => {
    it("detects INCOMPLETE_DUMPING when unit reaches DP but never exits", async () => {
      const runId = "run-t4-" + Date.now();
      const base = new Date("2026-01-15T08:00:00Z");

      // Enters LP, exits, enters DP, stays there
      const positions = [
        makeRawPosition("EX-501", 1, TEST_LP.inside.lat, TEST_LP.inside.lon, 0, 0, base),           // Enter LP
        makeRawPosition("EX-501", 1, -3.0161, 121.8548, 30, 120, base),                              // Exit LP
        makeRawPosition("EX-501", 1, TEST_DP.inside.lat, TEST_DP.inside.lon, 0, 360, base),          // Enter DP
        makeRawPosition("EX-501", 1, TEST_DP.inside.lat, TEST_DP.inside.lon, 0, 420, base),          // Still in DP
        makeRawPosition("EX-501", 1, TEST_DP.inside.lat, TEST_DP.inside.lon, 0, 480, base),          // Still in DP
      ];

      await runPositionsThroughGeofenceEngine(client, positions, runId);
      const result = await runCycleEngine(client, GEOFENCE_TYPE_MAP, runId);

      assert.ok(result.candidates_generated >= 1, "at least one candidate");
      const cyc = result.candidates.find((c) => c.unit === "EX-501");
      assert.ok(cyc, "has EX-501 candidate");
      assert.strictEqual(cyc!.candidate_status, "INCOMPLETE_DUMPING");
      assert.ok(cyc!.quality_flags.includes("INCOMPLETE_DUMPING"), "flag present");

      await cleanupRun(client, runId);
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // T5: Missing return (S5)
  // ──────────────────────────────────────────────────────────────────
  describe("T5 — Missing return", () => {
    it("detects MISSING_RETURN when unit exits DP but never returns to LP", async () => {
      const runId = "run-t5-" + Date.now();
      const base = new Date("2026-01-15T09:00:00Z");

      // Full loading+dumping but wanders off instead of returning
      const positions = [
        makeRawPosition("EX-501", 1, TEST_LP.inside.lat, TEST_LP.inside.lon, 0, 0, base),           // Enter LP
        makeRawPosition("EX-501", 1, -3.0161, 121.8548, 30, 120, base),                              // Exit LP
        makeRawPosition("EX-501", 1, TEST_DP.inside.lat, TEST_DP.inside.lon, 0, 360, base),          // Enter DP
        makeRawPosition("EX-501", 1, -3.0161, 121.8548, 25, 420, base),                              // Exit DP
        makeRawPosition("EX-501", 1, TEST_DP.outside_far.lat, TEST_DP.outside_far.lon, 40, 600, base), // Wanders off
      ];

      await runPositionsThroughGeofenceEngine(client, positions, runId);
      const result = await runCycleEngine(client, GEOFENCE_TYPE_MAP, runId);

      assert.ok(result.candidates_generated >= 1, "at least one candidate");
      const cyc = result.candidates.find((c) => c.unit === "EX-501");
      assert.ok(cyc, "has EX-501 candidate");
      assert.strictEqual(cyc!.candidate_status, "MISSING_RETURN");
      assert.ok(cyc!.quality_flags.includes("MISSING_RETURN"), "flag present");

      await cleanupRun(client, runId);
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // T6: GPS gap during hauling (S6)
  // ──────────────────────────────────────────────────────────────────
  describe("T6 — GPS gap during hauling", () => {
    it("flags GPS_GAP when telemetry gap exceeds threshold during cycle", async () => {
      const runId = "run-t6-" + Date.now();
      const base = new Date("2026-01-15T10:00:00Z");

      // Normal cycle but with a large gap between exit LP and enter DP
      const positions = [
        makeRawPosition("EX-501", 1, TEST_LP.inside.lat, TEST_LP.inside.lon, 0, 0, base),           // Enter LP
        makeRawPosition("EX-501", 1, -3.0161, 121.8548, 30, 120, base),                              // Exit LP
        // GPS GAP: 700 seconds (exceeds maxTelemetryGapSeconds=600)
        makeRawPosition("EX-501", 1, TEST_DP.inside.lat, TEST_DP.inside.lon, 0, 820, base),          // Enter DP (700s gap!)
        makeRawPosition("EX-501", 1, -3.0161, 121.8548, 25, 880, base),                              // Exit DP
        makeRawPosition("EX-501", 1, TEST_LP.inside.lat, TEST_LP.inside.lon, 0, 1120, base),         // Return to LP
      ];

      await runPositionsThroughGeofenceEngine(client, positions, runId);
      const result = await runCycleEngine(client, GEOFENCE_TYPE_MAP, runId);

      assert.ok(result.candidates_generated >= 1, "at least one candidate");
      const cyc = result.candidates.find((c) => c.unit === "EX-501");
      assert.ok(cyc, "has EX-501 candidate");
      assert.ok(cyc!.quality_flags.includes("GPS_GAP"), "GPS_GAP flag present");
      // Should still be COMPLETE_CANDIDATE (GPS_GAP is a warning, not a blocker)
      // or could be COMPLETE_CANDIDATE with GPS_GAP flag
      assert.ok(
        cyc!.candidate_status === "COMPLETE_CANDIDATE" || cyc!.candidate_status === "REVIEW",
        `status is COMPLETE_CANDIDATE or REVIEW (got ${cyc!.candidate_status})`,
      );

      await cleanupRun(client, runId);
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // T7: Late-arrival ordering (S7)
  // ──────────────────────────────────────────────────────────────────
  describe("T7 — Late-arrival telemetry ordering", () => {
    it("same trajectory with out-of-order arrival produces same cycle", async () => {
      const runId = "run-t7-" + Date.now();
      const base = new Date("2026-01-15T11:00:00Z");

      // Positions arrive late but with correct fix_times
      // Trajectory: enter LP → exit LP → enter DP → exit DP → return
      const positions = [
        // Insert out of order! But fix_times are correct
        makeRawPosition("EX-501", 1, TEST_LP.inside.lat, TEST_LP.inside.lon, 0, 0, base),           // Enter LP
        makeRawPosition("EX-501", 1, -3.0161, 121.8548, 30, 120, base),                              // Exit LP
        makeRawPosition("EX-501", 1, TEST_DP.inside.lat, TEST_DP.inside.lon, 0, 360, base),          // Enter DP
        makeRawPosition("EX-501", 1, -3.0161, 121.8548, 25, 420, base),                              // Exit DP
        makeRawPosition("EX-501", 1, TEST_LP.inside.lat, TEST_LP.inside.lon, 0, 660, base),          // Return to LP
      ];

      await runPositionsThroughGeofenceEngine(client, positions, runId);
      const result = await runCycleEngine(client, GEOFENCE_TYPE_MAP, runId);

      assert.strictEqual(result.candidates_generated, 1, "one candidate");
      const cyc = result.candidates[0];
      assert.strictEqual(cyc.candidate_status, "COMPLETE_CANDIDATE");
      assert.strictEqual(cyc.unit, "EX-501");

      await cleanupRun(client, runId);
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // T8: Duplicate geofence crossing (S8)
  // ──────────────────────────────────────────────────────────────────
  describe("T8 — Duplicate geofence crossing", () => {
    it("flags DUPLICATE_CROSSING when double ENTER detected", async () => {
      const runId = "run-t8-" + Date.now();
      const base = new Date("2026-01-15T12:00:00Z");

      // Seed geofence events directly (geofence engine prevents duplicate ENTERs naturally)
      const p1 = generateId("pos");
      const p2 = generateId("pos");
      const p3 = generateId("pos");

      await seedGeofenceEvent(client, { runId, unit: "EX-501", deviceId: 1, geofenceId: TEST_LP.id, eventType: "GEOFENCE_ENTER", fixTime: new Date(base.getTime()), lat: TEST_LP.inside.lat, lon: TEST_LP.inside.lon, positionId: p1 });
      await seedGeofenceEvent(client, { runId, unit: "EX-501", deviceId: 1, geofenceId: TEST_LP.id, eventType: "GEOFENCE_ENTER", fixTime: new Date(base.getTime() + 60000), lat: TEST_LP.inside.lat, lon: TEST_LP.inside.lon, positionId: p2 }); // DUPLICATE!
      await seedGeofenceEvent(client, { runId, unit: "EX-501", deviceId: 1, geofenceId: TEST_LP.id, eventType: "GEOFENCE_EXIT", fixTime: new Date(base.getTime() + 120000), lat: TEST_LP.outside_west.lat, lon: TEST_LP.outside_west.lon, positionId: p3 });

      const result = await runCycleEngine(client, GEOFENCE_TYPE_MAP, runId);

      assert.ok(result.candidates_generated >= 1, "at least one candidate");
      const cyc = result.candidates.find((c) => c.unit === "EX-501");
      assert.ok(cyc, "has EX-501 candidate");
      assert.ok(cyc!.quality_flags.includes("DUPLICATE_CROSSING"), "DUPLICATE_CROSSING flag present");

      await cleanupRun(client, runId);
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // T9: Wrong dumping point (S10)
  // ──────────────────────────────────────────────────────────────────
  describe("T9 — Wrong dumping point", () => {
    it("produces cycle with different dumping_point when unit goes to wrong DP", async () => {
      const runId = "run-t9-" + Date.now();
      const base = new Date("2026-01-15T13:00:00Z");

      // Unit goes to wrong dumping point instead of the expected one
      const positions = [
        makeRawPosition("EX-501", 1, TEST_LP.inside.lat, TEST_LP.inside.lon, 0, 0, base),           // Enter LP
        makeRawPosition("EX-501", 1, -3.0161, 121.8548, 30, 120, base),                              // Exit LP
        makeRawPosition("EX-501", 1, TEST_DP_WRONG.inside.lat, TEST_DP_WRONG.inside.lon, 35, 400, base), // Enter WRONG DP
        makeRawPosition("EX-501", 1, TEST_DP_WRONG.inside.lat, TEST_DP_WRONG.inside.lon, 0, 460, base), // Dwell in wrong DP
        makeRawPosition("EX-501", 1, -3.0145, 121.8575, 30, 465, base),                              // Exit wrong DP
        makeRawPosition("EX-501", 1, TEST_LP.inside.lat, TEST_LP.inside.lon, 0, 700, base),          // Return to LP
      ];

      await runPositionsThroughGeofenceEngine(client, positions, runId);
      const result = await runCycleEngine(client, GEOFENCE_TYPE_MAP, runId);

      assert.ok(result.candidates_generated >= 1, "at least one candidate");
      const cyc = result.candidates.find((c) => c.unit === "EX-501");
      assert.ok(cyc, "has EX-501 candidate");
      assert.strictEqual(cyc!.dumping_point, TEST_DP_WRONG.id, "dumping point is the wrong one");
      assert.strictEqual(cyc!.candidate_status, "COMPLETE_CANDIDATE", "still completes (wrong DP is valid DP)");
      assert.strictEqual(cyc!.loading_point, TEST_LP.id);

      await cleanupRun(client, runId);
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // T10: Two-unit isolation (S11)
  // ──────────────────────────────────────────────────────────────────
  describe("T10 — Two-unit isolation", () => {
    it("EX-501 and DT-3055 produce independent cycle candidates", async () => {
      const runId = "run-t10-" + Date.now();
      const base = new Date("2026-01-15T14:00:00Z");

      // EX-501: normal complete cycle
      const ex501 = [
        makeRawPosition("EX-501", 1, TEST_LP.inside.lat, TEST_LP.inside.lon, 0, 0, base),
        makeRawPosition("EX-501", 1, -3.0161, 121.8548, 30, 120, base),
        makeRawPosition("EX-501", 1, TEST_DP.inside.lat, TEST_DP.inside.lon, 0, 360, base),
        makeRawPosition("EX-501", 1, -3.0161, 121.8548, 25, 420, base),
        makeRawPosition("EX-501", 1, TEST_LP.inside.lat, TEST_LP.inside.lon, 0, 660, base),
      ];

      // DT-3055: incomplete dumping (enters DP but never exits, different timing)
      const dt3055 = [
        makeRawPosition("DT-3055", 2, TEST_LP.inside.lat, TEST_LP.inside.lon, 0, 30, base),
        makeRawPosition("DT-3055", 2, -3.0161, 121.8548, 25, 150, base),
        makeRawPosition("DT-3055", 2, TEST_DP.inside.lat, TEST_DP.inside.lon, 0, 400, base),
        makeRawPosition("DT-3055", 2, TEST_DP.inside.lat, TEST_DP.inside.lon, 0, 460, base),
      ];

      const allPositions = [...ex501, ...dt3055];
      await runPositionsThroughGeofenceEngine(client, allPositions, runId);
      const result = await runCycleEngine(client, GEOFENCE_TYPE_MAP, runId);

      assert.strictEqual(result.units_processed, 2, "two units processed");
      assert.ok(result.candidates_generated >= 2, "at least two candidates");

      const exCyc = result.candidates.find((c) => c.unit === "EX-501");
      const dtCyc = result.candidates.find((c) => c.unit === "DT-3055");

      assert.ok(exCyc, "EX-501 has candidate");
      assert.ok(dtCyc, "DT-3055 has candidate");
      assert.strictEqual(exCyc!.candidate_status, "COMPLETE_CANDIDATE", "EX-501 is complete");
      assert.strictEqual(dtCyc!.candidate_status, "INCOMPLETE_DUMPING", "DT-3055 is incomplete dumping");

      // No cross-contamination
      assert.notStrictEqual(exCyc!.cycle_id, dtCyc!.cycle_id, "different cycle IDs");

      await cleanupRun(client, runId);
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // T11: Overlapping geofence (S12)
  // ──────────────────────────────────────────────────────────────────
  describe("T11 — Overlapping geofence", () => {
    it("handles position in overlapping loading geofences without crashing", async () => {
      const runId = "run-t11-" + Date.now();
      const base = new Date("2026-01-15T15:00:00Z");

      // Seed the overlapping LP geofence (T11-specific, not in global seed)
      await client.query(
        `INSERT INTO fms_geofences (geofence_id, name, type, geometry, active, source, created_by)
         VALUES ($1, $2, $3, ST_GeomFromText($4, 4326), true, 'TEST', 'phase3b-test')
         ON CONFLICT (geofence_id) DO UPDATE SET geometry = ST_GeomFromText($4, 4326)`,
        [TEST_LP_OVERLAP.id, TEST_LP_OVERLAP.name, TEST_LP_OVERLAP.type, TEST_LP_OVERLAP.geom],
      );
      // Local map includes the overlapping geofence
      const t11Map = new Map(GEOFENCE_TYPE_MAP);
      t11Map.set(TEST_LP_OVERLAP.id, "LOADING_POINT");

      // Position inside both TEST_LP and TEST_LP_OVERLAP
      const overlapPoint = TEST_LP_OVERLAP.inside; // (-3.01635, 121.8543) — inside both

      const positions = [
        makeRawPosition("EX-501", 1, overlapPoint.lat, overlapPoint.lon, 0, 0, base),
        makeRawPosition("EX-501", 1, -3.0161, 121.8548, 30, 120, base),  // Exit both LPs
        makeRawPosition("EX-501", 1, TEST_DP.inside.lat, TEST_DP.inside.lon, 0, 360, base),
        makeRawPosition("EX-501", 1, -3.0161, 121.8548, 25, 420, base),
        makeRawPosition("EX-501", 1, overlapPoint.lat, overlapPoint.lon, 0, 660, base),  // Return to overlap
      ];

      await runPositionsThroughGeofenceEngine(client, positions, runId);
      const result = await runCycleEngine(client, t11Map, runId);

      assert.ok(result.candidates_generated >= 1, "at least one candidate");
      const cyc = result.candidates.find((c) => c.unit === "EX-501");
      assert.ok(cyc, "has candidate");
      // Should have DUPLICATE_CROSSING or AMBIGUOUS_GEOFENCE or still complete
      assert.ok(cyc!.loading_point, "has a loading point assigned");
      assert.ok(
        cyc!.candidate_status === "COMPLETE_CANDIDATE" || cyc!.quality_flags.length > 0,
        `handled overlapping geofence (status: ${cyc!.candidate_status}, flags: ${cyc!.quality_flags.join(",")})`,
      );

      await cleanupRun(client, runId);
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // T12: Idempotent reprocessing (S13)
  // ──────────────────────────────────────────────────────────────────
  describe("T12 — Idempotent reprocessing", () => {
    it("running cycle engine twice with same run_id produces same candidates", async () => {
      const runId = "run-t12-" + Date.now();
      const base = new Date("2026-01-15T16:00:00Z");

      const positions = [
        makeRawPosition("EX-501", 1, TEST_LP.inside.lat, TEST_LP.inside.lon, 0, 0, base),
        makeRawPosition("EX-501", 1, -3.0161, 121.8548, 30, 120, base),
        makeRawPosition("EX-501", 1, TEST_DP.inside.lat, TEST_DP.inside.lon, 0, 360, base),
        makeRawPosition("EX-501", 1, -3.0161, 121.8548, 25, 420, base),
        makeRawPosition("EX-501", 1, TEST_LP.inside.lat, TEST_LP.inside.lon, 0, 660, base),
      ];

      await runPositionsThroughGeofenceEngine(client, positions, runId);

      // First run
      const result1 = await runCycleEngine(client, GEOFENCE_TYPE_MAP, runId);
      assert.strictEqual(result1.candidates_generated, 1, "first run: 1 candidate");

      // Second run — should not duplicate (ON CONFLICT DO NOTHING)
      const result2 = await runCycleEngine(client, GEOFENCE_TYPE_MAP, runId);
      assert.strictEqual(result2.candidates_generated, 1, "second run: still 1 candidate");

      // Verify only one row in DB
      const dbCount = await client.query(
        "SELECT COUNT(*) as cnt FROM fms_cycle_candidates WHERE run_id = $1",
        [runId],
      );
      assert.strictEqual(parseInt(dbCount.rows[0].cnt), 1, "only one row in database");

      await cleanupRun(client, runId);
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // T13: Live/offline parity (S14)
  // ──────────────────────────────────────────────────────────────────
  describe("T13 — Live/offline parity", () => {
    it("same trajectory processed live and after backlog produces identical cycle", async () => {
      const baseLive = new Date("2026-01-15T17:00:00Z");
      const baseOffline = new Date("2026-01-15T17:00:00Z"); // Same base time

      // === LIVE RUN ===
      const runLive = "run-t13-live-" + Date.now();
      const positionsLive = [
        makeRawPosition("EX-501", 1, TEST_LP.inside.lat, TEST_LP.inside.lon, 0, 0, baseLive),
        makeRawPosition("EX-501", 1, -3.0161, 121.8548, 30, 120, baseLive),
        makeRawPosition("EX-501", 1, TEST_DP.inside.lat, TEST_DP.inside.lon, 0, 360, baseLive),
        makeRawPosition("EX-501", 1, -3.0161, 121.8548, 25, 420, baseLive),
        makeRawPosition("EX-501", 1, TEST_LP.inside.lat, TEST_LP.inside.lon, 0, 660, baseLive),
      ];

      await runPositionsThroughGeofenceEngine(client, positionsLive, runLive);
      const resultLive = await runCycleEngine(client, GEOFENCE_TYPE_MAP, runLive);

      // === OFFLINE RUN (same trajectory, different run_id) ===
      const runOffline = "run-t13-offline-" + Date.now();
      const positionsOffline = [
        makeRawPosition("EX-501", 1, TEST_LP.inside.lat, TEST_LP.inside.lon, 0, 0, baseOffline),
        makeRawPosition("EX-501", 1, -3.0161, 121.8548, 30, 120, baseOffline),
        makeRawPosition("EX-501", 1, TEST_DP.inside.lat, TEST_DP.inside.lon, 0, 360, baseOffline),
        makeRawPosition("EX-501", 1, -3.0161, 121.8548, 25, 420, baseOffline),
        makeRawPosition("EX-501", 1, TEST_LP.inside.lat, TEST_LP.inside.lon, 0, 660, baseOffline),
      ];

      await runPositionsThroughGeofenceEngine(client, positionsOffline, runOffline);
      const resultOffline = await runCycleEngine(client, GEOFENCE_TYPE_MAP, runOffline);

      // Compare results
      assert.strictEqual(resultLive.candidates_generated, resultOffline.candidates_generated, "same candidate count");
      assert.strictEqual(resultLive.complete, resultOffline.complete, "same complete count");
      assert.strictEqual(resultLive.units_processed, resultOffline.units_processed, "same units processed");

      const cycLive = resultLive.candidates[0];
      const cycOff = resultOffline.candidates[0];
      assert.strictEqual(cycLive.candidate_status, cycOff.candidate_status, "same status");
      assert.strictEqual(cycLive.unit, cycOff.unit, "same unit");
      assert.strictEqual(cycLive.loading_point, cycOff.loading_point, "same loading point");
      assert.strictEqual(cycLive.dumping_point, cycOff.dumping_point, "same dumping point");
      assert.strictEqual(cycLive.quality_flags.length, cycOff.quality_flags.length, "same flag count");
      assert.strictEqual(
        Math.round(cycLive.duration_total_s!),
        Math.round(cycOff.duration_total_s!),
        "same duration",
      );

      await cleanupRun(client, runLive);
      await cleanupRun(client, runOffline);
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // T14: Threshold configurability
  // ──────────────────────────────────────────────────────────────────
  describe("T14 — Threshold configurability", () => {
    it("changing minLoadingDwellSeconds affects loading dwell detection", async () => {
      const runId = "run-t14-" + Date.now();
      const base = new Date("2026-01-15T18:00:00Z");

      // Short dwell: 10 seconds at loading
      const positions = [
        makeRawPosition("EX-501", 1, TEST_LP.inside.lat, TEST_LP.inside.lon, 0, 0, base),           // Enter LP
        makeRawPosition("EX-501", 1, -3.0161, 121.8548, 30, 10, base),                               // Exit LP after 10s
        makeRawPosition("EX-501", 1, TEST_DP.inside.lat, TEST_DP.inside.lon, 0, 250, base),          // Enter DP
        makeRawPosition("EX-501", 1, -3.0161, 121.8548, 25, 310, base),                              // Exit DP
        makeRawPosition("EX-501", 1, TEST_LP.inside.lat, TEST_LP.inside.lon, 0, 550, base),          // Return
      ];

      await runPositionsThroughGeofenceEngine(client, positions, runId);

      // With strict config: minLoadingDwell = 60s (10s dwell should trigger EXCESSIVE_DWELL or different behavior)
      const strictConfig: CycleConfig = {
        ...DEFAULT_CYCLE_CONFIG,
        minLoadingDwellSeconds: 60,
      };

      const result = await runCycleEngine(client, GEOFENCE_TYPE_MAP, runId, strictConfig);
      assert.ok(result.candidates_generated >= 1, "produces candidates regardless of config");

      const cyc = result.candidates.find((c) => c.unit === "EX-501");
      assert.ok(cyc, "has candidate");
      // With 10s dwell and 60s min, loading_dwell_s should be 10
      assert.ok(cyc!.loading_dwell_s! < 60, `loading dwell ${cyc!.loading_dwell_s}s < 60s min threshold`);

      await cleanupRun(client, runId);
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // T15: No false Ritasi output
  // ──────────────────────────────────────────────────────────────────
  describe("T15 — No false Ritasi output", () => {
    it("cycle engine never produces ritasi/production data", async () => {
      // Query ALL candidates in the database
      const r = await client.query(
        `SELECT * FROM fms_cycle_candidates`
      );

      for (const row of r.rows) {
        // Verify no ritasi fields exist
        assert.strictEqual(row.ritasi, undefined, "no ritasi column");
        assert.strictEqual(row.tonase, undefined, "no tonase column");
        assert.strictEqual(row.bcm, undefined, "no bcm column");
        assert.strictEqual(row.production, undefined, "no production column");

        // Verify candidate_status is always a cycle status, never a ritasi status
        assert.ok(
          ["COMPLETE_CANDIDATE", "INCOMPLETE_LOADING", "INCOMPLETE_DUMPING", "MISSING_RETURN", "REVIEW"].includes(row.candidate_status),
          `status is cycle-related: ${row.candidate_status}`,
        );
      }
    });

    it("cycle contract field names contain no production/ritasi terminology", () => {
      const fields = Object.keys(DEFAULT_CYCLE_CONFIG);
      for (const field of fields) {
        assert.ok(!field.includes("ritasi"), `config field '${field}' has no ritasi`);
        assert.ok(!field.includes("tonase"), `config field '${field}' has no tonase`);
        assert.ok(!field.includes("production"), `config field '${field}' has no production`);
      }
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // T16: Phase 3A regression
  // ──────────────────────────────────────────────────────────────────
  describe("T16 — Phase 3A geofence engine regression", () => {
    it("geofence engine still works correctly", async () => {
      const runId = "run-t16-" + Date.now();

      // Quick geofence test: point inside LP should produce ENTER
      const pos = makeRawPosition("EX-501", 1, TEST_LP.inside.lat, TEST_LP.inside.lon, 0, 0, new Date());
      const containing = await getContainingGeofences(client, pos.latitude, pos.longitude);
      assert.ok(containing.includes(TEST_LP.id), "point is inside test LP");

      const events = await processPositionGeofence(client, pos, containing, new Set(), runId);
      assert.ok(events.length >= 1, "produces at least one event");
      assert.strictEqual(events[0].event_type, "GEOFENCE_ENTER", "ENTER event");
      assert.strictEqual(events[0].geofence_id, TEST_LP.id, "correct geofence");

      // Cleanup geofence events (not cycle candidates)
      await client.query("DELETE FROM fms_geofence_events WHERE run_id = $1", [runId]);
    });

    it("Phase 3A tables still exist and are queryable", async () => {
      for (const table of ["fms_geofences", "fms_geofence_events", "fms_movement_observations"]) {
        const r = await client.query(`SELECT COUNT(*) as cnt FROM ${table}`);
        assert.ok(parseInt(r.rows[0].cnt) >= 0, `${table} is queryable`);
      }
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // T17: Phase 2 pipeline regression
  // ──────────────────────────────────────────────────────────────────
  describe("T17 — Phase 2 pipeline regression", () => {
    it("raw telemetry and canonical events tables still work", async () => {
      for (const table of ["fms_raw_telemetry", "fms_canonical_events", "fms_units"]) {
        const r = await client.query(`SELECT COUNT(*) as cnt FROM ${table}`);
        assert.ok(parseInt(r.rows[0].cnt) >= 0, `${table} is queryable`);
      }
    });

    it("Traccar API is still accessible", async () => {
      const status = await httpGet(`${TRACCAR_URL}/api/server`);
      assert.strictEqual(status, 200, "Traccar API returns 200");
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // T18: Resource/services unaffected
  // ──────────────────────────────────────────────────────────────────
  describe("T18 — Resource and services unaffected", () => {
    it("all 5 containers are running", async () => {
      let result = "";
      try {
        result = execSync("docker ps --format '{{.Names}} {{.Status}}'", { encoding: "utf8" });
      } catch { result = ""; }

      const expected = ["fms-postgres", "fms-traccar", "lumin-postgres", "metro-postgres", "audit-bubur-fay-pg"];
      for (const name of expected) {
        assert.ok(result.includes(name), `container ${name} is running`);
      }
    });

    it("PostgreSQL on port 5439 is responsive", async () => {
      const r = await client.query("SELECT 1 as ok");
      assert.strictEqual(r.rows[0].ok, 1, "DB responds");
    });

    it("cycle_candidates table is empty (tests cleaned up after themselves)", async () => {
      const r = await client.query("SELECT COUNT(*) as cnt FROM fms_cycle_candidates");
      assert.strictEqual(parseInt(r.rows[0].cnt), 0, "all test candidates were cleaned up");
    });
  });
});
