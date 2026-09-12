# FMS PHASE 3C — HISTORICAL REPLAY & RITASI PARITY
## FINAL REPORT (§21)

**Status:**
```
PHASE 3C ENGINEERING + HISTORICAL VALIDATION COMPLETE
RITASI BUSINESS VALIDATION PENDING
RITASI AUTHORITY = HOLD / REVIEW
```

| | |
|---|---|
| Branch | `feat/fms-b001-canonical-event-contract` |
| HEAD | `a71ede48cf412fb10e4808b7a390f1d37c5eae20` (Phase 3B — **unchanged**) |
| Commit | **NONE — Phase 3C is uncommitted, per Owner directive** |
| Gate result | **43 / 43 PASS · 18 / 18 suites · 0 fail** (T1–T22 = **22 / 22 PASS**) |
| `VERIFIED_RITASI` | **NONE EMITTED — prohibited and not produced** |
| Correction applied | **NONE — no ÷2, ×2, dedup, normalisation or correction factor** |

> **Client-identifier sanitization (2026-09-10, Owner-directed):** illustrative lineage examples in
> this report use anonymous deterministic labels — `UNIT-A/B/C` (haulage units), `EQUIPMENT-A/B`
> (loader / hauler), `DUMPPOINT-A`, `MATERIAL-A`. Dates, shift, source-row citations, reconciliation
> values, source sheet/reference methodology, aggregate findings, classifications and SHA256 source
> hashes are preserved verbatim; **no analytical content or conclusion was altered**.
> The labels `Pit BR23` / `Pit BR23W` are **deliberately retained** — they are the substance of the
> 9–15 Aug diagnostic finding and are not substitutable by an anonymous label.

---

## 1. Source registry (verified independently)

Originals stored at `validation/fixtures/historical/`, **read-only (mode 444)**, **gitignored**,
**outside GitHub history** (`.gitignore`: `validation/fixtures/historical/`, `validation/extracted/`, `*.xlsb`).

| Key | Filename (preserved exactly) | SHA256 | Match |
|---|---|---|---|
| A | `HAULING DATA WEEKLY LIM 2026 AGUSTUS1.xlsx` | `3f9a97110d705da35435c5191a4014ed55ce030dd63412153572b808294bc8ba` | ✅ |
| B | `Status Unit Support BR_ 202600831.xlsb` | `69136db613302e6ca976250465653c16bba74fe84f48e629e8e95758fdf8b28c` | ✅ |
| C | `Master Hourly Like New_20260831 (3).xlsb` | `f3ae53db0f9300eb68a0ffdcba0a948a7a28d0cc79d68ae8378d6647c16ad470` | ✅ |

All three SHA256 values were **independently recomputed by the agent and match the Owner-supplied
values exactly**. Filename note: B is on disk as `Status Unit Support BR_ 202600831.xlsb` — **space
after `BR_`**. It was **not renamed**.

`originals_unchanged_after_extraction: true` — the extractor hashes before *and* after every run;
a mismatch aborts. Verified pass on every run.

### 1a. Reproducibility re-verification

A late background-process notification for the **pre-patch** extractor run
(`RuntimeError: header row not found in sheet 'Master'` — the defect fixed before the accepted run)
raised the question of whether the accepted artifact came from a clean run. Re-verified:

| Check | Result |
|---|---|
| Canonical artifact intact | `validation/extracted/historical-evidence.json` — 628,345 B, mtime `20:11` ✅ |
| Stale PID `903682` | **gone** — no `rm -rf` race against the good run ✅ |
| Fresh re-run to a separate path | `REAL_EXIT=0` ✅ |
| Re-run vs canonical, after dropping `generated_at_utc` | **byte-identical** ✅ |
| All Workbook A/B/C observations in the re-run | identical to §6/§7/§9 ✅ |
| Full T1–T22 gate re-run (run 5) | **43 / 43 PASS · `REAL_EXIT=0`** ✅ |

**Root cause of the stale notification:** `cmd | tee log; echo "EXIT=$?"` reports **`tee`'s** exit
code, not `cmd`'s — so a crashed run reports `EXIT=0`. This is now recorded as a pitfall in the
`source-data-reconciliation-forensics` skill, with the fix (`set -o pipefail` / `${PIPESTATUS[0]}`).
All subsequent invocations in this phase use `set -o pipefail`.


## 2. Source / sheet authority matrix (PROVISIONAL — unchanged)

| Workbook | Sheet | Provisional authority |
|---|---|---|
| A | `INPUT` | Primary raw Ritasi / Tonase |
| A | `REKAP DAILY` | Derived |
| A | `DATA TIMBANGAN` | Weighbridge |
| A | `HM` | HM / KM |
| A | `IN_STATUS UNIT` | Status |
| A | `DISTENANCE` | Route / distance |
| B | `Status Unit` | Primary operational status |
| B | `EP` / `Equipment Performance` | Derived |
| B | `Master` / `TUM` | Master / reference / business rule |
| C | `Input Ritasi` | Source A |
| C | `In Prod` | Source B |
| C | `STATUS UNIT` | Status |
| C | `MASTER` | Reference |
| C | `Wajib Baca` | Data dictionary (7 operational rules) |

**Neither `Input Ritasi` nor `In Prod` is an official authority for RITASI.**

`Wajib Baca` was read: it contains 7 operational rules (unit input discipline, TUM, status,
hourly reporting) — it is a **data dictionary, not a Ritasi metric definition**. It does **not**
resolve the business definition.

## 3. Evidence schema (lineage-preserving)

Every extracted aggregate carries: `source_file`, `source_sheet`, `source_row(s)`, and the
**original cell values** that produced it. Missing ≠ zero. Original client terminology preserved
verbatim (`Retase`, `Ritse`, `SHIF`, `Pit BR23W`, …).

## 4. Importer architecture (isolation preserved)

```
scripts/extract-historical-workbooks.py    619 lines   READ-ONLY extractor (Python)
  └─> validation/extracted/historical-evidence.json     628,345 B  (gitignored, client rows)

lib/fms/historical-replay.ts               782 lines   replay/parity engine (TypeScript)
drizzle/0004_fms_historical_evidence.sql   174 lines   4 tables + idempotent ALTER (applied)
tests/fms-phase3c-historical.test.ts      1380 lines   T1–T22 gate
```

**§3C-2 ARCHITECTURE RULE SATISFIED:**
`cycle-engine.ts`, `geofence-engine.ts`, `telemetry-pipeline.ts`, `traccar-adapter.ts` have
**zero diff**. No workbook-specific logic leaked into the engine. The importer lives entirely
in the replay layer + `scripts/`.

### Column resolution — by header name, never hardcoded index

| Workbook | Sheet | Metric | Header | Grain |
|---|---|---|---|---|
| A | `INPUT` | 1 row = 1 retase | `Retase`, `TONASE` | Tanggal + Shift + Unit |
| A | `REKAP DAILY` | `RETASE`, `TOTAL TONASE`, `TOTAL BCM` | — | Tanggal + Shift + Unit |
| C | `Input Ritasi` | per-row count | **`Ritse`** | Tanggal + Shift + Loader + Hauler + route, hourly buckets |
| C | `In Prod` | per-row count | **`Rate`** | per-trip |
| B | `Status Unit` | `Unit Status` | `Working`/`Standby`/`Delay`/`Breakdown` | unit × shift × activity |

**Two traps recorded and corrected:**
1. `In Prod.Bucket` is **NOT** a Ritasi count — it is a histogram (modal value 6.0). Using it
   yields near-zero totals. The correct metric is `In Prod.Rate`.
2. `Input Ritasi` has ~29 populated hourly bucket columns; only the column headed `Ritse` is the
   window-scoped Ritasi total. Summing all buckets inflates by ~40×.
3. `openpyxl` returns real `datetime` objects for date cells while `pyxlsb` returns serials —
   the date reader must accept both, or Workbook A silently extracts 0 rows.

## 5. Grain analysis

| Source | Grain |
|---|---|
| A `INPUT` | one row per retase · aggregated to Tanggal + Shift + Unit |
| A `REKAP DAILY` | one row per Tanggal + Shift + Unit |
| C `Input Ritasi` | day × shift × loader × hauler × From/To route, with hourly sub-buckets |
| C `In Prod` | one row per trip (TimeFrom/TimeTo, LP, DP) |
| B `Status Unit` | unit × shift × activity segment with start/end/duration |

`Input Ritasi` (route grain) and `In Prod` (trip grain) are **not the same grain**, which is why
their agreement is a business question rather than an arithmetic identity.

## 6. Workbook A parity — INDEPENDENTLY REPRODUCED ✅

Grain: **Tanggal + Shift + Unit**

| Quantity | Prior observation | Extracted from real rows | Status |
|---|---|---|---|
| Groups (`INPUT`) | 1365 | **1365** | ✅ reproduced |
| Groups (`REKAP DAILY`) | 1365 | **1365** | ✅ reproduced |
| Groups matched | 1365 / 1365 | **1365 / 1365** | ✅ reproduced |
| INPUT-only / REKAP-only | 0 / 0 | **0 / 0** | ✅ reproduced |
| **Ritasi** | 8,825 | **8,825** | ✅ reproduced |
| **Tonase** | 436,335.92 | **436,335.92** | ✅ reproduced |
| **BCM** | 247,918.13636 | **247,918.13635** | ✅ reproduced (Δ 1×10⁻⁵) |

> The BCM delta is **floating-point accumulation order only** (~4×10⁻¹¹ relative). It is **not**
> hidden by rounding and **not** a data discrepancy. `classifyParity(8825, 8825)` → **MATCH**.

**Representative Tanggal + Shift + Unit examples (real lineage):**

| Tanggal | Shift | Unit | INPUT Ritase | REKAP Ritase | Tonase | BCM | INPUT rows | REKAP row | Parity |
|---|---|---|---|---|---|---|---|---|---|
| 2026-08-01 | D | `UNIT-A` | 1 | 1 | 32.84 | 18.659091 | `[49776]` | `[7097]` | MATCH |
| 2026-08-01 | D | `UNIT-B` | 8 | 8 | 388.84 | 220.931818 | `[49778, 49785, 49794, 49804, 49814, 49820, 49837, 49847]` | `[7098]` | MATCH |
| 2026-08-31 | N | `UNIT-C` | 9 | 9 | 419.64 | 238.431818 | `[58382, 58402, 58420, 58438, 58453, 58471, 58482, 58500, 58520]` | `[8493]` | MATCH |

Each group's aggregate is reconstructible from the cited original rows — full lineage preserved.

## 7. Workbook C — August parity table — INDEPENDENTLY REPRODUCED ✅

`Input Ritasi.Ritse` vs `In Prod.Rate`

| Window | Input Ritasi | In Prod | Delta | Prior | Ratio | Engine class |
|---|---|---|---|---|---|---|
| **1–8 Aug** | **9,793** | **9,772** | **+21** | +21 ✅ | 1.0021 | `MINOR_VARIANCE` |
| **9–15 Aug** | **19,654** | **9,850** | **+9,804** | +9,804 ✅ | **1.99533** | `MAJOR_VARIANCE` |
| **16–28 Aug** | **19,875** | **19,918** | **−43** | −43 ✅ | 0.9978 | `MINOR_VARIANCE` |
| **29–31 Aug** | **no comparable coverage (0 rows)** | **3,962** | — (NULL) | 3,962 ✅ | — | `MISSING_SOURCE_A` |

**All four prior observations reproduced exactly from real extracted rows.** 29–31 Aug Input is
recorded as **absent (0 rows)** and is **not imputed**; its delta is **NULL, not 0**.

## 8. 9–15 August — REAL ROW-LEVEL INVESTIGATION · ROOT CAUSE IDENTIFIED

### Finding: double-representation of one loading point under two labels

| Window | `Pit BR23W` | `Pit BR23` | Window total | Split |
|---|---|---|---|---|
| 1–8 Aug | **0** | **9,793** | 9,793 | single label (100%) |
| **9–15 Aug** | **9,827** | **9,827** | **19,654** | **exactly 50.0 % / 50.0 %** |
| 16–28 Aug | **0** | **19,875** | 19,875 | single label (100%) |

### Smoking-gun lineage pair (identical every field except the `From` label)

```
source_row  876 · 2026-08-10 · DS · loader EQUIPMENT-A · hauler EQUIPMENT-B
             From "Pit BR23W" · To DUMPPOINT-A · MATERIAL-A · distance 872.414 · Ritse 5.0

source_row 2816 · 2026-08-10 · DS · loader EQUIPMENT-A · hauler EQUIPMENT-B
             From "Pit BR23"  · To DUMPPOINT-A · MATERIAL-A · distance 872.414 · Ritse 5.0
```

Identical loader, hauler, dumping point, material, **distance** and **Ritse** — the same physical
haul recorded twice under two loading-point labels.

### Corroborating structural evidence

| Evidence | 1–8 Aug | 9–15 Aug | 16–28 Aug |
|---|---|---|---|
| `Input Ritasi` rows / day | 97.5 | **213** | 104.6 |
| Distinct route keys / day-shift | 3–5 | **8–12** | 3–6 |
| Ritse per row (density) | normal | **normal** | normal |
| Full-row exact duplicates | 0 | **0** | 0 |

Ritse-per-row density is **normal in every window** — the 9–15 anomaly is **row duplication**,
not inflated per-row values. There are **no identical full-row duplicates**, which is why naive
dedup would not have caught it.

Per-day Ritse, 9–15 Aug: 2,660 / 2,676 / 2,858 / 2,908 / 2,948 / 2,682 / 2,922 — the anomaly is
**uniform across all 7 days**, not a single-day artefact.

### Alias test — DIAGNOSTIC ONLY, NEVER APPLIED

```
19,654 − 9,827 (Pit BR23W removed, diagnostic) = 9,827
9,827 − 9,850 (In Prod)                        =    −23
```

The residual **−23** falls back inside the **normal reconciliation band** observed in the control
windows (**+21** and **−43**) instead of **+9,804**. This is the decisive confirmation.

### Classification

```
DUPLICATE_PATTERN   (loading-point alias double-representation)
REVIEW_REQUIRED
```

**`correction_applied: false`.** No ÷2, no ×2, no auto-dedup, no normalisation, no correction
factor — in the extractor, the replay layer, or the engine. The raw **19,654** is persisted
intact (T16 PASS).

### OWNER-ACCEPTED DISPOSITION (2026-09-10)

| Item | Disposition |
|---|---|
| Classification | `DUPLICATE_PATTERN` / `REVIEW_REQUIRED` — **accepted** |
| Evidence | Strong evidence indicates double-representation under `Pit BR23` + `Pit BR23W` — **accepted** |
| **Merging the labels** | **PROHIBITED for now** — client/business confirmation still required to determine whether `Pit BR23W` is truly an alias of `Pit BR23` |
| **Diagnostic removal of `Pit BR23W`** | **NOT a production correction** — diagnostic only |
| **Raw historical value `19,654`** | **Must remain preserved** |

### Residual, stated honestly

Even after removing the alias, `Input Ritasi` (9,827) ≠ `In Prod` (9,850) — residual **−23**.
That residual is the **same order of magnitude as routine control-window disagreement**
(+21, −43) and is therefore **not** evidence that `Input Ritasi` and `In Prod` measure the same
quantity. It remains a **business-definition question**.

## 9. Workbook B — prior observation NOT REPRODUCED → `PRIOR_OBSERVATION_UNVERIFIED`

| Quantity | Prior claim | Extracted from real rows |
|---|---|---|
| Units matched | 122 / 122 | **69 / 69** ❌ |
| Aug 2026 distinct units in `Status Unit` | — | **69** |
| `Master` unit list size | — | **468** |
| 31 Aug `Status Unit` rows | — | **297** |
| 31 Aug distinct units | — | **66** |
| 31 Aug `Working` status rows | — | **112** |
| 31 Aug distinct units with any `Working` row | — | **50** |
| 31 Aug total hours | — | **792.00** (= 66 units × 12 h) |

**The prior "122/122" figure could not be reproduced at any grain tested.** No plausible 122 is
derivable from Workbook B (69 units; 66 on 31 Aug; 112 Working rows; 468 Master rows; 196 EP
unit rows). 31 Aug covers the **Night shift only**.

Per the directive, the **actual extracted values + lineage are reported** and the prior figure is
**NOT adopted**. The reproducible statement is: **`69/69` units matched against `Master`.**

→ **Flagged for Owner clarification:** the source of the 122 figure.

### OWNER-ACCEPTED DISPOSITION (2026-09-10)

| Item | Disposition |
|---|---|
| `122 / 122` | **`PRIOR_OBSERVATION_UNVERIFIED`** — NOT reproduced from the original workbook |
| Use as baseline | **PROHIBITED** until the source of the 122 figure is identified |
| Reproducible evidence | **`69 / 69`** units matched against `Master` |

## 10. T1–T22 GATE — 22 / 22 PASS

```
# tests 43   # suites 18   # pass 43   # fail 0   # duration 55.8 s
```

| Gate | Description | Result |
|---|---|---|
| T1 | historical evidence schema (+ T1c source registry) | ✅ PASS |
| T2 | source lineage preserved | ✅ PASS |
| T3 | missing ≠ zero | ✅ PASS |
| T4–T6 | parity classification | ✅ PASS |
| T7 | missing-source classification | ✅ PASS |
| T8 | duplicate-pattern detection | ✅ PASS |
| T9 | grain-mismatch detection | ✅ PASS |
| T10–T12 | reconciliation grains | ✅ PASS |
| T13s–T15s | **[SYNTHETIC]** machinery only — explicitly *not* real parity | ✅ PASS |
| **T13–T15** | **REAL historical parity (workbook-derived)** | ✅ **PASS** |
| T16 | no automatic correction (raw 19,654 preserved) | ✅ PASS |
| T17 | no `VERIFIED_RITASI` | ✅ PASS |
| T18 | no fabricated historical telemetry | ✅ PASS |
| 3C-6 | 9–15 August investigation | ✅ PASS |
| 3C-10 | review table | ✅ PASS |
| 3C-9 | source authority | ✅ PASS |
| T19–T21 | Phase 3B / 3A / 2 regressions | ✅ PASS |
| T22 | services and resources | ✅ PASS |

**T13/T14/T15 are now REAL, not circular:**
- T13 — Workbook A parity from real rows (1365/1365, 8,825, 436,335.92, BCM within 1e-4),
  lineage verified, engine → `MATCH`.
- T14 — Workbook C 9–15 from real rows, including the **root cause** and its lineage pair,
  engine → `MAJOR_VARIANCE`.
- T15 — Workbook C full August window table, engine classifications `MINOR_VARIANCE` /
  `MINOR_VARIANCE` / `MISSING_SOURCE_A`, plus proof the ~2× is **isolated to 9–15**.

The fail-closed gate now **passes** because real workbook evidence is present. It remains
fail-closed: absent workbooks → `HISTORICAL_SOURCE_FILES_UNAVAILABLE`, never a fake PASS.

## 11. Regression results ✅

| Regression | Result |
|---|---|
| T19 Phase 3B cycle-engine | **PASS** (25 tests) |
| T20 Phase 3A geofence | **PASS** (26 tests) |
| T21 Phase 2 pipeline | **PASS** (25 tests) |

`cycle-engine.ts`, `geofence-engine.ts`, `telemetry-pipeline.ts`, `traccar-adapter.ts`,
`db/schema.ts`, `db/geofence-schema.ts`: **zero diff**. Phase 2 / 3A / 3B behaviour untouched —
nothing was modified to make telemetry or history agree with Excel.

## 12. Resource impact ✅

| Resource | Value |
|---|---|
| Containers | **5 Up** — `fms-postgres` (:5439→5432), `fms-traccar`, `lumin-postgres` (:5437), `metro-postgres` (:5436), `audit-bubur-fay-pg` (:5438) |
| RAM available | **5,207 MB** |
| Disk free | **28 GB** (64 % used) |
| Untouched DBs | `lumin-postgres`, `metro-postgres`, `audit-bubur-fay-pg` — **not modified** |
| Post-run DB state | `sources=0 evidence=0 recon=0 config=1` (test fixtures cleaned by `after()`) |
| Traccar | v6.15.3 pinned — intact |

## 13. Files changed (all UNCOMMITTED)

| File | Lines | Status |
|---|---|---|
| `lib/fms/historical-replay.ts` | 782 | NEW — replay/parity engine |
| `tests/fms-phase3c-historical.test.ts` | 1,380 | NEW — T1–T22 gate |
| `drizzle/0004_fms_historical_evidence.sql` | 174 | NEW — applied to `fms_db` |
| `scripts/extract-historical-workbooks.py` | 619 | NEW — read-only extractor |
| `validation/HISTORICAL_SOURCE_MANIFEST.md` | 194 | NEW — **committable** registry (no client rows) |
| `docs/FMS_PHASE3C_FINAL_REPORT.md` | this file | NEW — §21 deliverable |
| `docs/FMS_PHASE3C_FAILURE_TRIAGE.md` | 256 | NEW — failure triage |
| `.gitignore` | +5 | MODIFIED — workbook/artifact exclusions |
| `static/` | — | untracked, **not a deliverable** |

**Commit status: NONE.** HEAD remains `a71ede48cf412fb10e4808b7a390f1d37c5eae20` (Phase 3B).
Per directive: *"Do NOT commit yet. STOP FOR OWNER APPROVAL after delivering the final report."*

## 14. Definition of Done reconciliation (§20)

| Requirement | Status |
|---|---|
| 22 / 22 PASS | ✅ 22/22 (43 tests, 0 fail) |
| Real workbook evidence used | ✅ 3 originals, real rows |
| SHA256 recorded | ✅ all 3, independently verified |
| Lineage preserved | ✅ source_file/sheet/row + original values |
| T13/T14/T15 real, not circular | ✅ workbook-derived; synthetic relabelled `[SYNTHETIC]` |
| 9–15 Aug investigated from real rows | ✅ root cause identified |
| No automatic correction | ✅ `correction_applied: false` |
| No fabricated telemetry | ✅ T18 PASS |
| No `VERIFIED_RITASI` | ✅ T17 PASS |
| Phase 2/3A/3B regressions PASS | ✅ 25/26/25 |
| Services/resources unaffected | ✅ T22 PASS |

## 15. Unresolved business questions

1. **What is `Ritasi`?** loaded outbound leg / LP→DP / full LP→DP→LP cycle / weighbridge ticket /
   production transaction?
2. Is `Input Ritasi` or `In Prod` authoritative for RITASI — or are they two different metrics?
3. Is the ≈2× divergence in 9–15 Aug **expected** by the client, or a workbook/master-data defect?
   Is `Pit BR23W` genuinely a distinct loading point from `Pit BR23`?
4. Is `INPUT` authoritative over `REKAP DAILY` in Workbook A?
5. What is the source of the "122/122" Workbook B figure?

**PHASE 3C ENGINEERING + HISTORICAL VALIDATION COMPLETE
RITASI BUSINESS VALIDATION PENDING
RITASI AUTHORITY = HOLD / REVIEW**

`CYCLE_CANDIDATE ≠ RITASI ≠ VERIFIED_RITASI ≠ PRODUCTION`

**STOPPED FOR OWNER APPROVAL.**
