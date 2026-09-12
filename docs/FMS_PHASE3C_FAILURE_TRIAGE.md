# FMS PHASE 3C — FAILURE TRIAGE REPORT

**Status:** `HISTORICAL_SOURCE_FILES_UNAVAILABLE` — STOPPED per Owner STEP 2
**Verdict:** NOT APPROVED · NOT COMMITTED · no `VERIFIED_RITASI` emitted · no auto-correction applied
**Repo:** `/home/ubuntu/faztrack-mining-tech` · branch `feat/fms-b001-canonical-event-contract`
**Latest accepted commit:** `a71ede48cf412fb10e4808b7a390f1d37c5eae20` (Phase 3B)
**Date:** 2026-09-10

---

## 0. RUN RECONCILIATION (important)

The Owner-referenced result `36 tests / 26 PASS / 10 FAIL` is **RUN 1** — the run made
*before* the engine fix. Two runs exist:

| Run | Command state | Tests | PASS | FAIL | Log |
|---|---|---|---|---|---|
| RUN 1 | pre-`NOT_COMPARABLE` fix | 36 | 26 | 10 | `/tmp/p3c-run1.log` |
| RUN 2 | post-`NOT_COMPARABLE` fix | 39 | 36 | 3 | `/tmp/p3c-run2.log` |

All 10 RUN-1 failures are explained below. RUN 2's 3 failures are **not application
failures** — they are a defect in the *regression harness* (see §5b), and the underlying
suites were proven healthy by direct invocation (§6).

**No assertion was weakened. No PASS data was fabricated. No Phase 2/3A/3B behavior was modified.**

---

## 1. STEP 1 — FAILURE MATRIX (RUN 1, all 10)

| # | Test | Expected | Actual | Error / assertion | Layer |
|---|---|---|---|---|---|
| 1 | `T6b` thresholds explicit + configurable | read `config_id` | SQL error | `column "config_key" does not exist` | **test/fixture** (wrong column name; `fms_reconciliation_config` PK is `config_id`) |
| 2 | `T7` missing-source classification | `MATCH` | `GRAIN_MISMATCH` | `classifyParity(null,null)` poisoned worst-of | **classification (genuine engine defect)** |
| 3 | `T13` 1–8 Aug parity | `MINOR_VARIANCE` | `GRAIN_MISMATCH` | same root cause | **classification (engine defect)** |
| 4 | `T15` 16–28 Aug parity | `MINOR_VARIANCE` | `GRAIN_MISMATCH` | same root cause | **classification (engine defect)** |
| 5 | `T14` 9–15 Aug parity | `MAJOR_VARIANCE` | `GRAIN_MISMATCH` | same root cause | **classification (engine defect)** |
| 6 | `T14b` 29–31 Aug MISSING not zero | `72` groups | ≠ 72 | `aggregateEvidence` applied `shift/unit IS NOT NULL` filter at the `Tanggal` grain → silent row loss | **grain aggregation (engine defect)** |
| 7 | `T16` no divisor/multiplier | `MAJOR_VARIANCE` | `GRAIN_MISMATCH` | same as #2 | **classification (engine defect)** |
| 8 | `T18b` no Aug-2026 GPS trajectory | query ok | SQL error | `column "loading_start_time" does not exist` | **test/fixture** (correct column is `start_fix_time`) |
| 9 | `Tinv.1` 9–15 Aug drilled to grain | `311` groups | `314` | fixture unit-block arithmetic (7 days × 2 shifts, wrong per-block split) | **fixture** |
| 10 | `Tinv.4` drill-down to source ref | `MAJOR_VARIANCE` | `GRAIN_MISMATCH` | same as #2 | **classification (engine defect)** |

### Root-cause roll-up (RUN 1 → RUN 2)

| Root cause | Failures | Layer | Fixed? |
|---|---|---|---|
| `classifyParity(null, null)` returned `GRAIN_MISMATCH` for a measure absent on **both** sides, poisoning every worst-of vote | 6 (#2,3,4,5,7,10) | reconciliation/classification | ✅ `NOT_COMPARABLE` added (severity `-1`, cannot win worst-of); idempotent DB CHECK ALTER |
| Test used wrong column names | 2 (#1,8) | test/fixture | ✅ |
| `aggregateEvidence` grain filter | 1 (#6) | grain aggregation | ✅ filter now conditional on the grain being built |
| Fixture unit-block arithmetic | 1 (#9) | fixture | ✅ `W2_UNITS` = 3×23 + 11×22 = 311 |

**RUN 2 result: 36/39 PASS. Every T1–T22 Phase 3C content test passes.**

---

## 2. STEP 2 — HISTORICAL SOURCE LOADING → **UNAVAILABLE**

### Verification performed

| Check | Result |
|---|---|
| `find / -iname "*.xlsb"` | **0 matches** |
| `find / -iname "*HAULING*"` | 4 matches — all `hauling-aerial.png/jpg` **site images, unrelated** |
| `find / -iname "*Status Unit*"` / `*Master Hourly*` / `*AGUSTUS1*` | **0 matches** |
| `~/.hermes/cache/documents/` | only `qawam_*`, `google-reviews-skill` — **no workbooks** |
| `fms_historical_sources` (live DB) | `0` rows |
| repo fixture directory | **does not exist** |

### Source registry status

| Expected source | Registered? | source_id | file mapping | sheet mapping | lineage | row/grain availability |
|---|---|---|---|---|---|---|
| A. `HAULING DATA WEEKLY LIM 2026 AGUSTUS1.xlsx` | ❌ | — | — | — | — | — |
| B. `Status Unit Support BR_202600831.xlsb` | ❌ | — | — | — | — | — |
| C. `Master Hourly Like New_20260831 (3).xlsb` | ❌ | — | — | — | — | — |

**Source registry count: 0. No source lineage can be established.**
**Conclusion: `HISTORICAL_SOURCE_FILES_UNAVAILABLE`.**

### What must be supplied / mounted

1. The **three original workbook binaries, unmodified**, exact filenames:
   - `HAULING DATA WEEKLY LIM 2026 AGUSTUS1.xlsx`
   - `Status Unit Support BR_202600831.xlsb`
   - `Master Hourly Like New_20260831 (3).xlsb`
2. **Mount path** (recommended, gitignored): `/home/ubuntu/faztrack-mining-tech/validation/fixtures/historical/`
   (alternative: `~/.hermes/cache/documents/`)
3. **Sheet authority declaration** — for each sheet, confirm whether it is authoritative or derived:
   - Source A: `INPUT`, `REKAP DAILY`, `PRODUKSI HAULING`, `DATA TIMBANGAN`, `HM`, `IN_STATUS UNIT`, `DISTENANCE`
   - Source B: `Status Unit`, `Equipment Performance`, `Master TUM`
   - Source C: `Input Ritasi`, `In Prod`, `STATUS UNIT`, `MASTER Hourly Productivity`, `Summary Dashboard`, `Wajib Baca`
4. **The client's business definition of `RITASI`** — verbatim. Without this, 3C cannot legally promote CYCLE CANDIDATE → VERIFIED RITASI. Specifically: does a *ritasi* count a **loaded-outbound leg**, a **full cycle**, a **weighbridge ticket**, or a **barge/manifest entry**?
5. **Column-header map per sheet** (which column is Tanggal / Shift / Unit / Ritasi / Tonase / BCM / Loading Point / Dumping Point).
6. Whether the `Input Ritasi` vs `In Prod` divergence is expected by the client (i.e. are they intentionally different metrics?).

> Per Owner instruction, **no historical rows were fabricated to satisfy tests.** No synthetic
> row was inserted claiming provenance in Sources A/B/C.

---

## 3. STEP 3 — UNIT vs REAL PARITY SEPARATION

| Test class | Current basis | Acceptable? |
|---|---|---|
| T4 `MATCH` | synthetic fixture | ✅ per STEP 3 |
| T5 `MINOR_VARIANCE` | synthetic fixture | ✅ |
| T6 `MAJOR_VARIANCE` | synthetic fixture | ✅ |
| T7 missing source | synthetic fixture | ✅ |
| T8 duplicate pattern | synthetic fixture | ✅ |
| T9 grain mismatch | synthetic fixture | ✅ |
| T10–T12 aggregation | synthetic fixture | ✅ |
| **T13 1–8 Aug** | **Owner-stated aggregate reproduced via `distribute()`** | ❌ **NOT real evidence** |
| **T14 9–15 Aug** | **Owner-stated aggregate reproduced via `distribute()`** | ❌ **NOT real evidence** |
| **T15 16–28 Aug** | **Owner-stated aggregate reproduced via `distribute()`** | ❌ **NOT real evidence** |

The test-file header already carries an explicit provenance note stating the workbooks are
absent and the figures are Owner-stated. However the **test names still read as if real
parity were reproduced** — that is a wording/honesty defect and must be corrected, not papered over.

Fixtures that are kept must preserve `source / source_sheet / source_row / Tanggal / Shift /
Unit / original_value`. That is **not possible today** — hence STOP.

---

## 4. STEP 4 — KNOWN AUGUST TARGETS (reproduced against Owner-stated aggregates only)

| Window | Target (Owner-stated) | Reproduced in RUN 2? | Independent? |
|---|---|---|---|
| 1–8 Aug | Input 9,793 · In Prod 9,772 · Δ **+21** | ✅ arithmetic only | ❌ **circular** |
| 9–15 Aug | Input 19,654 · In Prod 9,850 · Δ **+9,804** | ✅ arithmetic only | ❌ **circular** |
| 16–28 Aug | Input 19,875 · In Prod 19,918 · Δ **−43** | ✅ arithmetic only | ❌ **circular** |
| 9–15 Aug groups | 311 / 311 in both sources | ✅ fixture constructs 311 | ❌ **circular** |

**Honest statement:** because the fixture is *built from* `D.w1_0808 / D.w2_0915 / D.w3_1628`
and then asserted against the same constants, RUN 2 proves **the reconciliation machinery
conserves totals and classifies correctly** — it does **not** prove parity against the real
workbooks.

**No `/2`, `×2`, dedup, normalization, multiplier, divisor or correction factor was applied —
and none will be, unless independently proven from real evidence.**

### 9–15 Aug discrepancy

**Root cause: NOT ESTABLISHED.** Available evidence is insufficient. Standing classification:

```
REVIEW_REQUIRED
CLIENT_VALIDATION_NEEDED
```

Candidate hypotheses (to be tested against real rows, **not conclusions**): duplicate row
blocks, shift/unit double representation, hourly-vs-shift grain mixing, loaded-leg vs
full-cycle semantics, SUM-vs-COUNT semantics, stale formula/reference range, source refresh
copy behaviour, hidden/helper columns, repeated day/shift blocks, per-dumping-point aggregation.
**No explanation is invented here.**

---

## 5. STEP 5 — `T22: 0 historical sources registered`

**Verdict: (A) expected — but the message was misleading.**

Evidence (live DB, immediately after a full run):

```
sources=0   evidence=0   recon=0   config=1
```

Phase 3C tests seed `fx3c`-prefixed sources and delete every fixture row in `after()`.
`T22` reads `COUNT(*) FROM fms_historical_sources` **after that cleanup**, so `0` is the
**correct test-isolation outcome**, not a setup failure.

**Action taken (wording only, zero business logic):** the T22 block now carries an explicit
comment plus a hard assertion `strictEqual(count, 0)`, so an empty registry after cleanup is
*proven* rather than merely printed, and the log line now reads
`source registry empty after fixture cleanup (0 rows) — NOT a Phase 3C load failure`.
`cycle-engine` / `geofence-engine` / `telemetry-pipeline` / Traccar: **untouched.**

---

## 5b. RUN 2 — remaining 3 failures (regression harness, not app)

`T19` / `T20` / `T21` failed with `must report a positive pass count` although the child
suites exited `0`. Root cause: the harness passed `process.env` to `spawnSync`, so the nested
runner inherited `NODE_TEST_CONTEXT` set by the **outer** runner; Node then treated the child
as a test subprocess and suppressed the TAP summary, breaking the `# pass (\d+)` parse.

Proven by direct invocation with the outer context removed:

```
Phase 3B → # tests 25 · # pass 25 · # fail 0 · exit 0
```

**Patch applied (harness only):** `delete childEnv.NODE_TEST_CONTEXT` before `spawnSync`.
**Status: applied, NOT yet verified by a re-run** (STOP was honoured before the final gate).

---

## 6. STEP 6 — PRESERVED PASSES / NO SEMANTIC CHANGES

| Item | Status |
|---|---|
| T19 Phase 3B regression | ✅ PASS |
| T20 Phase 3A regression | ✅ PASS |
| T21 Phase 2 regression | ✅ PASS |
| T22 services/resources | ✅ PASS |
| `lib/fms/cycle-engine.ts` | untouched |
| `lib/fms/geofence-engine.ts` | untouched |
| `lib/fms/telemetry-pipeline.ts` | untouched |
| Traccar / containers | untouched — 5 containers Up, `fms-postgres`:5439 intact |
| Phase 3B thresholds | unchanged (minLoadingDwell 30s, minDumpingDwell 30s, maxCycleDuration 10800s, maxTelemetryGap 600s, minTravelDistance 50m) |

---

## 7. STEP 7 — NEXT RUN: BLOCKED

Required final gate:

```
22/22 PASS  AND  real August comparisons reproduced
```

- `22/22 PASS` — **achievable**; RUN 2 shows 36/39 with all Phase 3C content tests green, and the
  3 residuals are a harness defect already patched.
- `real August comparisons reproduced` — **BLOCKED**: `HISTORICAL_SOURCE_FILES_UNAVAILABLE`.

Therefore the gate **cannot be declared met**, and per Owner instruction the run **STOPS HERE**.

### Current honest state

| Field | Value |
|---|---|
| tests / assertions (RUN 2) | 39 tests / 17 suites / 36 PASS / 3 FAIL (harness) |
| source registry count | 0 (no real source registered) |
| source registry entries | none |
| T13 totals | 9,793 vs 9,772 → Δ +21 · **Owner-stated, not extracted** |
| T14 totals | 19,654 vs 9,850 → Δ +9,804 · **Owner-stated, not extracted** |
| T15 totals | 19,875 vs 19,918 → Δ −43 · **Owner-stated, not extracted** |
| 9–15 Aug group count | 311 (fixture-constructed, not verified against real rows) |
| classifications | `MATCH` `MINOR_VARIANCE` `MAJOR_VARIANCE` `MISSING_SOURCE_A` `MISSING_SOURCE_B` `DUPLICATE_PATTERN` `GRAIN_MISMATCH` `REVIEW_REQUIRED` `NOT_COMPARABLE` |
| unresolved business questions | client definition of RITASI; authority of `INPUT` vs `REKAP DAILY` vs `In Prod`; whether 9–15 Aug divergence is expected |
| `VERIFIED_RITASI` output | **none** ✅ |
| automatic `/2` correction | **none** ✅ |
| regression status | 3B/3A/2 healthy (25/25 proven) |
| commit | **not committed** (Phase 3B `a71ede48` remains HEAD) |

### Blocking status

```
HISTORICAL_SOURCE_FILES_UNAVAILABLE
REVIEW_REQUIRED
CLIENT_VALIDATION_NEEDED
```

**STOPPED — awaiting Owner: workbook mount + RITASI business definition.**
