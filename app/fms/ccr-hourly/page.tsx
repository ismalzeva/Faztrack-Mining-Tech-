export const metadata = {
  title: "Faztrack FMS — CCR Hourly Control",
  description: "Digital mirror hourly control untuk CCR.",
};

const hours = ["07–08", "08–09", "09–10", "10–11", "11–12", "12–13", "13–14", "14–15", "15–16", "16–17", "17–18", "18–19"];
const rows = [
  { unit: "DT-3055", values: [3,4,4,3,4,3,4,4,3,4,3,4] },
  { unit: "DT-3056", values: [4,4,3,4,3,4,4,3,4,4,3,4] },
  { unit: "DT-3057", values: [3,3,4,4,4,3,3,4,4,3,4,4] },
  { unit: "DT-3058", values: [4,3,4,3,4,4,3,4,3,4,4,3] },
  { unit: "DT-3059", values: [3,4,3,4,3,4,4,3,4,3,4,4] },
];

export default function CcrHourlyPage() {
  const totals = hours.map((_, index) => rows.reduce((sum, row) => sum + row.values[index], 0));
  const totalRitasi = totals.reduce((sum, value) => sum + value, 0);

  return (
    <main style={{ minHeight: "100vh", background: "#0e1319", color: "#f5f7fa", padding: 28, fontFamily: "Arial, sans-serif" }}>
      <div style={{ maxWidth: 1400, margin: "0 auto" }}>
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 20, marginBottom: 20 }}>
          <div>
            <p style={{ margin: 0, color: "#f2a51a", fontWeight: 700, fontSize: 12, letterSpacing: 1 }}>FAZTRACK MINING FMS · CCR</p>
            <h1 style={{ margin: "7px 0 5px" }}>Hourly Control</h1>
            <p style={{ margin: 0, color: "#9ca7b3" }}>Digital mirror monitoring per jam. Struktur dibuat untuk mengikuti kontrol existing, bukan mengganti cara CCR bekerja.</p>
          </div>
          <div style={{ background: "#171e26", border: "1px solid #29333e", borderRadius: 10, padding: "11px 14px" }}>
            <div><b>Tanggal:</b> 08 Sep 2026</div><div><b>Shift:</b> DAY · 07:00–19:00</div><div><b>Loader:</b> EX-501</div>
          </div>
        </header>

        <section style={{ display: "grid", gridTemplateColumns: "repeat(5,minmax(0,1fr))", gap: 10, marginBottom: 16 }}>
          {[
            ["Plan", "—"],
            ["Actual Ritasi", totalRitasi],
            ["Working Unit", rows.length],
            ["Status Unit", "MONITORED"],
            ["Source", "SIMULATOR / MANUAL"],
          ].map(([label, value]) => <div key={String(label)} style={{ background: "#171e26", border: "1px solid #29333e", borderRadius: 10, padding: 14 }}><small style={{ color: "#8f9aa7", fontWeight: 700 }}>{label}</small><div style={{ fontSize: 20, fontWeight: 700, marginTop: 6 }}>{value}</div></div>)}
        </section>

        <section style={{ background: "#171e26", border: "1px solid #29333e", borderRadius: 12, overflow: "hidden" }}>
          <div style={{ padding: "13px 15px", borderBottom: "1px solid #29333e" }}><strong>Ritasi per Unit per Hour</strong> <span style={{ color: "#f2a51a", marginLeft: 8, fontSize: 12 }}>DEMO DATA · COUNTING RULE BELUM FINAL</span></div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 1150, textAlign: "center" }}>
              <thead><tr style={{ background: "#11171e", color: "#9ba6b2", fontSize: 12 }}><th style={{ padding: 11, textAlign: "left" }}>Unit</th>{hours.map((hour) => <th key={hour} style={{ padding: 11 }}>{hour}</th>)}<th style={{ padding: 11 }}>Total</th></tr></thead>
              <tbody>
                {rows.map((row) => <tr key={row.unit} style={{ borderTop: "1px solid #242e39" }}><td style={{ padding: 11, textAlign: "left", fontWeight: 700 }}>{row.unit}</td>{row.values.map((value, index) => <td key={index} style={{ padding: 11 }}>{value}</td>)}<td style={{ padding: 11, fontWeight: 700, color: "#f2a51a" }}>{row.values.reduce((a,b)=>a+b,0)}</td></tr>)}
                <tr style={{ borderTop: "2px solid #3c4855", background: "#131a22", fontWeight: 700 }}><td style={{ padding: 11, textAlign: "left" }}>Actual</td>{totals.map((value, index) => <td key={index} style={{ padding: 11 }}>{value}</td>)}<td style={{ padding: 11, color: "#f2a51a" }}>{totalRitasi}</td></tr>
              </tbody>
            </table>
          </div>
        </section>

        <section style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 10, marginTop: 14 }}>
          {[
            ["Working", "5 unit", "Machine observation + validation"],
            ["Standby / Delay / BD", "0 / 0 / 0", "Reason tetap mengikuti taxonomy klien"],
            ["Rain / Slippery", "0 / 0", "Tetap event terpisah"],
            ["Variance", "REVIEW", "Tidak ada silent correction"],
          ].map(([title, value, note]) => <div key={title} style={{ background: "#171e26", border: "1px solid #29333e", borderRadius: 10, padding: 14 }}><small style={{ color: "#8f9aa7" }}>{title}</small><div style={{ margin: "6px 0", fontSize: 18, fontWeight: 700 }}>{value}</div><div style={{ color: "#8f9aa7", fontSize: 12 }}>{note}</div></div>)}
        </section>

        <div style={{ marginTop: 18, display: "flex", gap: 10 }}>
          <a href="/fms/p2h" style={{ color: "#d9e0e7", textDecoration: "none", border: "1px solid #3a4653", borderRadius: 8, padding: "10px 13px" }}>← Digital P2H</a>
          <a href="/fms/pre-poc" style={{ color: "#111", textDecoration: "none", background: "#f2a51a", borderRadius: 8, padding: "10px 13px", fontWeight: 700 }}>Telemetry Simulator</a>
        </div>
      </div>
    </main>
  );
}
