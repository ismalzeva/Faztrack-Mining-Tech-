/**
 * FMS Phase 3C: Historical Replay & Ritasi Parity Engine
 *
 * ARCHITECTURE RULE: This module is ISOLATED from cycle-engine.ts.
 * Historical Excel is VALIDATION EVIDENCE, not telemetry truth.
 * No workbook-specific business logic. No auto-correction.
 * Missing value = NULL, NEVER zero.
 * CYCLE CANDIDATE ≠ RITASI ≠ VERIFIED RITASI ≠ PRODUCTION.
 */

import { Client } from "pg";
import { randomUUID } from "crypto";

// ─── TYPES ─────────────────────────────────────────────────────────

export type AuthorityStatus = "HUMAN_AUTHORITY" | "HOLD" | "REVIEW" | "AUTO";
export type ValidationStatus = "RAW" | "VALIDATED" | "RECONCILED" | "DISPUTED";

export type ParityClassification =
  | "MATCH"
  | "MINOR_VARIANCE"
  | "MAJOR_VARIANCE"
  | "MISSING_SOURCE_A"
  | "MISSING_SOURCE_B"
  | "DUPLICATE_PATTERN"
  | "GRAIN_MISMATCH"
  | "REVIEW_REQUIRED"
  /**
   * Neither source carries a value for this measure (e.g. a workbook with no
   * Tonase column at all). This is NOT a match, NOT a variance and NOT a grain
   * mismatch — it is simply not comparable. It must never win a worst-of vote.
   */
  | "NOT_COMPARABLE";

export interface HistoricalSource {
  source_id: string;
  source_name: string;
  source_type: string;
  source_sheet?: string;
  source_file?: string;
  period_start?: string;
  period_end?: string;
  grain: string;
  row_count?: number;
  known_totals?: { ritasi?: number; tonase?: number; bcm?: number };
  known_parities?: Record<string, { matched: number; total: number }>;
  known_discrepancies?: Record<string, unknown>;
  authority_status: AuthorityStatus;
}

export interface HistoricalEvidenceRow {
  source_id: string;
  source_sheet?: string;
  source_row?: number;
  source_reference?: string;
  tanggal: string;
  shift?: string;
  unit?: string;
  ritasi?: number | null;
  tonase?: number | null;
  bcm?: number | null;
  loading_point?: string;
  dumping_point?: string;
  material?: string;
  loader?: string;
  hm?: number;
  status_unit?: string;
  grain: string;
  authority_status?: AuthorityStatus;
  notes?: string;
}

export interface ReconciliationConfig {
  match_threshold_pct: number;
  minor_variance_threshold_pct: number;
  major_variance_threshold_pct: number;
  match_threshold_abs: number;
  minor_variance_threshold_abs: number;
}

export interface ReconciliationResult {
  reconciliation_id: string;
  tanggal: string;
  shift?: string;
  unit?: string;
  source_a_ritasi?: number | null;
  source_a_tonase?: number | null;
  source_a_bcm?: number | null;
  source_b_ritasi?: number | null;
  source_b_tonase?: number | null;
  source_b_bcm?: number | null;
  delta_ritasi?: number;
  delta_tonase?: number;
  delta_bcm?: number;
  delta_pct_ritasi?: number;
  delta_pct_tonase?: number;
  classification: ParityClassification;
  grain: string;
  evidence: Record<string, unknown>;
  review_status: string;
}

const DEFAULT_CONFIG: ReconciliationConfig = {
  match_threshold_pct: 0.0,
  minor_variance_threshold_pct: 5.0,
  major_variance_threshold_pct: 20.0,
  match_threshold_abs: 0.0,
  minor_variance_threshold_abs: 5.0,
};

// ─── SOURCE REGISTRY ───────────────────────────────────────────────

export async function registerSource(
  client: Client,
  source: HistoricalSource
): Promise<string> {
  const id = source.source_id || `src-${randomUUID().slice(0, 8)}`;
  await client.query(
    `INSERT INTO fms_historical_sources
       (source_id, source_name, source_type, source_sheet, source_file,
        period_start, period_end, grain, row_count, known_totals,
        known_parities, known_discrepancies, authority_status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     ON CONFLICT (source_id) DO UPDATE SET
       source_name=EXCLUDED.source_name, row_count=EXCLUDED.row_count,
       known_totals=EXCLUDED.known_totals, known_parities=EXCLUDED.known_parities`,
    [
      id, source.source_name, source.source_type,
      source.source_sheet ?? null, source.source_file ?? null,
      source.period_start ?? null, source.period_end ?? null,
      source.grain, source.row_count ?? null,
      source.known_totals ? JSON.stringify(source.known_totals) : null,
      source.known_parities ? JSON.stringify(source.known_parities) : null,
      source.known_discrepancies ? JSON.stringify(source.known_discrepancies) : null,
      source.authority_status,
    ]
  );
  return id;
}

export async function getSource(
  client: Client,
  sourceId: string
): Promise<HistoricalSource | null> {
  const res = await client.query(
    `SELECT * FROM fms_historical_sources WHERE source_id = $1`, [sourceId]
  );
  return res.rows[0] ?? null;
}

// ─── EVIDENCE IMPORT ───────────────────────────────────────────────

/**
 * Import evidence rows. Each row becomes one fms_historical_evidence record.
 * Grain keys (tanggal, shift, unit) determine aggregation level.
 * Missing values stay NULL — never coerced to zero.
 */
export async function importEvidence(
  client: Client,
  rows: HistoricalEvidenceRow[]
): Promise<{ imported: number; evidence_ids: string[] }> {
  const ids: string[] = [];
  for (const row of rows) {
    const eid = `ev-${randomUUID().slice(0, 12)}`;
    ids.push(eid);
    await client.query(
      `INSERT INTO fms_historical_evidence
         (evidence_id, source_id, source_sheet, source_row, source_reference,
          tanggal, shift, unit, ritasi, tonase, bcm,
          loading_point, dumping_point, material, loader, hm, status_unit,
          grain, authority_status, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
      [
        eid, row.source_id, row.source_sheet ?? null, row.source_row ?? null,
        row.source_reference ?? null,
        row.tanggal, row.shift ?? null, row.unit ?? null,
        row.ritasi ?? null, row.tonase ?? null, row.bcm ?? null,
        row.loading_point ?? null, row.dumping_point ?? null,
        row.material ?? null, row.loader ?? null, row.hm ?? null,
        row.status_unit ?? null,
        row.grain, row.authority_status ?? "HUMAN_AUTHORITY", row.notes ?? null,
      ]
    );
  }
  return { imported: rows.length, evidence_ids: ids };
}

// ─── EVIDENCE QUERY ────────────────────────────────────────────────

export async function getEvidence(
  client: Client,
  filters: { source_id?: string; tanggal?: string; shift?: string; unit?: string }
): Promise<Record<string, unknown>[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  let idx = 1;
  if (filters.source_id) { conditions.push(`source_id = $${idx++}`); params.push(filters.source_id); }
  if (filters.tanggal) { conditions.push(`tanggal = $${idx++}`); params.push(filters.tanggal); }
  if (filters.shift !== undefined) {
    if (filters.shift === null) { conditions.push(`shift IS NULL`); }
    else { conditions.push(`shift = $${idx++}`); params.push(filters.shift); }
  }
  if (filters.unit !== undefined) {
    if (filters.unit === null) { conditions.push(`unit IS NULL`); }
    else { conditions.push(`unit = $${idx++}`); params.push(filters.unit); }
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const res = await client.query(`SELECT * FROM fms_historical_evidence ${where} ORDER BY tanggal, shift, unit`, params);
  return res.rows;
}

// ─── AGGREGATION ───────────────────────────────────────────────────

/**
 * Aggregate evidence at a given grain.
 * grain levels: 'Tanggal', 'Tanggal+Shift', 'Tanggal+Shift+Unit'
 * NULL values in group-by columns = aggregated away.
 */
export async function aggregateEvidence(
  client: Client,
  sourceId: string,
  grain: "Tanggal" | "Tanggal+Shift" | "Tanggal+Shift+Unit",
  filters?: { tanggal_from?: string; tanggal_to?: string }
): Promise<Record<string, unknown>[]> {
  const groupCols: string[] = ["tanggal"];
  if (grain === "Tanggal+Shift" || grain === "Tanggal+Shift+Unit") groupCols.push("shift");
  if (grain === "Tanggal+Shift+Unit") groupCols.push("unit");

  const conditions = [`source_id = $1`];
  // Only require the finer-grain columns when that grain is actually being built.
  // Aggregating to 'Tanggal' must still count ALL rows.
  if (grain === "Tanggal+Shift" || grain === "Tanggal+Shift+Unit") {
    conditions.push(`shift IS NOT NULL`);
  }
  if (grain === "Tanggal+Shift+Unit") {
    conditions.push(`unit IS NOT NULL`);
  }
  const params: unknown[] = [sourceId];
  let idx = 2;
  if (filters?.tanggal_from) { conditions.push(`tanggal >= $${idx++}`); params.push(filters.tanggal_from); }
  if (filters?.tanggal_to) { conditions.push(`tanggal <= $${idx++}`); params.push(filters.tanggal_to); }

  const sql = `
    SELECT ${groupCols.map(c => `"${c}"`).join(", ")},
           COUNT(*) as row_count,
           SUM(ritasi) as total_ritasi,
           SUM(tonase) as total_tonase,
           SUM(bcm) as total_bcm
    FROM fms_historical_evidence
    WHERE ${conditions.join(" AND ")}
    GROUP BY ${groupCols.map(c => `"${c}"`).join(", ")}
    ORDER BY ${groupCols.map(c => `"${c}"`).join(", ")}
  `;
  const res = await client.query(sql, params);
  return res.rows;
}

// ─── PARITY CLASSIFICATION ─────────────────────────────────────────

export function classifyParity(
  valA: number | null | undefined,
  valB: number | null | undefined,
  config: ReconciliationConfig = DEFAULT_CONFIG
): { classification: ParityClassification; delta?: number; delta_pct?: number } {
  // Missing value detection.
  // Both sides absent => NOT_COMPARABLE (a measure that simply does not exist in
  // either source). This must NOT be reported as a grain mismatch or a match.
  if (valA == null && valB == null) return { classification: "NOT_COMPARABLE" };
  if (valA == null) return { classification: "MISSING_SOURCE_A" };
  if (valB == null) return { classification: "MISSING_SOURCE_B" };

  const delta = valA - valB;
  const avg = (Math.abs(valA) + Math.abs(valB)) / 2;
  const delta_pct = avg === 0 ? 0 : (Math.abs(delta) / avg) * 100;

  // Match check (exact or within absolute threshold)
  if (Math.abs(delta) <= config.match_threshold_abs && delta_pct <= config.match_threshold_pct) {
    return { classification: "MATCH", delta, delta_pct };
  }

  // Minor variance
  if (delta_pct <= config.minor_variance_threshold_pct || Math.abs(delta) <= config.minor_variance_threshold_abs) {
    return { classification: "MINOR_VARIANCE", delta, delta_pct };
  }

  // Major variance
  return { classification: "MAJOR_VARIANCE", delta, delta_pct };
}

// ─── PERIOD SUMMARY ────────────────────────────────────────────────

/**
 * Summarize reconciliation results over a period.
 * Returns source totals, delta, delta%, and the overall classification.
 * The overall classification is the WORST class observed (never an average).
 * NO correction is applied — totals are reported as-is.
 */
export function summarizeReconciliation(results: ReconciliationResult[]): {
  groups: number;
  source_a_total_ritasi: number;
  source_b_total_ritasi: number;
  delta_ritasi: number;
  delta_pct_ritasi: number;
  source_a_total_tonase: number;
  source_b_total_tonase: number;
  delta_tonase: number;
  classification: ParityClassification;
  counts_by_classification: Record<string, number>;
} {
  let sumA = 0, sumB = 0, sumATon = 0, sumBTon = 0;
  // Pre-seed every class so callers can safely read any key (no undefined).
  const counts: Record<string, number> = {
    MATCH: 0, MINOR_VARIANCE: 0, MAJOR_VARIANCE: 0,
    MISSING_SOURCE_A: 0, MISSING_SOURCE_B: 0,
    DUPLICATE_PATTERN: 0, GRAIN_MISMATCH: 0, REVIEW_REQUIRED: 0,
    NOT_COMPARABLE: 0,
  };
  // Start unset so an all-NOT_COMPARABLE result set does not masquerade as MATCH.
  let worst: ParityClassification | null = null;
  const severity: Record<ParityClassification, number> = {
    MATCH: 0, MINOR_VARIANCE: 1, MAJOR_VARIANCE: 2,
    MISSING_SOURCE_A: 3, MISSING_SOURCE_B: 3,
    DUPLICATE_PATTERN: 4, GRAIN_MISMATCH: 5, REVIEW_REQUIRED: 6,
    // -1 => can never win the worst-of vote
    NOT_COMPARABLE: -1,
  };

  for (const r of results) {
    sumA += r.source_a_ritasi ?? 0;
    sumB += r.source_b_ritasi ?? 0;
    sumATon += r.source_a_tonase ?? 0;
    sumBTon += r.source_b_tonase ?? 0;
    counts[r.classification] = (counts[r.classification] ?? 0) + 1;
    if (worst === null || severity[r.classification] > severity[worst]) worst = r.classification;
  }

  const delta = sumA - sumB;
  const avg = (Math.abs(sumA) + Math.abs(sumB)) / 2;
  const deltaPct = avg === 0 ? 0 : (Math.abs(delta) / avg) * 100;

  return {
    groups: results.length,
    source_a_total_ritasi: sumA,
    source_b_total_ritasi: sumB,
    delta_ritasi: delta,
    delta_pct_ritasi: deltaPct,
    source_a_total_tonase: sumATon,
    source_b_total_tonase: sumBTon,
    delta_tonase: sumATon - sumBTon,
    classification: worst ?? "NOT_COMPARABLE",
    counts_by_classification: counts,
  };
}

// ─── DUPLICATE PATTERN DETECTION ───────────────────────────────────

/**
 * Detect duplicate rows within a source.
 * A duplicate = same grain key (tanggal+shift+unit) AND identical payload.
 * Returns groups with duplicate counts. Does NOT delete or correct anything.
 */
export async function detectDuplicateRows(
  client: Client,
  sourceId: string
): Promise<Array<{
  tanggal: string; shift: string | null; unit: string | null;
  total_rows: number; distinct_payloads: number; duplicate_rows: number;
  sample_ritasi: number | null;
}>> {
  const res = await client.query(
    `SELECT tanggal, shift, unit,
            COUNT(*)::int AS total_rows,
            COUNT(DISTINCT (COALESCE(ritasi::text,'~'), COALESCE(tonase::text,'~'), COALESCE(bcm::text,'~'), COALESCE(loading_point,'~'), COALESCE(dumping_point,'~')))::int AS distinct_payloads,
            SUM(ritasi) AS sample_ritasi
     FROM fms_historical_evidence
     WHERE source_id = $1
     GROUP BY tanggal, shift, unit
     HAVING COUNT(*) > 1
     ORDER BY COUNT(*) DESC, tanggal, shift, unit`,
    [sourceId]
  );
  return res.rows.map(r => ({
    ...r,
    duplicate_rows: r.total_rows - r.distinct_payloads,
  }));
}

/**
 * Detect whether two sources are declared at different grains.
 * Comparing totals across different grains is a GRAIN_MISMATCH, not a variance.
 */
export async function detectGrainMismatch(
  client: Client,
  sourceAId: string,
  sourceBId: string
): Promise<{ mismatch: boolean; grain_a: string | null; grain_b: string | null; note: string }> {
  const a = await getSource(client, sourceAId);
  const b = await getSource(client, sourceBId);
  const ga = a?.grain ?? null;
  const gb = b?.grain ?? null;
  const mismatch = ga != null && gb != null && ga !== gb;
  return {
    mismatch,
    grain_a: ga,
    grain_b: gb,
    note: mismatch
      ? `GRAIN_MISMATCH: Source A grain='${ga}' vs Source B grain='${gb}'. Totals are NOT directly comparable.`
      : `Grains align: both '${ga}'.`,
  };
}

// ─── RECONCILIATION ────────────────────────────────────────────────

/**
 * Reconcile two sources at a given grain.
 * Produces one ReconciliationResult per grain group present in either source.
 */
export async function reconcile(
  client: Client,
  sourceAId: string,
  sourceBId: string,
  grain: "Tanggal" | "Tanggal+Shift" | "Tanggal+Shift+Unit",
  config: ReconciliationConfig = DEFAULT_CONFIG,
  runId?: string
): Promise<ReconciliationResult[]> {
  const aggA = await aggregateEvidence(client, sourceAId, grain);
  const aggB = await aggregateEvidence(client, sourceBId, grain);

  // Duplicate detection (per grain key) — for classification, never for correction
  const dupA = await detectDuplicateRows(client, sourceAId);
  const dupB = await detectDuplicateRows(client, sourceBId);
  const dupKey = (r: { tanggal: string; shift: string | null; unit: string | null }) => {
    const parts: string[] = [r.tanggal];
    if (grain === "Tanggal+Shift" || grain === "Tanggal+Shift+Unit") parts.push(r.shift ?? "");
    if (grain === "Tanggal+Shift+Unit") parts.push(r.unit ?? "");
    return parts.join("|");
  };
  const dupMapA = new Map(dupA.filter(d => d.duplicate_rows > 0).map(d => [dupKey(d), d]));
  const dupMapB = new Map(dupB.filter(d => d.duplicate_rows > 0).map(d => [dupKey(d), d]));

  // Index by grain key
  const grainKey = (row: Record<string, unknown>) => {
    const parts: string[] = [row.tanggal as string];
    if (grain === "Tanggal+Shift" || grain === "Tanggal+Shift+Unit") parts.push(row.shift as string);
    if (grain === "Tanggal+Shift+Unit") parts.push(row.unit as string);
    return parts.join("|");
  };

  const mapA = new Map(aggA.map(r => [grainKey(r), r]));
  const mapB = new Map(aggB.map(r => [grainKey(r), r]));

  const allKeys = new Set([...Array.from(mapA.keys()), ...Array.from(mapB.keys())]);
  const results: ReconciliationResult[] = [];
  const rid = runId || `recon-${randomUUID().slice(0, 8)}`;

  for (const key of Array.from(allKeys)) {
    const a = mapA.get(key);
    const b = mapB.get(key);
    const parts = key.split("|");

    const tanggal = parts[0];
    const shift = parts[1] ?? null;
    const unit = parts[2] ?? null;

    const a_ritasi = a ? (a.total_ritasi as number) : null;
    const b_ritasi = b ? (b.total_ritasi as number) : null;
    const a_tonase = a ? (a.total_tonase as number) : null;
    const b_tonase = b ? (b.total_tonase as number) : null;
    const a_bcm = a ? (a.total_bcm as number) : null;
    const b_bcm = b ? (b.total_bcm as number) : null;

    const rit = classifyParity(a_ritasi, b_ritasi, config);
    const ton = classifyParity(a_tonase, b_tonase, config);

    // Overall classification = worst of ritasi and tonase
    const severity: Record<ParityClassification, number> = {
      MATCH: 0, MINOR_VARIANCE: 1, MAJOR_VARIANCE: 2,
      MISSING_SOURCE_A: 3, MISSING_SOURCE_B: 3,
      DUPLICATE_PATTERN: 4, GRAIN_MISMATCH: 5, REVIEW_REQUIRED: 6,
      // Neither side carries this measure => never allowed to win the vote.
      NOT_COMPARABLE: -1,
    };
    let classification: ParityClassification =
      (severity[rit.classification] ?? -1) >= (severity[ton.classification] ?? -1)
        ? rit.classification : ton.classification;

    // Duplicate pattern overrides variance classes (evidence of structural issue)
    const dupHitA = dupMapA.get(key);
    const dupHitB = dupMapB.get(key);
    if ((dupHitA || dupHitB) && severity[classification] < severity.DUPLICATE_PATTERN) {
      classification = "DUPLICATE_PATTERN";
    }

    const dupEvidence = {
      source_a_duplicate_rows: dupHitA ? dupHitA.duplicate_rows : 0,
      source_a_total_rows: dupHitA ? dupHitA.total_rows : (a ? (a.row_count as number) : 0),
      source_b_duplicate_rows: dupHitB ? dupHitB.duplicate_rows : 0,
      source_b_total_rows: dupHitB ? dupHitB.total_rows : (b ? (b.row_count as number) : 0),
    };

    const reconId = `rc-${randomUUID().slice(0, 12)}`;
    const result: ReconciliationResult = {
      reconciliation_id: reconId,
      tanggal,
      shift: shift ?? undefined,
      unit: unit ?? undefined,
      source_a_ritasi: a_ritasi,
      source_a_tonase: a_tonase,
      source_a_bcm: a_bcm,
      source_b_ritasi: b_ritasi,
      source_b_tonase: b_tonase,
      source_b_bcm: b_bcm,
      delta_ritasi: rit.delta,
      delta_tonase: ton.delta,
      delta_pct_ritasi: rit.delta_pct,
      delta_pct_tonase: ton.delta_pct,
      classification,
      grain,
      evidence: {
        source_a_rows: a ? (a.row_count as number) : 0,
        source_b_rows: b ? (b.row_count as number) : 0,
        ...dupEvidence,
      },
      review_status: "PENDING",
    };
    results.push(result);

    // Persist
    await client.query(
      `INSERT INTO fms_reconciliation_results
         (reconciliation_id, run_id, tanggal, shift, unit,
          source_a_id, source_a_ritasi, source_a_tonase, source_a_bcm,
          source_b_id, source_b_ritasi, source_b_tonase, source_b_bcm,
          delta_ritasi, delta_tonase, delta_bcm,
          delta_pct_ritasi, delta_pct_tonase,
          classification, grain, evidence, review_status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)`,
      [
        reconId, rid, tanggal, shift, unit,
        sourceAId, a_ritasi, a_tonase, a_bcm,
        sourceBId, b_ritasi, b_tonase, b_bcm,
        rit.delta ?? null, ton.delta ?? null, null,
        rit.delta_pct ?? null, ton.delta_pct ?? null,
        classification, grain, JSON.stringify(result.evidence), "PENDING",
      ]
    );
  }

  return results;
}

// ─── 9–15 AUGUST INVESTIGATION ─────────────────────────────────────

export interface AugustInvestigation {
  period: string;
  source_a_name: string;
  source_b_name: string;
  source_a_total_ritasi: number;
  source_b_total_ritasi: number;
  delta: number;
  delta_pct: number;
  unit_shift_analysis: Array<{
    tanggal: string;
    shift: string;
    unit: string;
    source_a_ritasi: number | null;
    source_b_ritasi: number | null;
    delta: number | null;
    has_both: boolean;
  }>;
  duplicate_analysis: {
    total_rows_a: number;
    total_rows_b: number;
    distinct_tanggal_shift_unit_a: number;
    distinct_tanggal_shift_unit_b: number;
    groups_only_in_a: number;
    groups_only_in_b: number;
    groups_in_both: number;
  };
  findings: string[];
}

/**
 * Systematic investigation of the 9–15 August discrepancy.
 * Known: Source A Input Ritasi ≈ 19,654 vs Source B In Prod ≈ 9,850.
 * Known: 311/311 Tanggal+Shift+Unit groups exist in BOTH sources.
 * Task: determine why Input Ritasi ≈ 2× In Prod WITHOUT assuming "divide by 2".
 */
export async function investigate9to15August(
  client: Client,
  sourceAId: string,
  sourceBId: string
): Promise<AugustInvestigation> {
  const period = "2026-08-09 to 2026-08-15";

  // Get all evidence from both sources in the period
  const evA = await client.query(
    `SELECT * FROM fms_historical_evidence WHERE source_id = $1 AND tanggal >= '2026-08-09' AND tanggal <= '2026-08-15' ORDER BY tanggal, shift, unit, source_row`,
    [sourceAId]
  );
  const evB = await client.query(
    `SELECT * FROM fms_historical_evidence WHERE source_id = $1 AND tanggal >= '2026-08-09' AND tanggal <= '2026-08-15' ORDER BY tanggal, shift, unit, source_row`,
    [sourceBId]
  );

  const rowsA = evA.rows;
  const rowsB = evB.rows;

  // Totals
  const totalA = rowsA.reduce((s, r) => s + (r.ritasi ?? 0), 0);
  const totalB = rowsB.reduce((s, r) => s + (r.ritasi ?? 0), 0);

  // Group by Tanggal+Shift+Unit
  const groupKey = (r: Record<string, unknown>) => `${r.tanggal}|${r.shift}|${r.unit}`;
  const groupsA = new Map<string, { count: number; total_ritasi: number; rows: Record<string, unknown>[] }>();
  const groupsB = new Map<string, { count: number; total_ritasi: number; rows: Record<string, unknown>[] }>();

  for (const r of rowsA) {
    const k = groupKey(r);
    const g = groupsA.get(k) || { count: 0, total_ritasi: 0, rows: [] };
    g.count++;
    g.total_ritasi += (r.ritasi ?? 0);
    g.rows.push(r);
    groupsA.set(k, g);
  }
  for (const r of rowsB) {
    const k = groupKey(r);
    const g = groupsB.get(k) || { count: 0, total_ritasi: 0, rows: [] };
    g.count++;
    g.total_ritasi += (r.ritasi ?? 0);
    g.rows.push(r);
    groupsB.set(k, g);
  }

  const keysA = new Set(Array.from(groupsA.keys()));
  const keysB = new Set(Array.from(groupsB.keys()));
  const allKeys = new Set([...Array.from(keysA), ...Array.from(keysB)]);

  const groupsOnlyA = Array.from(keysA).filter(k => !keysB.has(k)).length;
  const groupsOnlyB = Array.from(keysB).filter(k => !keysA.has(k)).length;
  const groupsInBoth = Array.from(keysA).filter(k => keysB.has(k)).length;

  // Per-group analysis
  const unitShiftAnalysis: AugustInvestigation["unit_shift_analysis"] = [];
  for (const k of Array.from(allKeys)) {
    const [tanggal, shift, unit] = k.split("|");
    const gA = groupsA.get(k);
    const gB = groupsB.get(k);
    const aRit = gA ? gA.total_ritasi : null;
    const bRit = gB ? gB.total_ritasi : null;
    const delta = (aRit != null && bRit != null) ? aRit - bRit : null;
    unitShiftAnalysis.push({
      tanggal, shift, unit,
      source_a_ritasi: aRit,
      source_b_ritasi: bRit,
      delta,
      has_both: gA != null && gB != null,
    });
  }

  // Findings (structural analysis)
  const findings: string[] = [];

  // Check 1: Does Source A have ~2× rows per group compared to Source B?
  const avgRowsA = rowsA.length / (keysA.size || 1);
  const avgRowsB = rowsB.length / (keysB.size || 1);
  const rowRatio = avgRowsA / (avgRowsB || 1);
  if (rowRatio > 1.5 && rowRatio < 2.5) {
    findings.push(`HYPOTHESIS_ROW_DUPLICATION: Source A averages ${avgRowsA.toFixed(1)} rows/group vs Source B ${avgRowsB.toFixed(1)} (ratio ${rowRatio.toFixed(2)}). Possible row duplication in Source A.`);
  }

  // Check 2: Within groups present in both, does A have 2× the count of B?
  let doubleCountGroups = 0;
  let totalGroupsCompared = 0;
  for (const k of Array.from(keysA)) {
    if (!keysB.has(k)) continue;
    totalGroupsCompared++;
    const gA = groupsA.get(k)!;
    const gB = groupsB.get(k)!;
    if (gA.count >= gB.count * 1.8 && gA.count <= gB.count * 2.2) {
      doubleCountGroups++;
    }
  }
  if (totalGroupsCompared > 0 && doubleCountGroups / totalGroupsCompared > 0.5) {
    findings.push(`HYPOTHESIS_DOUBLE_COUNT: ${doubleCountGroups}/${totalGroupsCompared} groups show Source A rows ≈ 2× Source B rows.`);
  }

  // Check 3: Within groups, is A's ritasi ≈ 2× B's?
  let doubleRitasiGroups = 0;
  for (const k of Array.from(keysA)) {
    if (!keysB.has(k)) continue;
    const gA = groupsA.get(k)!;
    const gB = groupsB.get(k)!;
    if (gB.total_ritasi > 0) {
      const ratio = gA.total_ritasi / gB.total_ritasi;
      if (ratio > 1.8 && ratio < 2.2) doubleRitasiGroups++;
    }
  }
  if (totalGroupsCompared > 0 && doubleRitasiGroups / totalGroupsCompared > 0.5) {
    findings.push(`HYPOTHESIS_DOUBLE_RITASI: ${doubleRitasiGroups}/${totalGroupsCompared} groups show Source A ritasi ≈ 2× Source B ritasi.`);
  }

  // Check 4: Are there duplicate tanggal+shift blocks in Source A?
  const dateShiftCountsA = new Map<string, number>();
  for (const r of rowsA) {
    const dk = `${r.tanggal}|${r.shift}`;
    dateShiftCountsA.set(dk, (dateShiftCountsA.get(dk) || 0) + 1);
  }
  const dateShiftCountsB = new Map<string, number>();
  for (const r of rowsB) {
    const dk = `${r.tanggal}|${r.shift}`;
    dateShiftCountsB.set(dk, (dateShiftCountsB.get(dk) || 0) + 1);
  }
  let repeatedBlocks = 0;
  for (const [dk, countA] of Array.from(dateShiftCountsA)) {
    const countB = dateShiftCountsB.get(dk) || 0;
    if (countA > countB * 1.5 && countB > 0) repeatedBlocks++;
  }
  if (repeatedBlocks > 0) {
    findings.push(`HYPOTHESIS_REPEATED_BLOCKS: ${repeatedBlocks} date+shift combinations have significantly more rows in Source A than Source B.`);
  }

  // Check 5: Exact group coverage
  findings.push(`COVERAGE: ${keysA.size} distinct groups in Source A, ${keysB.size} in Source B.`);
  findings.push(`OVERLAP: ${groupsInBoth} groups in BOTH, ${groupsOnlyA} only in A, ${groupsOnlyB} only in B.`);
  findings.push(`TOTAL: Source A ritasi=${totalA.toFixed(2)}, Source B ritasi=${totalB.toFixed(2)}, delta=${(totalA - totalB).toFixed(2)}.`);
  findings.push(`NOTE: 311/311 Tanggal+Shift+Unit groups known to exist in BOTH sources. If actual overlap differs, investigate source completeness.`);

  // Do NOT conclude "divide by 2" — report structural evidence only
  findings.push(`STATUS: INVESTIGATION_REQUIRED. No automatic correction applied. Structural hypotheses listed above require manual evidence review.`);

  const srcA = await getSource(client, sourceAId);
  const srcB = await getSource(client, sourceBId);

  return {
    period,
    source_a_name: srcA?.source_name ?? sourceAId,
    source_b_name: srcB?.source_name ?? sourceBId,
    source_a_total_ritasi: totalA,
    source_b_total_ritasi: totalB,
    delta: totalA - totalB,
    delta_pct: totalB === 0 ? Infinity : ((totalA - totalB) / totalB) * 100,
    unit_shift_analysis: unitShiftAnalysis.slice(0, 50), // first 50 for review
    duplicate_analysis: {
      total_rows_a: rowsA.length,
      total_rows_b: rowsB.length,
      distinct_tanggal_shift_unit_a: keysA.size,
      distinct_tanggal_shift_unit_b: keysB.size,
      groups_only_in_a: groupsOnlyA,
      groups_only_in_b: groupsOnlyB,
      groups_in_both: groupsInBoth,
    },
    findings,
  };
}

// ─── REVIEW TABLE ──────────────────────────────────────────────────

export async function getReviewTable(
  client: Client,
  runId: string
): Promise<Record<string, unknown>[]> {
  const res = await client.query(
    `SELECT reconciliation_id, tanggal, shift, unit,
            source_a_ritasi, source_b_ritasi, delta_ritasi, delta_pct_ritasi,
            source_a_tonase, source_b_tonase, delta_tonase,
            classification, grain, review_status, evidence
     FROM fms_reconciliation_results
     WHERE run_id = $1
     ORDER BY tanggal, shift, unit`,
    [runId]
  );
  return res.rows;
}

// ─── CLEANUP ───────────────────────────────────────────────────────

export async function cleanupHistoricalData(client: Client): Promise<void> {
  await client.query("DELETE FROM fms_reconciliation_results");
  await client.query("DELETE FROM fms_historical_evidence");
  await client.query("DELETE FROM fms_historical_sources");
}
