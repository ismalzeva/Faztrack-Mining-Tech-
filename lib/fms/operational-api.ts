/**
 * Single source of truth for the Faztrack FMS operational API surface.
 *
 * These handlers hold the EXACT semantics that previously lived inline in
 * `app/api/fms/{assignments,events,p2h}/route.ts` — status codes, validation
 * messages, row shapes, ordering and limits are byte-for-byte preserved.
 *
 * They are consumed by the native Node operational backend (`server/fms-api.mjs`)
 * which reaches PostgreSQL/PostGIS directly. The Vinext route handlers are thin
 * proxies to that backend, because the `postgres` TCP driver must never be
 * loaded through the Cloudflare-targeted Vinext bundle.
 *
 * Human authority is preserved: Shift Assignment and the P2H operability
 * decision are HUMAN-controlled records. Nothing here infers operational
 * status from telemetry.
 */

import { desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { fmsCanonicalEvents, fmsP2hChecks, fmsShiftAssignments } from "@/db/schema";
import { FMS_EVENT_TYPES, type CanonicalMiningEvent } from "./canonical-event";

export type ApiResult = { status: number; body: unknown };

const ok = (body: unknown): ApiResult => ({ status: 200, body });
const fail = (status: number, error: string): ApiResult => ({ status, body: { error } });

type Json = Record<string, unknown>;
const asObject = (value: unknown): Json =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : {};

/* ------------------------------------------------------------------ *
 * Digital Shift Board — fms_shift_assignments (HUMAN AUTHORITY)
 * ------------------------------------------------------------------ */

export async function getShiftAssignments(query: URLSearchParams): Promise<ApiResult> {
  const db = getDb();
  const tanggal = query.get("tanggal");
  const rows = tanggal
    ? await db
        .select()
        .from(fmsShiftAssignments)
        .where(eq(fmsShiftAssignments.tanggal, tanggal))
        .orderBy(desc(fmsShiftAssignments.updatedAt))
    : await db
        .select()
        .from(fmsShiftAssignments)
        .orderBy(desc(fmsShiftAssignments.updatedAt))
        .limit(200);
  return ok({ data: rows });
}

export async function createShiftAssignment(payload: unknown): Promise<ApiResult> {
  const body = asObject(payload);
  const required = ["tanggal", "shift", "hauler"] as const;
  for (const key of required) {
    if (!body[key]) return fail(400, `${key} wajib diisi`);
  }

  const now = new Date();
  const row = {
    id: crypto.randomUUID(),
    tanggal: body.tanggal as string,
    shift: body.shift as string,
    siteProject: (body.siteProject as string) ?? null,
    loader: (body.loader as string) ?? null,
    operatorLoader: (body.operatorLoader as string) ?? null,
    hauler: body.hauler as string,
    operatorHauler: (body.operatorHauler as string) ?? null,
    loadingPoint: (body.loadingPoint as string) ?? null,
    dumpingPoint: (body.dumpingPoint as string) ?? null,
    material: (body.material as string) ?? null,
    statusAssignment: (body.statusAssignment as string) ?? "ASSIGNED",
    sourceName: "Digital Shift Board",
    createdBy: (body.createdBy as string) ?? null,
    createdAt: now,
    updatedAt: now,
  };
  await getDb().insert(fmsShiftAssignments).values(row);
  return { status: 201, body: { data: row } };
}

/* ------------------------------------------------------------------ *
 * Canonical FMS events — fms_canonical_events
 * ------------------------------------------------------------------ */

/**
 * Drizzle columns declared `{ withTimezone: true }` use the `date` mode, so the
 * driver expects a `Date` instance. Passing an ISO string throws
 * `value.toISOString is not a function` — a latent bug in the original handlers
 * that was masked by the runtime blocker. Returns null for unusable input rather
 * than fabricating a timestamp.
 */
function toDate(value: unknown): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value !== "string" || value.trim() === "") return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export async function listCanonicalEvents(query: URLSearchParams): Promise<ApiResult> {
  const db = getDb();
  const unit = query.get("unit");
  const rows = unit
    ? await db
        .select()
        .from(fmsCanonicalEvents)
        .where(eq(fmsCanonicalEvents.unit, unit))
        .orderBy(desc(fmsCanonicalEvents.waktu))
        .limit(500)
    : await db
        .select()
        .from(fmsCanonicalEvents)
        .orderBy(desc(fmsCanonicalEvents.waktu))
        .limit(500);
  return ok({ data: rows });
}

export async function createCanonicalEvent(payload: unknown): Promise<ApiResult> {
  const event = asObject(payload) as unknown as CanonicalMiningEvent;

  if (!FMS_EVENT_TYPES.includes(event.event_type)) {
    return fail(400, "event_type tidak dikenal");
  }
  if (!event._event_id || !event.waktu || !event.tanggal_operasional || !event.source_name) {
    return fail(400, "canonical event belum lengkap");
  }

  // `waktu` is a business timestamp: unparseable input fails validation rather
  // than being silently replaced. `_received_at` carries the ingestion receipt
  // time; when absent the column's now() default applies (unchanged behaviour),
  // but a present-yet-unparseable value is a client error, not a silent now().
  const waktu = toDate(event.waktu);
  if (!waktu) return fail(400, "waktu tidak valid");
  const receivedAt =
    event._received_at == null ? null : toDate(event._received_at);
  if (event._received_at != null && !receivedAt) {
    return fail(400, "_received_at tidak valid");
  }

  await getDb()
    .insert(fmsCanonicalEvents)
    .values({
      eventId: event._event_id,
      eventType: event.event_type,
      waktu,
      tanggalOperasional: event.tanggal_operasional,
      shift: event.shift ?? null,
      unit: event.unit ?? null,
      operator: event.operator ?? null,
      sourceType: event.source_type,
      sourceName: event.source_name,
      authorityStatus: event.authority_status,
      payloadJson: JSON.stringify(event.payload),
      sourceRecordId: event._source_record_id ?? null,
      receivedAt: receivedAt ?? new Date(),
      recordStatus: event._record_status,
    })
    .onConflictDoNothing();

  return { status: 202, body: { data: { event_id: event._event_id, accepted: true } } };
}

/* ------------------------------------------------------------------ *
 * Digital P2H — fms_p2h_checks (HUMAN AUTHORITY: operability decision)
 * ------------------------------------------------------------------ */

const P2H_DECISIONS = ["LAYAK DIOPERASIKAN", "TIDAK LAYAK DIOPERASIKAN"];

export async function listP2hChecks(query: URLSearchParams): Promise<ApiResult> {
  const db = getDb();
  const unit = query.get("unit");
  const rows = unit
    ? await db
        .select()
        .from(fmsP2hChecks)
        .where(eq(fmsP2hChecks.unit, unit))
        .orderBy(desc(fmsP2hChecks.createdAt))
        .limit(100)
    : await db
        .select()
        .from(fmsP2hChecks)
        .orderBy(desc(fmsP2hChecks.createdAt))
        .limit(200);
  return ok({ data: rows });
}

export async function createP2hCheck(payload: unknown): Promise<ApiResult> {
  const body = asObject(payload);
  if (!body.tanggal || !body.shift || !body.unit || !body.keputusanP2h) {
    return fail(400, "Tanggal, Shift, Unit, dan Keputusan P2H wajib diisi");
  }
  if (!P2H_DECISIONS.includes(body.keputusanP2h as string)) {
    return fail(400, "Keputusan P2H tidak dikenal");
  }

  const row = {
    id: crypto.randomUUID(),
    shiftAssignmentId: (body.shiftAssignmentId as string) ?? null,
    tanggal: body.tanggal as string,
    shift: body.shift as string,
    namaOperator: (body.namaOperator as string) ?? null,
    nrp: (body.nrp as string) ?? null,
    unit: body.unit as string,
    hmAwal: typeof body.hmAwal === "number" ? body.hmAwal : null,
    kmAwal: typeof body.kmAwal === "number" ? body.kmAwal : null,
    checklistJson: JSON.stringify(body.checklist ?? {}),
    remarks: (body.remarks as string) ?? null,
    keputusanP2h: body.keputusanP2h as string,
    keputusanOleh: (body.keputusanOleh as string) ?? null,
    sourceName: "Digital P2H",
    createdAt: new Date(),
  };
  await getDb().insert(fmsP2hChecks).values(row);
  return { status: 201, body: { data: row } };
}

/* ------------------------------------------------------------------ *
 * Dispatch table used by the native Node backend
 * ------------------------------------------------------------------ */

export type Operation = {
  method: "GET" | "POST";
  handler: (arg: URLSearchParams | unknown) => Promise<ApiResult>;
};

export const OPERATIONS: Record<string, Operation> = {
  "/api/fms/assignments": {
    method: "GET",
    handler: (arg) => getShiftAssignments(arg as URLSearchParams),
  },
  "/api/fms/assignments:POST": {
    method: "POST",
    handler: (arg) => createShiftAssignment(arg),
  },
  "/api/fms/events": {
    method: "GET",
    handler: (arg) => listCanonicalEvents(arg as URLSearchParams),
  },
  "/api/fms/events:POST": {
    method: "POST",
    handler: (arg) => createCanonicalEvent(arg),
  },
  "/api/fms/p2h": {
    method: "GET",
    handler: (arg) => listP2hChecks(arg as URLSearchParams),
  },
  "/api/fms/p2h:POST": {
    method: "POST",
    handler: (arg) => createP2hCheck(arg),
  },
};
