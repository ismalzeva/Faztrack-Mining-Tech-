# FMS PHASE 3C — HISTORICAL SOURCE MANIFEST

**Purpose.** Source registry for the three ORIGINAL August 2026 client workbooks used as
Phase 3C historical validation evidence. This file is COMMITTABLE and contains **no client
row data** — only filenames, hashes, sheet names, aggregate reconciliation numbers and
classification results.

**Originals are NOT committed.** They live outside GitHub history and are gitignored by
`validation/fixtures/historical/` and `*.xlsb`. They are read-only (mode 444) and were
verified byte-identical (SHA256) before *and* after every extraction run.

---

## 1. Source registry

| Key | Filename | SHA256 | Stored at |
|---|---|---|---|
| A | `HAULING DATA WEEKLY LIM 2026 AGUSTUS1.xlsx` | `3f9a97110d705da35435c5191a4014ed55ce030dd63412153572b808294bc8ba` | `validation/fixtures/historical/` |
| B | `Status Unit Support BR_ 202600831.xlsb` | `69136db613302e6ca976250465653c16bba74fe84f48e629e8e95758fdf8b28c` | `validation/fixtures/historical/` |
| C | `Master Hourly Like New_20260831 (3).xlsb` | `f3ae53db0f9300eb68a0ffdcba0a948a7a28d0cc79d68ae8378d6647c16ad470` | `validation/fixtures/historical/` |

> Note: the on-disk name of B is `Status Unit Support BR_ 202600831.xlsb` — there is a
> **space after `BR_`**. Filename is preserved exactly as delivered (never renamed).

`originals_unchanged_after_extraction: true` on every run.

## 2. Source / sheet authority (PROVISIONAL — unchanged from the Owner instruction card)

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
RITASI business definition = `CLIENT_VALIDATION_NEEDED`. RITASI authority = **HOLD / REVIEW**.

## 3. Extraction

```
/home/ubuntu/venvs/fms-validation/bin/python \
  scripts/extract-historical-workbooks.py \
  --out validation/extracted/historical-evidence.json
```

* Artifact `validation/extracted/historical-evidence.json` is **gitignored** (contains client rows).
* The extractor only **reads and aggregates**. It applies **no** correction, no `/2`, no `×2`,
  no dedup, no normalisation, no imputation. Missing ≠ zero.
* Every aggregate carries lineage: `source_file`, `source_sheet`, `source_row(s)`, and the
  original cell values that produced it.

### Column resolution

Columns are resolved **by normalised header name**, never by hardcoded index, so the mapping
is self-documenting and survives sheet layout shifts.

| Workbook | Sheet | Metric column | Header | Grain |
|---|---|---|---|---|
| A | `INPUT` | one row = one retase | `Retase`, `TONASE` | Tanggal + Shift + Unit |
| A | `REKAP DAILY` | `RETASE`, `TOTAL TONASE`, `TOTAL BCM` | — | Tanggal + Shift + Unit |
| C | `Input Ritasi` | `Ritse` | per-row Ritasi count | Tanggal + Shift + Loader + Hauler + route, hourly buckets |
| C | `In Prod` | `Rate` | per-row Ritasi count | per-trip |
| B | `Status Unit` | `Unit Status` | `Working` / `Standby` / `Delay` / `Breakdown` | per unit × shift × activity |

> **Column trap (recorded):** `In Prod.Bucket` is **NOT** a Ritasi count — it is a histogram
> (dominant value 6.0). Using it as a ritasi metric yields near-zero totals. The correct metric
> is `In Prod.Rate`. Likewise `Input Ritasi` has ~29 non-zero bucket columns; only col header
> `Ritse` is the window-scoped Ritasi total.

## 4. Independent reproduction of prior observations

### Workbook A — grain Tanggal + Shift + Unit

| Quantity | Prior observation | Extracted (this run) | Status |
|---|---|---|---|
| Groups in INPUT | 1365 | **1365** | ✅ reproduced |
| Groups in REKAP DAILY | 1365 | **1365** | ✅ reproduced |
| Groups matched | 1365/1365 | **1365 / 1365** | ✅ reproduced |
| INPUT-only groups | 0 | **0** | ✅ |
| REKAP-only groups | 0 | **0** | ✅ |
| Ritasi | 8,825 | **8,825** | ✅ reproduced |
| Tonase | 436,335.92 | **436,335.92** | ✅ reproduced |
| BCM | 247,918.13636 | **247,918.13635** | ✅ reproduced (Δ 1e-5) |

> The BCM difference is **floating-point accumulation order only** (1×10⁻⁵ on a 2.5×10⁵ value,
> i.e. ~4×10⁻¹¹ relative). It is not a data discrepancy. No rounding was imposed to hide it.

### Workbook C — `Input Ritasi.Ritse` vs `In Prod.Rate`

| Window | Input Ritasi | In Prod | Delta | Prior delta | Status |
|---|---|---|---|---|---|
| 1–8 Aug | **9,793** | **9,772** | **+21** | +21 | ✅ reproduced |
| 9–15 Aug | **19,654** | **9,850** | **+9,804** | +9,804 | ✅ reproduced |
| 16–28 Aug | **19,875** | **19,918** | **−43** | −43 | ✅ reproduced |
| 29–31 Aug | **no comparable coverage (0 rows)** | **3,962** | — | 3,962 | ✅ reproduced |

Every one of the four prior observations reproduces **exactly**, from real extracted rows,
with zero hardcoding and zero manipulation.

### Workbook B — Status Unit vs Master

| Quantity | Prior observation | Extracted (this run) | Status |
|---|---|---|---|
| Units matched | 122 / 122 | **69 / 69** | ❌ **NOT reproduced** → `PRIOR_OBSERVATION_UNVERIFIED` |
| Aug 2026 distinct units in `Status Unit` | — | **69** | actual |
| `Master` unit list size | — | **468** | actual |
| 31 Aug rows (`Status Unit`) | — | **297** | actual |
| 31 Aug distinct units | — | **66** | actual |
| 31 Aug `Working` status rows | — | **112** | actual |
| 31 Aug distinct units with any `Working` row | — | **50** | actual |
| 31 Aug total hours | — | **792.00** | actual |

**Finding:** the prior "122/122 units matched" figure **could not be reproduced at any grain
tested**. `Status Unit` contains 69 distinct units for August 2026 and **all 69 match the
`Master` list (69/69)**. The 31 Aug slice covers the **Night shift only** (297 rows, 66 units,
792 h = 66 × 12 h), with 112 `Working` status rows across 50 distinct working units.

No plausible 122 could be derived from Workbook B: 69 units, 66 units on 31 Aug, 112 Working
rows, 468 Master rows. The prior figure is therefore reported as **NOT REPRODUCED** and is
**NOT adopted**. Per directive, the actual extracted values + lineage are reported instead
of forcing agreement.

> **`PRIOR_OBSERVATION_UNVERIFIED`** — `122 / 122` is NOT reproduced from the original workbook
> and **must NOT be used as a baseline** until its source is identified.

**OWNER-ACCEPTED (2026-09-10):** 122/122 is dispositioned `PRIOR_OBSERVATION_UNVERIFIED`.
The reproducible evidence is **`69 / 69`** units matched against `Master`.

> The true, reproducible Workbook B statement is: **`69/69` units matched against `Master`.**

## 5. 9–15 August investigation — ROOT CAUSE IDENTIFIED

`Input Ritasi` ≈ 2× `In Prod` in the 9–15 Aug window is caused by
**double-representation of a single loading point under two labels**.

Raw evidence from the sheet rows:

| Window | `Pit BR23W` | `Pit BR23` | Window total | Split |
|---|---|---|---|---|
| 1–8 Aug | **0** | **9,793** | 9,793 | single label (100%) |
| **9–15 Aug** | **9,827** | **9,827** | **19,654** | **exactly 50.0% / 50.0%** |
| 16–28 Aug | **0** | **19,875** | 19,875 | single label (100%) |

* In the 9–15 window the same physical haul appears **twice** — once with `From = 'Pit BR23W'`
  and once with `From = 'Pit BR23'` — carrying **identical** `Ritse`, `Truck Factor (ton/rit)`,
  `Distance`, `Material`, `Hauler` and `Loader` per row.
* Worked example (10 Aug 2026): `Ritse by 'From' = {'Pit BR23W': 663, 'Pit BR23': 663}` →
  663 + 663 = **1,326** = that day's exact total. On a control day (20 Aug, 16–28 window) the
  same day resolves to `{'Pit BR23': 700}` = **700** = exact total.
* Row density matches the anomaly: 1–8 Aug ≈ 97.5 rows/day, **9–15 Aug ≈ 213 rows/day**,
  16–28 Aug ≈ 104.6 rows/day. Per-row Ritse density is *normal* across all windows
  (~12.5–14.6), so the anomaly is **row duplication**, not inflated per-row values.
* Distinct route keys per day-shift: 1–8 Aug = 3–5, **9–15 Aug = 8–12**, 16–28 Aug = 3–6.

**Alias test (diagnostic only — NOT applied):** removing the `Pit BR23W` label gives
`19,654 − 9,827 = 9,827`, i.e. residual delta vs `In Prod` = **−23**, which falls back inside
the *normal* reconciliation band observed in the control windows (+21 and −43) instead of
+9,804.

### Classification

```
DUPLICATE_PATTERN   (loading-point alias double-representation)
REVIEW_REQUIRED
```

**NO correction was applied.** `correction_applied: false`. No ÷2, no ×2, no auto-dedup, no
normalisation, no correction factor — anywhere in the extractor, the replay layer, or the engine.
Whether `Pit BR23W` is a true alias of `Pit BR23` or a genuinely distinct loading point is a
**client/business question**, not an engineering one.

### Residual, stated honestly

Even after accounting for the alias duplication, `Input Ritasi` (9,827) and `In Prod` (9,850)
do **not** match — residual **−23**. That residual is the same order of magnitude as the
control windows' routine disagreement (+21, −43) and is therefore **not** evidence that
`Input Ritasi` and `In Prod` measure the same thing. It remains a business-definition question.

## 6. Business questions still open

1. What is `Ritasi`? loaded outbound leg / LP→DP / full LP→DP→LP cycle / weighbridge ticket /
   production transaction?
2. Is `Input Ritasi` or `In Prod` authoritative for RITASI — or are they two different metrics?
3. Is the ≈2× divergence in 9–15 Aug **expected** by the client, or is it a workbook defect?
4. Is `INPUT` authoritative over `REKAP DAILY` in Workbook A?
5. What is the source of the `Pit BR23W` / `Pit BR23` alias pair, and is it a master-data fault?

**RITASI AUTHORITY = HOLD / REVIEW.  Business definition = CLIENT_VALIDATION_NEEDED.**
`CYCLE_CANDIDATE ≠ RITASI ≠ VERIFIED_RITASI ≠ PRODUCTION`. **No `VERIFIED_RITASI` is emitted.**
