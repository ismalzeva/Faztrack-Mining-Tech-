export const metadata = {
  title: "Faztrack FMS Reader — Telemetry",
  description: "Synthetic telemetry demonstration for Faztrack Mining Technology.",
};

export default function TelemetryPage() {
  return (
    <main
      style={{
        width: "100%",
        height: "100dvh",
        margin: 0,
        padding: 0,
        overflow: "hidden",
        background: "#eef1f5",
      }}
    >
      <iframe
        src="/telemetry.html"
        title="Faztrack FMS Reader — Synthetic Telemetry Demo"
        style={{ width: "100%", height: "100%", border: 0, display: "block" }}
        allow="fullscreen"
      />
    </main>
  );
}
