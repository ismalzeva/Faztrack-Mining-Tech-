import type { TraccarPosition } from "./traccar-adapter";

export interface SimulatedUnit {
  traccarDeviceId: number;
  unit: string;
  startLatitude: number;
  startLongitude: number;
  speedKnots?: number;
  engineHours?: number;
  totalDistanceMeters?: number;
}

export interface SimulatorTickOptions {
  tick: number;
  startTimeIso: string;
  intervalSeconds?: number;
}

/**
 * Deterministic PRE-POC simulator.
 * It intentionally emits Traccar-shaped positions so the exact same adapter
 * can later receive real FMC650/Traccar data without changing downstream FMS logic.
 */
export function simulateTraccarPosition(
  unit: SimulatedUnit,
  options: SimulatorTickOptions,
): TraccarPosition {
  const intervalSeconds = options.intervalSeconds ?? 10;
  const time = new Date(
    new Date(options.startTimeIso).getTime() + options.tick * intervalSeconds * 1000,
  ).toISOString();

  const speedKnots = unit.speedKnots ?? 12;
  const distanceIncrementMeters = speedKnots * 0.514444 * intervalSeconds * options.tick;
  const latitudeDelta = options.tick * 0.00002;
  const longitudeDelta = options.tick * 0.00003;

  return {
    id: options.tick + 1,
    deviceId: unit.traccarDeviceId,
    protocol: "teltonika",
    deviceTime: time,
    fixTime: time,
    serverTime: time,
    latitude: unit.startLatitude + latitudeDelta,
    longitude: unit.startLongitude + longitudeDelta,
    accuracy: 5,
    speed: speedKnots,
    course: 90,
    attributes: {
      ignition: true,
      engineHours:
        unit.engineHours !== undefined
          ? unit.engineHours + (options.tick * intervalSeconds) / 3600
          : undefined,
      totalDistance:
        (unit.totalDistanceMeters ?? 0) + distanceIncrementMeters,
      simulator: true,
    },
  };
}

export const PRE_POC_UNITS: SimulatedUnit[] = [
  {
    traccarDeviceId: 1001,
    unit: "EX-501",
    startLatitude: -3.01643,
    startLongitude: 121.85414,
    speedKnots: 2,
    engineHours: 8451,
  },
  {
    traccarDeviceId: 2001,
    unit: "DT-3055",
    startLatitude: -3.0163,
    startLongitude: 121.854,
    speedKnots: 14,
    engineHours: 4001,
    totalDistanceMeters: 19_827_000,
  },
  {
    traccarDeviceId: 2002,
    unit: "DT-3056",
    startLatitude: -3.0161,
    startLongitude: 121.8538,
    speedKnots: 13,
    engineHours: 3950,
  },
  {
    traccarDeviceId: 2003,
    unit: "DT-3057",
    startLatitude: -3.0159,
    startLongitude: 121.8536,
    speedKnots: 11,
    engineHours: 4100,
  },
  {
    traccarDeviceId: 2004,
    unit: "DT-3058",
    startLatitude: -3.0157,
    startLongitude: 121.8534,
    speedKnots: 12,
    engineHours: 3900,
  },
  {
    traccarDeviceId: 2005,
    unit: "DT-3059",
    startLatitude: -3.0155,
    startLongitude: 121.8532,
    speedKnots: 15,
    engineHours: 4020,
  },
];
