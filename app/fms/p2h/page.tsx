export const metadata = {
  title: "Faztrack FMS — Digital P2H",
  description: "Digital mirror Daily Operational Checklist tanpa mengubah flow klien.",
};

const physicalChecks = [
  "Track / Tyre",
  "Oil Engine / Hydraulic / Transmission",
  "Air Radiator",
  "APAR",
  "Seat Belt",
  "Klakson & Alarm Mundur",
  "Panel Control",
  "Brake System",
  "Steering System",
  "Lampu",
  "Function Attachment",
  "Spion",
];

const systemChecks = [
  ["HM Awal", "4,001.00", "AUTO / MANUAL"],
  ["KM Awal", "19,827.00", "AUTO / MANUAL"],
  ["Battery", "NORMAL", "AUTO"],
  ["Engine", "NORMAL", "AUTO"],
  ["DTC", "TIDAK ADA", "AUTO jika tersedia"],
];

export default function DigitalP2HPage() {
  return (
    <main style={{ minHeight: "100vh", background: "#eef1f4", padding: 28, fontFamily: "Arial, sans-serif", color: "#17202a" }}>
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        <header style={{ marginBottom: 20 }}>
          <p style={{ margin: 0, color: "#d98200", fontWeight: 700, fontSize: 12, letterSpacing: 1 }}>FAZTRACK MINING FMS · DIGITAL MIRROR</p>
          <h1 style={{ margin: "7px 0 5px" }}>Daily Operational Checklist / P2H</h1>
          <p style={{ margin: 0, color: "#66717d" }}>Flow dan istilah klien dipertahankan. Pemeriksaan fisik tetap dilakukan manusia; data mesin hanya membantu auto-fill bila sudah tervalidasi.</p>
        </header>

        <section style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 10, marginBottom: 16 }}>
          {[
            ["Tanggal", "08 Sep 2026"],
            ["Shift", "DAY"],
            ["Nama Operator", "Nurul"],
            ["NRP", "—"],
            ["Unit", "DT-3055"],
            ["Tipe / No Alat", "Dump Truck"],
            ["HM Awal", "4,001.00"],
            ["KM Awal", "19,827.00"],
          ].map(([label, value]) => (
            <div key={label} style={{ background: "white", border: "1px solid #d9dfe6", borderRadius: 10, padding: 14 }}>
              <small style={{ color: "#7a8591", textTransform: "uppercase", fontWeight: 700 }}>{label}</small>
              <div style={{ fontSize: 18, fontWeight: 700, marginTop: 5 }}>{value}</div>
            </div>
          ))}
        </section>

        <section style={{ background: "white", border: "1px solid #d9dfe6", borderRadius: 12, overflow: "hidden", marginBottom: 16 }}>
          <div style={{ padding: "14px 16px", background: "#18212b", color: "white" }}><strong>Pemeriksaan Fisik — Human Check</strong></div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))" }}>
            {physicalChecks.map((item) => (
              <div key={item} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "13px 16px", borderBottom: "1px solid #edf0f3" }}>
                <span>{item}</span>
                <span style={{ display: "flex", gap: 7 }}>
                  <b style={{ color: "#177245", border: "1px solid #b8dcca", borderRadius: 6, padding: "5px 8px" }}>✓ Baik</b>
                  <span style={{ color: "#9a3a32", border: "1px solid #e5c3bf", borderRadius: 6, padding: "5px 8px" }}>Tidak Baik</span>
                </span>
              </div>
            ))}
          </div>
        </section>

        <section style={{ background: "white", border: "1px solid #d9dfe6", borderRadius: 12, overflow: "hidden", marginBottom: 16 }}>
          <div style={{ padding: "14px 16px", background: "#2d3742", color: "white" }}><strong>Pemeriksaan Sistem — Machine Observation</strong></div>
          {systemChecks.map(([parameter, value, source]) => (
            <div key={parameter} style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr 1fr", padding: "12px 16px", borderBottom: "1px solid #edf0f3" }}>
              <b>{parameter}</b><span>{value}</span><span style={{ color: "#d98200", fontWeight: 700 }}>{source}</span>
            </div>
          ))}
        </section>

        <section style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 14 }}>
          <div style={{ background: "white", border: "1px solid #d9dfe6", borderRadius: 12, padding: 16 }}>
            <small style={{ color: "#7a8591", fontWeight: 700 }}>REMARKS / CATATAN</small>
            <div style={{ minHeight: 90, border: "1px dashed #c9d0d8", borderRadius: 8, marginTop: 9, padding: 10, color: "#8a949f" }}>Diisi operator/pengawas bila ada temuan.</div>
          </div>
          <div style={{ background: "#fff7e8", border: "1px solid #efc675", borderRadius: 12, padding: 16 }}>
            <small style={{ color: "#8d6413", fontWeight: 700 }}>KEPUTUSAN P2H</small>
            <h2 style={{ margin: "8px 0", color: "#276447" }}>LAYAK DIOPERASIKAN</h2>
            <p style={{ margin: 0, color: "#6c5a35", fontSize: 13 }}>Keputusan tetap dilakukan manusia. Sistem tidak mengubah status layak/tidak layak otomatis.</p>
          </div>
        </section>

        <div style={{ marginTop: 18, display: "flex", gap: 10 }}>
          <a href="/fms/shift-board" style={{ textDecoration: "none", color: "#26323d", border: "1px solid #b8c0c8", borderRadius: 8, padding: "10px 13px" }}>← Shift Board</a>
          <a href="/fms/ccr-hourly" style={{ textDecoration: "none", color: "#111", background: "#f2a51a", borderRadius: 8, padding: "10px 13px", fontWeight: 700 }}>CCR Hourly Control →</a>
        </div>
      </div>
    </main>
  );
}
