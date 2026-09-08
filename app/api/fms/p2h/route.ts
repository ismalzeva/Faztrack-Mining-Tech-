import { desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { fmsP2hChecks } from "@/db/schema";

export async function GET(request: Request) {
  const db = getDb();
  const url = new URL(request.url);
  const unit = url.searchParams.get("unit");
  const rows = unit
    ? await db.select().from(fmsP2hChecks).where(eq(fmsP2hChecks.unit, unit)).orderBy(desc(fmsP2hChecks.createdAt)).limit(100)
    : await db.select().from(fmsP2hChecks).orderBy(desc(fmsP2hChecks.createdAt)).limit(200);
  return Response.json({ data: rows });
}

export async function POST(request: Request) {
  const db = getDb();
  const body = await request.json();
  if (!body.tanggal || !body.shift || !body.unit || !body.keputusanP2h) {
    return Response.json({ error: "Tanggal, Shift, Unit, dan Keputusan P2H wajib diisi" }, { status: 400 });
  }
  if (!["LAYAK DIOPERASIKAN", "TIDAK LAYAK DIOPERASIKAN"].includes(body.keputusanP2h)) {
    return Response.json({ error: "Keputusan P2H tidak dikenal" }, { status: 400 });
  }

  const row = {
    id: crypto.randomUUID(),
    shiftAssignmentId: body.shiftAssignmentId ?? null,
    tanggal: body.tanggal,
    shift: body.shift,
    namaOperator: body.namaOperator ?? null,
    nrp: body.nrp ?? null,
    unit: body.unit,
    hmAwal: typeof body.hmAwal === "number" ? body.hmAwal : null,
    kmAwal: typeof body.kmAwal === "number" ? body.kmAwal : null,
    checklistJson: JSON.stringify(body.checklist ?? {}),
    remarks: body.remarks ?? null,
    keputusanP2h: body.keputusanP2h,
    keputusanOleh: body.keputusanOleh ?? null,
    sourceName: "Digital P2H",
    createdAt: new Date().toISOString(),
  };
  await db.insert(fmsP2hChecks).values(row);
  return Response.json({ data: row }, { status: 201 });
}
