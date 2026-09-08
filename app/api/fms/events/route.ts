import { desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { fmsCanonicalEvents } from "@/db/schema";
import { FMS_EVENT_TYPES, type CanonicalMiningEvent } from "@/lib/fms/canonical-event";

export async function GET(request: Request) {
  const db = getDb();
  const url = new URL(request.url);
  const unit = url.searchParams.get("unit");
  const rows = unit
    ? await db.select().from(fmsCanonicalEvents).where(eq(fmsCanonicalEvents.unit, unit)).orderBy(desc(fmsCanonicalEvents.waktu)).limit(500)
    : await db.select().from(fmsCanonicalEvents).orderBy(desc(fmsCanonicalEvents.waktu)).limit(500);
  return Response.json({ data: rows });
}

export async function POST(request: Request) {
  const db = getDb();
  const event = (await request.json()) as CanonicalMiningEvent;
  if (!FMS_EVENT_TYPES.includes(event.event_type)) {
    return Response.json({ error: "event_type tidak dikenal" }, { status: 400 });
  }
  if (!event._event_id || !event.waktu || !event.tanggal_operasional || !event.source_name) {
    return Response.json({ error: "canonical event belum lengkap" }, { status: 400 });
  }

  await db.insert(fmsCanonicalEvents).values({
    eventId: event._event_id,
    eventType: event.event_type,
    waktu: event.waktu,
    tanggalOperasional: event.tanggal_operasional,
    shift: event.shift ?? null,
    unit: event.unit ?? null,
    operator: event.operator ?? null,
    sourceType: event.source_type,
    sourceName: event.source_name,
    authorityStatus: event.authority_status,
    payloadJson: JSON.stringify(event.payload),
    sourceRecordId: event._source_record_id ?? null,
    receivedAt: event._received_at,
    recordStatus: event._record_status,
  }).onConflictDoNothing();

  return Response.json({ data: { event_id: event._event_id, accepted: true } }, { status: 202 });
}
