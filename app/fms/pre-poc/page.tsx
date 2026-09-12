import { createTraccarAdapter } from "@/lib/fms/traccar-adapter";
import { PRE_POC_UNITS, simulateTraccarPosition } from "@/lib/fms/telemetry-simulator";

export const metadata = {
  title: "Faztrack FMS — Pre-POC Telemetry",
  description: "Simulasi telemetry sebelum FMC650 terpasang di unit tambang.",
};

function valueOf<T extends object>(payload: unknown, key: keyof T) {
  if (!payload || typeof payload !== "object") return undefined;
  return (payload as T)[key];
}

export default function PrePocTelemetryPage() {
  const tick = 42;
  const bindings = PRE_POC_UNITS.map((unit) => ({
    traccarDeviceId: unit.traccarDeviceId,
    unit: unit.unit,
  }));
  const adapt = createTraccarAdapter({
    deviceBindings: bindings,
    shiftResolver: () => "DAY",
    receivedAtFactory: () => "2026-09-08T01:07:01.000Z",
  });

  const rows = PRE_POC_UNITS.map((unit) => {
    const position = simulateTraccarPosition(unit, {
      tick,
      startTimeIso: "2026-09-08T01:00:00.000Z",
      intervalSeconds: 10,
    });
    const events = adapt(position);
    const lokasi = events.find((event) => event.event_type === "Lokasi");
    const kecepatan = events.find((event) => event.event_type === "Kecepatan");
    const hm = events.find((event) => event.event_type === "HM");
    const km = events.find((event) => event.event_type === "KM");

    return {
      unit: unit.unit,
      deviceId: unit.traccarDeviceId,
      waktu: position.fixTime,
      latitude: valueOf<{ latitude: number }>(lokasi?.payload, "latitude"),
      longitude: valueOf<{ longitude: number }>(lokasi?.payload, "longitude"),
      kecepatan: valueOf<{ kecepatan_km_jam: number }>(kecepatan?.payload, "kecepatan_km_jam"),
      hm: valueOf<{ hm: number }>(hm?.payload, "hm"),
      km: valueOf<{ km: number }>(km?.payload, "km"),
    };
  });

  return (
    <main style={{ minHeight: "100vh", background: "#0d1117", color: "#f8fafc", padding: 28, fontFamily: "Arial, sans-serif" }}>
      <div style={{ maxWidth: 1280, margin: "0 auto" }}>
        <header style={{ display: "flex", justifyContent: "space-between", gap: 24, alignItems: "flex-start", marginBottom: 28 }}>
          <div>
            <p style={{ margin: 0, color: "#f2a51a", fontWeight: 700, letterSpacing: 1.2, fontSize: 12 }}>FAZTRACK MINING FMS · PRE-POC</p>
            <h1 style={{ margin: "8px 0 6px", fontSize: 34 }}>Telemetry Simulator</h1>
            <p style={{ margin: 0, color: "#aeb7c4", maxWidth: 760 }}>Simulasi ini memakai format data yang sama dengan jalur Traccar/FMC650. Nilai di bawah adalah data sintetis untuk menguji software sebelum alat fisik tiba.</p>
          </div>
          <div style={{ border: "1px solid #2c3440", borderRadius: 10, padding: "10px 14px", background: "#151b23", fontSize: 13 }}>
            <div><strong>Shift:</strong> DAY</div>
            <div><strong>Sumber:</strong> SIMULATOR → TRACCAR ADAPTER</div>
            <div><strong>Authority:</strong> PROVISIONAL</div>
          </div>
        </header>

        <section style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 12, marginBottom: 20 }}>
          {[ ["Unit", rows.length], ["Online", rows.length], ["Event Type", "Lokasi · Kecepatan · HM · KM"], ["Ritasi", "BELUM DIHITUNG"] ].map(([label, value]) => (
            <div key={String(label)} style={{ background: "#151b23", border: "1px solid #27303b", borderRadius: 12, padding: 16 }}>
              <div style={{ color: "#8d99a8", fontSize: 12, textTransform: "uppercase", letterSpacing: .7 }}>{label}</div>
              <div style={{ marginTop: 7, fontSize: 20, fontWeight: 700 }}>{value}</div>
            </div>
          ))}
        </section>

        <section style={{ background: "#151b23", border: "1px solid #27303b", borderRadius: 14, overflow: "hidden" }}>
          <div style={{ padding: "15px 18px", borderBottom: "1px solid #27303b" }}>
            <strong>Live Fleet — Machine Observation</strong>
            <span style={{ color: "#8d99a8", marginLeft: 10, fontSize: 12 }}>Tidak menginferensi Working / Standby / Delay / BD / Ritasi</span>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 920 }}>
              <thead>
                <tr style={{ background: "#11161d", textAlign: "left", color: "#9aa6b4", fontSize: 12 }}>
                  {["Unit","Device ID","Waktu","Latitude","Longitude","Kecepatan","HM","KM","Status Data"].map((head) => <th key={head} style={{ padding: "12px 14px", borderBottom: "1px solid #27303b" }}>{head}</th>)}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.unit} style={{ borderBottom: "1px solid #202833" }}>
                    <td style={{ padding: "13px 14px", fontWeight: 700 }}>{row.unit}</td>
                    <td style={{ padding: "13px 14px" }}>{row.deviceId}</td>
                    <td style={{ padding: "13px 14px" }}>{row.waktu.slice(11, 19)}</td>
                    <td style={{ padding: "13px 14px" }}>{typeof row.latitude === "number" ? row.latitude.toFixed(5) : "—"}</td>
                    <td style={{ padding: "13px 14px" }}>{typeof row.longitude === "number" ? row.longitude.toFixed(5) : "—"}</td>
                    <td style={{ padding: "13px 14px" }}>{typeof row.kecepatan === "number" ? `${row.kecepatan.toFixed(1)} km/jam` : "—"}</td>
                    <td style={{ padding: "13px 14px" }}>{typeof row.hm === "number" ? row.hm.toFixed(2) : "—"}</td>
                    <td style={{ padding: "13px 14px" }}>{typeof row.km === "number" ? row.km.toFixed(2) : "—"}</td>
                    <td style={{ padding: "13px 14px" }}><span style={{ color: "#f2a51a", fontWeight: 700 }}>PROVISIONAL</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <div style={{ marginTop: 18, display: "flex", gap: 12, flexWrap: "wrap" }}>
          <a href="/fms/shift-board" style={{ color: "#111", background: "#f2a51a", padding: "11px 15px", borderRadius: 8, textDecoration: "none", fontWeight: 700 }}>Buka Digital Shift Board →</a>
          <a href="/telemetry" style={{ color: "#d8dee7", border: "1px solid #394452", padding: "11px 15px", borderRadius: 8, textDecoration: "none" }}>Telemetry Existing</a>
        </div>
      </div>
    </main>
  );
}
