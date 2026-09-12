import { Client } from "pg";

/**
 * FMS Phase 3A: Geofence + Movement Event Engine
 *
 * Transforms raw GPS positions into deterministic spatial/movement observations.
 * OPERATES ON: fms_raw_telemetry → fms_geofence_events + fms_movement_observations
 * DO NOT infer: Working/Standby/Delay/Breakdown, Ritasi, fuel consumed.
 */

// ─── TYPES ─────────────────────────────────────────────────────────

export type GeofenceType =
  | "LOADING_POINT"
  | "DUMPING_POINT"
  | "PIT"
  | "STOCKPILE"
  | "HAULING_ROAD"
  | "WORKSHOP"
  | "FUEL_STATION"
  | "OTHER";

export type SpatialEventType = "GEOFENCE_ENTER" | "GEOFENCE_INSIDE" | "GEOFENCE_EXIT";
export type MovementType = "MOVING" | "STOPPED" | "DWELL";

export interface Geofence {
  geofence_id: string;
  name: string;
  type: GeofenceType;
  site: string | null;
  geometry_wkt: string; // WKT representation of the polygon
  active: boolean;
}

export interface RawPosition {
  id: string;
  unit: string;
  device_id: number;
  fix_time: Date;
  device_time: Date | null;
  server_time: Date;
  latitude: number;
  longitude: number;
  speed: number | null;
  course: number | null;
  quality_flags: string[] | null;
}

export interface SpatialEvent {
  event_id: string;
  run_id: string | null;
  unit: string;
  device_id: number;
  geofence_id: string;
  event_type: SpatialEventType;
  fix_time: Date;
  device_time: Date | null;
  server_time: Date;
  latitude: number;
  longitude: number;
  position_id: string;
  quality_flags: string[];
}

export interface MovementObservation {
  observation_id: string;
  run_id: string | null;
  unit: string;
  device_id: number;
  observation_type: MovementType;
  fix_time: Date;
  device_time: Date | null;
  server_time: Date;
  latitude: number;
  longitude: number;
  speed_kmh: number | null;
  distance_m: number | null;
  duration_s: number | null;
  position_id: string;
  quality_flags: string[];
}

export interface GeofenceEngineConfig {
  /** Speed threshold in km/h. Below = STOPPED, above = MOVING */
  speedThresholdKmh: number;
  /** Dwell time threshold in seconds. STOPPED longer than this = DWELL */
  dwellThresholdSeconds: number;
  /** Maximum time gap between consecutive positions (seconds) before resetting state */
  maxGapSeconds: number;
}

const DEFAULT_CONFIG: GeofenceEngineConfig = {
  speedThresholdKmh: 2.0,
  dwellThresholdSeconds: 300, // 5 minutes
  maxGapSeconds: 600, // 10 minutes
};

// ─── HELPERS ───────────────────────────────────────────────────────

function generateId(prefix: string): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${ts}_${rand}`;
}

/** Haversine distance in meters */
export function haversineDistanceM(
  lat1: number, lon1: number,
  lat2: number, lon2: number,
): number {
  const R = 6371000; // Earth radius in meters
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Difference in seconds between two dates */
function diffSeconds(a: Date, b: Date): number {
  return Math.abs(a.getTime() - b.getTime()) / 1000;
}

function toIso(d: Date | null): string | null {
  return d ? d.toISOString() : null;
}

// ─── GEOFENCE MANAGEMENT ──────────────────────────────────────────

/**
 * Create a geofence in the database. geometry_wkt is a WKT POLYGON or MULTIPOINT.
 */
export async function createGeofence(
  client: Client,
  geofence: Geofence,
): Promise<void> {
  await client.query(
    `INSERT INTO fms_geofences (geofence_id, name, type, site, geometry, active)
     VALUES ($1, $2, $3, $4, ST_GeomFromText($5, 4326), $6)
     ON CONFLICT (geofence_id) DO UPDATE SET
       name = EXCLUDED.name, type = EXCLUDED.type, site = EXCLUDED.site,
       geometry = EXCLUDED.geometry, active = EXCLUDED.active,
       updated_at = now()`,
    [geofence.geofence_id, geofence.name, geofence.type, geofence.site,
     geofence.geometry_wkt, geofence.active],
  );
}

/**
 * Get all active geofences with their WKT geometry.
 */
export async function getActiveGeofences(
  client: Client,
): Promise<(Geofence & { geometry_wkt: string })[]> {
  const r = await client.query(
    `SELECT geofence_id, name, type, site, active,
            ST_AsText(geometry) as geometry_wkt
     FROM fms_geofences WHERE active = true`
  );
  return r.rows;
}

/**
 * Check which active geofences contain a given point.
 */
export async function getContainingGeofences(
  client: Client,
  lat: number,
  lon: number,
): Promise<string[]> {
  const r = await client.query(
    `SELECT geofence_id FROM fms_geofences
     WHERE active = true AND ST_Contains(geometry, ST_SetSRID(ST_MakePoint($1, $2), 4326))`,
    [lon, lat], // PostGIS: X=lon, Y=lat
  );
  return r.rows.map((row: any) => row.geofence_id);
}

// ─── SPATIAL EVENT ENGINE ─────────────────────────────────────────

/**
 * Get the last known geofence state for a unit (set of geofence IDs the unit was inside).
 * Uses the most recent geofence event's fix_time to determine state.
 */
export async function getLastGeofenceState(
  client: Client,
  unit: string,
  runId?: string | null,
): Promise<Set<string>> {
  const runFilter = runId
    ? "AND run_id = $2"
    : "AND run_id IS NULL";
  const params = runId ? [unit, runId] : [unit];

  // Get the most recent fix_time for this unit
  const latestR = await client.query(
    `SELECT MAX(fix_time) as latest FROM fms_geofence_events
     WHERE unit = $1 ${runFilter}`,
    params,
  );
  const latest = latestR.rows[0]?.latest;
  if (!latest) return new Set();

  // Get all geofences the unit was INSIDE or ENTER at that latest time
  const r = await client.query(
    `SELECT DISTINCT geofence_id FROM fms_geofence_events
     WHERE unit = $1 ${runFilter}
       AND fix_time = $3
       AND event_type IN ('GEOFENCE_ENTER', 'GEOFENCE_INSIDE')`,
    [...params, latest],
  );

  // Remove any that were subsequently EXIT'd at the same time
  const exitR = await client.query(
    `SELECT DISTINCT geofence_id FROM fms_geofence_events
     WHERE unit = $1 ${runFilter}
       AND fix_time = $3
       AND event_type = 'GEOFENCE_EXIT'`,
    [...params, latest],
  );
  const exited = new Set(exitR.rows.map((row: any) => row.geofence_id));
  const inside = new Set(r.rows.map((row: any) => row.geofence_id));
  for (const g of Array.from(exited)) inside.delete(g);
  return inside;
}

/**
 * Process a single position against geofences and generate spatial events.
 * Returns events generated (ENTER/INSIDE/EXIT).
 */
export async function processPositionGeofence(
  client: Client,
  position: RawPosition,
  currentGeofenceIds: string[],
  previousGeofenceIds: Set<string>,
  runId?: string | null,
): Promise<SpatialEvent[]> {
  const currentSet = new Set(currentGeofenceIds);
  const events: SpatialEvent[] = [];

  for (const gfId of currentGeofenceIds) {
    const wasInside = previousGeofenceIds.has(gfId);
    const eventType: SpatialEventType = wasInside ? "GEOFENCE_INSIDE" : "GEOFENCE_ENTER";

    const evt: SpatialEvent = {
      event_id: generateId("gfev"),
      run_id: runId ?? null,
      unit: position.unit,
      device_id: position.device_id,
      geofence_id: gfId,
      event_type: eventType,
      fix_time: position.fix_time,
      device_time: position.device_time,
      server_time: position.server_time,
      latitude: position.latitude,
      longitude: position.longitude,
      position_id: position.id,
      quality_flags: position.quality_flags ?? [],
    };
    events.push(evt);
  }

  // EXIT events for geofences no longer containing the point
  for (const gfId of Array.from(previousGeofenceIds)) {
    if (!currentSet.has(gfId)) {
      const evt: SpatialEvent = {
        event_id: generateId("gfev"),
        run_id: runId ?? null,
        unit: position.unit,
        device_id: position.device_id,
        geofence_id: gfId,
        event_type: "GEOFENCE_EXIT",
        fix_time: position.fix_time,
        device_time: position.device_time,
        server_time: position.server_time,
        latitude: position.latitude,
        longitude: position.longitude,
        position_id: position.id,
        quality_flags: position.quality_flags ?? [],
      };
      events.push(evt);
    }
  }

  return events;
}

/**
 * Insert spatial events into fms_geofence_events.
 */
export async function insertSpatialEvents(
  client: Client,
  events: SpatialEvent[],
): Promise<number> {
  let count = 0;
  for (const evt of events) {
    await client.query(
      `INSERT INTO fms_geofence_events
       (event_id, run_id, unit, device_id, geofence_id, event_type,
        fix_time, device_time, server_time, latitude, longitude,
        position_id, quality_flags)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (event_id) DO NOTHING`,
      [
        evt.event_id, evt.run_id, evt.unit, evt.device_id, evt.geofence_id,
        evt.event_type, evt.fix_time, toIso(evt.device_time), evt.server_time,
        evt.latitude, evt.longitude, evt.position_id, JSON.stringify(evt.quality_flags),
      ],
    );
    count++;
  }
  return count;
}

// ─── MOVEMENT OBSERVATION ENGINE ──────────────────────────────────

/**
 * Determine movement type from consecutive positions.
 */
export function classifyMovement(
  prev: RawPosition,
  curr: RawPosition,
  config: GeofenceEngineConfig = DEFAULT_CONFIG,
): { type: MovementType; distance_m: number; duration_s: number } {
  const distance = haversineDistanceM(
    prev.latitude, prev.longitude,
    curr.latitude, curr.longitude,
  );
  const duration = diffSeconds(curr.fix_time, prev.fix_time);
  const speed = duration > 0 ? (distance / duration) * 3.6 : 0; // m/s → km/h

  // If gap too large, don't classify — treat as separate segment
  if (duration > config.maxGapSeconds) {
    return { type: "MOVING", distance_m: distance, duration_s: duration };
  }

  if (speed < config.speedThresholdKmh) {
    // Below threshold: STOPPED or DWELL
    if (duration >= config.dwellThresholdSeconds) {
      return { type: "DWELL", distance_m: distance, duration_s: duration };
    }
    return { type: "STOPPED", distance_m: distance, duration_s: duration };
  }

  return { type: "MOVING", distance_m: distance, duration_s: duration };
}

/**
 * Process positions into movement observations.
 * Positions MUST be ordered by fix_time ascending.
 */
export function generateMovementObservations(
  positions: RawPosition[],
  runId?: string | null,
  config: GeofenceEngineConfig = DEFAULT_CONFIG,
): MovementObservation[] {
  if (positions.length === 0) return [];

  const observations: MovementObservation[] = [];

  // First position: observe based on speed alone (no previous)
  const first = positions[0];
  const firstSpeed = first.speed ?? 0;
  observations.push({
    observation_id: generateId("mobs"),
    run_id: runId ?? null,
    unit: first.unit,
    device_id: first.device_id,
    observation_type: firstSpeed < config.speedThresholdKmh ? "STOPPED" : "MOVING",
    fix_time: first.fix_time,
    device_time: first.device_time,
    server_time: first.server_time,
    latitude: first.latitude,
    longitude: first.longitude,
    speed_kmh: firstSpeed,
    distance_m: 0,
    duration_s: 0,
    position_id: first.id,
    quality_flags: first.quality_flags ?? [],
  });

  for (let i = 1; i < positions.length; i++) {
    const prev = positions[i - 1];
    const curr = positions[i];
    const { type, distance_m, duration_s } = classifyMovement(prev, curr, config);
    const speed = duration_s > 0 ? (distance_m / duration_s) * 3.6 : 0;

    observations.push({
      observation_id: generateId("mobs"),
      run_id: runId ?? null,
      unit: curr.unit,
      device_id: curr.device_id,
      observation_type: type,
      fix_time: curr.fix_time,
      device_time: curr.device_time,
      server_time: curr.server_time,
      latitude: curr.latitude,
      longitude: curr.longitude,
      speed_kmh: speed,
      distance_m,
      duration_s,
      position_id: curr.id,
      quality_flags: curr.quality_flags ?? [],
    });
  }

  return observations;
}

/**
 * Insert movement observations into fms_movement_observations.
 */
export async function insertMovementObservations(
  client: Client,
  observations: MovementObservation[],
): Promise<number> {
  let count = 0;
  for (const obs of observations) {
    await client.query(
      `INSERT INTO fms_movement_observations
       (observation_id, run_id, unit, device_id, observation_type,
        fix_time, device_time, server_time, latitude, longitude,
        speed_kmh, distance_m, duration_s, position_id, quality_flags)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       ON CONFLICT (observation_id) DO NOTHING`,
      [
        obs.observation_id, obs.run_id, obs.unit, obs.device_id,
        obs.observation_type, obs.fix_time, toIso(obs.device_time),
        obs.server_time, obs.latitude, obs.longitude,
        obs.speed_kmh, obs.distance_m, obs.duration_s,
        obs.position_id, JSON.stringify(obs.quality_flags),
      ],
    );
    count++;
  }
  return count;
}

// ─── PIPELINE ENTRY POINT ─────────────────────────────────────────

export interface GeofencePipelineResult {
  run_id: string | null;
  positions_processed: number;
  spatial_events_generated: number;
  movement_observations_generated: number;
  geofence_breakdown: Record<string, { enter: number; inside: number; exit: number }>;
  movement_breakdown: { moving: number; stopped: number; dwell: number };
}

/**
 * Run the full geofence + movement pipeline on raw telemetry.
 * Reads positions ordered by fix_time (not ingestion order) for late-arrival correctness.
 *
 * @param client - PostgreSQL client
 * @param unit - Unit to process (e.g. "EX-501")
 * @param runId - Optional run/session ID for test isolation
 * @param config - Optional movement thresholds
 * @param fromDate - Optional start of date range (for test scoping)
 * @param toDate - Optional end of date range
 */
export async function runGeofencePipeline(
  client: Client,
  unit: string,
  runId?: string | null,
  config: GeofenceEngineConfig = DEFAULT_CONFIG,
  fromDate?: Date,
  toDate?: Date,
): Promise<GeofencePipelineResult> {
  // Load active geofences
  const geofences = await getActiveGeofences(client);
  if (geofences.length === 0) {
    return {
      run_id: runId ?? null,
      positions_processed: 0,
      spatial_events_generated: 0,
      movement_observations_generated: 0,
      geofence_breakdown: {},
      movement_breakdown: { moving: 0, stopped: 0, dwell: 0 },
    };
  }

  // Load raw positions ORDERED BY FIX_TIME (critical for late-arrival correctness)
  let query = `
    SELECT id, unit, device_id, fix_time, device_time, server_time,
           latitude, longitude, speed, course
    FROM fms_raw_telemetry
    WHERE unit = $1
  `;
  const params: any[] = [unit];

  if (fromDate) {
    query += ` AND fix_time >= $${params.length + 1}`;
    params.push(fromDate);
  }
  if (toDate) {
    query += ` AND fix_time <= $${params.length + 1}`;
    params.push(toDate);
  }
  query += ` ORDER BY fix_time ASC`;

  const posResult = await client.query(query, params);
  const positions: RawPosition[] = posResult.rows.map((r: any) => ({
    id: r.id,
    unit: r.unit,
    device_id: r.device_id,
    fix_time: new Date(r.fix_time),
    device_time: r.device_time ? new Date(r.device_time) : null,
    server_time: new Date(r.server_time),
    latitude: r.latitude,
    longitude: r.longitude,
    speed: r.speed,
    course: r.course,
    quality_flags: null,
  }));

  if (positions.length === 0) {
    return {
      run_id: runId ?? null,
      positions_processed: 0,
      spatial_events_generated: 0,
      movement_observations_generated: 0,
      geofence_breakdown: {},
      movement_breakdown: { moving: 0, stopped: 0, dwell: 0 },
    };
  }

  // Get previous geofence state (for correct ENTER vs INSIDE across runs)
  let previousInside = await getLastGeofenceState(client, unit, runId);

  // Process each position through geofence engine
  const allSpatialEvents: SpatialEvent[] = [];
  const geofenceBreakdown: Record<string, { enter: number; inside: number; exit: number }> = {};

  for (const pos of positions) {
    // Check which geofences contain this point
    const containing = await getContainingGeofences(client, pos.latitude, pos.longitude);

    // Generate ENTER/INSIDE/EXIT events
    const events = await processPositionGeofence(
      client, pos, containing, previousInside, runId,
    );

    for (const evt of events) {
      allSpatialEvents.push(evt);
      if (!geofenceBreakdown[evt.geofence_id]) {
        geofenceBreakdown[evt.geofence_id] = { enter: 0, inside: 0, exit: 0 };
      }
      if (evt.event_type === "GEOFENCE_ENTER") geofenceBreakdown[evt.geofence_id].enter++;
      if (evt.event_type === "GEOFENCE_INSIDE") geofenceBreakdown[evt.geofence_id].inside++;
      if (evt.event_type === "GEOFENCE_EXIT") geofenceBreakdown[evt.geofence_id].exit++;
    }

    // Update state for next position
    previousInside = new Set(containing);
  }

  // Insert spatial events
  await insertSpatialEvents(client, allSpatialEvents);

  // Generate and insert movement observations
  const movements = generateMovementObservations(positions, runId, config);
  await insertMovementObservations(client, movements);

  const movementBreakdown = {
    moving: movements.filter((m) => m.observation_type === "MOVING").length,
    stopped: movements.filter((m) => m.observation_type === "STOPPED").length,
    dwell: movements.filter((m) => m.observation_type === "DWELL").length,
  };

  return {
    run_id: runId ?? null,
    positions_processed: positions.length,
    spatial_events_generated: allSpatialEvents.length,
    movement_observations_generated: movements.length,
    geofence_breakdown: geofenceBreakdown,
    movement_breakdown: movementBreakdown,
  };
}
