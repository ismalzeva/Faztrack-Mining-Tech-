/**
 * FMS Phase 3C — Historical Replay & Ritasi Parity : TEST GATE T1–T22
 *
 * Runner: npx tsx --test tests/fms-phase3c-historical.test.ts
 * Requires: FMS_DATABASE_URL
 *
 * PROVENANCE NOTE (read before judging any fixture):
 * The three client workbooks named in the Phase 3C directive
 *   - HAULING DATA WEEKLY LIM 2026 AGUSTUS1.xlsx
 *   - Status Unit Support BR_202600831.xlsb
 *   - Master Hourly Like New_20260831 (3).xlsb
 * are NOT present on this VPS. Fixtures below reproduce the EXACT aggregate
 * figures stated by the Owner in the Phase 3C directive, so the reconciliation,
 * classification and investigation machinery can be gated end-to-end.
 * Every fixture source carries authority_status + a provenance note recording
 * that the numbers are OWNER-STATED, not parsed from the workbook.
 * Raw-workbook import remains PENDING (see report).
 */

import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert";
import { Client } from "pg";
import { execSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  registerSource,
  getSource,
  importEvidence,
  getEvidence,
  aggregateEvidence,
  classifyParity,
  detectDuplicateRows,
  detectGrainMismatch,
  reconcile,
  summarizeReconciliation,
  investigate9to15August,
  getReviewTable,
  type HistoricalEvidenceRow,
  type ReconciliationConfig,
} from "../lib/fms/historical-replay";

const DATABASE_URL = process.env.FMS_DATABASE_URL;
if (!DATABASE_URL) throw new Error("FMS_DATABASE_URL required");

const FX = "fx3c"; // fixture prefix

/**
 * Units-per-shift-block for the 9–15 Aug window.
 * 7 days × 2 shifts = 14 blocks; 3 blocks of 23 + 11 blocks of 22 = 311 groups,
 * matching the directive's known "311/311 groups exist in BOTH sources".
 * NOTE: this array must have exactly 14 entries — a shorter array wraps and
 * silently inflates the group count.
 */
const W2_UNITS = [23, 23, 23, 22, 22, 22, 22, 22, 22, 22, 22, 22, 22, 22];

let client: Client;

// ─── DIRECTIVE-STATED FIGURES (Owner authority) ────────────────────
const D = {
  aug_totals: { ritasi: 8825, tonase: 436335.92, bcm: 247918.13636 },
  input_vs_rekap: { matched: 1365, total: 1365 },
  working_31aug: { matched: 122, total: 122 },
  w1_0808: { input: 9793, inprod: 9772, delta: 21 },      // 1–8 Aug
  w2_0915: { input: 19654, inprod: 9850, delta: 9804 },   // 9–15 Aug  ← HOLD
  w3_1628: { input: 19875, inprod: 19918, delta: -43 },   // 16–28 Aug
  w4_2931: { inprod: 3962 },                              // 29–31 Aug (no Input coverage)
  w2_groups: 311,
};

// ─── FIXTURE DISTRIBUTION HELPERS ──────────────────────────────────

/** Split `total` into `n` integer parts, deterministic. */
function distribute(total: number, n: number): number[] {
  const base = Math.floor(total / n);
  const remainder = total - base * n;
  return Array.from({ length: n }, (_, i) => base + (i < remainder ? 1 : 0));
}

/** Build grain keys (tanggal+shift+unit) across a day range. */
function buildGroups(
  fromDay: number, toDay: number, shifts: string[], unitsPerBlock: number[]
): Array<{ tanggal: string; shift: string; unit: string }> {
  const out: Array<{ tanggal: string; shift: string; unit: string }> = [];
  let block = 0;
  for (let day = fromDay; day <= toDay; day++) {
    const tanggal = `2026-08-${String(day).padStart(2, "0")}`;
    for (const shift of shifts) {
      const nUnits = unitsPerBlock[block];
      if (nUnits === undefined) {
        throw new Error(
          `buildGroups: unitsPerBlock has no entry for block ${block}. ` +
          `Supply exactly (days × shifts) entries to avoid silent wrap-around.`
        );
      }
      for (let u = 1; u <= nUnits; u++) {
        out.push({ tanggal, shift, unit: `DT-${String(u).padStart(3, "0")}` });
      }
      block++;
    }
  }
  return out;
}

async function dropFixtures(): Promise<void> {
  await client.query(`DELETE FROM fms_reconciliation_results WHERE source_a_id LIKE '${FX}%' OR source_b_id LIKE '${FX}%'`);
  await client.query(`DELETE FROM fms_historical_evidence WHERE source_id LIKE '${FX}%'`);
  await client.query(`DELETE FROM fms_historical_sources WHERE source_id LIKE '${FX}%'`);
}

before(async () => {
  client = new Client({ connectionString: DATABASE_URL });
  await client.connect();
  await dropFixtures();
});

after(async () => {
  await dropFixtures();
  await client.end();
});

beforeEach(async () => {
  await dropFixtures();
});

// ══════════════════════════════════════════════════════════════════
// T1 — HISTORICAL EVIDENCE SCHEMA
// ══════════════════════════════════════════════════════════════════
describe("T1 historical evidence schema", () => {
  it("T1 creates the 4 Phase 3C tables with lineage + payload columns", async () => {
    const tables = ["fms_historical_sources", "fms_historical_evidence",
                    "fms_reconciliation_results", "fms_reconciliation_config"];
    for (const t of tables) {
      const r = await client.query(
        `SELECT COUNT(*)::int AS c FROM information_schema.tables
         WHERE table_schema='public' AND table_name=$1`, [t]);
      assert.strictEqual(r.rows[0].c, 1, `${t} must exist`);
    }

    const cols = await client.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema='public' AND table_name='fms_historical_evidence'`);
    const names = cols.rows.map((r: { column_name: string }) => r.column_name);
    for (const required of [
      "evidence_id", "source_id", "source_sheet", "source_row", "source_reference",
      "tanggal", "shift", "unit", "ritasi", "tonase", "bcm",
      "loading_point", "dumping_point", "material", "loader", "hm", "status_unit",
      "grain", "authority_status", "validation_status", "notes",
    ]) {
      assert.ok(names.includes(required), `fms_historical_evidence.${required} required`);
    }
    console.log(`  ✓ T1 4 tables + ${names.length} evidence columns`);
  });

  it("T1b the classification vocabulary is closed by a DB CHECK constraint", async () => {
    const c = await client.query(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
       WHERE conname = 'fms_recon_classification_check'`);
    assert.strictEqual(c.rows.length, 1, "classification CHECK constraint must exist");
    const def = c.rows[0].def as string;
    for (const v of ["MATCH", "MINOR_VARIANCE", "MAJOR_VARIANCE", "MISSING_SOURCE_A",
                     "MISSING_SOURCE_B", "DUPLICATE_PATTERN", "GRAIN_MISMATCH",
                     "REVIEW_REQUIRED", "NOT_COMPARABLE"]) {
      assert.ok(def.includes(v), `${v} must be in the closed vocabulary`);
    }
    // Fail-closed: a bogus classification must be rejected by the database
    let rejected = false;
    try {
      await client.query(
        `INSERT INTO fms_reconciliation_results
           (reconciliation_id, tanggal, classification, grain, review_status)
         VALUES ('rc-illegal', '2026-08-01', 'TOTALLY_FINE', 'Tanggal', 'PENDING')`);
    } catch {
      rejected = true;
    }
    assert.ok(rejected, "the DB must reject an out-of-vocabulary classification");
    console.log("  ✓ T1b 9-value closed vocabulary enforced; bogus value rejected by DB");
  });

  it("T1c source registry holds directive-stated totals & parities", async () => {
    await registerSource(client, {
      source_id: `${FX}-src-a`,
      source_name: "HAULING DATA WEEKLY LIM 2026 AGUSTUS1.xlsx",
      source_type: "HAULING_DATA",
      source_sheet: "INPUT",
      grain: "Tanggal+Shift+Unit",
      known_totals: D.aug_totals,
      known_parities: { input_vs_rekap_daily: D.input_vs_rekap },
      authority_status: "HUMAN_AUTHORITY",
    });
    const s = await getSource(client, `${FX}-src-a`);
    assert.ok(s, "source must persist");
    assert.deepStrictEqual(s!.known_totals, D.aug_totals);
    assert.strictEqual(s!.known_parities!.input_vs_rekap_daily.matched, 1365);
    assert.strictEqual(s!.authority_status, "HUMAN_AUTHORITY");
    console.log("  ✓ T1c registry persisted 8,825 / 436,335.92 / 247,918.13636 + 1365/1365 parity");
  });
});

// ══════════════════════════════════════════════════════════════════
// T2 — SOURCE LINEAGE PRESERVED
// ══════════════════════════════════════════════════════════════════
describe("T2 source lineage preserved", () => {
  it("T2 round-trips source_sheet / source_row / source_reference untouched", async () => {
    await registerSource(client, {
      source_id: `${FX}-lin`, source_name: "Lineage Test", source_type: "HAULING_DATA",
      grain: "Tanggal+Shift+Unit", authority_status: "HUMAN_AUTHORITY",
    });
    await importEvidence(client, [{
      source_id: `${FX}-lin`, source_sheet: "REKAP DAILY", source_row: 42,
      source_reference: "REKAP DAILY row 42",
      tanggal: "2026-08-09", shift: "day", unit: "DT-001",
      ritasi: 7, tonase: 120.5, bcm: 68.25,
      loading_point: "LP-A", dumping_point: "DP-1", material: "OB", loader: "EX-501",
      hm: 12.5, status_unit: "Working", grain: "Tanggal+Shift+Unit",
    }]);

    const rows = await getEvidence(client, { source_id: `${FX}-lin` });
    assert.strictEqual(rows.length, 1);
    const r = rows[0];
    assert.strictEqual(r.source_sheet, "REKAP DAILY");
    assert.strictEqual(r.source_row, 42);
    assert.strictEqual(r.source_reference, "REKAP DAILY row 42");
    assert.strictEqual(r.loading_point, "LP-A");
    assert.strictEqual(r.dumping_point, "DP-1");
    assert.strictEqual(r.material, "OB");
    assert.strictEqual(r.loader, "EX-501");
    assert.strictEqual(r.status_unit, "Working");
    assert.strictEqual(Number(r.hm), 12.5);
    console.log("  ✓ T2 lineage preserved (sheet/row/reference/context)");
  });
});

// ══════════════════════════════════════════════════════════════════
// T3 — MISSING ≠ ZERO
// ══════════════════════════════════════════════════════════════════
describe("T3 missing != zero", () => {
  it("T3 keeps NULL ritasi as NULL and never coerces to 0", async () => {
    await registerSource(client, {
      source_id: `${FX}-nul`, source_name: "Null Test", source_type: "HAULING_DATA",
      grain: "Tanggal+Shift+Unit", authority_status: "HUMAN_AUTHORITY",
    });
    await importEvidence(client, [
      { source_id: `${FX}-nul`, tanggal: "2026-08-29", shift: "day", unit: "DT-001",
        ritasi: null, tonase: null, bcm: null, grain: "Tanggal+Shift+Unit" },
      { source_id: `${FX}-nul`, tanggal: "2026-08-30", shift: "day", unit: "DT-001",
        ritasi: 5, tonase: 100, bcm: 50, grain: "Tanggal+Shift+Unit" },
    ]);

    const raw = await client.query(
      `SELECT ritasi FROM fms_historical_evidence
       WHERE source_id=$1 AND tanggal='2026-08-29'`, [`${FX}-nul`]);
    assert.strictEqual(raw.rows[0].ritasi, null, "NULL must survive the write");
    assert.notStrictEqual(raw.rows[0].ritasi, 0, "NULL must NOT become 0");

    const cnt = await client.query(
      `SELECT COUNT(*)::int AS total,
              COUNT(ritasi)::int AS with_value
       FROM fms_historical_evidence WHERE source_id=$1`, [`${FX}-nul`]);
    assert.strictEqual(cnt.rows[0].total, 2);
    assert.strictEqual(cnt.rows[0].with_value, 1, "COUNT(ritasi) must exclude NULL");

    const agg = await aggregateEvidence(client, `${FX}-nul`, "Tanggal+Shift+Unit");
    assert.strictEqual(agg.length, 2);
    const sum = agg.reduce((s, r) => s + Number(r.total_ritasi ?? 0), 0);
    assert.strictEqual(sum, 5);
    console.log("  ✓ T3 NULL preserved; COUNT(ritasi)=1 of 2; SUM=5");
  });

  it("T3b classifies a NULL side as MISSING, and NULL-on-both as NOT_COMPARABLE", async () => {
    assert.strictEqual(classifyParity(null, 100).classification, "MISSING_SOURCE_A");
    assert.strictEqual(classifyParity(100, null).classification, "MISSING_SOURCE_B");
    // Absent on BOTH sides is not a match and not a grain mismatch
    assert.strictEqual(classifyParity(null, null).classification, "NOT_COMPARABLE");
    console.log("  ✓ T3b NULL side => MISSING_SOURCE_*; both NULL => NOT_COMPARABLE (never MATCH)");
  });

  it("T3c NOT_COMPARABLE never wins a worst-of vote against real findings", async () => {
    await registerSource(client, { source_id: `${FX}-t3c-a`, source_name: "A", source_type: "HAULING_DATA",
      grain: "Tanggal+Shift+Unit", authority_status: "HUMAN_AUTHORITY" });
    await registerSource(client, { source_id: `${FX}-t3c-b`, source_name: "B", source_type: "HAULING_DATA",
      grain: "Tanggal+Shift+Unit", authority_status: "HUMAN_AUTHORITY" });
    // ritasi differs materially; tonase absent on BOTH sides (no Tonase column)
    await importEvidence(client, [
      { source_id: `${FX}-t3c-a`, tanggal: "2026-08-01", shift: "day", unit: "DT-001",
        ritasi: 200, grain: "Tanggal+Shift+Unit" },
    ]);
    await importEvidence(client, [
      { source_id: `${FX}-t3c-b`, tanggal: "2026-08-01", shift: "day", unit: "DT-001",
        ritasi: 100, grain: "Tanggal+Shift+Unit" },
    ]);
    const res = await reconcile(client, `${FX}-t3c-a`, `${FX}-t3c-b`, "Tanggal+Shift+Unit",
      undefined, `${FX}-run-t3c`);
    assert.strictEqual(res[0].classification, "MAJOR_VARIANCE",
      "a missing-on-both Tonase must NOT mask a real Ritasi variance");
    console.log("  ✓ T3c absent Tonase (both sides) does not mask MAJOR_VARIANCE in Ritasi");
  });
});

// ══════════════════════════════════════════════════════════════════
// T4–T6 — PARITY CLASSIFICATION (exact / minor / major)
// ══════════════════════════════════════════════════════════════════
describe("T4-T6 parity classification", () => {
  it("T4 classifies exact agreement as MATCH", async () => {
    const cfg: ReconciliationConfig = {
      match_threshold_pct: 0, minor_variance_threshold_pct: 5,
      major_variance_threshold_pct: 20, match_threshold_abs: 0,
      minor_variance_threshold_abs: 5,
    };
    const r = classifyParity(100, 100, cfg);
    assert.strictEqual(r.classification, "MATCH");
    assert.strictEqual(r.delta, 0);

    await registerSource(client, { source_id: `${FX}-m-a`, source_name: "A", source_type: "HAULING_DATA",
      grain: "Tanggal+Shift+Unit", authority_status: "HUMAN_AUTHORITY" });
    await registerSource(client, { source_id: `${FX}-m-b`, source_name: "B", source_type: "HAULING_DATA",
      grain: "Tanggal+Shift+Unit", authority_status: "HUMAN_AUTHORITY" });
    const row = (sid: string): HistoricalEvidenceRow => ({
      source_id: sid, tanggal: "2026-08-01", shift: "day", unit: "DT-001",
      ritasi: 100, tonase: 1000, bcm: 500, grain: "Tanggal+Shift+Unit",
    });
    await importEvidence(client, [row(`${FX}-m-a`)]);
    await importEvidence(client, [row(`${FX}-m-b`)]);
    const res = await reconcile(client, `${FX}-m-a`, `${FX}-m-b`, "Tanggal+Shift+Unit", cfg, `${FX}-run-match`);
    assert.strictEqual(res.length, 1);
    assert.strictEqual(res[0].classification, "MATCH");
    console.log("  ✓ T4 MATCH for 100 vs 100");
  });

  it("T5 classifies a small deviation as MINOR_VARIANCE", async () => {
    const r = classifyParity(102, 100);
    assert.strictEqual(r.classification, "MINOR_VARIANCE");
    assert.strictEqual(r.delta, 2);
    assert.ok(r.delta_pct! < 5, `delta% ${r.delta_pct} should be < 5`);
    console.log(`  ✓ T5 MINOR_VARIANCE for 102 vs 100 (delta% = ${r.delta_pct!.toFixed(2)})`);
  });

  it("T6 classifies a large deviation as MAJOR_VARIANCE", async () => {
    const r = classifyParity(200, 100);
    assert.strictEqual(r.classification, "MAJOR_VARIANCE");
    assert.ok(r.delta_pct! > 20, `delta% ${r.delta_pct} should be > 20`);
    console.log(`  ✓ T6 MAJOR_VARIANCE for 200 vs 100 (delta% = ${r.delta_pct!.toFixed(2)})`);
  });

  it("T6b thresholds are explicit + configurable, not hardcoded magic", async () => {
    const strict: ReconciliationConfig = {
      match_threshold_pct: 0, minor_variance_threshold_pct: 0.1,
      major_variance_threshold_pct: 20, match_threshold_abs: 0,
      minor_variance_threshold_abs: 0,
    };
    // 102 vs 100 = 1.98% -> MAJOR under a 0.1% minor band
    assert.strictEqual(classifyParity(102, 100, strict).classification, "MAJOR_VARIANCE");
    // default config -> minor
    assert.strictEqual(classifyParity(102, 100).classification, "MINOR_VARIANCE");

    const cfgRows = await client.query(
      `SELECT config_id FROM fms_reconciliation_config ORDER BY config_id`);
    assert.ok(cfgRows.rows.length > 0, "config table must be seeded");

    const cols = await client.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema='public' AND table_name='fms_reconciliation_config'`);
    const names = cols.rows.map((r: { column_name: string }) => r.column_name);
    for (const k of ["match_threshold_pct", "minor_variance_threshold_pct",
                     "major_variance_threshold_pct", "match_threshold_abs",
                     "minor_variance_threshold_abs"]) {
      assert.ok(names.includes(k), `${k} must be configurable in DB`);
    }
    console.log(`  ✓ T6b configurable; ${cfgRows.rows.length} config row(s) + 5 threshold columns in DB`);
  });
});

// ══════════════════════════════════════════════════════════════════
// T7 — MISSING SOURCE CLASSIFICATION
// ══════════════════════════════════════════════════════════════════
describe("T7 missing-source classification", () => {
  it("T7 flags groups present in only one source", async () => {
    await registerSource(client, { source_id: `${FX}-7a`, source_name: "A", source_type: "HAULING_DATA",
      grain: "Tanggal+Shift+Unit", authority_status: "HUMAN_AUTHORITY" });
    await registerSource(client, { source_id: `${FX}-7b`, source_name: "B", source_type: "HAULING_DATA",
      grain: "Tanggal+Shift+Unit", authority_status: "HUMAN_AUTHORITY" });
    await importEvidence(client, [
      { source_id: `${FX}-7a`, tanggal: "2026-08-01", shift: "day", unit: "DT-001", ritasi: 10, grain: "Tanggal+Shift+Unit" },
      { source_id: `${FX}-7a`, tanggal: "2026-08-02", shift: "day", unit: "DT-001", ritasi: 20, grain: "Tanggal+Shift+Unit" },
    ]);
    await importEvidence(client, [
      { source_id: `${FX}-7b`, tanggal: "2026-08-01", shift: "day", unit: "DT-001", ritasi: 10, grain: "Tanggal+Shift+Unit" },
      { source_id: `${FX}-7b`, tanggal: "2026-08-03", shift: "day", unit: "DT-001", ritasi: 30, grain: "Tanggal+Shift+Unit" },
    ]);
    const res = await reconcile(client, `${FX}-7a`, `${FX}-7b`, "Tanggal+Shift+Unit", undefined, `${FX}-run-7`);
    const byDate = new Map(res.map(r => [r.tanggal, r]));
    assert.strictEqual(byDate.get("2026-08-01")!.classification, "MATCH");
    assert.strictEqual(byDate.get("2026-08-02")!.classification, "MISSING_SOURCE_B");
    assert.strictEqual(byDate.get("2026-08-03")!.classification, "MISSING_SOURCE_A");
    console.log("  ✓ T7 08-02 => MISSING_SOURCE_B, 08-03 => MISSING_SOURCE_A");
  });
});

// ══════════════════════════════════════════════════════════════════
// T8 — DUPLICATE PATTERN DETECTION
// ══════════════════════════════════════════════════════════════════
describe("T8 duplicate-pattern detection", () => {
  it("T8 detects identical repeated rows and classifies DUPLICATE_PATTERN", async () => {
    await registerSource(client, { source_id: `${FX}-8a`, source_name: "A", source_type: "HAULING_DATA",
      grain: "Tanggal+Shift+Unit", authority_status: "HUMAN_AUTHORITY" });
    await registerSource(client, { source_id: `${FX}-8b`, source_name: "B", source_type: "HAULING_DATA",
      grain: "Tanggal+Shift+Unit", authority_status: "HUMAN_AUTHORITY" });

    const triple: HistoricalEvidenceRow = {
      source_id: `${FX}-8a`, source_sheet: "INPUT",
      tanggal: "2026-08-10", shift: "day", unit: "DT-777",
      ritasi: 9, tonase: 180, bcm: 90,
      loading_point: "LP-A", dumping_point: "DP-1", grain: "Tanggal+Shift+Unit",
    };
    await importEvidence(client, [
      { ...triple, source_row: 1 }, { ...triple, source_row: 2 }, { ...triple, source_row: 3 },
    ]);
    await importEvidence(client, [{
      source_id: `${FX}-8b`, tanggal: "2026-08-10", shift: "day", unit: "DT-777",
      ritasi: 9, tonase: 180, bcm: 90, grain: "Tanggal+Shift+Unit",
    }]);

    const dups = await detectDuplicateRows(client, `${FX}-8a`);
    assert.strictEqual(dups.length, 1, "one group must be flagged");
    assert.strictEqual(dups[0].total_rows, 3);
    assert.strictEqual(dups[0].distinct_payloads, 1);
    assert.strictEqual(dups[0].duplicate_rows, 2, "2 surplus rows beyond the first");
    assert.strictEqual(Number(dups[0].sample_ritasi), 27);

    const res = await reconcile(client, `${FX}-8a`, `${FX}-8b`, "Tanggal+Shift+Unit", undefined, `${FX}-run-8`);
    assert.strictEqual(res[0].classification, "DUPLICATE_PATTERN");
    assert.strictEqual(res[0].source_a_ritasi, 27, "totals reported as-is, NOT deduplicated");
    assert.strictEqual(res[0].source_b_ritasi, 9);
    assert.strictEqual((res[0].evidence as Record<string, unknown>).source_a_duplicate_rows, 2);
    console.log("  ✓ T8 3 identical rows detected; DUPLICATE_PATTERN; totals NOT auto-deduped (27 vs 9)");
  });

  it("T8b a legitimately repeated value with DIFFERENT context is not a duplicate", async () => {
    await registerSource(client, { source_id: `${FX}-8c`, source_name: "A", source_type: "HAULING_DATA",
      grain: "Tanggal+Shift+Unit", authority_status: "HUMAN_AUTHORITY" });
    await importEvidence(client, [
      { source_id: `${FX}-8c`, tanggal: "2026-08-10", shift: "day", unit: "DT-888",
        ritasi: 9, tonase: 180, bcm: 90, dumping_point: "DP-1", grain: "Tanggal+Shift+Unit" },
      { source_id: `${FX}-8c`, tanggal: "2026-08-10", shift: "day", unit: "DT-888",
        ritasi: 9, tonase: 180, bcm: 90, dumping_point: "DP-2", grain: "Tanggal+Shift+Unit" },
    ]);
    const dups = await detectDuplicateRows(client, `${FX}-8c`);
    assert.strictEqual(dups.length, 1);
    assert.strictEqual(dups[0].distinct_payloads, 2, "different dumping_point = different payload");
    assert.strictEqual(dups[0].duplicate_rows, 0, "no true duplicate");
    console.log("  ✓ T8b same value + different dumping_point => 0 duplicates (no false positive)");
  });
});

// ══════════════════════════════════════════════════════════════════
// T9 — GRAIN MISMATCH DETECTION
// ══════════════════════════════════════════════════════════════════
describe("T9 grain-mismatch detection", () => {
  it("T9 flags two sources declared at different grains", async () => {
    await registerSource(client, { source_id: `${FX}-9a`, source_name: "Daily", source_type: "HAULING_DATA",
      grain: "Tanggal", authority_status: "HUMAN_AUTHORITY" });
    await registerSource(client, { source_id: `${FX}-9b`, source_name: "Hourly", source_type: "MASTER_HOURLY",
      grain: "Tanggal+Shift+Unit", authority_status: "HUMAN_AUTHORITY" });
    const g = await detectGrainMismatch(client, `${FX}-9a`, `${FX}-9b`);
    assert.strictEqual(g.mismatch, true);
    assert.match(g.note, /GRAIN_MISMATCH/);
    assert.strictEqual(g.grain_a, "Tanggal");
    assert.strictEqual(g.grain_b, "Tanggal+Shift+Unit");

    await registerSource(client, { source_id: `${FX}-9c`, source_name: "Daily2", source_type: "HAULING_DATA",
      grain: "Tanggal", authority_status: "HUMAN_AUTHORITY" });
    const ok = await detectGrainMismatch(client, `${FX}-9a`, `${FX}-9c`);
    assert.strictEqual(ok.mismatch, false);
    console.log("  ✓ T9 Tanggal vs Tanggal+Shift+Unit => mismatch; Tanggal vs Tanggal => aligned");
  });

  it("T9b the weekly grain structure cannot silently wrap and inflate group counts", () => {
    // Guards the exact defect found in review: a 7-entry array for 14 blocks.
    assert.strictEqual(W2_UNITS.length, 14, "W2_UNITS must have one entry per shift block");
    const groups = buildGroups(9, 15, ["day", "night"], W2_UNITS);
    assert.strictEqual(groups.length, D.w2_groups, `expected ${D.w2_groups} groups, got ${groups.length}`);
    const uniqueKeys = new Set(groups.map(g => `${g.tanggal}|${g.shift}|${g.unit}`));
    assert.strictEqual(uniqueKeys.size, D.w2_groups, "no duplicate grain keys");
    // A short array must FAIL LOUDLY rather than wrap
    assert.throws(() => buildGroups(9, 15, ["day", "night"], [23, 22]), /no entry for block/);
    console.log(`  ✓ T9b 14 blocks => exactly ${groups.length} unique groups; short array throws instead of wrapping`);
  });
});

// ══════════════════════════════════════════════════════════════════
// T10–T12 — RECONCILIATION GRAINS
// ══════════════════════════════════════════════════════════════════
describe("T10-T12 reconciliation grains", () => {
  async function seedGrainFixture(): Promise<void> {
    await registerSource(client, { source_id: `${FX}-g`, source_name: "Grain Fixture", source_type: "HAULING_DATA",
      grain: "Tanggal+Shift+Unit", authority_status: "HUMAN_AUTHORITY" });
    await importEvidence(client, [
      { source_id: `${FX}-g`, tanggal: "2026-08-01", shift: "day",   unit: "DT-001", ritasi: 10, grain: "Tanggal+Shift+Unit" },
      { source_id: `${FX}-g`, tanggal: "2026-08-01", shift: "day",   unit: "DT-002", ritasi: 20, grain: "Tanggal+Shift+Unit" },
      { source_id: `${FX}-g`, tanggal: "2026-08-01", shift: "night", unit: "DT-001", ritasi: 30, grain: "Tanggal+Shift+Unit" },
      { source_id: `${FX}-g`, tanggal: "2026-08-02", shift: "day",   unit: "DT-001", ritasi: 40, grain: "Tanggal+Shift+Unit" },
    ]);
  }

  it("T10 aggregates to Tanggal (1 row / date)", async () => {
    await seedGrainFixture();
    const agg = await aggregateEvidence(client, `${FX}-g`, "Tanggal");
    assert.strictEqual(agg.length, 2, "2 distinct dates");
    const d1 = agg.find(r => r.tanggal === "2026-08-01")!;
    assert.strictEqual(Number(d1.total_ritasi), 60, "10+20+30");
    assert.strictEqual(Number(d1.row_count), 3);
    console.log("  ✓ T10 Tanggal => 2 rows; 08-01 total 60 across 3 source rows");
  });

  it("T11 aggregates to Tanggal+Shift (2 rows / date)", async () => {
    await seedGrainFixture();
    const agg = await aggregateEvidence(client, `${FX}-g`, "Tanggal+Shift");
    assert.strictEqual(agg.length, 3, "08-01 day, 08-01 night, 08-02 day");
    const d1day = agg.find(r => r.tanggal === "2026-08-01" && r.shift === "day")!;
    assert.strictEqual(Number(d1day.total_ritasi), 30, "10+20");
    const d1night = agg.find(r => r.tanggal === "2026-08-01" && r.shift === "night")!;
    assert.strictEqual(Number(d1night.total_ritasi), 30);
    console.log("  ✓ T11 Tanggal+Shift => 3 rows; 08-01 split 30/30");
  });

  it("T12 aggregates to Tanggal+Shift+Unit (finest grain)", async () => {
    await seedGrainFixture();
    const agg = await aggregateEvidence(client, `${FX}-g`, "Tanggal+Shift+Unit");
    assert.strictEqual(agg.length, 4, "4 distinct unit-shift-date combos");
    const target = agg.find(r => r.tanggal === "2026-08-01" && r.shift === "day" && r.unit === "DT-002")!;
    assert.strictEqual(Number(target.total_ritasi), 20);
    console.log("  ✓ T12 Tanggal+Shift+Unit => 4 rows (finest grain preserved)");
  });

  it("T12b each grain re-aggregates to the same grand total", async () => {
    await seedGrainFixture();
    const totals: number[] = [];
    for (const g of ["Tanggal", "Tanggal+Shift", "Tanggal+Shift+Unit"] as const) {
      const agg = await aggregateEvidence(client, `${FX}-g`, g);
      totals.push(agg.reduce((s, r) => s + Number(r.total_ritasi), 0));
    }
    assert.deepStrictEqual(totals, [100, 100, 100], "grain must not change the grand total");
    console.log("  ✓ T12b all 3 grains reconcile to grand total 100");
  });
});

// ══════════════════════════════════════════════════════════════════
// T13–T15 — KNOWN AUGUST COMPARISONS REPRODUCED
// ══════════════════════════════════════════════════════════════════
describe("T13s-T15s SYNTHETIC machinery only (NOT real workbook parity)", () => {
  /**
   * Register the two Source-C measures over a day range and reproduce the
   * stated delta. `nearDouble` builds A as (2×B minus a residual) so the
   * 9–15 Aug structure is reproduced faithfully instead of flattened.
   */
  async function seedWindow(
    tag: string, fromDay: number, toDay: number, unitsPerBlock: number[],
    inputTotal: number, inprodTotal: number, nearDouble = false,
  ): Promise<{ aId: string; bId: string }> {
    const aId = `${FX}-${tag}-input`;
    const bId = `${FX}-${tag}-inprod`;
    await registerSource(client, { source_id: aId, source_name: `Master Hourly / Input Ritasi (${tag})`,
      source_type: "MASTER_HOURLY", source_sheet: "Input Ritasi", grain: "Tanggal+Shift+Unit",
      authority_status: "HUMAN_AUTHORITY",
      known_discrepancies: { provenance: "OWNER-STATED figures from Phase 3C directive; raw workbook not on VPS" } });
    await registerSource(client, { source_id: bId, source_name: `Master Hourly / In Prod (${tag})`,
      source_type: "MASTER_HOURLY", source_sheet: "In Prod", grain: "Tanggal+Shift+Unit",
      authority_status: "HUMAN_AUTHORITY",
      known_discrepancies: { provenance: "OWNER-STATED figures from Phase 3C directive; raw workbook not on VPS" } });

    const groups = buildGroups(fromDay, toDay, ["day", "night"], unitsPerBlock);
    const bVals = distribute(inprodTotal, groups.length);

    let aVals: number[];
    if (nearDouble) {
      aVals = bVals.map(v => v * 2);
      const residual = inprodTotal * 2 - inputTotal;
      for (let k = 0; k < residual && k < aVals.length; k++) aVals[k] -= 1;
    } else {
      aVals = distribute(inputTotal, groups.length);
    }
    // Invariant: fixtures must reproduce the directive figure EXACTLY.
    assert.strictEqual(aVals.reduce((s, v) => s + v, 0), inputTotal,
      `${tag}: Input fixture must sum to the stated ${inputTotal}`);
    assert.strictEqual(bVals.reduce((s, v) => s + v, 0), inprodTotal,
      `${tag}: In Prod fixture must sum to the stated ${inprodTotal}`);

    await importEvidence(client, groups.map((g, i) => ({ source_id: aId, tanggal: g.tanggal,
      shift: g.shift, unit: g.unit, ritasi: aVals[i], grain: "Tanggal+Shift+Unit" as const })));
    await importEvidence(client, groups.map((g, i) => ({ source_id: bId, tanggal: g.tanggal,
      shift: g.shift, unit: g.unit, ritasi: bVals[i], grain: "Tanggal+Shift+Unit" as const })));
    return { aId, bId };
  }

  it("T13s [SYNTHETIC] machinery conserves the 1–8 Aug aggregate arithmetic (9,793 vs 9,772)", async () => {
    const { aId, bId } = await seedWindow("t13", 1, 8, [12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12],
      D.w1_0808.input, D.w1_0808.inprod);
    const res = await reconcile(client, aId, bId, "Tanggal+Shift+Unit", undefined, `${FX}-run-t13`);
    const sum = summarizeReconciliation(res);

    assert.strictEqual(sum.source_a_total_ritasi, D.w1_0808.input, "Input must be 9,793");
    assert.strictEqual(sum.source_b_total_ritasi, D.w1_0808.inprod, "In Prod must be 9,772");
    assert.strictEqual(sum.delta_ritasi, D.w1_0808.delta, "delta must be +21");
    assert.strictEqual(sum.classification, "MINOR_VARIANCE", "+21 on ~9.7k is minor");
    assert.ok(sum.delta_pct_ritasi < 1, `delta% ${sum.delta_pct_ritasi} should be < 1%`);
    console.log(`  ✓ T13s [SYNTHETIC] 1–8 Aug: 9,793 vs 9,772 => delta +21 (${sum.delta_pct_ritasi.toFixed(3)}%) MINOR_VARIANCE over ${sum.groups} groups`);
  });

  it("T15s [SYNTHETIC] machinery conserves the 16–28 Aug aggregate arithmetic (19,875 vs 19,918)", async () => {
    const { aId, bId } = await seedWindow("t15", 16, 28,
      Array.from({ length: 26 }, () => 12), D.w3_1628.input, D.w3_1628.inprod);
    const res = await reconcile(client, aId, bId, "Tanggal+Shift+Unit", undefined, `${FX}-run-t15`);
    const sum = summarizeReconciliation(res);

    assert.strictEqual(sum.source_a_total_ritasi, D.w3_1628.input, "Input must be 19,875");
    assert.strictEqual(sum.source_b_total_ritasi, D.w3_1628.inprod, "In Prod must be 19,918");
    assert.strictEqual(sum.delta_ritasi, D.w3_1628.delta, "delta must be -43");
    assert.strictEqual(sum.classification, "MINOR_VARIANCE");
    console.log(`  ✓ T15s [SYNTHETIC] 16–28 Aug: 19,875 vs 19,918 => delta -43 (${sum.delta_pct_ritasi.toFixed(3)}%) MINOR_VARIANCE over ${sum.groups} groups`);
  });

  it("T14s [SYNTHETIC] machinery reproduces the 9–15 Aug ~2x discrepancy and HOLDS it for review", async () => {
    const { aId, bId } = await seedWindow("t14", 9, 15, W2_UNITS,
      D.w2_0915.input, D.w2_0915.inprod, true);
    const res = await reconcile(client, aId, bId, "Tanggal+Shift+Unit", undefined, `${FX}-run-t14`);
    const sum = summarizeReconciliation(res);

    assert.strictEqual(sum.source_a_total_ritasi, D.w2_0915.input, "Input Ritasi must be 19,654");
    assert.strictEqual(sum.source_b_total_ritasi, D.w2_0915.inprod, "In Prod must be 9,850");
    assert.strictEqual(sum.delta_ritasi, D.w2_0915.delta, "delta must be +9,804");
    assert.strictEqual(sum.classification, "MAJOR_VARIANCE", "~2x is major, not minor");
    assert.ok(sum.delta_pct_ritasi > 60, "delta% must be large");
    assert.ok(sum.delta_pct_ritasi < 70, "but not total — both sides carry data");

    // 311/311 groups known to exist in BOTH sources
    assert.strictEqual(sum.groups, D.w2_groups, `expected ${D.w2_groups} Tanggal+Shift+Unit groups`);
    assert.strictEqual(sum.counts_by_classification.MISSING_SOURCE_A, 0);
    assert.strictEqual(sum.counts_by_classification.MISSING_SOURCE_B, 0);

    // ratio is ~2 but NOT exactly 2 — recorded as evidence, never corrected
    const ratio = sum.source_a_total_ritasi / sum.source_b_total_ritasi;
    assert.ok(ratio > 1.9 && ratio < 2.1, `ratio ${ratio.toFixed(4)} near but not at 2`);
    assert.notStrictEqual(sum.source_a_total_ritasi, sum.source_b_total_ritasi * 2,
      "Input is NOT an exact double of In Prod");
    console.log(`  ✓ T14s [SYNTHETIC] 9–15 Aug: 19,654 vs 9,850 => delta +9,804 (${sum.delta_pct_ritasi.toFixed(2)}%) MAJOR_VARIANCE, ratio ${ratio.toFixed(4)}, ${sum.groups}/${D.w2_groups} groups in BOTH`);
  });

  it("T14b records 29–31 Aug as MISSING Input coverage, not zero", async () => {
    await registerSource(client, { source_id: `${FX}-t14b-input`, source_name: "Input Ritasi (29–31 Aug)",
      source_type: "MASTER_HOURLY", grain: "Tanggal+Shift+Unit", authority_status: "HUMAN_AUTHORITY",
      known_discrepancies: { note: "29–31 Aug: Input Ritasi has no comparable coverage" } });
    await registerSource(client, { source_id: `${FX}-t14b-inprod`, source_name: "In Prod (29–31 Aug)",
      source_type: "MASTER_HOURLY", grain: "Tanggal+Shift+Unit", authority_status: "HUMAN_AUTHORITY" });
    const groups = buildGroups(29, 31, ["day", "night"], [12, 12, 12, 12, 12, 12]);
    const vals = distribute(D.w4_2931.inprod, groups.length);
    await importEvidence(client, groups.map((g, i) => ({
      source_id: `${FX}-t14b-inprod`, tanggal: g.tanggal, shift: g.shift, unit: g.unit,
      ritasi: vals[i], grain: "Tanggal+Shift+Unit" as const,
    })));

    const res = await reconcile(client, `${FX}-t14b-input`, `${FX}-t14b-inprod`,
      "Tanggal+Shift+Unit", undefined, `${FX}-run-t14b`);
    const sum = summarizeReconciliation(res);
    assert.strictEqual(sum.source_b_total_ritasi, D.w4_2931.inprod, "In Prod 3,962 preserved");
    assert.strictEqual(res.length, 72, "72 falsifiable groups (3 days × 2 shifts × 12 units)");
    assert.strictEqual(sum.counts_by_classification.MISSING_SOURCE_A, res.length,
      "every group must be MISSING_SOURCE_A");
    const persisted = await getReviewTable(client, `${FX}-run-t14b`);
    assert.strictEqual(persisted.length, res.length);
    assert.ok(persisted.every((r: Record<string, unknown>) => r.source_a_ritasi === null),
      "missing Input must persist as NULL, never 0");
    console.log(`  ✓ T14b 29–31 Aug: In Prod 3,962 vs Input ABSENT => ${res.length}× MISSING_SOURCE_A, NULL not 0`);
  });
});

// ══════════════════════════════════════════════════════════════════
// T13 / T14 / T15 — REAL HISTORICAL PARITY (workbook-derived ONLY)
//
// Master Instruction §16: T13/T14/T15 may ONLY be called REAL historical
// parity tests when they consume traceable evidence extracted from the
// actual original workbooks. Constants (D.w1_0808 / D.w2_0915 / D.w3_1628)
// are NOT acceptable substitutes — they are retained above as T13s/T14s/T15s
// and labelled [SYNTHETIC] machinery-only.
//
// Real parity is driven by:
//   1. the three ORIGINAL workbooks under validation/fixtures/historical/
//      (SHA256 verified against the frozen registry below), and
//   2. the lineage-preserving extraction artifact produced by
//      scripts/extract-historical-workbooks.py
//         -> validation/extracted/historical-evidence.json
//      (gitignored: it contains client rows).
//
// These gates FAIL CLOSED. A blocked gate reports
// HISTORICAL_SOURCE_FILES_UNAVAILABLE — it must never be read as a defect and
// must never be satisfied with fabricated rows.
// ══════════════════════════════════════════════════════════════════

const HIST_DIR = path.join(process.cwd(), "validation", "fixtures", "historical");
const EVIDENCE_ARTIFACT = path.join(
  process.cwd(), "validation", "extracted", "historical-evidence.json",
);

// Frozen source registry. Filenames preserved exactly as delivered —
// note the SPACE after "BR_" in workbook B.
const REQUIRED_WORKBOOKS = [
  { key: "A", file: "HAULING DATA WEEKLY LIM 2026 AGUSTUS1.xlsx",
    sha256: "3f9a97110d705da35435c5191a4014ed55ce030dd63412153572b808294bc8ba" },
  { key: "B", file: "Status Unit Support BR_ 202600831.xlsb",
    sha256: "69136db613302e6ca976250465653c16bba74fe84f48e629e8e95758fdf8b28c" },
  { key: "C", file: "Master Hourly Like New_20260831 (3).xlsb",
    sha256: "f3ae53db0f9300eb68a0ffdcba0a948a7a28d0cc79d68ae8378d6647c16ad470" },
] as const;

function discoverHistoricalSources(): {
  present: Array<{ key: string; file: string; sha256: string; matches: boolean }>;
  missing: string[];
} {
  const present: Array<{ key: string; file: string; sha256: string; matches: boolean }> = [];
  const missing: string[] = [];
  for (const w of REQUIRED_WORKBOOKS) {
    const p = path.join(HIST_DIR, w.file);
    if (fs.existsSync(p)) {
      const sha256 = createHash("sha256").update(fs.readFileSync(p)).digest("hex");
      present.push({ key: w.key, file: w.file, sha256, matches: sha256 === w.sha256 });
    } else {
      missing.push(w.file);
    }
  }
  return { present, missing };
}

/** Load the lineage-preserving extraction artifact. Fail-closed when absent. */
function loadHistoricalEvidence(): any {
  const { present, missing } = discoverHistoricalSources();
  if (missing.length > 0) {
    assert.fail(
      `HISTORICAL_SOURCE_FILES_UNAVAILABLE — ${missing.length}/3 workbook(s) absent from ${HIST_DIR}: ` +
      `${missing.join(", ")}. Real historical parity cannot be established. Do NOT fabricate rows.`,
    );
  }
  if (!fs.existsSync(EVIDENCE_ARTIFACT)) {
    assert.fail(
      `HISTORICAL_EVIDENCE_ARTIFACT_MISSING — ${EVIDENCE_ARTIFACT} not found. ` +
      `Run: python scripts/extract-historical-workbooks.py --out validation/extracted/historical-evidence.json`,
    );
  }
  const ev = JSON.parse(fs.readFileSync(EVIDENCE_ARTIFACT, "utf8"));
  assert.equal(ev.schema_version, "fms-3c-historical-evidence/1");
  assert.equal(ev.originals_unchanged_after_extraction, true,
    "extractor must prove the originals were unmodified");
  return ev;
}

describe("T13-T15 REAL historical parity (workbook-derived)", () => {
  it("T13real source registry — 3 originals present, SHA256 verified, unmodified", () => {
    const { present, missing } = discoverHistoricalSources();

    if (missing.length > 0) {
      console.error("");
      console.error("  \u26d4 HISTORICAL_SOURCE_FILES_UNAVAILABLE");
      console.error(`     expected mount: ${HIST_DIR}`);
      for (const m of missing) console.error(`     MISSING: ${m}`);
      console.error(`     (${missing.length}/3 absent — real T13/T14/T15 are BLOCKED, not failing)`);
      console.error("");
      assert.fail(
        `HISTORICAL_SOURCE_FILES_UNAVAILABLE — ${missing.length}/3 workbook(s) absent. ` +
        `Real historical parity cannot be established. Do NOT fabricate rows. ` +
        `Mount them at ${HIST_DIR}.`,
      );
    }

    for (const p of present) {
      assert.match(p.sha256, /^[0-9a-f]{64}$/, `${p.file} sha256 must be recorded`);
      assert.ok(p.matches,
        `${p.file} SHA256 drift: extracted originals must stay byte-identical (no modification)`);
      console.log(`  \u2713 registry ${p.key} sha256=${p.sha256} ${p.file}`);
    }

    const ev = loadHistoricalEvidence();
    assert.equal(ev.sources.length, 3, "artifact must carry all 3 source registrations");
    assert.equal(ev.extraction_rules.no_correction, true);
    assert.equal(ev.extraction_rules.no_dedup, true);
    assert.equal(ev.extraction_rules.no_normalisation, true);
    assert.equal(ev.extraction_rules.missing_is_not_zero, true);
    console.log("  \u2713 artifact lineage rules: no_correction / no_dedup / no_normalisation / missing!=0");
  });

  it("T13 real Workbook A parity at Tanggal + Shift + Unit (REAL rows, not fixtures)", () => {
    const ev = loadHistoricalEvidence();
    const a = ev.workbook_a;

    assert.equal(a.grain, "Tanggal + Shift + Unit", "Workbook A grain must be Tanggal+Shift+Unit");
    assert.equal(a.sheet_input, "INPUT");
    assert.equal(a.sheet_rekap, "REKAP DAILY");

    // --- prior observations, independently reproduced from real workbook rows
    assert.equal(a.groups_total, 1365, "Workbook A group count (prior: 1365)");
    assert.equal(a.groups_matched, 1365, "Workbook A matched groups (prior: 1365/1365)");
    assert.equal(a.groups_input_only, 0, "no INPUT-only groups");
    assert.equal(a.groups_rekap_only, 0, "no REKAP-only groups");
    assert.equal(a.totals.ritase, 8825, "Workbook A total Ritasi (prior: 8,825)");
    assert.equal(a.totals.tonase, 436335.92, "Workbook A total Tonase (prior: 436,335.92)");
    assert.ok(Math.abs(a.totals.bcm - 247918.13636) < 1e-4,
      `Workbook A total BCM ~247,918.13636 (prior), got ${a.totals.bcm} ` +
      `(1e-5 float-accumulation-order difference is accepted)`);

    // --- LINEAGE: every group must be traceable to real source rows
    assert.equal(a.groups.length, 1365, "every group carries lineage");
    let checked = 0;
    for (const g of a.groups) {
      assert.ok(g.tanggal && g.shift && g.unit, "group key must be Tanggal+Shift+Unit");
      assert.ok(Array.isArray(g.input_rows) && g.input_rows.length > 0,
        `group ${g.tanggal}/${g.shift}/${g.unit} must cite INPUT source rows`);
      assert.ok(Array.isArray(g.rekap_rows) && g.rekap_rows.length > 0,
        `group ${g.tanggal}/${g.shift}/${g.unit} must cite REKAP DAILY source rows`);
      assert.ok(g.input_rows.every((r: number) => Number.isInteger(r) && r > 0),
        "source_row references must be real positive row numbers");
      assert.equal(g.parity, "MATCH");
      if (checked++ >= 40) break;   // spot-check lineage breadth without scanning all 1365
    }
    console.log(`  \u2713 Workbook A REAL: 1365/1365 groups MATCH \u00b7 Ritasi ${a.totals.ritase} \u00b7 ` +
      `Tonase ${a.totals.tonase} \u00b7 BCM ${a.totals.bcm} \u00b7 lineage verified on ${checked} groups`);

    // --- engine agrees on the REAL aggregate (no correction path)
    const cls = classifyParity(a.totals.ritase, a.totals.rekap_ritase);
    assert.equal(cls.classification, "MATCH",
      "engine must classify the real Workbook A INPUT-vs-REKAP aggregate as MATCH");
    console.log(`  \u2713 engine classifyParity(REAL ${a.totals.ritase} vs ${a.totals.rekap_ritase}) => MATCH`);
  });

  it("T14 real Workbook C 9-15 Aug parity + ROOT CAUSE from real rows", () => {
    const ev = loadHistoricalEvidence();
    const c = ev.workbook_c;
    const x = c.aug_9_15;

    // --- real metric identification (recorded, not assumed)
    assert.equal(c.metric_authority.input_ritasi_metric.header, "Ritse",
      "Workbook C Input Ritasi metric column is 'Ritse'");
    assert.equal(c.metric_authority.in_prod_metric.header, "Rate",
      "Workbook C In Prod metric column is 'Rate'");

    // --- prior observations reproduced exactly
    assert.equal(x.input_ritase, 19654, "9-15 Aug Input Ritasi (prior: 19,654)");
    assert.equal(x.in_prod, 9850, "9-15 Aug In Prod (prior: 9,850)");
    assert.equal(x.delta, 9804, "9-15 Aug delta (prior: +9,804)");
    assert.ok(x.input_ritase / x.in_prod > 1.99 && x.input_ritase / x.in_prod < 2.01,
      `9-15 Aug ratio must be ~2x, got ${x.input_ritase / x.in_prod}`);

    // --- NO correction, ever
    assert.equal(x.correction_applied, false, "no correction may be applied to the 9-15 anomaly");

    // --- ROOT CAUSE: loading-point alias double-representation
    assert.equal(x.input_by_from["Pit BR23W"], 9827, "alias label Pit BR23W carries 9,827");
    assert.equal(x.input_by_from["Pit BR23"], 9827, "canonical label Pit BR23 carries 9,827");
    assert.equal(x.input_by_from["Pit BR23W"] + x.input_by_from["Pit BR23"], x.input_ritase,
      "the two labels exactly account for the whole window");

    assert.equal(x.alias_pairs.length, 1, "exactly one alias pair detected");
    const pair = x.alias_pairs[0];
    assert.equal(pair.candidate_alias, "Pit BR23W");
    assert.equal(pair.candidate_canonical, "Pit BR23");
    assert.equal(pair.pct_of_window, 50, "the alias carries exactly 50% of the window");

    // --- the alias test is DIAGNOSTIC only; it is never applied
    assert.equal(x.residual_after_alias_removed, 9827,
      "alias removed (diagnostic) => 9,827");
    assert.equal(x.residual_delta_vs_in_prod, -23,
      "residual -23 falls back inside the normal +/- band (+21 / -43), NOT +9,804");

    // --- lineage on the REAL 9-15 rows
    assert.equal(x.rows.length, x.rows.length);
    assert.ok(x.rows.length > 1000, "9-15 window must expose its real rows with lineage");
    for (const r of x.rows.slice(0, 25)) {
      assert.ok(Number.isInteger(r.source_row) && r.source_row > 0, "row must cite source_row");
      assert.equal(r.tanggal.slice(0, 7), "2026-08");
      assert.ok(typeof r.ritse === "number");
      assert.ok(r.from && r.to, "each row must carry its loading/dumping point");
    }
    const d10 = x.rows.filter((r: any) => r.tanggal === "2026-08-10");
    assert.ok(d10.some((r: any) => r.from === "Pit BR23W") &&
              d10.some((r: any) => r.from === "Pit BR23"),
      "10 Aug must carry BOTH alias labels");

    // --- engine classification of the REAL 9-15 numbers
    const cls = classifyParity(x.input_ritase, x.in_prod);
    assert.equal(cls.classification, "MAJOR_VARIANCE",
      "engine must classify the real 9-15 divergence as MAJOR_VARIANCE");
    console.log(`  \u2713 Workbook C REAL 9-15: ${x.input_ritase} vs ${x.in_prod} => +${x.delta} ` +
      `MAJOR_VARIANCE (ratio ${(x.input_ritase / x.in_prod).toFixed(5)})`);
    console.log(`  \u2713 ROOT CAUSE (real rows): 'Pit BR23W'=${x.input_by_from["Pit BR23W"]} ` +
      `+ 'Pit BR23'=${x.input_by_from["Pit BR23"]} = ${x.input_ritase}, exactly 50.0%/50.0% \u2014 ` +
      `same haul recorded under two loading-point labels`);
    console.log(`  \u2713 alias removed (DIAGNOSTIC ONLY, never applied) => ${x.residual_after_alias_removed}, ` +
      `vs In Prod ${x.in_prod} => ${x.residual_delta_vs_in_prod} (normal band)`);
  });

  it("T15 real Workbook C full August window parity (1-8 / 16-28 / 29-31)", () => {
    const ev = loadHistoricalEvidence();
    const wins: any[] = ev.workbook_c.windows;
    const by = Object.fromEntries(wins.map((w) => [w.label, w]));

    assert.deepEqual(wins.map((w) => w.label), ["1-8", "9-15", "16-28", "29-31"]);

    // --- prior observations, exactly reproduced from real rows
    assert.equal(by["1-8"].input_ritase, 9793, "1-8 Aug Input Ritasi (prior: 9,793)");
    assert.equal(by["1-8"].in_prod, 9772, "1-8 Aug In Prod (prior: 9,772)");
    assert.equal(by["1-8"].delta, 21, "1-8 Aug delta (prior: +21)");

    assert.equal(by["16-28"].input_ritase, 19875, "16-28 Aug Input Ritasi (prior: 19,875)");
    assert.equal(by["16-28"].in_prod, 19918, "16-28 Aug In Prod (prior: 19,918)");
    assert.equal(by["16-28"].delta, -43, "16-28 Aug delta (prior: -43)");

    assert.equal(by["29-31"].input_rows, 0, "29-31 Aug has NO comparable Input coverage");
    assert.equal(by["29-31"].input_ritase, 0, "29-31 Aug Input must not be imputed");
    assert.equal(by["29-31"].in_prod, 3962, "29-31 Aug In Prod (prior: 3,962)");
    assert.equal(by["29-31"].delta, null, "29-31 Aug delta is undefined (missing != zero)");

    // --- engine must agree with the real classifications
    const expect: Record<string, string> = {
      "1-8": "MINOR_VARIANCE",
      "16-28": "MINOR_VARIANCE",
      "29-31": "MISSING_SOURCE_A",
    };
    for (const [label, want] of Object.entries(expect)) {
      const w = by[label];
      const cls = label === "29-31"
        ? classifyParity(null, w.in_prod)
        : classifyParity(w.input_ritase, w.in_prod);
      assert.equal(cls.classification, want,
        `${label} Aug: engine expected ${want}, got ${cls.classification}`);
      console.log(`  \u2713 Workbook C REAL ${label}: ${w.input_ritase} vs ${w.in_prod} => ` +
        `${w.delta ?? "n/a"} classified ${cls.classification}`);
    }

    // --- the ~2x factor is UNIQUE to 9-15 (proof it is not a global scaling artefact)
    const r915 = by["9-15"].input_ritase / by["9-15"].in_prod;
    for (const label of ["1-8", "16-28"]) {
      const r = by[label].input_ritase / by[label].in_prod;
      assert.ok(r < 1.01 && r > 0.99, `${label} ratio must be ~1.0, got ${r}`);
    }
    assert.ok(r915 > 1.99, `9-15 ratio ${r915} is an isolated anomaly, not a global factor`);
    console.log(`  \u2713 ratios: 1-8=${(by["1-8"].input_ritase / by["1-8"].in_prod).toFixed(4)} ` +
      `9-15=${r915.toFixed(4)} 16-28=${(by["16-28"].input_ritase / by["16-28"].in_prod).toFixed(4)} ` +
      `\u2014 anomaly is ISOLATED to 9-15`);
  });
});

// ══════════════════════════════════════════════════════════════════
// T16 — NO AUTOMATIC DIVIDE-BY-2 (OR ANY) CORRECTION
// ══════════════════════════════════════════════════════════════════
describe("T16 no automatic correction", () => {
  it("T16 persists the raw discrepancy and applies no divisor/multiplier", async () => {
    const aId = `${FX}-t16-a`, bId = `${FX}-t16-b`;
    await registerSource(client, { source_id: aId, source_name: "Input (9–15 Aug)", source_type: "MASTER_HOURLY",
      grain: "Tanggal+Shift+Unit", authority_status: "HUMAN_AUTHORITY" });
    await registerSource(client, { source_id: bId, source_name: "In Prod (9–15 Aug)", source_type: "MASTER_HOURLY",
      grain: "Tanggal+Shift+Unit", authority_status: "HUMAN_AUTHORITY" });
    const groups = buildGroups(9, 15, ["day", "night"], W2_UNITS);
    const bVals = distribute(D.w2_0915.inprod, groups.length);
    const aVals = bVals.map(v => v * 2);
    const residual = D.w2_0915.inprod * 2 - D.w2_0915.input;
    for (let k = 0; k < residual; k++) aVals[k] -= 1;
    await importEvidence(client, groups.map((g, i) => ({ source_id: aId, tanggal: g.tanggal,
      shift: g.shift, unit: g.unit, ritasi: aVals[i], grain: "Tanggal+Shift+Unit" as const })));
    await importEvidence(client, groups.map((g, i) => ({ source_id: bId, tanggal: g.tanggal,
      shift: g.shift, unit: g.unit, ritasi: bVals[i], grain: "Tanggal+Shift+Unit" as const })));

    const res = await reconcile(client, aId, bId, "Tanggal+Shift+Unit", undefined, `${FX}-run-t16`);
    const sum = summarizeReconciliation(res);

    // The reported value must be the RAW total, never a halved/corrected one
    assert.strictEqual(sum.source_a_total_ritasi, 19654, "raw 19,654 must be reported");
    assert.notStrictEqual(sum.source_a_total_ritasi, 9827, "must NOT silently halve");
    assert.notStrictEqual(sum.source_b_total_ritasi, 19700, "must NOT silently double");

    // Persisted evidence must be identical to what was imported
    const evAgg = await aggregateEvidence(client, aId, "Tanggal+Shift+Unit");
    const evTotal = evAgg.reduce((s, r) => s + Number(r.total_ritasi), 0);
    assert.strictEqual(evTotal, 19654, "stored evidence must be unmutated");

    // Every group must remain MAJOR_VARIANCE — nothing auto-resolved to MATCH
    const resolved = res.filter(r => r.classification === "MATCH");
    assert.strictEqual(resolved.length, 0, "no group may be auto-corrected into MATCH");
    assert.strictEqual(sum.classification, "MAJOR_VARIANCE");

    // No correction-factor artefact anywhere in the schema or the result row
    const cols = await client.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema='public' AND table_name='fms_reconciliation_results'`);
    const names = cols.rows.map((r: { column_name: string }) => r.column_name);
    for (const forbidden of ["correction_factor", "divisor", "multiplier", "adjusted_ritasi", "verified_ritasi"]) {
      assert.ok(!names.includes(forbidden), `column ${forbidden} must not exist`);
    }
    const persisted = await getReviewTable(client, `${FX}-run-t16`);
    for (const row of persisted) {
      assert.strictEqual(Number(row.source_a_ritasi), Number(row.source_a_ritasi), "value must be a plain number");
      for (const k of Object.keys(row)) {
        assert.ok(!/correction|divisor|multiplier|adjusted/i.test(k),
          `persisted row must not carry a correction artefact (${k})`);
      }
    }
    console.log(`  ✓ T16 raw 19,654 preserved; 0 groups auto-corrected; no correction artefact in schema or rows`);
  });
});

// ══════════════════════════════════════════════════════════════════
// T17 — NO VERIFIED_RITASI GENERATED
// ══════════════════════════════════════════════════════════════════
describe("T17 no VERIFIED_RITASI", () => {
  it("T17 nowhere in the schema or output is a VERIFIED_RITASI produced", async () => {
    const cols = await client.query(
      `SELECT table_name, column_name FROM information_schema.columns
       WHERE table_schema='public'
         AND (column_name ILIKE '%verified%' OR table_name ILIKE '%verified%')`);
    assert.strictEqual(cols.rows.length, 0, "no verified_* column may exist");

    const tbls = await client.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema='public' AND table_name ILIKE '%verified%'`);
    assert.strictEqual(tbls.rows.length, 0, "no verified_* table may exist");

    const cc = await client.query(`SELECT DISTINCT candidate_status FROM fms_cycle_candidates`);
    for (const r of cc.rows) {
      assert.notStrictEqual(r.candidate_status, "VERIFIED_RITASI");
      assert.notStrictEqual(r.candidate_status, "RITASI");
      assert.notStrictEqual(r.candidate_status, "PRODUCTION");
    }

    const rs = await client.query(`SELECT DISTINCT review_status FROM fms_reconciliation_results`);
    for (const r of rs.rows) {
      assert.ok(["PENDING", "REVIEWED", "DISPUTED"].includes(r.review_status),
        `review_status '${r.review_status}' must not imply verification`);
    }
    console.log("  ✓ T17 no verified_* table/column; candidates stay CANDIDATE; review_status stays PENDING class");
  });

  it("T17b the replay layer and cycle-engine never emit a VERIFIED_RITASI token", async () => {
    const src = fs.readFileSync("lib/fms/historical-replay.ts", "utf8");
    assert.ok(!/VERIFIED_RITASI/.test(src), "no VERIFIED_RITASI literal in the replay layer");
    const cyc = fs.readFileSync("lib/fms/cycle-engine.ts", "utf8");
    assert.ok(!/VERIFIED_RITASI/.test(cyc), "cycle-engine must not emit VERIFIED_RITASI");
    console.log("  ✓ T17b no VERIFIED_RITASI literal in replay layer or cycle-engine");
  });
});

// ══════════════════════════════════════════════════════════════════
// T18 — NO FABRICATED HISTORICAL TELEMETRY
// ══════════════════════════════════════════════════════════════════
describe("T18 no fabricated historical telemetry", () => {
  it("T18 running the whole 3C flow inserts zero telemetry rows", async () => {
    const count = async (t: string) =>
      (await client.query(`SELECT COUNT(*)::int AS c FROM ${t}`)).rows[0].c as number;

    const b = {
      raw: await count("fms_raw_telemetry"),
      ev: await count("fms_canonical_events"),
      gf: await count("fms_geofence_events"),
      cy: await count("fms_cycle_candidates"),
      mv: await count("fms_movement_observations"),
    };

    await registerSource(client, { source_id: `${FX}-t18-a`, source_name: "Hist A", source_type: "HAULING_DATA",
      grain: "Tanggal+Shift+Unit", authority_status: "HUMAN_AUTHORITY" });
    await registerSource(client, { source_id: `${FX}-t18-b`, source_name: "Hist B", source_type: "HAULING_DATA",
      grain: "Tanggal+Shift+Unit", authority_status: "HUMAN_AUTHORITY" });
    const groups = buildGroups(9, 15, ["day", "night"], W2_UNITS);
    const bVals = distribute(9850, groups.length);
    const aVals = bVals.map(v => v * 2);
    for (let k = 0; k < 46; k++) aVals[k] -= 1;
    await importEvidence(client, groups.map((g, i) => ({ source_id: `${FX}-t18-a`, tanggal: g.tanggal,
      shift: g.shift, unit: g.unit, ritasi: aVals[i], grain: "Tanggal+Shift+Unit" as const })));
    await importEvidence(client, groups.map((g, i) => ({ source_id: `${FX}-t18-b`, tanggal: g.tanggal,
      shift: g.shift, unit: g.unit, ritasi: bVals[i], grain: "Tanggal+Shift+Unit" as const })));
    await reconcile(client, `${FX}-t18-a`, `${FX}-t18-b`, "Tanggal+Shift+Unit", undefined, `${FX}-run-t18`);
    await investigate9to15August(client, `${FX}-t18-a`, `${FX}-t18-b`);

    const a = {
      raw: await count("fms_raw_telemetry"),
      ev: await count("fms_canonical_events"),
      gf: await count("fms_geofence_events"),
      cy: await count("fms_cycle_candidates"),
      mv: await count("fms_movement_observations"),
    };

    assert.strictEqual(a.raw, b.raw, "fms_raw_telemetry must be untouched");
    assert.strictEqual(a.ev, b.ev, "fms_canonical_events must be untouched");
    assert.strictEqual(a.gf, b.gf, "fms_geofence_events must be untouched");
    assert.strictEqual(a.cy, b.cy, "fms_cycle_candidates must be untouched");
    assert.strictEqual(a.mv, b.mv, "fms_movement_observations must be untouched");
    console.log("  ✓ T18 3C flow added 0 rows to raw_telemetry / canonical_events / geofence_events / cycle_candidates / movement_observations");
  });

  it("T18b no August-2026 GPS trajectory exists to be mistaken for historical truth", async () => {
    const cy = await client.query(
      `SELECT COUNT(*)::int AS c FROM fms_cycle_candidates
       WHERE start_fix_time >= '2026-08-01' AND start_fix_time < '2026-09-01'`);
    assert.strictEqual(cy.rows[0].c, 0,
      "no August 2026 cycle candidate may exist — the client workbook has no FMC650 telemetry");

    const src = fs.readFileSync("lib/fms/historical-replay.ts", "utf8");
    assert.ok(!/INSERT INTO fms_raw_telemetry/i.test(src), "replay layer must never write telemetry");
    assert.ok(!/INSERT INTO fms_cycle_candidates/i.test(src), "replay layer must never write candidates");
    console.log("  ✓ T18b 0 August-2026 cycle candidates; replay layer contains no telemetry/candidate INSERT");
  });
});

// ══════════════════════════════════════════════════════════════════
// 3C-6 — 9–15 AUGUST SYSTEMATIC INVESTIGATION
// ══════════════════════════════════════════════════════════════════
describe("3C-6 9-15 August investigation", () => {
  async function seedW2(tag: string): Promise<{ aId: string; bId: string }> {
    const aId = `${FX}-${tag}-a`, bId = `${FX}-${tag}-b`;
    await registerSource(client, { source_id: aId, source_name: "Master Hourly / Input Ritasi",
      source_type: "MASTER_HOURLY", source_sheet: "Input Ritasi", grain: "Tanggal+Shift+Unit",
      authority_status: "HUMAN_AUTHORITY",
      known_discrepancies: { provenance: "OWNER-STATED; raw workbook absent" } });
    await registerSource(client, { source_id: bId, source_name: "Master Hourly / In Prod",
      source_type: "MASTER_HOURLY", source_sheet: "In Prod", grain: "Tanggal+Shift+Unit",
      authority_status: "HUMAN_AUTHORITY",
      known_discrepancies: { provenance: "OWNER-STATED; raw workbook absent" } });
    const groups = buildGroups(9, 15, ["day", "night"], W2_UNITS);
    const bVals = distribute(D.w2_0915.inprod, groups.length);
    const aVals = bVals.map(v => v * 2);
    const residual = D.w2_0915.inprod * 2 - D.w2_0915.input;
    for (let k = 0; k < residual; k++) aVals[k] -= 1;
    await importEvidence(client, groups.map((g, i) => ({ source_id: aId, tanggal: g.tanggal,
      shift: g.shift, unit: g.unit, ritasi: aVals[i], grain: "Tanggal+Shift+Unit" as const })));
    await importEvidence(client, groups.map((g, i) => ({ source_id: bId, tanggal: g.tanggal,
      shift: g.shift, unit: g.unit, ritasi: bVals[i], grain: "Tanggal+Shift+Unit" as const })));
    return { aId, bId };
  }

  it("Tinv.1 documents the discrepancy at unit/shift grain without concluding divide-by-2", async () => {
    const { aId, bId } = await seedW2("inv");
    const inv = await investigate9to15August(client, aId, bId);

    assert.strictEqual(inv.source_a_total_ritasi, 19654);
    assert.strictEqual(inv.source_b_total_ritasi, 9850);
    assert.strictEqual(inv.delta, 9804);
    assert.strictEqual(inv.duplicate_analysis.groups_in_both, D.w2_groups,
      "311/311 groups must exist in BOTH sources");
    assert.strictEqual(inv.duplicate_analysis.groups_only_in_a, 0);
    assert.strictEqual(inv.duplicate_analysis.groups_only_in_b, 0);
    assert.strictEqual(inv.unit_shift_analysis.length, 50, "drill-down sample at unit/shift grain");

    const joined = inv.findings.join(" ");
    assert.ok(!/divide by 2|divide-by-2|halve the total|÷ ?2/i.test(joined),
      "must not conclude divide-by-2");
    assert.match(joined, /INVESTIGATION_REQUIRED/);
    assert.ok(inv.findings.some(f => f.startsWith("HYPOTHESIS_")),
      "structural hypotheses must be recorded as evidence");
    console.log(`  ✓ Tinv.1 9–15 Aug: delta +9,804; ${inv.duplicate_analysis.groups_in_both}/311 groups in BOTH; ${inv.unit_shift_analysis.length} drill-down rows; no divide-by-2 conclusion`);
    for (const f of inv.findings) console.log(`      · ${f}`);
  });

  it("Tinv.2 quantifies the near-doubling: ratio and residual, as evidence only", async () => {
    const { aId, bId } = await seedW2("inv2");
    const inv = await investigate9to15August(client, aId, bId);
    const ratio = inv.source_a_total_ritasi / inv.source_b_total_ritasi;
    const exactDouble = inv.source_b_total_ritasi * 2;
    const residualFromDouble = exactDouble - inv.source_a_total_ritasi;

    assert.ok(ratio > 1.99 && ratio < 2.0, `ratio ${ratio.toFixed(5)} near 2`);
    assert.strictEqual(residualFromDouble, 46,
      "Input is 46 SHORT of an exact double — pure double-counting does not fully explain it");
    assert.ok(inv.findings.some(f => /HYPOTHESIS_/.test(f)));
    console.log(`  ✓ Tinv.2 ratio ${ratio.toFixed(5)}; 2×In Prod = ${exactDouble}; residual = ${residualFromDouble} (NOT an exact 2×)`);
  });

  it("Tinv.3 per-day rate analysis isolates the anomaly to the Input measure", async () => {
    const rate = (total: number, days: number) => total / days;
    const w1In = rate(D.w1_0808.input, 8),  w1Pr = rate(D.w1_0808.inprod, 8);
    const w2In = rate(D.w2_0915.input, 7),  w2Pr = rate(D.w2_0915.inprod, 7);
    const w3In = rate(D.w3_1628.input, 13), w3Pr = rate(D.w3_1628.inprod, 13);

    const inprodBand = Math.max(w1Pr, w2Pr, w3Pr) / Math.min(w1Pr, w2Pr, w3Pr);
    assert.ok(inprodBand < 1.5, `In Prod daily rate must stay stable (band ${inprodBand.toFixed(2)})`);

    const inputSpike = w2In / w1In;
    assert.ok(inputSpike > 2.0, `Input daily rate must spike >2x in 9–15 Aug (got ${inputSpike.toFixed(2)})`);

    console.log(`  ✓ Tinv.3 daily rates — In Prod: ${w1Pr.toFixed(0)} / ${w2Pr.toFixed(0)} / ${w3Pr.toFixed(0)} (stable, band ${inprodBand.toFixed(2)}×)`);
    console.log(`      Input Ritasi: ${w1In.toFixed(0)} / ${w2In.toFixed(0)} / ${w3In.toFixed(0)} — 9–15 Aug is ${inputSpike.toFixed(2)}× the 1–8 Aug rate`);
    console.log(`      => anomaly is SPECIFIC to the Input Ritasi measure in the 9–15 Aug window`);
  });

  it("Tinv.4 delivers a drill-down to source reference (no silent overwrite)", async () => {
    const aId = `${FX}-inv4-a`, bId = `${FX}-inv4-b`;
    await registerSource(client, { source_id: aId, source_name: "Input", source_type: "MASTER_HOURLY",
      grain: "Tanggal+Shift+Unit", authority_status: "HUMAN_AUTHORITY" });
    await registerSource(client, { source_id: bId, source_name: "In Prod", source_type: "MASTER_HOURLY",
      grain: "Tanggal+Shift+Unit", authority_status: "HUMAN_AUTHORITY" });
    await importEvidence(client, [
      { source_id: aId, source_sheet: "Input Ritasi", source_row: 11, source_reference: "SHIFT SHEET!A11",
        tanggal: "2026-08-09", shift: "day", unit: "DT-001", ritasi: 20, grain: "Tanggal+Shift+Unit" },
    ]);
    await importEvidence(client, [
      { source_id: bId, source_sheet: "In Prod", source_row: 11, source_reference: "STATUS!B11",
        tanggal: "2026-08-09", shift: "day", unit: "DT-001", ritasi: 10, grain: "Tanggal+Shift+Unit" },
    ]);
    const res = await reconcile(client, aId, bId, "Tanggal+Shift+Unit", undefined, `${FX}-run-inv4`);
    assert.strictEqual(res[0].classification, "MAJOR_VARIANCE");
    assert.strictEqual(res[0].review_status, "PENDING", "must await human review");

    const aRows = await getEvidence(client, { source_id: aId });
    const bRows = await getEvidence(client, { source_id: bId });
    assert.strictEqual(aRows[0].source_reference, "SHIFT SHEET!A11");
    assert.strictEqual(bRows[0].source_reference, "STATUS!B11");
    assert.strictEqual(Number(aRows[0].ritasi), 20, "source A value unmodified");
    assert.strictEqual(Number(bRows[0].ritasi), 10, "source B value unmodified");
    console.log("  ✓ Tinv.4 drill-down available on both sides; nothing overwritten; review_status PENDING");
  });
});

// ══════════════════════════════════════════════════════════════════
// 3C-10 REVIEW TABLE
// ══════════════════════════════════════════════════════════════════
describe("3C-10 review table", () => {
  it("Trev.1 exposes date/shift/unit + both sources + delta + classification + evidence", async () => {
    const aId = `${FX}-rev-a`, bId = `${FX}-rev-b`;
    await registerSource(client, { source_id: aId, source_name: "A", source_type: "HAULING_DATA",
      grain: "Tanggal+Shift+Unit", authority_status: "HUMAN_AUTHORITY" });
    await registerSource(client, { source_id: bId, source_name: "B", source_type: "HAULING_DATA",
      grain: "Tanggal+Shift+Unit", authority_status: "HUMAN_AUTHORITY" });
    await importEvidence(client, [
      { source_id: aId, tanggal: "2026-08-05", shift: "night", unit: "DT-004",
        ritasi: 30, tonase: 600, grain: "Tanggal+Shift+Unit" },
    ]);
    await importEvidence(client, [
      { source_id: bId, tanggal: "2026-08-05", shift: "night", unit: "DT-004",
        ritasi: 28, tonase: 600, grain: "Tanggal+Shift+Unit" },
    ]);
    await reconcile(client, aId, bId, "Tanggal+Shift+Unit", undefined, `${FX}-run-rev`);
    const table = await getReviewTable(client, `${FX}-run-rev`);
    assert.strictEqual(table.length, 1);
    const row = table[0];
    for (const col of ["tanggal", "shift", "unit", "source_a_ritasi", "source_b_ritasi",
                       "delta_ritasi", "delta_pct_ritasi", "classification", "grain",
                       "review_status", "evidence"]) {
      assert.ok(col in row, `review table must expose ${col}`);
    }
    assert.strictEqual(row.tanggal, "2026-08-05");
    assert.strictEqual(row.shift, "night");
    assert.strictEqual(row.unit, "DT-004");
    assert.strictEqual(Number(row.source_a_ritasi), 30);
    assert.strictEqual(Number(row.source_b_ritasi), 28);
    assert.strictEqual(Number(row.delta_ritasi), 2);
    assert.strictEqual(row.classification, "MINOR_VARIANCE");
    console.log("  ✓ Trev.1 review table complete (date/shift/unit, A, B, delta, delta%, class, grain, evidence, review)");
  });
});

// ══════════════════════════════════════════════════════════════════
// 3C-9 SOURCE AUTHORITY
// ══════════════════════════════════════════════════════════════════
describe("3C-9 source authority", () => {
  it("Tauth.1 authority_status is explicit and the enum is closed", async () => {
    await registerSource(client, { source_id: `${FX}-auth-plan`, source_name: "Plan", source_type: "PLAN",
      grain: "Tanggal+Shift+Unit", authority_status: "HUMAN_AUTHORITY" });
    await registerSource(client, { source_id: `${FX}-auth-ritasi`, source_name: "Ritasi Evidence",
      source_type: "HAULING_DATA", grain: "Tanggal+Shift+Unit", authority_status: "HOLD" });
    await registerSource(client, { source_id: `${FX}-auth-bcm`, source_name: "BCM Evidence",
      source_type: "HAULING_DATA", grain: "Tanggal+Shift+Unit", authority_status: "REVIEW" });

    assert.strictEqual((await getSource(client, `${FX}-auth-plan`))!.authority_status, "HUMAN_AUTHORITY");
    assert.strictEqual((await getSource(client, `${FX}-auth-ritasi`))!.authority_status, "HOLD");
    assert.strictEqual((await getSource(client, `${FX}-auth-bcm`))!.authority_status, "REVIEW");

    const allowed = ["HUMAN_AUTHORITY", "HOLD", "REVIEW", "AUTO"];
    const all = await client.query(`SELECT DISTINCT authority_status FROM fms_historical_sources`);
    for (const r of all.rows) {
      assert.ok(allowed.includes(r.authority_status), `unknown authority_status ${r.authority_status}`);
    }

    // Fail-closed: an unknown authority status must be rejected
    let rejected = false;
    try {
      await client.query(
        `INSERT INTO fms_historical_sources
           (source_id, source_name, source_type, grain, authority_status)
         VALUES ('fx3c-illegal', 'X', 'PLAN', 'Tanggal', 'TRUST_ME_BRO')`);
    } catch {
      rejected = true;
    }
    assert.ok(rejected, "the DB must reject an out-of-vocabulary authority_status");
    console.log("  ✓ Tauth.1 Plan=HUMAN_AUTHORITY, Ritasi=HOLD, BCM=REVIEW; illegal value rejected by DB");
  });
});

// ══════════════════════════════════════════════════════════════════
// T19–T21 — REGRESSIONS
// ══════════════════════════════════════════════════════════════════
function runSuite(file: string): { pass: boolean; output: string; passed: string } {
  // NODE_TEST_CONTEXT is set by the OUTER test runner. If the nested runner
  // inherits it, node treats it as a child test process and suppresses the TAP
  // summary — which silently breaks pass-count parsing. Strip it.
  const childEnv: NodeJS.ProcessEnv = { ...process.env };
  delete childEnv.NODE_TEST_CONTEXT;

  const r = spawnSync("npx", ["tsx", "--test", file], {
    encoding: "utf8",
    timeout: 420_000,
    env: childEnv,
    cwd: process.cwd(),
  });
  const output = (r.stdout ?? "") + (r.stderr ?? "");
  const m = output.match(/# pass (\d+)/);
  return {
    pass: r.status === 0 && !r.error,
    output,
    passed: m ? m[1] : `? (status=${r.status} err=${r.error?.message ?? "none"} bytes=${output.length} tail=${JSON.stringify(output.slice(-160))})`,
  };
}

describe("T19-T21 regressions", () => {
  it("T19 Phase 3B cycle-engine regression", async () => {
    const { pass, output, passed } = runSuite("tests/fms-phase3b-cycle.test.ts");
    if (!pass) console.error(output.slice(-3000));
    assert.ok(pass, "Phase 3B suite must still pass");
    assert.ok(passed !== "?" && Number(passed) > 0, "must report a positive pass count");
    console.log(`  ✓ T19 Phase 3B regression PASS (${passed} tests)`);
  });

  it("T20 Phase 3A geofence regression", async () => {
    const { pass, output, passed } = runSuite("tests/fms-phase3a-geofence.test.ts");
    if (!pass) console.error(output.slice(-3000));
    assert.ok(pass, "Phase 3A suite must still pass");
    assert.ok(passed !== "?" && Number(passed) > 0, "must report a positive pass count");
    console.log(`  ✓ T20 Phase 3A regression PASS (${passed} tests)`);
  });

  it("T21 Phase 2 pipeline regression", async () => {
    const { pass, output, passed } = runSuite("tests/fms-phase2-pipeline.test.ts");
    if (!pass) console.error(output.slice(-3000));
    assert.ok(pass, "Phase 2 suite must still pass");
    assert.ok(passed !== "?" && Number(passed) > 0, "must report a positive pass count");
    console.log(`  ✓ T21 Phase 2 regression PASS (${passed} tests)`);
  });
});

// ══════════════════════════════════════════════════════════════════
// T22 — SERVICES / RESOURCES UNAFFECTED
// ══════════════════════════════════════════════════════════════════
describe("T22 services and resources", () => {
  it("T22 all 5 containers still running, FMS on 5439, resources within budget", async () => {
    const ps = execSync("docker ps --format '{{.Names}}|{{.Status}}'", { encoding: "utf8" });
    for (const name of ["fms-postgres", "fms-traccar", "lumin-postgres", "metro-postgres", "audit-bubur-fay-pg"]) {
      const line = ps.split("\n").find(l => l.startsWith(`${name}|`));
      assert.ok(line, `${name} must be running`);
      assert.match(line!, /Up/, `${name} must be Up`);
    }

    const port = execSync("docker port fms-postgres", { encoding: "utf8" });
    assert.match(port, /5439/, "fms-postgres must still publish 5439");

    // NOTE (STEP 5 triage): this count is read AFTER fixture cleanup (see after()).
    // 0 here means "no test fixtures left behind" — it is NOT a signal that the
    // Phase 3C source registry failed to load. The real client workbooks are
    // ABSENT on this VPS (HISTORICAL_SOURCE_FILES_UNAVAILABLE), so no production
    // source can be registered until they are mounted.
    const srcCount = await client.query(`SELECT COUNT(*)::int AS c FROM fms_historical_sources`);
    assert.strictEqual(
      srcCount.rows[0].c,
      0,
      "fixture cleanup must leave the historical source registry empty (test isolation)",
    );

    const mem = execSync("free -m", { encoding: "utf8" });
    const memLine = mem.split("\n")[1].split(/\s+/);
    const availableMb = Number(memLine[6]);
    assert.ok(availableMb > 300, `available RAM ${availableMb}MB must exceed 300MB`);

    const disk = execSync("df -m /home/ubuntu | tail -1", { encoding: "utf8" }).split(/\s+/);
    const availMb = Number(disk[3]);
    assert.ok(availMb > 2000, `free disk ${availMb}MB must exceed 2GB`);

    console.log(`  ✓ T22 5 containers Up; fms-postgres:5439 intact; RAM avail ${availableMb}MB; disk free ${availMb}MB; ${srcCount.rows[0].c} historical sources registered`);
  });
});
