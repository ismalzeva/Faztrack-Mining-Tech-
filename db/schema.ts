import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";

/**
 * Persistence schema for the Faztrack FMS digital mirror.
 * PostgreSQL on dedicated fms-postgres container (port 5437).
 * User-facing terminology remains the client's terminology; technical IDs are internal only.
 */

// ─── LAYER 1: RAW TELEMETRY ────────────────────────────────────────
export const fmsRawTelemetry = pgTable(
  "fms_raw_telemetry",
  {
    id: text("id").primaryKey(),
    deviceId: integer("device_id").notNull(),
    unit: varchar("unit", { length: 64 }).notNull(),
    serverTime: timestamp("server_time", { withTimezone: true }).notNull(),
    deviceTime: timestamp("device_time", { withTimezone: true }),
    fixTime: timestamp("fix_time", { withTimezone: true }).notNull(),
    latitude: real("latitude").notNull(),
    longitude: real("longitude").notNull(),
    speed: real("speed"),
    course: real("course"),
    altitude: real("altitude"),
    ignition: boolean("ignition"),
    rawPayload: jsonb("raw_payload"),
    receivedAt: timestamp("received_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("idx_raw_tel_unit_time").on(table.unit, table.fixTime),
    index("idx_raw_tel_device_time").on(table.deviceId, table.fixTime),
    index("idx_raw_lat_lon").on(table.latitude, table.longitude),
    index("idx_raw_received_at").on(table.receivedAt),
  ]
);

// ─── LAYER 3: OPERATIONAL TABLES ────────────────────────────────────

export const fmsUnits = pgTable(
  "fms_units",
  {
    id: text("id").primaryKey(),
    unit: varchar("unit", { length: 64 }).notNull(),
    tipeUnit: varchar("tipe_unit", { length: 128 }),
    noUnitScm: varchar("no_unit_scm", { length: 128 }),
    factory: varchar("factory", { length: 128 }),
    traccarDeviceId: integer("traccar_device_id"),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("fms_units_unit_unique").on(table.unit),
    uniqueIndex("fms_units_traccar_device_id_unique").on(table.traccarDeviceId),
  ]
);

export const fmsShiftAssignments = pgTable(
  "fms_shift_assignments",
  {
    id: text("id").primaryKey(),
    tanggal: varchar("tanggal", { length: 10 }).notNull(),
    shift: varchar("shift", { length: 16 }).notNull(),
    siteProject: varchar("site_project", { length: 128 }),
    loader: varchar("loader", { length: 64 }),
    operatorLoader: varchar("operator_loader", { length: 128 }),
    hauler: varchar("hauler", { length: 64 }).notNull(),
    operatorHauler: varchar("operator_hauler", { length: 128 }),
    loadingPoint: varchar("loading_point", { length: 128 }),
    dumpingPoint: varchar("dumping_point", { length: 128 }),
    material: varchar("material", { length: 128 }),
    statusAssignment: varchar("status_assignment", { length: 32 })
      .notNull()
      .default("ASSIGNED"),
    sourceName: varchar("source_name", { length: 128 })
      .notNull()
      .default("Digital Shift Board"),
    createdBy: varchar("created_by", { length: 128 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("idx_fms_shift_assignments_tanggal_shift").on(table.tanggal, table.shift),
    index("idx_fms_shift_assignments_hauler").on(table.hauler),
  ]
);

export const fmsP2hChecks = pgTable(
  "fms_p2h_checks",
  {
    id: text("id").primaryKey(),
    shiftAssignmentId: text("shift_assignment_id"),
    tanggal: varchar("tanggal", { length: 10 }).notNull(),
    shift: varchar("shift", { length: 16 }).notNull(),
    namaOperator: varchar("nama_operator", { length: 128 }),
    nrp: varchar("nrp", { length: 64 }),
    unit: varchar("unit", { length: 64 }).notNull(),
    hmAwal: real("hm_awal"),
    kmAwal: real("km_awal"),
    checklistJson: text("checklist_json").notNull(),
    remarks: text("remarks"),
    keputusanP2h: varchar("keputusan_p2h", { length: 64 }).notNull(),
    keputusanOleh: varchar("keputusan_oleh", { length: 128 }),
    sourceName: varchar("source_name", { length: 128 })
      .notNull()
      .default("Digital P2H"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("idx_fms_p2h_tanggal_shift_unit").on(table.tanggal, table.shift, table.unit),
  ]
);

export const fmsCanonicalEvents = pgTable(
  "fms_canonical_events",
  {
    eventId: text("event_id").primaryKey(),
    eventType: varchar("event_type", { length: 64 }).notNull(),
    waktu: timestamp("waktu", { withTimezone: true }).notNull(),
    tanggalOperasional: varchar("tanggal_operasional", { length: 10 }).notNull(),
    shift: varchar("shift", { length: 16 }),
    unit: varchar("unit", { length: 64 }),
    operator: varchar("operator", { length: 128 }),
    sourceType: varchar("source_type", { length: 64 }).notNull(),
    sourceName: varchar("source_name", { length: 128 }).notNull(),
    authorityStatus: varchar("authority_status", { length: 64 }).notNull(),
    payloadJson: jsonb("payload_json").notNull(),
    sourceRecordId: text("source_record_id"),
    receivedAt: timestamp("received_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    recordStatus: varchar("record_status", { length: 32 }).notNull(),
  },
  (table) => [
    index("idx_fms_events_unit_waktu").on(table.unit, table.waktu),
    index("idx_fms_events_tanggal_shift").on(table.tanggalOperasional, table.shift),
    index("idx_fms_events_type").on(table.eventType),
  ]
);

export const fmsHourlyControl = pgTable(
  "fms_hourly_control",
  {
    id: text("id").primaryKey(),
    tanggal: varchar("tanggal", { length: 10 }).notNull(),
    shift: varchar("shift", { length: 16 }).notNull(),
    hourBucket: varchar("hour_bucket", { length: 16 }).notNull(),
    loader: varchar("loader", { length: 64 }),
    unit: varchar("unit", { length: 64 }),
    plan: real("plan"),
    actual: real("actual"),
    ritasi: real("ritasi"),
    statusUnit: varchar("status_unit", { length: 32 }),
    workingHours: real("working_hours"),
    standbyHours: real("standby_hours"),
    delayHours: real("delay_hours"),
    breakdownHours: real("breakdown_hours"),
    rainHours: real("rain_hours"),
    slipperyHours: real("slippery_hours"),
    waitingFuelHours: real("waiting_fuel_hours"),
    dataStatus: varchar("data_status", { length: 32 })
      .notNull()
      .default("PROVISIONAL"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("idx_fms_hourly_tanggal_shift_hour").on(table.tanggal, table.shift, table.hourBucket),
    index("idx_fms_hourly_unit").on(table.unit),
  ]
);
