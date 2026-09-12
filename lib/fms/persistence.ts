import { desc, eq, and } from "drizzle-orm";
import { getDb } from "@/db";
import { fmsCanonicalEvents, fmsHourlyControl, fmsP2hChecks, fmsShiftAssignments } from "@/db/schema";
import type { CanonicalMiningEvent } from "./canonical-event";

export async function saveCanonicalEvents(events: CanonicalMiningEvent[]) {
  if (!events.length) return;
  const db = getDb();
  await db.insert(fmsCanonicalEvents).values(events.map((event) => ({
    eventId: event._event_id,
    eventType: event.event_type,
    waktu: event.waktu,
    tanggalOperasional: event.tanggal_operasional,
    shift: event.shift,
    unit: event.unit,
    operator: event.operator,
    sourceType: event.source_type,
    sourceName: event.source_name,
    authorityStatus: event.authority_status,
    payloadJson: JSON.stringify(event.payload),
    sourceRecordId: event._source_record_id,
    receivedAt: event._received_at,
    recordStatus: event._record_status,
  }))).onConflictDoNothing();
}

export async function listShiftAssignments(tanggal: string, shift: string) {
  return getDb().select().from(fmsShiftAssignments)
    .where(and(eq(fmsShiftAssignments.tanggal, tanggal), eq(fmsShiftAssignments.shift, shift)))
    .orderBy(fmsShiftAssignments.loader, fmsShiftAssignments.hauler);
}

export async function latestP2hForUnit(unit: string) {
  const rows = await getDb().select().from(fmsP2hChecks)
    .where(eq(fmsP2hChecks.unit, unit)).orderBy(desc(fmsP2hChecks.createdAt)).limit(1);
  return rows[0] ?? null;
}

export async function listHourlyControl(tanggal: string, shift: string) {
  return getDb().select().from(fmsHourlyControl)
    .where(and(eq(fmsHourlyControl.tanggal, tanggal), eq(fmsHourlyControl.shift, shift)))
    .orderBy(fmsHourlyControl.hourBucket, fmsHourlyControl.loader, fmsHourlyControl.unit);
}
