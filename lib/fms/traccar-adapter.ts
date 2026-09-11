import type {
  CanonicalMiningEvent,
  FmsSourceType,
  HmPayload,
  KmPayload,
  KecepatanPayload,
  LokasiPayload,
} from "./canonical-event";

export interface TraccarPosition {
  id?: number;
  deviceId: number;
  protocol?: string;
  deviceTime?: string;
  fixTime: string;
  serverTime?: string;
  latitude: number;
  longitude: number;
  altitude?: number;
  accuracy?: number;
  speed?: number; // Traccar position speed is typically knots.
  course?: number;
  attributes?: Record<string, unknown>;
}

/**
 * Binding perangkat → unit.
 *
 * Vendor-agnostic (owner P2 "ADAPTIVE DEVICE RULE"): FMC650 adalah DEVICE #1,
 * bukan asumsi arsitektur. `sourceType`/`sourceName` berasal dari registry
 * perangkat (lib/fms/device-registry.ts), BUKAN dari cabang kode per vendor.
 * Keduanya opsional agar perilaku pra-registry tetap identik (backward compatible).
 */
export interface TraccarDeviceBinding {
  traccarDeviceId: number;
  unit: string;
  sourceType?: FmsSourceType;
  sourceName?: string;
}

export interface TraccarAdapterOptions {
  deviceBindings: TraccarDeviceBinding[];
  tanggalOperasionalResolver?: (fixTimeIso: string) => string;
  shiftResolver?: (fixTimeIso: string) => string | undefined;
  eventIdFactory?: (prefix: string, position: TraccarPosition) => string;
  receivedAtFactory?: () => string;
}

function defaultTanggalOperasionalResolver(fixTimeIso: string) {
  return fixTimeIso.slice(0, 10);
}

function defaultEventIdFactory(prefix: string, position: TraccarPosition) {
  return `${prefix}:${position.deviceId}:${position.id ?? position.fixTime}`;
}

function knotsToKmH(knots: number) {
  return knots * 1.852;
}

function numberAttribute(attributes: Record<string, unknown> | undefined, keys: string[]) {
  if (!attributes) return undefined;
  for (const key of keys) {
    const value = attributes[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() !== "") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return undefined;
}

export function createTraccarAdapter(options: TraccarAdapterOptions) {
  const bindingMap = new Map(
    options.deviceBindings.map((binding) => [binding.traccarDeviceId, binding]),
  );

  const tanggalOperasionalResolver =
    options.tanggalOperasionalResolver ?? defaultTanggalOperasionalResolver;
  const eventIdFactory = options.eventIdFactory ?? defaultEventIdFactory;
  const receivedAtFactory = options.receivedAtFactory ?? (() => new Date().toISOString());

  return function adaptTraccarPosition(position: TraccarPosition): CanonicalMiningEvent[] {
    const binding = bindingMap.get(position.deviceId);
    if (!binding) {
      throw new Error(`Unmapped Traccar deviceId ${position.deviceId}`);
    }
    const unit = binding.unit;

    const base = {
      waktu: position.fixTime,
      tanggal_operasional: tanggalOperasionalResolver(position.fixTime),
      shift: options.shiftResolver?.(position.fixTime),
      unit,
      source_type: (binding.sourceType ?? "FMC650/Traccar") as FmsSourceType,
      source_name: binding.sourceName ?? `Traccar:${position.deviceId}`,
      authority_status: "PROVISIONAL" as const,
      _source_record_id: position.id ? String(position.id) : undefined,
      _received_at: receivedAtFactory(),
      _record_status: "RAW" as const,
    };

    const events: CanonicalMiningEvent[] = [];

    const lokasiPayload: LokasiPayload = {
      latitude: position.latitude,
      longitude: position.longitude,
      accuracy_m: position.accuracy,
    };

    events.push({
      ...base,
      _event_id: eventIdFactory("lokasi", position),
      event_type: "Lokasi",
      payload: lokasiPayload,
    });

    if (typeof position.speed === "number" && Number.isFinite(position.speed)) {
      const kecepatanPayload: KecepatanPayload = {
        kecepatan_km_jam: knotsToKmH(position.speed),
      };
      events.push({
        ...base,
        _event_id: eventIdFactory("kecepatan", position),
        event_type: "Kecepatan",
        payload: kecepatanPayload,
      });
    }

    const attributes = position.attributes;

    // HM candidates vary by device/vehicle mapping. Keep provisional until hardware validation.
    const hm = numberAttribute(attributes, ["hours", "engineHours", "totalEngineHours"]);
    if (hm !== undefined) {
      const hmPayload: HmPayload = { hm, basis: "ECU/CAN" };
      events.push({
        ...base,
        _event_id: eventIdFactory("hm", position),
        event_type: "HM",
        payload: hmPayload,
      });
    }

    // Distance is treated as an observation only. Do not conflate it with client KM until parity.
    const distanceMeters = numberAttribute(attributes, ["totalDistance", "distance", "odometer"]);
    if (distanceMeters !== undefined) {
      const kmPayload: KmPayload = { km: distanceMeters / 1000, basis: "GPS" };
      events.push({
        ...base,
        _event_id: eventIdFactory("km", position),
        event_type: "KM",
        payload: kmPayload,
      });
    }

    return events;
  };
}
