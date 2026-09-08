import { createTraccarAdapter } from "@/lib/fms/traccar-adapter";
import { PRE_POC_UNITS, simulateTraccarPosition } from "@/lib/fms/telemetry-simulator";

export async function GET() {
  const tanggal = "2026-09-08";
  const shift = "DAY";
  const assignment = {
    tanggal,
    shift,
    loader: "EX-501",
    operatorLoader: "Norman",
    hauler: "DT-3055",
    operatorHauler: "Nurul",
    loadingPoint: "PIT BR23",
    dumpingPoint: "OPD_02",
    material: "Limonite",
    authority: "HUMAN_AUTHORITY",
  } as const;

  const p2h = {
    tanggal,
    shift,
    unit: assignment.hauler,
    namaOperator: assignment.operatorHauler,
    hmAwal: 4001,
    kmAwal: 19827,
    keputusanP2h: "LAYAK DIOPERASIKAN",
    keputusanOleh: "Human",
  } as const;

  const unit = PRE_POC_UNITS.find((item) => item.unit === assignment.hauler);
  if (!unit) {
    return Response.json({ error: "Unit simulator tidak ditemukan" }, { status: 500 });
  }

  const position = simulateTraccarPosition(unit, {
    tick: 42,
    startTimeIso: "2026-09-08T01:00:00.000Z",
    intervalSeconds: 10,
  });

  const adapt = createTraccarAdapter({
    deviceBindings: [{ traccarDeviceId: unit.traccarDeviceId, unit: unit.unit }],
    shiftResolver: () => shift,
    receivedAtFactory: () => "2026-09-08T01:07:01.000Z",
  });
  const events = adapt(position);

  const hasLokasi = events.some((event) => event.event_type === "Lokasi");
  const hasKecepatan = events.some((event) => event.event_type === "Kecepatan");
  const hasHm = events.some((event) => event.event_type === "HM");
  const hasKm = events.some((event) => event.event_type === "KM");
  const illegallyInferredRitasi = events.some((event) => event.event_type === "Ritasi");
  const illegallyInferredStatus = events.some((event) => event.event_type === "Status Unit");

  const checks = [
    { gate: "Shift Assignment", pass: assignment.authority === "HUMAN_AUTHORITY", evidence: `${assignment.loader} → ${assignment.hauler} / ${assignment.operatorHauler}` },
    { gate: "P2H", pass: p2h.keputusanP2h === "LAYAK DIOPERASIKAN" && p2h.keputusanOleh === "Human", evidence: p2h.keputusanP2h },
    { gate: "Telemetry Unit Match", pass: events.every((event) => event.unit === assignment.hauler), evidence: assignment.hauler },
    { gate: "Lokasi", pass: hasLokasi, evidence: hasLokasi ? "Canonical Event tersedia" : "Missing" },
    { gate: "Kecepatan", pass: hasKecepatan, evidence: hasKecepatan ? "Canonical Event tersedia" : "Missing" },
    { gate: "HM", pass: hasHm, evidence: hasHm ? "Canonical Event PROVISIONAL" : "Missing" },
    { gate: "KM", pass: hasKm, evidence: hasKm ? "Canonical Event PROVISIONAL" : "Missing" },
    { gate: "No Auto Ritasi", pass: !illegallyInferredRitasi, evidence: "Counting rule masih REVIEW" },
    { gate: "No Auto Status Unit", pass: !illegallyInferredStatus, evidence: "Working/Standby/Delay/BD belum diinferensi" },
  ];

  const passed = checks.every((check) => check.pass);

  return Response.json({
    mode: "PRE_POC_DETERMINISTIC_DEMO",
    persistence: "NOT_TESTED — D1 binding belum tersedia pada hosting config",
    passed,
    assignment,
    p2h,
    telemetry: {
      source: "Simulator → Traccar Adapter",
      deviceId: unit.traccarDeviceId,
      eventTypes: events.map((event) => event.event_type),
      authority: "PROVISIONAL",
    },
    checks,
    nextGate: "Bind Cloudflare D1, run migrations, then repeat the same flow with persistence enabled.",
  });
}
