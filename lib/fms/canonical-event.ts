export const FMS_EVENT_TYPES = [
  "Shift Assignment",
  "P2H",
  "Lokasi",
  "Kecepatan",
  "HM",
  "KM",
  "Ritasi",
  "Status Unit",
  "Fuel",
  "Breakdown",
  "Rain",
  "Slippery",
] as const;

export type FmsEventType = (typeof FMS_EVENT_TYPES)[number];

export type FmsSourceType =
  | "Human Input"
  | "Excel"
  | "FMC650/Traccar"
  | "ECU/CAN"
  | "Weighbridge"
  | "System Calculation";

export type FmsAuthorityStatus =
  | "HUMAN_AUTHORITY"
  | "PROVISIONAL"
  | "VALIDATED_MACHINE_SOURCE"
  | "REVIEW";

/**
 * Source-agnostic contract between existing client process, telemetry/FMS,
 * and MEI. User-facing labels intentionally preserve client terminology.
 * Technical identifiers stay behind the UI.
 */
export interface CanonicalMiningEvent<TPayload = Record<string, unknown>> {
  _event_id: string;
  event_type: FmsEventType;
  waktu: string;
  tanggal_operasional: string;
  shift?: string;
  unit?: string;
  operator?: string;
  source_type: FmsSourceType;
  source_name: string;
  authority_status: FmsAuthorityStatus;
  payload: TPayload;
  _source_record_id?: string;
  _received_at: string;
  _record_status: "RAW" | "VALIDATED" | "REVIEW" | "REJECTED";
}

export interface LokasiPayload {
  latitude: number;
  longitude: number;
  accuracy_m?: number;
  lokasi?: string;
}

export interface KecepatanPayload {
  kecepatan_km_jam: number;
}

export interface HmPayload {
  hm: number;
  basis: "Manual" | "ECU/CAN" | "Derived";
}

export interface KmPayload {
  km: number;
  basis: "Manual" | "GPS" | "ECU/CAN" | "Derived";
}

export interface RitasiPayload {
  ritasi: number;
  loading_point?: string;
  dumping_point?: string;
  material?: string;
  counting_rule_status: "REVIEW" | "VALIDATED";
}

export interface StatusUnitPayload {
  status_unit: "Working" | "Standby" | "Delay" | "BD" | string;
  reason?: string;
  inferred_by_machine?: boolean;
  human_validated?: boolean;
}

export interface FuelPayload {
  volume_liter: number;
  measurement: "Issued" | "Consumed";
  basis: "Manual" | "Transaction" | "ECU/CAN" | "Sensor";
}
