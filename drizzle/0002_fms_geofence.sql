-- FMS Phase 3A: Geofence + Movement Observation Schema
-- Database: fms_db (public schema, same as Phase 1/2)

-- ─── EXTENSION ─────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS postgis;

-- ─── GEOFENCES ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "fms_geofences" (
  "geofence_id" text PRIMARY KEY NOT NULL,
  "name" varchar(128) NOT NULL,
  "type" varchar(32) NOT NULL,
  "site" varchar(128),
  "geometry" geometry(Geometry, 4326) NOT NULL,
  "active" boolean NOT NULL DEFAULT true,
  "valid_from" timestamp with time zone,
  "valid_to" timestamp with time zone,
  "source" varchar(64) NOT NULL DEFAULT 'manual',
  "created_by" varchar(128),
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_fms_geofences_geometry" ON "fms_geofences" USING GIST ("geometry");
CREATE INDEX IF NOT EXISTS "idx_fms_geofences_type" ON "fms_geofences" ("type");
CREATE INDEX IF NOT EXISTS "idx_fms_geofences_active" ON "fms_geofences" ("active") WHERE "active" = true;

-- ─── GEOFENCE EVENTS ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "fms_geofence_events" (
  "event_id" text PRIMARY KEY NOT NULL,
  "run_id" varchar(64),
  "unit" varchar(64) NOT NULL,
  "device_id" integer NOT NULL,
  "geofence_id" text NOT NULL REFERENCES "fms_geofences"("geofence_id"),
  "event_type" varchar(16) NOT NULL,
  "fix_time" timestamp with time zone NOT NULL,
  "device_time" timestamp with time zone,
  "server_time" timestamp with time zone NOT NULL,
  "latitude" real NOT NULL,
  "longitude" real NOT NULL,
  "position_id" text,
  "quality_flags" jsonb,
  "received_at" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_fms_geofence_events_unit_time" ON "fms_geofence_events" ("unit", "fix_time");
CREATE INDEX IF NOT EXISTS "idx_fms_geofence_events_geofence" ON "fms_geofence_events" ("geofence_id");
CREATE INDEX IF NOT EXISTS "idx_fms_geofence_events_run" ON "fms_geofence_events" ("run_id") WHERE "run_id" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "idx_fms_geofence_events_type" ON "fms_geofence_events" ("event_type");

-- ─── MOVEMENT OBSERVATIONS ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "fms_movement_observations" (
  "observation_id" text PRIMARY KEY NOT NULL,
  "run_id" varchar(64),
  "unit" varchar(64) NOT NULL,
  "device_id" integer NOT NULL,
  "observation_type" varchar(16) NOT NULL,
  "fix_time" timestamp with time zone NOT NULL,
  "device_time" timestamp with time zone,
  "server_time" timestamp with time zone NOT NULL,
  "latitude" real NOT NULL,
  "longitude" real NOT NULL,
  "speed_kmh" real,
  "distance_m" real,
  "duration_s" real,
  "position_id" text,
  "quality_flags" jsonb,
  "received_at" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_fms_movement_unit_time" ON "fms_movement_observations" ("unit", "fix_time");
CREATE INDEX IF NOT EXISTS "idx_fms_movement_run" ON "fms_movement_observations" ("run_id") WHERE "run_id" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "idx_fms_movement_type" ON "fms_movement_observations" ("observation_type");
