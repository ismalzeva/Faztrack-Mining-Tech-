-- FMS PostgreSQL Migration — Phase 1
-- Generated from Drizzle pg-core schema
-- Database: fms-postgres (port 5437)

-- ─── LAYER 1: RAW TELEMETRY ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS "fms_raw_telemetry" (
  "id" text PRIMARY KEY NOT NULL,
  "device_id" integer NOT NULL,
  "unit" varchar(64) NOT NULL,
  "server_time" timestamp with time zone NOT NULL,
  "device_time" timestamp with time zone,
  "fix_time" timestamp with time zone NOT NULL,
  "latitude" real NOT NULL,
  "longitude" real NOT NULL,
  "speed" real,
  "course" real,
  "altitude" real,
  "ignition" boolean,
  "raw_payload" jsonb,
  "received_at" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_raw_tel_unit_time" ON "fms_raw_telemetry" ("unit","fix_time");
CREATE INDEX IF NOT EXISTS "idx_raw_tel_device_time" ON "fms_raw_telemetry" ("device_id","fix_time");
CREATE INDEX IF NOT EXISTS "idx_raw_lat_lon" ON "fms_raw_telemetry" ("latitude","longitude");
CREATE INDEX IF NOT EXISTS "idx_raw_received_at" ON "fms_raw_telemetry" ("received_at");

-- ─── LAYER 3: OPERATIONAL TABLES ─────────────────────────────────
CREATE TABLE IF NOT EXISTS "fms_units" (
  "id" text PRIMARY KEY NOT NULL,
  "unit" varchar(64) NOT NULL,
  "tipe_unit" varchar(128),
  "no_unit_scm" varchar(128),
  "factory" varchar(128),
  "traccar_device_id" integer,
  "active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "fms_units_unit_unique" ON "fms_units" ("unit");
CREATE UNIQUE INDEX IF NOT EXISTS "fms_units_traccar_device_id_unique" ON "fms_units" ("traccar_device_id");

CREATE TABLE IF NOT EXISTS "fms_shift_assignments" (
  "id" text PRIMARY KEY NOT NULL,
  "tanggal" varchar(10) NOT NULL,
  "shift" varchar(16) NOT NULL,
  "site_project" varchar(128),
  "loader" varchar(64),
  "operator_loader" varchar(128),
  "hauler" varchar(64) NOT NULL,
  "operator_hauler" varchar(128),
  "loading_point" varchar(128),
  "dumping_point" varchar(128),
  "material" varchar(128),
  "status_assignment" varchar(32) NOT NULL DEFAULT 'ASSIGNED',
  "source_name" varchar(128) NOT NULL DEFAULT 'Digital Shift Board',
  "created_by" varchar(128),
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_fms_shift_assignments_tanggal_shift" ON "fms_shift_assignments" ("tanggal","shift");
CREATE INDEX IF NOT EXISTS "idx_fms_shift_assignments_hauler" ON "fms_shift_assignments" ("hauler");

CREATE TABLE IF NOT EXISTS "fms_p2h_checks" (
  "id" text PRIMARY KEY NOT NULL,
  "shift_assignment_id" text,
  "tanggal" varchar(10) NOT NULL,
  "shift" varchar(16) NOT NULL,
  "nama_operator" varchar(128),
  "nrp" varchar(64),
  "unit" varchar(64) NOT NULL,
  "hm_awal" real,
  "km_awal" real,
  "checklist_json" text NOT NULL,
  "remarks" text,
  "keputusan_p2h" varchar(64) NOT NULL,
  "keputusan_oleh" varchar(128),
  "source_name" varchar(128) NOT NULL DEFAULT 'Digital P2H',
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_fms_p2h_tanggal_shift_unit" ON "fms_p2h_checks" ("tanggal","shift","unit");

-- ─── LAYER 4: CANONICAL FMS OUTPUT ───────────────────────────────
CREATE TABLE IF NOT EXISTS "fms_canonical_events" (
  "event_id" text PRIMARY KEY NOT NULL,
  "event_type" varchar(64) NOT NULL,
  "waktu" timestamp with time zone NOT NULL,
  "tanggal_operasional" varchar(10) NOT NULL,
  "shift" varchar(16),
  "unit" varchar(64),
  "operator" varchar(128),
  "source_type" varchar(64) NOT NULL,
  "source_name" varchar(128) NOT NULL,
  "authority_status" varchar(64) NOT NULL,
  "payload_json" jsonb NOT NULL,
  "source_record_id" text,
  "received_at" timestamp with time zone NOT NULL DEFAULT now(),
  "record_status" varchar(32) NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_fms_events_unit_waktu" ON "fms_canonical_events" ("unit","waktu");
CREATE INDEX IF NOT EXISTS "idx_fms_events_tanggal_shift" ON "fms_canonical_events" ("tanggal_operasional","shift");
CREATE INDEX IF NOT EXISTS "idx_fms_events_type" ON "fms_canonical_events" ("event_type");

-- ─── HOURLY CONTROL ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "fms_hourly_control" (
  "id" text PRIMARY KEY NOT NULL,
  "tanggal" varchar(10) NOT NULL,
  "shift" varchar(16) NOT NULL,
  "hour_bucket" varchar(16) NOT NULL,
  "loader" varchar(64),
  "unit" varchar(64),
  "plan" real,
  "actual" real,
  "ritasi" real,
  "status_unit" varchar(32),
  "working_hours" real,
  "standby_hours" real,
  "delay_hours" real,
  "breakdown_hours" real,
  "rain_hours" real,
  "slippery_hours" real,
  "waiting_fuel_hours" real,
  "data_status" varchar(32) NOT NULL DEFAULT 'PROVISIONAL',
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_fms_hourly_tanggal_shift_hour" ON "fms_hourly_control" ("tanggal","shift","hour_bucket");
CREATE INDEX IF NOT EXISTS "idx_fms_hourly_unit" ON "fms_hourly_control" ("unit");
