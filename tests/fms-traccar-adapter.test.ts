import assert from "node:assert/strict";
import test from "node:test";
import { createTraccarAdapter } from "../lib/fms/traccar-adapter";
import { simulateTraccarPosition } from "../lib/fms/telemetry-simulator";

test("FMC650/Traccar observation remains provisional and preserves client terms", () => {
  const position = simulateTraccarPosition(
    {
      traccarDeviceId: 2001,
      unit: "DT-3055",
      startLatitude: -3.01643,
      startLongitude: 121.85414,
      speedKnots: 10,
      engineHours: 4000,
      totalDistanceMeters: 100_000,
    },
    { tick: 1, startTimeIso: "2026-09-08T00:00:00.000Z", intervalSeconds: 10 },
  );

  const adapt = createTraccarAdapter({
    deviceBindings: [{ traccarDeviceId: 2001, unit: "DT-3055" }],
    receivedAtFactory: () => "2026-09-08T00:00:11.000Z",
  });

  const events = adapt(position);
  assert.deepEqual(events.map((event) => event.event_type), ["Lokasi", "Kecepatan", "HM", "KM"]);
  assert.ok(events.every((event) => event.unit === "DT-3055"));
  assert.ok(events.every((event) => event.authority_status === "PROVISIONAL"));
  assert.ok(events.every((event) => event._record_status === "RAW"));

  const speed = events.find((event) => event.event_type === "Kecepatan");
  assert.equal(Number((speed?.payload as { kecepatan_km_jam: number }).kecepatan_km_jam.toFixed(2)), 18.52);

  // The adapter must NOT infer Ritasi, Working, Standby, Delay, or BD from movement alone.
  assert.equal(events.some((event) => event.event_type === "Ritasi"), false);
  assert.equal(events.some((event) => event.event_type === "Status Unit"), false);
});

test("unmapped Traccar device is rejected instead of silently creating a Unit", () => {
  const adapt = createTraccarAdapter({ deviceBindings: [] });
  assert.throws(
    () =>
      adapt({
        deviceId: 9999,
        fixTime: "2026-09-08T00:00:00.000Z",
        latitude: -3.01643,
        longitude: 121.85414,
      }),
    /Unmapped Traccar deviceId 9999/,
  );
});
