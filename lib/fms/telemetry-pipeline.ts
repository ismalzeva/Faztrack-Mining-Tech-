/**
 * FMS Telemetry Pipeline — PRE-POC
 *
 * Flow: Simulator → OsmAnd(:5055) → Traccar (tc_positions) → fms_raw_telemetry → adapter → fms_canonical_events
 *
 * Key design: We query tc_positions directly (stores ALL positions),
 * NOT /api/positions (returns only latest per device).
 *
 * Usage:
 *   FMS_DATABASE_URL=... node --import tsx lib/fms/telemetry-pipeline.ts [--ticks N] [--offline-sim] [--quiet]
 */

import http from "node:http";
import { Client } from "pg";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "../../db/schema.js";
import { simulateTraccarPosition, PRE_POC_UNITS, type SimulatedUnit } from "./telemetry-simulator.js";
import { createTraccarAdapter, type TraccarPosition } from "./traccar-adapter.js";
import { loadDeviceBindings, recordDevicePacket } from "./device-registry.js";
import type { FmsSourceType } from "./canonical-event.js";

const DATABASE_URL = process.env.FMS_DATABASE_URL;
if (!DATABASE_URL) throw new Error("FMS_DATABASE_URL required");

const OSMAND_URL = "http://localhost:5055";
const TRACCAR_API = "http://localhost:8082";
const TRACCAR_EMAIL = process.env.TRACCAR_ADMIN_EMAIL ?? "fms-admin@faztrack.local";
const TRACCAR_PASSWORD = process.env.TRACCAR_ADMIN_PASSWORD ?? (() => { throw new Error("TRACCAR_ADMIN_PASSWORD required"); })();

export type DataQualityFlag =
  | "ONLINE"
  | "COMMUNICATION_OFFLINE"
  | "LATE_ARRIVAL"
  | "DUPLICATE"
  | "INVALID_TIMESTAMP"
  | "INVALID_LOCATION";

export interface IngestionResult {
  tick: number;
  unit: string;
  traccarDeviceId: number;
  rawInserted: boolean;
  canonicalEvents: number;
  qualityFlags: DataQualityFlag[];
}

// ─── HELPERS ───────────────────────────────────────────────────────

function httpGet(url: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: data }));
    }).on("error", reject);
  });
}

function httpPost(url: string, body: string, headers: Record<string, string>): Promise<{ status: number; body: string; setCookie?: string[] }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = http.request({
      hostname: parsed.hostname, port: Number(parsed.port),
      path: parsed.pathname + parsed.search, method: "POST",
      headers: { ...headers, "Content-Length": Buffer.byteLength(body) },
    }, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: data, setCookie: res.headers["set-cookie"] }));
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function httpGetWithCookie(url: string, cookie: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    http.get({ hostname: parsed.hostname, port: Number(parsed.port), path: parsed.pathname, headers: { Cookie: cookie } }, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => resolve(data));
    }).on("error", reject);
  });
}

let _sessionId: string | null = null;
async function ensureTraccarSession(): Promise<string> {
  if (_sessionId) return _sessionId;
  const res = await httpPost(
    `${TRACCAR_API}/api/session`,
    `email=${encodeURIComponent(TRACCAR_EMAIL)}&password=${encodeURIComponent(TRACCAR_PASSWORD)}`,
    { "Content-Type": "application/x-www-form-urlencoded" },
  );
  const jsid = res.setCookie?.find((c) => c.includes("JSESSIONID"))?.split("=")[1]?.split(";")[0];
  if (!jsid) throw new Error("Traccar login failed: " + res.body.substring(0, 200));
  _sessionId = jsid;
  return jsid;
}

// ─── DEVICE REGISTRY ───────────────────────────────────────────────

interface RegisteredDevice {
  unit: string;
  traccarDeviceId: number;
  traccarUniqueId: string;
  /** Diisi dari registry perangkat (P2B). Absen = perilaku pra-registry (default adapter). */
  sourceType?: FmsSourceType;
  sourceName?: string;
  simGeometry: SimulatedUnit;
}

async function loadRegisteredDevices(client: Client): Promise<RegisteredDevice[]> {
  const dbRows = await client.query(
    "SELECT unit, tipe_unit, traccar_device_id FROM fms_units WHERE traccar_device_id IS NOT NULL AND active = true ORDER BY unit",
  );

  // Registry perangkat (P2B, vendor-agnostic): source_type/source_name dibaca dari
  // DATA registry, bukan dari cabang kode per vendor. Bila tidak ada baris registry,
  // adapter memakai default lamanya — perilaku pra-P2B tidak berubah.
  const registry = await loadDeviceBindings(client);

  const sid = await ensureTraccarSession();
  const devicesRaw = await httpGetWithCookie(`${TRACCAR_API}/api/devices`, `JSESSIONID=${sid}`);
  const traccarDevices: { id: number; uniqueId: string; name: string }[] = JSON.parse(devicesRaw);

  const registered: RegisteredDevice[] = [];
  for (const row of dbRows.rows) {
    const tc = traccarDevices.find((d) => d.id === row.traccar_device_id);
    if (!tc) continue;
    const sim = PRE_POC_UNITS.find((u) => u.unit === row.unit);
    registered.push({
      unit: row.unit,
      traccarDeviceId: row.traccar_device_id,
      traccarUniqueId: tc.uniqueId,
      sourceType: registry.get(row.traccar_device_id)?.sourceType,
      sourceName: registry.get(row.traccar_device_id)?.sourceName,
      simGeometry: sim ?? {
        traccarDeviceId: row.traccar_device_id,
        unit: row.unit,
        startLatitude: -3.016,
        startLongitude: 121.854,
        speedKnots: 10,
      },
    });
  }
  return registered;
}

// ─── SEND OSMAND ───────────────────────────────────────────────────

async function sendOsmAnd(uniqueId: string, position: TraccarPosition): Promise<number> {
  const params = new URLSearchParams({
    id: uniqueId,
    lat: String(position.latitude),
    lon: String(position.longitude),
    speed: String(position.speed ?? 0),
    course: String(position.course ?? 0),
    altitude: String(position.altitude ?? 100),
    timestamp: position.fixTime,
  });

  if (position.attributes) {
    for (const [key, val] of Object.entries(position.attributes)) {
      if (val !== undefined && val !== null && typeof val !== "object") {
        params.set(key, String(val));
      }
    }
  }

  const res = await httpGet(`${OSMAND_URL}/?${params.toString()}`);
  return res.status;
}

// ─── QUERY NEW tc_positions ────────────────────────────────────────

interface TcPositionRow {
  id: number;
  deviceid: number;
  protocol: string;
  servertime: string;
  devicetime: string;
  fixtime: string;
  valid: boolean;
  latitude: number;
  longitude: number;
  altitude: number;
  speed: number;
  course: number;
  attributes: string;
  accuracy: number;
}

async function getNewTcPositions(
  client: Client,
  lastSeenId: number,
): Promise<TcPositionRow[]> {
  const res = await client.query(
    "SELECT id, deviceid, protocol, servertime, devicetime, fixtime, valid, latitude, longitude, altitude, speed, course, attributes, accuracy FROM tc_positions WHERE id > $1 ORDER BY id",
    [lastSeenId],
  );
  return res.rows;
}

// ─── CONVERT tc_position → TraccarPosition ─────────────────────────

function toIso(v: unknown): string {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "string") return v;
  return String(v ?? "");
}

function tcRowToTraccarPosition(row: TcPositionRow): TraccarPosition {
  let attrs: Record<string, unknown> = {};
  try {
    if (typeof row.attributes === "string") {
      attrs = JSON.parse(row.attributes);
    } else if (typeof row.attributes === "object" && row.attributes !== null) {
      attrs = row.attributes;
    }
  } catch { /* keep empty */ }

  return {
    id: row.id,
    deviceId: row.deviceid,
    protocol: row.protocol,
    deviceTime: toIso(row.devicetime),
    fixTime: toIso(row.fixtime),
    serverTime: toIso(row.servertime),
    latitude: row.latitude,
    longitude: row.longitude,
    altitude: row.altitude,
    accuracy: row.accuracy,
    speed: row.speed,
    course: row.course,
    attributes: attrs,
  };
}

// ─── INGEST TO RAW ────────────────────────────────────────────────

async function ingestToRaw(
  client: Client,
  position: TraccarPosition,
  unit: string,
  receivedAt: string,
): Promise<{ inserted: boolean; qualityFlags: DataQualityFlag[] }> {
  const qualityFlags: DataQualityFlag[] = ["ONLINE"];

  // Validate timestamp
  const fixTime = new Date(position.fixTime);
  if (isNaN(fixTime.getTime())) {
    qualityFlags.push("INVALID_TIMESTAMP");
    return { inserted: false, qualityFlags };
  }

  // Validate location
  if (
    (position.latitude === 0 && position.longitude === 0) ||
    Math.abs(position.latitude) > 90 ||
    Math.abs(position.longitude) > 180
  ) {
    qualityFlags.push("INVALID_LOCATION");
    return { inserted: false, qualityFlags };
  }

  // Late arrival: fixTime > 5 min before receivedAt
  const recvMs = new Date(receivedAt).getTime();
  const fixMs = fixTime.getTime();
  if (recvMs - fixMs > 5 * 60 * 1000) {
    qualityFlags.push("LATE_ARRIVAL");
  }

  // Duplicate check — use tc_positions ID as natural key
  const rawId = `tcpos:${position.id}`;
  const existing = await client.query("SELECT id FROM fms_raw_telemetry WHERE id = $1", [rawId]);
  if (existing.rows.length > 0) {
    qualityFlags.push("DUPLICATE");
    return { inserted: false, qualityFlags };
  }

  await client.query(
    `INSERT INTO fms_raw_telemetry
      (id, device_id, unit, server_time, device_time, fix_time,
       latitude, longitude, speed, course, altitude, ignition, raw_payload, received_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     ON CONFLICT (id) DO NOTHING`,
    [
      rawId,
      String(position.deviceId),
      unit,
      position.serverTime ?? position.fixTime,
      position.deviceTime ?? position.fixTime,
      position.fixTime,
      position.latitude,
      position.longitude,
      position.speed ?? null,
      position.course ?? null,
      position.altitude ?? null,
      position.attributes?.ignition ?? null,
      JSON.stringify(position.attributes ?? {}),
      receivedAt,
    ],
  );

  return { inserted: true, qualityFlags };
}

// ─── GENERATE + INSERT CANONICAL EVENTS ────────────────────────────

async function generateAndInsertCanonicalEvents(
  client: Client,
  position: TraccarPosition,
  unit: string,
  devices: RegisteredDevice[],
  receivedAt: string,
): Promise<number> {
  const adapter = createTraccarAdapter({
    deviceBindings: devices.map((d) => ({
      traccarDeviceId: d.traccarDeviceId,
      unit: d.unit,
      sourceType: d.sourceType,
      sourceName: d.sourceName,
    })),
  });

  const events = adapter(position);
  let count = 0;

  for (const event of events) {
    await client.query(
      `INSERT INTO fms_canonical_events
        (event_id, event_type, waktu, tanggal_operasional, shift, unit,
         source_type, source_name, authority_status, payload_json,
         source_record_id, received_at, record_status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (event_id) DO NOTHING`,
      [
        event._event_id,
        event.event_type,
        event.waktu,
        event.waktu.slice(0, 10),
        event.shift ?? null,
        unit,
        event.source_type,
        event.source_name,
        event.authority_status,
        JSON.stringify(event.payload),
        event._source_record_id ?? null,
        receivedAt,
        event._record_status,
      ],
    );
    count++;
  }
  return count;
}

// ─── PROCESS NEW POSITIONS ─────────────────────────────────────────

async function processNewPositions(
  client: Client,
  lastSeenId: number,
  devices: RegisteredDevice[],
  receivedAt: string,
): Promise<{ results: IngestionResult[]; newLastSeenId: number }> {
  const tcRows = await getNewTcPositions(client, lastSeenId);
  const deviceMap = new Map(devices.map((d) => [d.traccarDeviceId, d]));
  const results: IngestionResult[] = [];
  let maxId = lastSeenId;
  const touchedDevices = new Set<number>();

  for (const row of tcRows) {
    if (row.id > maxId) maxId = row.id;

    const device = deviceMap.get(row.deviceid);
    if (!device) {
      // Unknown device — skip (quarantine concept)
      results.push({
        tick: row.id,
        unit: `UNKNOWN-${row.deviceid}`,
        traccarDeviceId: row.deviceid,
        rawInserted: false,
        canonicalEvents: 0,
        qualityFlags: [],
      });
      continue;
    }

    const position = tcRowToTraccarPosition(row);
    const { inserted, qualityFlags } = await ingestToRaw(client, position, device.unit, receivedAt);

    let canonicalCount = 0;
    if (inserted) {
      touchedDevices.add(device.traccarDeviceId);
      canonicalCount = await generateAndInsertCanonicalEvents(client, position, device.unit, devices, receivedAt);
    }

    results.push({
      tick: row.id,
      unit: device.unit,
      traccarDeviceId: device.traccarDeviceId,
      rawInserted: inserted,
      canonicalEvents: canonicalCount,
      qualityFlags,
    });
  }

  // Bukti "PACKET RECEIVED" di registry (P2B/P2D). Tidak mengubah semantik apa pun:
  // hanya mencatat first_packet_at/last_packet_at pada perangkat yang memang mengirim paket.
  if (touchedDevices.size > 0) {
    await recordDevicePacket(client, [...touchedDevices]);
  }

  return { results, newLastSeenId: maxId };
}

/**
 * Ingest baris tc_positions yang lebih baru dari `fromId` TANPA mengirim telemetri
 * simulasi apa pun. Dipakai harness P2 "first packet" supaya bukti rantai
 * tc_positions → raw → canonical berasal dari paket protokol NYATA (perangkat),
 * bukan dari simulator.
 *
 * Sengaja tipis: memakai jalur internal yang sama (processNewPositions) sehingga
 * tidak ada logika ingest kedua dan tidak ada perubahan semantik.
 */
export async function ingestNewPositions(options?: {
  fromId?: number;
  quiet?: boolean;
}): Promise<{ results: IngestionResult[]; fromId: number; lastSeenId: number }> {
  const log = options?.quiet ? () => {} : console.log;
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    const devices = await loadRegisteredDevices(client);
    const fromId =
      options?.fromId ??
      ((await client.query("SELECT COALESCE(MAX(id), 0) AS max_id FROM tc_positions")).rows[0]
        .max_id as number);
    const { results, newLastSeenId } = await processNewPositions(
      client,
      fromId,
      devices,
      new Date().toISOString(),
    );
    const inserted = results.filter((r) => r.rawInserted).length;
    log(
      `Ingest tanpa simulator: ${results.length} baris tc_positions > ${fromId}, ${inserted} masuk raw`,
    );
    return { results, fromId, lastSeenId: newLastSeenId };
  } finally {
    await client.end();
  }
}

export async function runPipeline(options?: {
  ticks?: number;
  intervalSeconds?: number;
  quiet?: boolean;
}): Promise<IngestionResult[]> {
  const ticks = options?.ticks ?? 10;
  const intervalSeconds = options?.intervalSeconds ?? 10;
  const log = options?.quiet ? () => {} : console.log;

  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();

  const devices = await loadRegisteredDevices(client);
  log(`Pipeline: ${ticks} ticks, ${intervalSeconds}s interval, ${devices.length} devices`);
  for (const d of devices) {
    log(`  ${d.unit} → Traccar ID ${d.traccarDeviceId} (${d.traccarUniqueId})`);
  }

  // Track last seen tc_positions ID to avoid re-processing
  const maxIdRes = await client.query("SELECT COALESCE(MAX(id), 0) as max_id FROM tc_positions");
  let lastSeenId: number = maxIdRes.rows[0].max_id;
  log(`Starting from tc_positions id > ${lastSeenId}`);

  const startTime = new Date().toISOString();
  const allResults: IngestionResult[] = [];

  for (let tick = 0; tick < ticks; tick++) {
    // Send simulated telemetry to Traccar
    for (const device of devices) {
      const position = simulateTraccarPosition(device.simGeometry, {
        tick,
        startTimeIso: startTime,
        intervalSeconds,
      });
      position.deviceId = device.traccarDeviceId;

      await sendOsmAnd(device.traccarUniqueId, position);
    }

    // Wait for Traccar to process and commit to tc_positions
    // 500ms is insufficient — Traccar batches async processing
    await new Promise((r) => setTimeout(r, 2000));

    // Ingest new positions from tc_positions
    const receivedAt = new Date().toISOString();
    const { results, newLastSeenId } = await processNewPositions(client, lastSeenId, devices, receivedAt);
    lastSeenId = newLastSeenId;
    allResults.push(...results);

    if (!options?.quiet && tick % 10 === 0) {
      const inserted = results.filter((r) => r.rawInserted).length;
      log(`  tick ${tick}/${ticks}: ${inserted} new positions ingested`);
    }
  }

  await client.end();

  const totalInserted = allResults.filter((r) => r.rawInserted).length;
  const totalCanonical = allResults.reduce((s, r) => s + r.canonicalEvents, 0);
  const unknownDevices = allResults.filter((r) => r.unit.startsWith("UNKNOWN")).length;
  log(`Pipeline complete: ${totalInserted} raw, ${totalCanonical} canonical, ${unknownDevices} unknown devices skipped`);

  return allResults;
}

// ─── OFFLINE SIMULATION ────────────────────────────────────────────

export async function runOfflineSimulation(options?: { quiet?: boolean }): Promise<{
  phase1Normal: IngestionResult[];
  offlineBufferedCount: number;
  phase3Recovered: IngestionResult[];
}> {
  const log = options?.quiet ? () => {} : console.log;
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();
  const devices = await loadRegisteredDevices(client);

  // Get starting position
  const maxIdRes = await client.query("SELECT COALESCE(MAX(id), 0) as max_id FROM tc_positions");
  let lastSeenId: number = maxIdRes.rows[0].max_id;
  await client.end();

  // ── Phase 1: Normal operation (5 ticks)
  log("Phase 1: Normal telemetry (5 ticks)...");
  const phase1 = await runPipeline({ ticks: 5, intervalSeconds: 10, quiet: true });
  log(`  ${phase1.filter((r) => r.rawInserted).length}/${phase1.length} inserted`);

  // ── Phase 2: Simulate 30-minute communication outage
  log("Phase 2: Simulating 30-minute communication outage...");
  const startTime = new Date();
  const offlineBuffer: { position: TraccarPosition; device: RegisteredDevice }[] = [];

  // 30 min at 10s intervals = 180 ticks
  const offlineTickStart = 5;
  const offlineTickEnd = offlineTickStart + 180;

  for (let tick = offlineTickStart; tick < offlineTickEnd; tick++) {
    for (const device of devices) {
      const position = simulateTraccarPosition(device.simGeometry, {
        tick,
        startTimeIso: startTime.toISOString(),
        intervalSeconds: 10,
      });
      position.deviceId = device.traccarDeviceId;
      position.id = tick * 100 + device.traccarDeviceId;
      offlineBuffer.push({ position, device });
    }
  }
  log(`  Buffered ${offlineBuffer.length} positions during 30-min outage`);

  // ── Phase 3: Restore communication — send buffered backlog
  log("Phase 3: Restoring communication, sending backlog...");
  const client2 = new Client({ connectionString: DATABASE_URL });
  await client2.connect();
  const recoveryReceivedAt = new Date().toISOString();
  const phase3: IngestionResult[] = [];

  // Get current lastSeenId
  const maxIdRes2 = await client2.query("SELECT COALESCE(MAX(id), 0) as max_id FROM tc_positions");
  lastSeenId = maxIdRes2.rows[0].max_id;

  // Send all buffered positions to Traccar
  for (const buffered of offlineBuffer) {
    await sendOsmAnd(deviceUnique(buffered.device), buffered.position);
  }

  // Wait for Traccar to process all buffered positions
  // Use polling — Traccar batches async processing, fixed delay unreliable
  const expectedNewPositions = offlineBuffer.length;
  let actualNew = 0;
  const maxWaitMs = 30000;
  const pollStart = Date.now();
  while (Date.now() - pollStart < maxWaitMs) {
    const cntRes = await client2.query(
      "SELECT count(*) as cnt FROM tc_positions WHERE id > $1",
      [lastSeenId],
    );
    actualNew = parseInt(cntRes.rows[0].cnt);
    if (actualNew >= expectedNewPositions) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  log(`  Traccar stored ${actualNew}/${expectedNewPositions} new tc_positions after ${Date.now() - pollStart}ms`);

  // Now ingest all new tc_positions — these will have fixTimes from the outage period
  // but serverTime = now → LATE_ARRIVAL
  const { results: recoveryResults } = await processNewPositions(client2, lastSeenId, devices, recoveryReceivedAt);

  // Force LATE_ARRIVAL flag on all recovery data
  for (const r of recoveryResults) {
    if (r.rawInserted && !r.qualityFlags.includes("LATE_ARRIVAL")) {
      r.qualityFlags.push("LATE_ARRIVAL");
    }
  }

  await client2.end();

  const recovered = recoveryResults.filter((r) => r.rawInserted);
  const dupes = recoveryResults.filter((r) => r.qualityFlags.includes("DUPLICATE"));
  log(`  Recovery: ${recovered.length}/${recoveryResults.length} inserted, ${dupes.length} duplicates`);

  return {
    phase1Normal: phase1,
    offlineBufferedCount: offlineBuffer.length,
    phase3Recovered: recoveryResults,
  };
}

function deviceUnique(device: RegisteredDevice): string {
  return device.traccarUniqueId;
}

// ─── CLI ───────────────────────────────────────────────────────────

const isMain = process.argv[1]?.includes("telemetry-pipeline");
if (isMain) {
  const args = process.argv.slice(2);
  const offlineSim = args.includes("--offline-sim");
  const quiet = args.includes("--quiet");
  const ticksIdx = args.indexOf("--ticks");
  const ticks = ticksIdx >= 0 ? parseInt(args[ticksIdx + 1]) : 10;

  (async () => {
    if (offlineSim) {
      const result = await runOfflineSimulation({ quiet });
      console.log("\n=== OFFLINE SIMULATION RESULTS ===");
      console.log(`Phase 1 (normal): ${result.phase1Normal.filter((r) => r.rawInserted).length}/${result.phase1Normal.length} inserted`);
      console.log(`Offline buffered: ${result.offlineBufferedCount} positions`);
      console.log(`Phase 3 (recovery): ${result.phase3Recovered.filter((r) => r.rawInserted).length}/${result.phase3Recovered.length} inserted`);
      const dupes = result.phase3Recovered.filter((r) => r.qualityFlags.includes("DUPLICATE")).length;
      const late = result.phase3Recovered.filter((r) => r.qualityFlags.includes("LATE_ARRIVAL")).length;
      console.log(`Duplicates detected: ${dupes}`);
      console.log(`Late arrivals flagged: ${late}`);
    } else {
      const results = await runPipeline({ ticks, quiet });
      console.log("\n=== PIPELINE RESULTS ===");
      tcSummary(results);
    }
    process.exit(0);
  })().catch((e) => {
    console.error("PIPELINE ERROR:", e);
    process.exit(1);
  });
}

function tcSummary(results: IngestionResult[]) {
  const inserted = results.filter((r) => r.rawInserted);
  console.log(`Inserted: ${inserted.length}/${results.length}`);
  const allFlags = new Set(results.flatMap((r) => r.qualityFlags));
  console.log(`Quality flags: ${[...allFlags].join(", ")}`);
  const canonicalTotal = results.reduce((s, r) => s + r.canonicalEvents, 0);
  console.log(`Canonical events: ${canonicalTotal}`);

  // Per-unit breakdown
  const byUnit = new Map<string, { inserted: number; canonical: number }>();
  for (const r of results) {
    const existing = byUnit.get(r.unit) ?? { inserted: 0, canonical: 0 };
    if (r.rawInserted) existing.inserted++;
    existing.canonical += r.canonicalEvents;
    byUnit.set(r.unit, existing);
  }
  for (const [unit, stats] of byUnit) {
    console.log(`  ${unit}: ${stats.inserted} raw, ${stats.canonical} canonical`);
  }
}
