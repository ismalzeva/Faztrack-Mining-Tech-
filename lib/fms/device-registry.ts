// FMS P2B — Device Registry (vendor-agnostic).
//
// ATURAN ARSITEKTUR (owner, P2):
//   FMC650 adalah DEVICE #1, bukan arsitektur FMS.
//   Interpretasi vendor/perangkat BERHENTI di adapter/source boundary.
//   Perangkat baru di masa depan normalnya cukup: adapter/konfigurasi baru —
//   BUKAN perubahan pada Fleet UI, Geofence Engine, Cycle Engine, CCR, kontrak MEI.
//
// Modul ini TIDAK mengubah semantik Phase 2/3A/3B/3C. Ia hanya menyediakan
// pembacaan/penulisan tabel registry `fms_devices` (migrasi 0005) dan resolusi
// `source_type`/`source_name` untuk canonical event.

import { Client } from "pg";
import type { FmsSourceType } from "./canonical-event.js";

/** Nilai default yang menjaga kompatibilitas mundur penuh dengan perilaku pra-registry. */
export const DEFAULT_SOURCE_TYPE: FmsSourceType = "FMC650/Traccar";
export const DEFAULT_SOURCE_NAME_PREFIX = "Traccar";

const ALLOWED_SOURCE_TYPES: readonly string[] = [
  "Human Input",
  "Excel",
  "FMC650/Traccar",
  "ECU/CAN",
  "Weighbridge",
  "System Calculation",
];

/**
 * Petakan nilai dari registry ke union tertutup FmsSourceType.
 * Nilai tak dikenal TIDAK diteruskan diam-diam: fail-closed ke default + ditandai.
 */
export function resolveSourceType(raw: string | null | undefined): {
  sourceType: FmsSourceType;
  valid: boolean;
} {
  if (raw && ALLOWED_SOURCE_TYPES.includes(raw)) {
    return { sourceType: raw as FmsSourceType, valid: true };
  }
  return { sourceType: DEFAULT_SOURCE_TYPE, valid: raw == null };
}

export interface DeviceRegistryBinding {
  traccarDeviceId: number;
  /** IMEI/unique ID perangkat seperti dilaporkan protokol vendor (untuk audit & verifikasi silang). */
  uniqueId: string;
  unit: string;
  sourceType: FmsSourceType;
  sourceName: string;
  vendor: string;
  model: string | null;
  isSimulator: boolean;
  activationState: string;
}

export interface DeviceRegistrationInput {
  uniqueId: string;
  vendor: string;
  model?: string | null;
  protocol: string;
  transport?: "tcp" | "udp" | "http";
  unit?: string | null;
  unitId?: string | null;
  traccarDeviceId?: number | null;
  traccarUniqueId?: string | null;
  sourceType?: string | null;
  sourceName?: string | null;
  isSimulator?: boolean;
  notes?: string | null;
}

function makeDeviceId(uniqueId: string): string {
  return `DEV-${uniqueId.replace(/[^A-Za-z0-9]/g, "").toUpperCase()}`;
}

/**
 * Ambil binding perangkat dari registry untuk dipakai adapter.
 * Device dengan `traccar_device_id` NULL atau state retired/suspended tidak dikembalikan.
 */
export async function loadDeviceBindings(client: Client): Promise<Map<number, DeviceRegistryBinding>> {
  const { rows } = await client.query<{
    traccar_device_id: number;
    unique_id: string;
    unit: string | null;
    source_type: string | null;
    source_name: string | null;
    vendor: string;
    model: string | null;
    is_simulator: boolean;
    activation_state: string;
  }>(
    `SELECT traccar_device_id, unique_id, unit, source_type, source_name, vendor, model,
            is_simulator, activation_state
       FROM fms_devices
      WHERE traccar_device_id IS NOT NULL
        AND activation_state IN ('registered','active')
      ORDER BY traccar_device_id`,
  );

  const map = new Map<number, DeviceRegistryBinding>();
  for (const row of rows) {
    const { sourceType } = resolveSourceType(row.source_type);
    map.set(row.traccar_device_id, {
      traccarDeviceId: row.traccar_device_id,
      uniqueId: row.unique_id,
      unit: row.unit ?? "",
      sourceType,
      sourceName: row.source_name ?? `${DEFAULT_SOURCE_NAME_PREFIX}:${row.traccar_device_id}`,
      vendor: row.vendor,
      model: row.model,
      isSimulator: row.is_simulator,
      activationState: row.activation_state,
    });
  }
  return map;
}

/**
 * Daftarkan (atau perbarui) satu perangkat. Idempoten terhadap `unique_id`.
 * Ini adalah jalur onboarding perangkat fisik: IMEI/unique ID -> registry -> unit.
 */
export async function registerDevice(
  client: Client,
  input: DeviceRegistrationInput,
): Promise<{ id: string; created: boolean }> {
  const transport = input.transport ?? "tcp";
  if (!["tcp", "udp", "http"].includes(transport)) {
    throw new Error(`transport tidak valid: ${transport}`);
  }
  const { sourceType } = resolveSourceType(input.sourceType ?? null);
  const id = makeDeviceId(input.uniqueId);

  const existing = await client.query<{ id: string }>(
    `SELECT id FROM fms_devices WHERE unique_id = $1`,
    [input.uniqueId],
  );
  const created = existing.rowCount === 0;

  await client.query(
    `INSERT INTO fms_devices (
        id, unit_id, unit, vendor, model, unique_id, protocol, transport,
        traccar_device_id, traccar_unique_id, source_type, source_name,
        is_simulator, notes, updated_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14, now())
     ON CONFLICT (unique_id) DO UPDATE SET
        unit_id           = COALESCE(EXCLUDED.unit_id, fms_devices.unit_id),
        unit              = COALESCE(EXCLUDED.unit, fms_devices.unit),
        vendor            = EXCLUDED.vendor,
        model             = COALESCE(EXCLUDED.model, fms_devices.model),
        protocol          = EXCLUDED.protocol,
        transport         = EXCLUDED.transport,
        traccar_device_id = COALESCE(EXCLUDED.traccar_device_id, fms_devices.traccar_device_id),
        traccar_unique_id = COALESCE(EXCLUDED.traccar_unique_id, fms_devices.traccar_unique_id),
        source_type       = EXCLUDED.source_type,
        source_name       = COALESCE(EXCLUDED.source_name, fms_devices.source_name),
        is_simulator      = EXCLUDED.is_simulator,
        notes             = COALESCE(EXCLUDED.notes, fms_devices.notes),
        updated_at        = now()`,
    [
      id,
      input.unitId ?? null,
      input.unit ?? null,
      input.vendor,
      input.model ?? null,
      input.uniqueId,
      input.protocol,
      transport,
      input.traccarDeviceId ?? null,
      input.traccarUniqueId ?? null,
      sourceType,
      input.sourceName ?? null,
      input.isSimulator ?? false,
      input.notes ?? null,
    ],
  );

  return { id, created };
}

/**
 * Tandai bahwa paket nyata telah diterima dari perangkat (bukti P2 "PACKET RECEIVED").
 * `first_packet_at` hanya terisi sekali — tidak pernah ditimpa.
 */
export async function recordDevicePacket(
  client: Client,
  traccarDeviceIds: number[],
  at: Date = new Date(),
): Promise<number> {
  if (traccarDeviceIds.length === 0) return 0;
  const { rowCount } = await client.query(
    `UPDATE fms_devices
        SET last_packet_at  = $2,
            first_packet_at = COALESCE(first_packet_at, $2),
            activation_state = CASE WHEN activation_state = 'registered' THEN 'active'
                                    ELSE activation_state END,
            updated_at      = now()
      WHERE traccar_device_id = ANY($1::int[])`,
    [traccarDeviceIds, at],
  );
  return rowCount ?? 0;
}

/** Ringkasan registry untuk laporan/verifikasi. */
export async function summarizeRegistry(client: Client): Promise<{
  total: number;
  byState: Record<string, number>;
  physical: number;
  simulator: number;
  neverSeen: number;
}> {
  const { rows } = await client.query<{ activation_state: string; is_simulator: boolean; seen: boolean }>(
    `SELECT activation_state, is_simulator, (first_packet_at IS NOT NULL) AS seen FROM fms_devices`,
  );
  const byState: Record<string, number> = {};
  let physical = 0;
  let simulator = 0;
  let neverSeen = 0;
  for (const r of rows) {
    byState[r.activation_state] = (byState[r.activation_state] ?? 0) + 1;
    if (r.is_simulator) simulator += 1;
    else physical += 1;
    if (!r.seen) neverSeen += 1;
  }
  return { total: rows.length, byState, physical, simulator, neverSeen };
}
