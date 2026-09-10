-- FMS Phase 3C: Historical Evidence & Reconciliation Schema
-- Database: fms_db (public schema, continues from Phase 3B)
--
-- ARCHITECTURE RULE: This layer is ISOLATED from cycle-engine.ts.
-- Historical Excel is VALIDATION EVIDENCE, not telemetry truth.
-- No workbook-specific business logic in FMS core.

-- ─── SOURCE REGISTRY ───────────────────────────────────────────────
-- Tracks each historical workbook/sheet that has been registered.
CREATE TABLE IF NOT EXISTS "fms_historical_sources" (
  "source_id" text PRIMARY KEY NOT NULL,
  "source_name" varchar(256) NOT NULL,
  "source_type" varchar(64) NOT NULL,           -- 'HAULING_DATA', 'STATUS_UNIT', 'MASTER_HOURLY', etc.
  "source_sheet" varchar(128),                   -- specific sheet within workbook
  "source_file" varchar(512),                    -- original filename
  "period_start" varchar(10),                    -- 'YYYY-MM-DD' operational date
  "period_end" varchar(10),
  "grain" varchar(64) NOT NULL DEFAULT 'UNKNOWN', -- 'Tanggal+Shift+Unit', 'Tanggal+Shift', etc.
  "row_count" integer,
  "known_totals" jsonb,                          -- {ritasi, tonase, bcm} if source declares them
  "known_parities" jsonb,                        -- {input_vs_rekap_daily: {matched: 1365, total: 1365}}
  "known_discrepancies" jsonb,                   -- structured discrepancy notes
  "authority_status" varchar(32) NOT NULL DEFAULT 'HUMAN_AUTHORITY',
  "registered_at" timestamp with time zone NOT NULL DEFAULT now(),
  "registered_by" varchar(128) NOT NULL DEFAULT 'phase3c'
);

-- ─── HISTORICAL EVIDENCE RECORDS ───────────────────────────────────
-- Canonical representation of every row from every source.
-- Grain: Tanggal + Shift + Unit (finest common grain across sources).
-- Missing value = NULL, NEVER zero.
CREATE TABLE IF NOT EXISTS "fms_historical_evidence" (
  "evidence_id" text PRIMARY KEY NOT NULL,
  "source_id" text NOT NULL REFERENCES "fms_historical_sources"("source_id"),
  "source_sheet" varchar(128),
  "source_row" integer,                          -- original row number in source
  "source_reference" varchar(256),               -- human-readable reference (e.g., "REKAP DAILY row 42")

  -- Grain keys (finest available)
  "tanggal" varchar(10) NOT NULL,                -- 'YYYY-MM-DD' operational date
  "shift" varchar(16),                           -- 'day', 'night', etc. (NULL if not available)
  "unit" varchar(64),                            -- equipment ID (NULL if not available)

  -- Mining payload (client terminology preserved)
  "ritasi" real,                                 -- cycle count (NULL = missing, NOT zero)
  "tonase" real,                                 -- tonnes
  "bcm" real,                                    -- bank cubic meters

  -- Optional context
  "loading_point" varchar(128),
  "dumping_point" varchar(128),
  "material" varchar(128),
  "loader" varchar(128),
  "hm" real,                                     -- hour meter
  "status_unit" varchar(64),                     -- Working/Standby/Delay/BD etc.

  -- Metadata
  "grain" varchar(64) NOT NULL,                  -- grain of THIS record
  "authority_status" varchar(32) NOT NULL DEFAULT 'HUMAN_AUTHORITY',
  "validation_status" varchar(32) NOT NULL DEFAULT 'RAW',
  "notes" text,

  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_fms_hist_evidence_grain"
  ON "fms_historical_evidence" ("tanggal", "shift", "unit");
CREATE INDEX IF NOT EXISTS "idx_fms_hist_evidence_source"
  ON "fms_historical_evidence" ("source_id");
CREATE INDEX IF NOT EXISTS "idx_fms_hist_evidence_tanggal"
  ON "fms_historical_evidence" ("tanggal");

-- ─── RECONCILIATION RESULTS ────────────────────────────────────────
-- Stores the output of grain-level comparisons between sources.
CREATE TABLE IF NOT EXISTS "fms_reconciliation_results" (
  "reconciliation_id" text PRIMARY KEY NOT NULL,
  "run_id" varchar(64),

  -- Grain keys
  "tanggal" varchar(10) NOT NULL,
  "shift" varchar(16),
  "unit" varchar(64),

  -- Source A values
  "source_a_id" text,
  "source_a_ritasi" real,
  "source_a_tonase" real,
  "source_a_bcm" real,

  -- Source B values
  "source_b_id" text,
  "source_b_ritasi" real,
  "source_b_tonase" real,
  "source_b_bcm" real,

  -- Comparison
  "delta_ritasi" real,
  "delta_tonase" real,
  "delta_bcm" real,
  "delta_pct_ritasi" real,
  "delta_pct_tonase" real,

  -- Classification
  "classification" varchar(32) NOT NULL,         -- MATCH, MINOR_VARIANCE, MAJOR_VARIANCE, etc.
  "grain" varchar(64) NOT NULL,
  "evidence" jsonb,                              -- supporting detail
  "review_status" varchar(32) NOT NULL DEFAULT 'PENDING',

  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_fms_recon_grain"
  ON "fms_reconciliation_results" ("tanggal", "shift", "unit");
CREATE INDEX IF NOT EXISTS "idx_fms_recon_classification"
  ON "fms_reconciliation_results" ("classification");
CREATE INDEX IF NOT EXISTS "idx_fms_recon_run"
  ON "fms_reconciliation_results" ("run_id");

-- Closed vocabulary for parity classification (fail-closed, not free text).
-- NOT_COMPARABLE = neither source carries the measure (never a MATCH, never a
-- GRAIN_MISMATCH). Any value outside this list is rejected by the database.
ALTER TABLE "fms_reconciliation_results"
  DROP CONSTRAINT IF EXISTS "fms_recon_classification_check";
ALTER TABLE "fms_reconciliation_results"
  ADD CONSTRAINT "fms_recon_classification_check"
  CHECK ("classification" IN (
    'MATCH', 'MINOR_VARIANCE', 'MAJOR_VARIANCE',
    'MISSING_SOURCE_A', 'MISSING_SOURCE_B',
    'DUPLICATE_PATTERN', 'GRAIN_MISMATCH', 'REVIEW_REQUIRED',
    'NOT_COMPARABLE'
  ));

-- Review status vocabulary: never carries an approval/verification meaning.
ALTER TABLE "fms_reconciliation_results"
  DROP CONSTRAINT IF EXISTS "fms_recon_review_status_check";
ALTER TABLE "fms_reconciliation_results"
  ADD CONSTRAINT "fms_recon_review_status_check"
  CHECK ("review_status" IN ('PENDING', 'REVIEWED', 'DISPUTED'));

-- Source authority vocabulary (fail-closed). HUMAN_AUTHORITY = a human is the
-- authority for this figure; HOLD = known discrepancy, do not consume;
-- REVIEW = needs human judgement; AUTO = machine-derived, lowest authority.
ALTER TABLE "fms_historical_sources"
  DROP CONSTRAINT IF EXISTS "fms_hist_sources_authority_check";
ALTER TABLE "fms_historical_sources"
  ADD CONSTRAINT "fms_hist_sources_authority_check"
  CHECK ("authority_status" IN ('HUMAN_AUTHORITY', 'HOLD', 'REVIEW', 'AUTO'));

-- ─── RECONCILIATION CONFIG ─────────────────────────────────────────
-- Configurable thresholds for parity classification.
CREATE TABLE IF NOT EXISTS "fms_reconciliation_config" (
  "config_id" text PRIMARY KEY NOT NULL,
  "name" varchar(128) NOT NULL,
  "description" text,

  -- Thresholds (percentage-based for relative, absolute for count)
  "match_threshold_pct" real NOT NULL DEFAULT 0.0,           -- 0% = exact match only
  "minor_variance_threshold_pct" real NOT NULL DEFAULT 5.0,  -- ≤5% = MINOR
  "major_variance_threshold_pct" real NOT NULL DEFAULT 20.0, -- ≤20% = MAJOR, >20% = MAJOR

  -- Absolute thresholds (for small counts where % is misleading)
  "match_threshold_abs" real NOT NULL DEFAULT 0.0,
  "minor_variance_threshold_abs" real NOT NULL DEFAULT 5.0,

  "active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

-- Seed default config
INSERT INTO "fms_reconciliation_config"
  ("config_id", "name", "description", "match_threshold_pct", "minor_variance_threshold_pct", "major_variance_threshold_pct")
VALUES
  ('default', 'Default Thresholds', 'Standard parity classification thresholds', 0.0, 5.0, 20.0)
ON CONFLICT ("config_id") DO NOTHING;
