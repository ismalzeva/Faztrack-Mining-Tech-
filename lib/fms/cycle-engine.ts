import { Client } from "pg";
import { createHash } from "crypto";
import { haversineDistanceM } from "./geofence-engine";

/**
 * FMS Phase 3B: Mining Cycle Candidate Engine
 *
 * Transforms geofence events into CYCLE CANDIDATES.
 * CYCLE CANDIDATE ≠ VERIFIED RITASI ≠ PRODUCTION
 * Does NOT infer: Working/Standby/Delay/Breakdown, tonase, BCM, fuel.
 * Does NOT auto-correct historical discrepancies.
 */

// ─── TYPES ─────────────────────────────────────────────────────────

export type CycleState =
  | "OUTSIDE"
  | "AT_LOADING_POINT"
  | "LOADING_DWELL"
  | "HAULING_OUTBOUND"
  | "AT_DUMPING_POINT"
  | "DUMPING_DWELL"
  | "RETURNING"
  | "CYCLE_COMPLETE_CANDIDATE"
  | "INCOMPLETE"
  | "REVIEW";

export type QualityFlag =
  | "COMPLETE_CANDIDATE"
  | "INCOMPLETE_LOADING"
  | "INCOMPLETE_DUMPING"
  | "MISSING_RETURN"
  | "GPS_GAP"
  | "LATE_ARRIVAL"
  | "OUT_OF_ORDER"
  | "ROUTE_DEVIATION"
  | "DUPLICATE_CROSSING"
  | "AMBIGUOUS_GEOFENCE"
  | "EXCESSIVE_DWELL"
  | "REVIEW_REQUIRED";

export type CandidateStatus =
  | "COMPLETE_CANDIDATE"
  | "INCOMPLETE_LOADING"
  | "INCOMPLETE_DUMPING"
  | "MISSING_RETURN"
  | "REVIEW";

export type GeofenceRole = "loading_point" | "dumping_point" | "hauling_road" | "other";

export interface CycleConfig {
  minLoadingDwellSeconds: number;
  minDumpingDwellSeconds: number;
  maxCycleDurationSeconds: number;
  maxTelemetryGapSeconds: number;
  minTravelDistanceMeters: number;
  maxDwellSeconds: number;
}

export const DEFAULT_CYCLE_CONFIG: CycleConfig = {
  minLoadingDwellSeconds: 30,    // 30s minimum to count as loaded
  minDumpingDwellSeconds: 20,    // 20s minimum to count as dumped
  maxCycleDurationSeconds: 7200, // 2 hours max cycle
  maxTelemetryGapSeconds: 600,   // 10 min gap = GPS_GAP flag
  minTravelDistanceMeters: 50,    // 50m minimum meaningful travel
  maxDwellSeconds: 3600,         // 1 hour = EXCESSIVE_DWELL
};

export interface CycleCandidate {
  cycle_id: string;
  run_id: string | null;
  unit: string;
  device_id: number;
  operator: string | null;
  loader: string | null;
  loading_point: string | null;
  dumping_point: string | null;
  start_fix_time: Date;
  loading_enter_time: Date | null;
  loading_exit_time: Date | null;
  dumping_enter_time: Date | null;
  dumping_exit_time: Date | null;
  return_time: Date | null;
  end_fix_time: Date | null;
  duration_total_s: number | null;
  loading_dwell_s: number | null;
  travel_loaded_duration_s: number | null;
  dumping_dwell_s: number | null;
  return_duration_s: number | null;
  distance_outbound_m: number | null;
  distance_return_m: number | null;
  distance_total_m: number | null;
  source_position_ids: string[];
  source_geofence_event_ids: string[];
  quality_flags: QualityFlag[];
  candidate_status: CandidateStatus;
}

// ─── INTERNAL STATE ────────────────────────────────────────────────

interface CycleAccumulator {
  state: CycleState;
  unit: string;
  device_id: number;
  currentCycle: Partial<CycleCandidate>;
  positionsInPhase: Array<{ lat: number; lon: number; fix_time: Date; id: string }>;
  positionsInReturn: Array<{ lat: number; lon: number; fix_time: Date; id: string }>;
  allPositionIds: string[];
  allEventIds: string[];
  qualityFlags: Set<QualityFlag>;
  loading_point: string | null;
  dumping_point: string | null;
  lastEventTime: Date | null;
  hasActivityBeyondEntry: boolean;
  completedCycleCount: number;
}

function newAccumulator(unit: string, deviceId: number): CycleAccumulator {
  return {
    state: "OUTSIDE",
    unit,
    device_id: deviceId,
    currentCycle: {},
    positionsInPhase: [],
    positionsInReturn: [],
    allPositionIds: [],
    allEventIds: [],
    qualityFlags: new Set(),
    loading_point: null,
    dumping_point: null,
    lastEventTime: null,
    hasActivityBeyondEntry: false,
    completedCycleCount: 0,
  };
}

function diffSeconds(a: Date, b: Date): number {
  return Math.abs(a.getTime() - b.getTime()) / 1000;
}

function sumDistanceMeters(positions: Array<{ lat: number; lon: number }>): number {
  let total = 0;
  for (let i = 1; i < positions.length; i++) {
    total += haversineDistanceM(
      positions[i - 1].lat, positions[i - 1].lon,
      positions[i].lat, positions[i].lon,
    );
  }
  return total;
}

function generateCycleId(unit: string, startFixTime: Date): string {
  const hash = createHash("sha256")
    .update(`${unit}:${startFixTime.toISOString()}`)
    .digest("hex")
    .slice(0, 12);
  return `cyc_${hash}`;
}

// ─── GEOFENCE ROLE RESOLUTION ──────────────────────────────────────

export function resolveGeofenceRole(geofenceType: string): GeofenceRole {
  switch (geofenceType) {
    case "LOADING_POINT": return "loading_point";
    case "DUMPING_POINT": return "dumping_point";
    case "HAULING_ROAD": return "hauling_road";
    default: return "other";
  }
}

// ─── STATE MACHINE ─────────────────────────────────────────────────

function transitionState(
  acc: CycleAccumulator,
  eventType: "GEOFENCE_ENTER" | "GEOFENCE_EXIT",
  geofenceRole: GeofenceRole,
  geofenceId: string,
  fixTime: Date,
  positionId: string,
  lat: number,
  lon: number,
  config: CycleConfig,
): CycleCandidate | null {
  let completedCycle: CycleCandidate | null = null;

  // Track source IDs
  acc.allEventIds.push(positionId);
  if (!acc.allPositionIds.includes(positionId)) {
    acc.allPositionIds.push(positionId);
  }

  // GPS gap detection: check time gap since last event
  if (acc.lastEventTime && acc.state !== "OUTSIDE") {
    const gapSec = diffSeconds(fixTime, acc.lastEventTime);
    if (gapSec > config.maxTelemetryGapSeconds) {
      acc.qualityFlags.add("GPS_GAP");
    }
  }
  acc.lastEventTime = fixTime;

  switch (acc.state) {
    case "OUTSIDE": {
      if (eventType === "GEOFENCE_ENTER" && geofenceRole === "loading_point") {
        // Start new cycle
        acc.state = "AT_LOADING_POINT";
        acc.loading_point = geofenceId;
        acc.dumping_point = null;
        acc.currentCycle = {
          cycle_id: generateCycleId(acc.unit, fixTime),
          unit: acc.unit,
          device_id: acc.device_id,
          start_fix_time: fixTime,
          loading_enter_time: fixTime,
          loading_point: geofenceId,
        };
        acc.positionsInPhase = [{ lat, lon, fix_time: fixTime, id: positionId }];
        acc.positionsInReturn = [];
        acc.qualityFlags = new Set();
        acc.allPositionIds = [positionId];
        acc.allEventIds = [positionId];
        acc.hasActivityBeyondEntry = false;
      }
      // Ignore other events while outside
      break;
    }

    case "AT_LOADING_POINT": {
      if (eventType === "GEOFENCE_EXIT" && geofenceRole === "loading_point") {
        // Departed loading
        const dwell = diffSeconds(fixTime, acc.currentCycle.loading_enter_time!);
        acc.state = "HAULING_OUTBOUND";
        acc.currentCycle.loading_exit_time = fixTime;
        acc.currentCycle.loading_dwell_s = dwell;
        acc.positionsInPhase = [{ lat, lon, fix_time: fixTime, id: positionId }];
        acc.positionsInReturn = [];
        acc.hasActivityBeyondEntry = true;
      } else if (eventType === "GEOFENCE_ENTER" && geofenceRole === "loading_point") {
        // DUPLICATE_CROSSING: already at loading, entering again
        acc.qualityFlags.add("DUPLICATE_CROSSING");
      } else if (eventType === "GEOFENCE_ENTER" && geofenceRole !== "hauling_road") {
        // Unexpected geofence while at loading
        acc.qualityFlags.add("ROUTE_DEVIATION");
      }
      break;
    }

    case "LOADING_DWELL": {
      // Same as AT_LOADING_POINT for exit logic
      if (eventType === "GEOFENCE_EXIT" && geofenceRole === "loading_point") {
        const dwell = diffSeconds(fixTime, acc.currentCycle.loading_enter_time!);
        acc.state = "HAULING_OUTBOUND";
        acc.currentCycle.loading_exit_time = fixTime;
        acc.currentCycle.loading_dwell_s = dwell;
        acc.positionsInPhase = [{ lat, lon, fix_time: fixTime, id: positionId }];
        acc.positionsInReturn = [];
        acc.hasActivityBeyondEntry = true;
      } else if (eventType === "GEOFENCE_ENTER" && geofenceRole === "loading_point") {
        acc.qualityFlags.add("DUPLICATE_CROSSING");
      }
      break;
    }

    case "HAULING_OUTBOUND": {
      if (eventType === "GEOFENCE_ENTER" && geofenceRole === "dumping_point") {
        // Arrived at dumping
        acc.state = "AT_DUMPING_POINT";
        acc.dumping_point = geofenceId;
        acc.currentCycle.dumping_enter_time = fixTime;
        acc.currentCycle.dumping_point = geofenceId;
        // Calculate outbound distance from positions accumulated + current DP enter position
        acc.currentCycle.distance_outbound_m = sumDistanceMeters(
          [...acc.positionsInPhase, { lat, lon }],
        );
        acc.currentCycle.travel_loaded_duration_s = diffSeconds(
          fixTime, acc.currentCycle.loading_exit_time!,
        );
        acc.positionsInPhase = [{ lat, lon, fix_time: fixTime, id: positionId }];
      } else if (eventType === "GEOFENCE_ENTER" && geofenceRole === "loading_point") {
        // Returned to loading without dumping → INCOMPLETE_DUMPING
        acc.qualityFlags.add("INCOMPLETE_DUMPING");
        acc.currentCycle.end_fix_time = fixTime;
        acc.currentCycle.candidate_status = "INCOMPLETE_DUMPING";
        acc.currentCycle.duration_total_s = diffSeconds(fixTime, acc.currentCycle.start_fix_time!);
        completedCycle = finalizeCycle(acc);
        // Start new cycle at this loading point
        acc.state = "AT_LOADING_POINT";
        acc.loading_point = geofenceId;
        acc.dumping_point = null;
        acc.currentCycle = {
          cycle_id: generateCycleId(acc.unit, fixTime),
          unit: acc.unit,
          device_id: acc.device_id,
          start_fix_time: fixTime,
          loading_enter_time: fixTime,
          loading_point: geofenceId,
        };
        acc.positionsInPhase = [{ lat, lon, fix_time: fixTime, id: positionId }];
        acc.positionsInReturn = [];
        acc.qualityFlags = new Set();
        acc.allPositionIds = [positionId];
        acc.allEventIds = [positionId];
      } else if (eventType === "GEOFENCE_ENTER" && geofenceRole === "other") {
        acc.qualityFlags.add("ROUTE_DEVIATION");
      }
      // Track positions for distance
      acc.positionsInPhase.push({ lat, lon, fix_time: fixTime, id: positionId });
      break;
    }

    case "AT_DUMPING_POINT": {
      if (eventType === "GEOFENCE_EXIT" && geofenceRole === "dumping_point") {
        // Departed dumping
        const dwell = diffSeconds(fixTime, acc.currentCycle.dumping_enter_time!);
        acc.state = "RETURNING";
        acc.currentCycle.dumping_exit_time = fixTime;
        acc.currentCycle.dumping_dwell_s = dwell;
        acc.positionsInReturn = [{ lat, lon, fix_time: fixTime, id: positionId }];
      } else if (eventType === "GEOFENCE_ENTER" && geofenceRole === "dumping_point") {
        acc.qualityFlags.add("DUPLICATE_CROSSING");
      }
      break;
    }

    case "DUMPING_DWELL": {
      if (eventType === "GEOFENCE_EXIT" && geofenceRole === "dumping_point") {
        const dwell = diffSeconds(fixTime, acc.currentCycle.dumping_enter_time!);
        acc.state = "RETURNING";
        acc.currentCycle.dumping_exit_time = fixTime;
        acc.currentCycle.dumping_dwell_s = dwell;
        acc.positionsInReturn = [{ lat, lon, fix_time: fixTime, id: positionId }];
      } else if (eventType === "GEOFENCE_ENTER" && geofenceRole === "dumping_point") {
        acc.qualityFlags.add("DUPLICATE_CROSSING");
      }
      break;
    }

    case "RETURNING": {
      acc.positionsInReturn.push({ lat, lon, fix_time: fixTime, id: positionId });
      if (eventType === "GEOFENCE_ENTER" && geofenceRole === "loading_point") {
        // Cycle complete!
        acc.currentCycle.return_time = fixTime;
        acc.currentCycle.end_fix_time = fixTime;
        acc.currentCycle.distance_return_m = sumDistanceMeters(acc.positionsInReturn);
        acc.currentCycle.return_duration_s = diffSeconds(
          fixTime, acc.currentCycle.dumping_exit_time!,
        );
        acc.currentCycle.duration_total_s = diffSeconds(
          fixTime, acc.currentCycle.start_fix_time!,
        );
        acc.currentCycle.loading_point = acc.loading_point;
        completedCycle = accCycleComplete(acc);
        acc.completedCycleCount++;
        // Start new cycle
        acc.state = "AT_LOADING_POINT";
        acc.loading_point = geofenceId;
        acc.dumping_point = null;
        acc.currentCycle = {
          cycle_id: generateCycleId(acc.unit, fixTime),
          unit: acc.unit,
          device_id: acc.device_id,
          start_fix_time: fixTime,
          loading_enter_time: fixTime,
          loading_point: geofenceId,
        };
        acc.positionsInPhase = [{ lat, lon, fix_time: fixTime, id: positionId }];
        acc.positionsInReturn = [];
        acc.qualityFlags = new Set();
        acc.allPositionIds = [positionId];
        acc.allEventIds = [positionId];
        acc.hasActivityBeyondEntry = false;
      } else if (eventType === "GEOFENCE_ENTER" && geofenceRole === "dumping_point") {
        // Went back to dumping instead of returning
        acc.qualityFlags.add("ROUTE_DEVIATION");
      }
      break;
    }

    default:
      break;
  }

  return completedCycle;
}

function accCycleComplete(acc: CycleAccumulator): CycleCandidate {
  const cycle = acc.currentCycle;
  // Calculate total distance
  const distOut = cycle.distance_outbound_m ?? 0;
  const distRet = cycle.distance_return_m ?? 0;
  cycle.distance_total_m = distOut + distRet;

  // Apply quality flags
  if (acc.qualityFlags.size === 0) {
    cycle.quality_flags = ["COMPLETE_CANDIDATE"];
    cycle.candidate_status = "COMPLETE_CANDIDATE";
  } else {
    cycle.quality_flags = Array.from(acc.qualityFlags);
    // Determine status from flags
    if (acc.qualityFlags.has("INCOMPLETE_LOADING")) cycle.candidate_status = "INCOMPLETE_LOADING";
    else if (acc.qualityFlags.has("INCOMPLETE_DUMPING")) cycle.candidate_status = "INCOMPLETE_DUMPING";
    else if (acc.qualityFlags.has("MISSING_RETURN")) cycle.candidate_status = "MISSING_RETURN";
    else if (acc.qualityFlags.has("REVIEW_REQUIRED")) cycle.candidate_status = "REVIEW";
    else cycle.candidate_status = "COMPLETE_CANDIDATE";
  }

  cycle.source_position_ids = acc.allPositionIds;
  cycle.source_geofence_event_ids = acc.allEventIds;
  return cycle as CycleCandidate;
}

function finalizeCycle(acc: CycleAccumulator): CycleCandidate {
  const cycle = acc.currentCycle;
  cycle.distance_total_m = sumDistanceMeters(acc.positionsInPhase);
  cycle.quality_flags = Array.from(acc.qualityFlags);
  if (!cycle.candidate_status) {
    if (acc.qualityFlags.has("INCOMPLETE_LOADING")) cycle.candidate_status = "INCOMPLETE_LOADING";
    else if (acc.qualityFlags.has("INCOMPLETE_DUMPING")) cycle.candidate_status = "INCOMPLETE_DUMPING";
    else if (acc.qualityFlags.has("MISSING_RETURN")) cycle.candidate_status = "MISSING_RETURN";
    else cycle.candidate_status = "INCOMPLETE_LOADING";
  }
  cycle.source_position_ids = acc.allPositionIds;
  cycle.source_geofence_event_ids = acc.allEventIds;
  return cycle as CycleCandidate;
}

// ─── PIPELINE ──────────────────────────────────────────────────────

export interface CycleEngineResult {
  run_id: string | null;
  units_processed: number;
  candidates_generated: number;
  complete: number;
  incomplete: number;
  review: number;
  candidates: CycleCandidate[];
}

export interface GeofenceEventRow {
  event_id: string;
  run_id: string | null;
  unit: string;
  device_id: number;
  geofence_id: string;
  event_type: string;
  fix_time: Date;
  latitude: number;
  longitude: number;
  position_id: string;
}

export interface RawPositionRow {
  id: string;
  unit: string;
  device_id: number;
  fix_time: Date;
  latitude: number;
  longitude: number;
}

/**
 * Run the cycle candidate engine on geofence events.
 *
 * @param client - PostgreSQL client
 * @param geofenceTypes - Map of geofence_id → geofence type (e.g. "LOADING_POINT")
 * @param runId - Optional run/session ID for test isolation
 * @param config - Cycle thresholds
 * @param fromDate - Optional start date filter
 * @param toDate - Optional end date filter
 */
export async function runCycleEngine(
  client: Client,
  geofenceTypes: Map<string, string>,
  runId?: string | null,
  config: CycleConfig = DEFAULT_CYCLE_CONFIG,
  fromDate?: Date,
  toDate?: Date,
): Promise<CycleEngineResult> {
  // Load geofence events ordered by fix_time
  let query = `
    SELECT event_id, run_id, unit, device_id, geofence_id, event_type,
           fix_time, latitude, longitude, position_id
    FROM fms_geofence_events
    WHERE 1=1
  `;
  const params: any[] = [];

  if (runId) {
    query += ` AND run_id = $${params.length + 1}`;
    params.push(runId);
  }
  if (fromDate) {
    query += ` AND fix_time >= $${params.length + 1}`;
    params.push(fromDate);
  }
  if (toDate) {
    query += ` AND fix_time <= $${params.length + 1}`;
    params.push(toDate);
  }
  query += ` ORDER BY fix_time ASC`;

  const eventResult = await client.query(query, params);
  const events: GeofenceEventRow[] = eventResult.rows.map((r: any) => ({
    event_id: r.event_id,
    run_id: r.run_id,
    unit: r.unit,
    device_id: parseInt(r.device_id),
    geofence_id: r.geofence_id,
    event_type: r.event_type,
    fix_time: new Date(r.fix_time),
    latitude: parseFloat(r.latitude),
    longitude: parseFloat(r.longitude),
    position_id: r.position_id,
  }));

  // Group events by unit
  const eventsByUnit = new Map<string, GeofenceEventRow[]>();
  for (const evt of events) {
    const list = eventsByUnit.get(evt.unit) || [];
    list.push(evt);
    eventsByUnit.set(evt.unit, list);
  }

  // Process each unit
  const allCandidates: CycleCandidate[] = [];
  const unitsProcessed = eventsByUnit.size;

  for (const [unit, unitEvents] of Array.from(eventsByUnit)) {
    const acc = newAccumulator(unit, unitEvents[0].device_id);

    for (const evt of unitEvents) {
      const role = resolveGeofenceRole(geofenceTypes.get(evt.geofence_id) ?? "OTHER");

      const completed = transitionState(
        acc,
        evt.event_type as "GEOFENCE_ENTER" | "GEOFENCE_EXIT",
        role,
        evt.geofence_id,
        evt.fix_time,
        evt.position_id,
        evt.latitude,
        evt.longitude,
        config,
      );

      if (completed) {
        allCandidates.push(completed);
      }
    }

    // Flush incomplete cycle at end of data — but NOT if we just entered LP with no activity
    if (acc.state !== "OUTSIDE" && acc.state !== "CYCLE_COMPLETE_CANDIDATE") {
      // Skip flush if we just entered LP after completing a cycle (no real activity yet)
      if (acc.state === "AT_LOADING_POINT" && !acc.hasActivityBeyondEntry && acc.completedCycleCount > 0) {
        // Don't flush — unit is just sitting at loading at end of data, not a real incomplete cycle
      } else if (acc.currentCycle.loading_enter_time) {
        const incomplete = finalizeCycle(acc);
        // Apply MISSING_RETURN if we were returning but never reached loading
        if (acc.state === "RETURNING") {
          acc.qualityFlags.add("MISSING_RETURN");
          incomplete.quality_flags = Array.from(acc.qualityFlags);
          incomplete.candidate_status = "MISSING_RETURN";
        }
        // Apply INCOMPLETE_LOADING if we entered but never exited loading
        if (acc.state === "AT_LOADING_POINT" || acc.state === "LOADING_DWELL") {
          acc.qualityFlags.add("INCOMPLETE_LOADING");
          incomplete.quality_flags = Array.from(acc.qualityFlags);
          incomplete.candidate_status = "INCOMPLETE_LOADING";
        }
        // Apply INCOMPLETE_DUMPING if at dumping but never exited
        if (acc.state === "AT_DUMPING_POINT" || acc.state === "DUMPING_DWELL") {
          acc.qualityFlags.add("INCOMPLETE_DUMPING");
          incomplete.quality_flags = Array.from(acc.qualityFlags);
          incomplete.candidate_status = "INCOMPLETE_DUMPING";
        }
        incomplete.end_fix_time = unitEvents[unitEvents.length - 1].fix_time;
        incomplete.duration_total_s = diffSeconds(
          incomplete.end_fix_time, incomplete.start_fix_time,
        );
        allCandidates.push(incomplete);
      }
    }
  }

  // Persist candidates — set run_id from the engine parameter
  for (const cyc of allCandidates) {
    cyc.run_id = runId ?? null;
    await insertCycleCandidate(client, cyc);
  }

  return {
    run_id: runId ?? null,
    units_processed: unitsProcessed,
    candidates_generated: allCandidates.length,
    complete: allCandidates.filter((c) => c.candidate_status === "COMPLETE_CANDIDATE").length,
    incomplete: allCandidates.filter((c) =>
      c.candidate_status.startsWith("INCOMPLETE") || c.candidate_status === "MISSING_RETURN",
    ).length,
    review: allCandidates.filter((c) => c.candidate_status === "REVIEW").length,
    candidates: allCandidates,
  };
}

// ─── PERSISTENCE ───────────────────────────────────────────────────

async function insertCycleCandidate(
  client: Client,
  cycle: CycleCandidate,
): Promise<void> {
  await client.query(
    `INSERT INTO fms_cycle_candidates
     (cycle_id, run_id, unit, device_id, operator, loader,
      loading_point, dumping_point,
      start_fix_time, loading_enter_time, loading_exit_time,
      dumping_enter_time, dumping_exit_time, return_time, end_fix_time,
      duration_total_s, loading_dwell_s, travel_loaded_duration_s,
      dumping_dwell_s, return_duration_s,
      distance_outbound_m, distance_return_m, distance_total_m,
      source_position_ids, source_geofence_event_ids,
      quality_flags, candidate_status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27)
     ON CONFLICT (cycle_id) DO NOTHING`,
    [
      cycle.cycle_id, cycle.run_id, cycle.unit, cycle.device_id,
      cycle.operator ?? null, cycle.loader ?? null,
      cycle.loading_point ?? null, cycle.dumping_point ?? null,
      cycle.start_fix_time, cycle.loading_enter_time ?? null,
      cycle.loading_exit_time ?? null, cycle.dumping_enter_time ?? null,
      cycle.dumping_exit_time ?? null, cycle.return_time ?? null,
      cycle.end_fix_time ?? null,
      cycle.duration_total_s ?? null, cycle.loading_dwell_s ?? null,
      cycle.travel_loaded_duration_s ?? null, cycle.dumping_dwell_s ?? null,
      cycle.return_duration_s ?? null,
      cycle.distance_outbound_m ?? null, cycle.distance_return_m ?? null,
      cycle.distance_total_m ?? null,
      JSON.stringify(cycle.source_position_ids),
      JSON.stringify(cycle.source_geofence_event_ids),
      JSON.stringify(cycle.quality_flags),
      cycle.candidate_status,
    ],
  );
}
