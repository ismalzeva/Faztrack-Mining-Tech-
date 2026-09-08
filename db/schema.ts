import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * Persistence schema for the Faztrack FMS digital mirror.
 * User-facing terminology remains the client's terminology; technical IDs are internal only.
 */
export const fmsUnits = sqliteTable("fms_units", {
  id: text("id").primaryKey(),
  unit: text("unit").notNull().unique(),
  tipeUnit: text("tipe_unit"),
  noUnitScm: text("no_unit_scm"),
  factory: text("factory"),
  traccarDeviceId: integer("traccar_device_id").unique(),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const fmsShiftAssignments = sqliteTable("fms_shift_assignments", {
  id: text("id").primaryKey(),
  tanggal: text("tanggal").notNull(),
  shift: text("shift").notNull(),
  siteProject: text("site_project"),
  loader: text("loader"),
  operatorLoader: text("operator_loader"),
  hauler: text("hauler").notNull(),
  operatorHauler: text("operator_hauler"),
  loadingPoint: text("loading_point"),
  dumpingPoint: text("dumping_point"),
  material: text("material"),
  statusAssignment: text("status_assignment").notNull().default("ASSIGNED"),
  sourceName: text("source_name").notNull().default("Digital Shift Board"),
  createdBy: text("created_by"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const fmsP2hChecks = sqliteTable("fms_p2h_checks", {
  id: text("id").primaryKey(),
  shiftAssignmentId: text("shift_assignment_id"),
  tanggal: text("tanggal").notNull(),
  shift: text("shift").notNull(),
  namaOperator: text("nama_operator"),
  nrp: text("nrp"),
  unit: text("unit").notNull(),
  hmAwal: real("hm_awal"),
  kmAwal: real("km_awal"),
  checklistJson: text("checklist_json").notNull(),
  remarks: text("remarks"),
  keputusanP2h: text("keputusan_p2h").notNull(),
  keputusanOleh: text("keputusan_oleh"),
  sourceName: text("source_name").notNull().default("Digital P2H"),
  createdAt: text("created_at").notNull(),
});

export const fmsCanonicalEvents = sqliteTable("fms_canonical_events", {
  eventId: text("event_id").primaryKey(),
  eventType: text("event_type").notNull(),
  waktu: text("waktu").notNull(),
  tanggalOperasional: text("tanggal_operasional").notNull(),
  shift: text("shift"),
  unit: text("unit"),
  operator: text("operator"),
  sourceType: text("source_type").notNull(),
  sourceName: text("source_name").notNull(),
  authorityStatus: text("authority_status").notNull(),
  payloadJson: text("payload_json").notNull(),
  sourceRecordId: text("source_record_id"),
  receivedAt: text("received_at").notNull(),
  recordStatus: text("record_status").notNull(),
});

export const fmsHourlyControl = sqliteTable("fms_hourly_control", {
  id: text("id").primaryKey(),
  tanggal: text("tanggal").notNull(),
  shift: text("shift").notNull(),
  hourBucket: text("hour_bucket").notNull(),
  loader: text("loader"),
  unit: text("unit"),
  plan: real("plan"),
  actual: real("actual"),
  ritasi: real("ritasi"),
  statusUnit: text("status_unit"),
  workingHours: real("working_hours"),
  standbyHours: real("standby_hours"),
  delayHours: real("delay_hours"),
  breakdownHours: real("breakdown_hours"),
  rainHours: real("rain_hours"),
  slipperyHours: real("slippery_hours"),
  waitingFuelHours: real("waiting_fuel_hours"),
  dataStatus: text("data_status").notNull().default("PROVISIONAL"),
  updatedAt: text("updated_at").notNull(),
});
