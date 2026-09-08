const assignments = [
  { loader: "EX-501", loaderOperator: "Norman", hauler: "DT-3055", haulerOperator: "Nurul", status: "BELUM DIVALIDASI" },
  { loader: "", loaderOperator: "", hauler: "DT-3056", haulerOperator: "Hasran", status: "BELUM DIVALIDASI" },
  { loader: "", loaderOperator: "", hauler: "DT-3057", haulerOperator: "Salman", status: "BELUM DIVALIDASI" },
  { loader: "EX-510", loaderOperator: "Haerul", hauler: "DT-3058", haulerOperator: "—", status: "BELUM DIVALIDASI" },
  { loader: "", loaderOperator: "", hauler: "DT-3059", haulerOperator: "—", status: "BELUM DIVALIDASI" },
];

export const metadata = {
  title: "Faztrack FMS — Digital Shift Board",
  description: "Digital mirror dari whiteboard assignment awal shift.",
};

export default function ShiftBoardPage() {
  return (
    <main style={{ minHeight: "100vh", background: "#f3f4f6", color: "#171717", padding: 28, fontFamily: "Arial, sans-serif" }}>
      <div style={{ maxWidth: 1280, margin: "0 auto" }}>
        <header style={{ display: "flex", justifyContent: "space-between", gap: 20, alignItems: "flex-start", marginBottom: 22 }}>
          <div>
            <p style={{ margin: 0, color: "#a35f00", fontWeight: 800, fontSize: 12, letterSpacing: 1 }}>FAZTRACK MINING FMS · DIGITAL MIRROR</p>
            <h1 style={{ margin: "7px 0 4px", fontSize: 34 }}>Shift Board</h1>
            <p style={{ margin: 0, color: "#59616d" }}>Digitalisasi whiteboard assignment. Supervisor/CCR tetap menentukan Unit dan Operator.</p>
          </div>
          <div style={{ background: "white", border: "1px solid #d8dde4", borderRadius: 10, padding: "11px 14px", minWidth: 240 }}>
            <div><strong>Tanggal:</strong> 08 September 2026</div>
            <div><strong>Shift:</strong> DAY</div>
            <div><strong>Lokasi:</strong> PIT BR23</div>
          </div>
        </header>

        <div style={{ background: "#fff8e7", border: "1px solid #e8c56c", padding: "12px 14px", borderRadius: 10, marginBottom: 16 }}>
          <strong>Process Fidelity:</strong> board ini tidak mengubah otoritas assignment. Status telemetry belum boleh menggantikan keputusan operasional sebelum parallel-run validation.
        </div>

        <section style={{ background: "white", border: "1px solid #d8dde4", borderRadius: 12, overflow: "hidden" }}>
          <div style={{ padding: "14px 16px", background: "#1b1f24", color: "white", display: "flex", justifyContent: "space-between" }}>
            <strong>ASSIGNMENT UNIT & OPERATOR</strong><span style={{ color: "#f5b335" }}>DAY SHIFT</span>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", minWidth: 850, borderCollapse: "collapse" }}>
              <thead><tr style={{ background: "#eceff3", textAlign: "left" }}>{["Loader","Operator Loader","Hauler","Operator Hauler","Status Unit","Sumber Status"].map((h) => <th key={h} style={{ padding: 13, borderBottom: "1px solid #ccd2da" }}>{h}</th>)}</tr></thead>
              <tbody>{assignments.map((row, index) => <tr key={`${row.hauler}-${index}`}>
                <td style={{ padding: 13, borderBottom: "1px solid #e2e5e9", fontWeight: row.loader ? 800 : 400 }}>{row.loader || ""}</td>
                <td style={{ padding: 13, borderBottom: "1px solid #e2e5e9" }}>{row.loaderOperator}</td>
                <td style={{ padding: 13, borderBottom: "1px solid #e2e5e9", fontWeight: 800 }}>{row.hauler}</td>
                <td style={{ padding: 13, borderBottom: "1px solid #e2e5e9" }}>{row.haulerOperator}</td>
                <td style={{ padding: 13, borderBottom: "1px solid #e2e5e9" }}><strong style={{ color: "#a35f00" }}>{row.status}</strong></td>
                <td style={{ padding: 13, borderBottom: "1px solid #e2e5e9", color: "#68717d" }}>Manual / Telemetry PROVISIONAL</td>
              </tr>)}</tbody>
            </table>
          </div>
        </section>

        <section style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 12, marginTop: 16 }}>
          <div style={{ background: "white", border: "1px solid #d8dde4", borderRadius: 10, padding: 15 }}><small>ASSIGNMENT</small><h3 style={{ margin: "5px 0" }}>Human Authority</h3><p style={{ margin: 0, color: "#65707d" }}>Supervisor/CCR tetap menentukan Unit ↔ Operator.</p></div>
          <div style={{ background: "white", border: "1px solid #d8dde4", borderRadius: 10, padding: 15 }}><small>TELEMETRY</small><h3 style={{ margin: "5px 0" }}>Machine Observation</h3><p style={{ margin: 0, color: "#65707d" }}>Lokasi, Kecepatan, HM, KM masuk sebagai data provisional.</p></div>
          <div style={{ background: "white", border: "1px solid #d8dde4", borderRadius: 10, padding: 15 }}><small>STATUS UNIT</small><h3 style={{ margin: "5px 0" }}>Human Validated</h3><p style={{ margin: 0, color: "#65707d" }}>Working / Standby / Delay / BD tetap memakai istilah klien.</p></div>
        </section>

        <div style={{ marginTop: 18 }}><a href="/fms/pre-poc" style={{ color: "#171717", fontWeight: 800, textDecoration: "none" }}>← Pre-POC Telemetry Simulator</a></div>
      </div>
    </main>
  );
}
