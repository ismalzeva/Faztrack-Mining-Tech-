-- FMS Phase 3B: Cycle Candidate Schema
-- Database: fms_db (public schema, continues from Phase 3A)

-- ─── CYCLE CANDIDATES ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "fms_cycle_candidates" (
  "cycle_id" text PRIMARY KEY NOT NULL,
  "run_id" varchar(64),
  "unit" varchar(64) NOT NULL,
  "device_id" integer,
  "operator" varchar(128),
  "loader" varchar(128),
  "loading_point" varchar(128),
  "dumping_point" varchar(128),

  -- Timing (all fix_time based, NOT ingestion order)
  "start_fix_time" timestamp with time zone NOT NULL,
  "loading_enter_time" timestamp with time zone,
  "loading_exit_time" timestamp with time zone,
  "dumping_enter_time" timestamp with time zone,
  "dumping_exit_time" timestamp with time zone,
  "return_time" timestamp with time zone,
  "end_fix_time" timestamp with time zone,

  -- Durations (seconds)
  "duration_total_s" real,
  "loading_dwell_s" real,
  "travel_loaded_duration_s" real,
  "dumping_dwell_s" real,
  "return_duration_s" real,

  -- Distances (meters)
  "distance_outbound_m" real,
  "distance_return_m" real,
  "distance_total_m" real,

  -- Source tracking
  "source_position_ids" jsonb,
  "source_geofence_event_ids" jsonb,

  -- Quality
  "quality_flags" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "candidate_status" varchar(32) NOT NULL DEFAULT 'COMPLETE_CANDIDATE',

  -- Metadata
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

-- Indexes for cycle queries
CREATE INDEX IF NOT EXISTS "idx_fms_cycle_candidates_unit" ON "fms_cycle_candidates" ("unit", "start_fix_time");
CREATE INDEX IF NOT EXISTS "idx_fms_cycle_candidates_run" ON "fms_cycle_candidates" ("run_id") WHERE "run_id" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "idx_fms_cycle_candidates_status" ON "fms_cycle_candidates" ("candidate_status");
CREATE INDEX IF NOT EXISTS "idx_fms_cycle_candidates_time" ON "fms_cycle_candidates" ("start_fix_time", "end_fix_time");
