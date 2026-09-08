import { desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { fmsShiftAssignments } from "@/db/schema";

export async function GET(request: Request) {
  const db = getDb();
  const url = new URL(request.url);
  const tanggal = url.searchParams.get("tanggal");
  const rows = tanggal
    ? await db.select().from(fmsShiftAssignments).where(eq(fmsShiftAssignments.tanggal, tanggal)).orderBy(desc(fmsShiftAssignments.updatedAt))
    : await db.select().from(fmsShiftAssignments).orderBy(desc(fmsShiftAssignments.updatedAt)).limit(200);
  return Response.json({ data: rows });
}

export async function POST(request: Request) {
  const db = getDb();
  const body = await request.json();
  const required = ["tanggal", "shift", "hauler"] as const;
  for (const key of required) {
    if (!body[key]) return Response.json({ error: `${key} wajib diisi` }, { status: 400 });
  }

  const now = new Date().toISOString();
  const row = {
    id: crypto.randomUUID(),
    tanggal: body.tanggal,
    shift: body.shift,
    siteProject: body.siteProject ?? null,
    loader: body.loader ?? null,
    operatorLoader: body.operatorLoader ?? null,
    hauler: body.hauler,
    operatorHauler: body.operatorHauler ?? null,
    loadingPoint: body.loadingPoint ?? null,
    dumpingPoint: body.dumpingPoint ?? null,
    material: body.material ?? null,
    statusAssignment: body.statusAssignment ?? "ASSIGNED",
    sourceName: "Digital Shift Board",
    createdBy: body.createdBy ?? null,
    createdAt: now,
    updatedAt: now,
  };
  await db.insert(fmsShiftAssignments).values(row);
  return Response.json({ data: row }, { status: 201 });
}
