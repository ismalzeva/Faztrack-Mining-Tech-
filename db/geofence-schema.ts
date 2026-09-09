import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";

// ─── GEOFENCES ─────────────────────────────────────────────────────
export const fmsGeofences = pgTable(
  "fms_geofences",
  {
    geofenceId: text("geofence_id").primaryKey(),
    name: varchar("name", { length: 128 }).notNull(),
    type: varchar("type", { length: 32 }).notNull(),
    site: varchar("site", { length: 128 }),
    // geometry stored as text in Drizzle; PostGIS column managed via raw SQL
    active: boolean("active").notNull().default(true),
    validFrom: timestamp("valid_from", { withTimezone: true }),
    validTo: timestamp("valid_to", { withTimezone: true }),
    source: varchar("source", { length: 64 }).notNull().default("manual"),
    createdBy: varchar("created_by", { length: 128 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("idx_fms_geofences_type").on(table.type),
  ]
);

// ─── GEOFENCE EVENTS ──────────────────────────────────────────────
export const fmsGeofenceEvents = pgTable(
  "fms_geofence_events",
  {
    eventId: text("event_id").primaryKey(),
    runId: varchar("run_id", { length: 64 }),
    unit: varchar("unit", { length: 64 }).notNull(),
    deviceId: integer("device_id").notNull(),
    geofenceId: text("geofence_id")
      .notNull()
      .references(() => fmsGeofences.geofenceId),
    eventType: varchar("event_type", { length: 16 }).notNull(),
    fixTime: timestamp("fix_time", { withTimezone: true }).notNull(),
    deviceTime: timestamp("device_time", { withTimezone: true }),
    serverTime: timestamp("server_time", { withTimezone: true }).notNull(),
    latitude: real("latitude").notNull(),
    longitude: real("longitude").notNull(),
    positionId: text("position_id"),
    qualityFlags: jsonb("quality_flags"),
    receivedAt: timestamp("received_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("idx_fms_geofence_events_unit_time").on(table.unit, table.fixTime),
    index("idx_fms_geofence_events_geofence").on(table.geofenceId),
    index("idx_fms_geofence_events_run").on(table.runId),
    index("idx_fms_geofence_events_type").on(table.eventType),
  ]
);

// ─── MOVEMENT OBSERVATIONS ────────────────────────────────────────
export const fmsMovementObservations = pgTable(
  "fms_movement_observations",
  {
    observationId: text("observation_id").primaryKey(),
    runId: varchar("run_id", { length: 64 }),
    unit: varchar("unit", { length: 64 }).notNull(),
    deviceId: integer("device_id").notNull(),
    observationType: varchar("observation_type", { length: 16 }).notNull(),
    fixTime: timestamp("fix_time", { withTimezone: true }).notNull(),
    deviceTime: timestamp("device_time", { withTimezone: true }),
    serverTime: timestamp("server_time", { withTimezone: true }).notNull(),
    latitude: real("latitude").notNull(),
    longitude: real("longitude").notNull(),
    speedKmh: real("speed_kmh"),
    distanceM: real("distance_m"),
    durationS: real("duration_s"),
    positionId: text("position_id"),
    qualityFlags: jsonb("quality_flags"),
    receivedAt: timestamp("received_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("idx_fms_movement_unit_time").on(table.unit, table.fixTime),
    index("idx_fms_movement_run").on(table.runId),
    index("idx_fms_movement_type").on(table.observationType),
  ]
);
