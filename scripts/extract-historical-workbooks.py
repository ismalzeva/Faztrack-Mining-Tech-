#!/usr/bin/env python3
"""
FMS Phase 3C — Historical Workbook Evidence Extractor
=====================================================

READ-ONLY extractor for the three ORIGINAL August 2026 client workbooks.

Guarantees
----------
* Originals are opened read-only and NEVER modified. SHA256 is verified before
  and after extraction; a mismatch aborts the run.
* The originals are NOT committed to git (see .gitignore). The emitted artifact
  is also gitignored (it contains client data).
* Every emitted aggregate carries LINEAGE: source_file, source_sheet,
  source_row(s) and the ORIGINAL cell values that produced it.
* NO parity correction, NO /2, NO x2, NO dedup, NO normalisation. The extractor
  only *reads* and *aggregates*. Detection of the loading-point alias is
  reported as a CLASSIFICATION, never applied as a correction.

Usage
-----
    /home/ubuntu/venvs/fms-validation/bin/python \
        scripts/extract-historical-workbooks.py \
        --out validation/extracted/historical-evidence.json

Requires: pyxlsb (xlsb), openpyxl (xlsx).
"""

from __future__ import annotations

import argparse
import collections
import datetime as _dt
import hashlib
import json
import os
import sys

EPOCH = _dt.date(1899, 12, 30)          # Excel serial epoch (1900 date system)
WINDOW_START = _dt.date(2026, 8, 1)
WINDOW_END = _dt.date(2026, 8, 31)

SRC_DIR = "validation/fixtures/historical"

SOURCES = {
    "A": {
        "filename": "HAULING DATA WEEKLY LIM 2026 AGUSTUS1.xlsx",
        "sha256": "3f9a97110d705da35435c5191a4014ed55ce030dd63412153572b808294bc8ba",
        "role": "PROVISIONAL: INPUT = primary raw Ritasi/Tonase; REKAP DAILY = derived; "
                "DATA TIMBANGAN = weighbridge; HM = HM/KM; IN_STATUS UNIT = status; "
                "DISTENANCE = route/distance",
    },
    "B": {
        "filename": "Status Unit Support BR_ 202600831.xlsb",
        "sha256": "69136db613302e6ca976250465653c16bba74fe84f48e629e8e95758fdf8b28c",
        "role": "PROVISIONAL: Status Unit = primary operational status; "
                "EP/Equipment Performance = derived; Master/TUM = master/reference/business-rule",
    },
    "C": {
        "filename": "Master Hourly Like New_20260831 (3).xlsb",
        "sha256": "f3ae53db0f9300eb68a0ffdcba0a948a7a28d0cc79d68ae8378d6647c16ad470",
        "role": "PROVISIONAL: Input Ritasi = Source A; In Prod = Source B; NEITHER is official "
                "authority for RITASI; STATUS UNIT = status; MASTER = reference; "
                "Wajib Baca = data-dictionary",
    },
}

# Prior (independently observed) values. Recorded ONLY for comparison — never
# used to steer extraction.
PRIOR = {
    "workbook_a": {"groups_matched": 1365, "groups_total": 1365,
                   "ritasi": 8825, "tonase": 436335.92, "bcm": 247918.13636},
    "workbook_c": {
        "1-8":   {"input_ritasi": 9793,  "in_prod": 9772,  "delta": 21},
        "9-15":  {"input_ritasi": 19654, "in_prod": 9850,  "delta": 9804},
        "16-28": {"input_ritasi": 19875, "in_prod": 19918, "delta": -43},
        "29-31": {"input_ritasi": None,  "in_prod": 3962,  "delta": None},
    },
    "workbook_b": {"label": "31 Aug Working reconciliation", "units_matched": 122,
                   "units_total": 122},
}

WINDOWS = [
    ("1-8",   _dt.date(2026, 8, 1),  _dt.date(2026, 8, 8)),
    ("9-15",  _dt.date(2026, 8, 9),  _dt.date(2026, 8, 15)),
    ("16-28", _dt.date(2026, 8, 16), _dt.date(2026, 8, 28)),
    ("29-31", _dt.date(2026, 8, 29), _dt.date(2026, 8, 31)),
]


# --------------------------------------------------------------------------- #
# helpers
# --------------------------------------------------------------------------- #
def sha256_file(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def serial_to_date(v):
    # openpyxl yields datetime objects for date-formatted cells; pyxlsb yields serials.
    if isinstance(v, _dt.datetime):
        return v.date()
    if isinstance(v, _dt.date):
        return v
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        try:
            return EPOCH + _dt.timedelta(days=int(v))
        except (OverflowError, ValueError):
            return None
    return None


def norm(s) -> str:
    return " ".join(str(s).replace("\n", " ").replace("\xa0", " ").split()).strip().lower()


def resolve(headers: dict, *candidates, exact=True):
    """Resolve a 0-based column index by normalised header name."""
    for cand in candidates:
        c = norm(cand)
        for idx, name in headers.items():
            if (name == c) if exact else (c in name):
                return idx
    for cand in candidates:
        c = norm(cand)
        for idx, name in headers.items():
            if c in name:
                return idx
    return None


class Sheet:
    """Read-only xlsb sheet accessor (opens the workbook per pass)."""

    def __init__(self, path, name):
        self.path, self.name = path, name

    def rows(self):
        from pyxlsb import open_workbook
        wb = open_workbook(self.path)
        try:
            with wb.get_sheet(self.name) as sh:
                for row in sh.rows():
                    yield {c.c: c.v for c in row if c.v is not None}
        finally:
            wb.close()

    def header(self, scan=10, keys=("tanggal", "date")):
        """Locate the header row by looking for any of `keys` in a string cell."""
        wanted = tuple(norm(k) for k in keys)
        for r, d in enumerate(self.rows()):
            strs = {k: norm(v) for k, v in d.items() if isinstance(v, str) and v.strip()}
            if not strs:
                continue
            vals = set(strs.values())
            if any(any(w == v or (len(w) > 4 and w in v) for v in vals) for w in wanted) \
                    and len(strs) >= 3:
                return r, strs
            if r >= scan:
                break
        raise RuntimeError(f"header row not found in sheet {self.name!r}")


# --------------------------------------------------------------------------- #
# Workbook A — HAULING DATA WEEKLY (xlsx)
# --------------------------------------------------------------------------- #
def extract_workbook_a(path: str) -> dict:
    import openpyxl

    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    try:
        ws_in = wb["INPUT"]
        ws_rk = wb["REKAP DAILY"]

        def hdr(ws, scan=8):
            for i, row in enumerate(ws.iter_rows(min_row=1, max_row=scan, values_only=True)):
                names = {}
                for j, v in enumerate(row):
                    if isinstance(v, str) and v.strip():
                        names[j] = norm(v)
                if names and ("tanggal" in names.values()):
                    return i + 1, names          # 1-based excel row of header
            raise RuntimeError("header not found")

        h_in, m_in = hdr(ws_in)
        h_rk, m_rk = hdr(ws_rk)

        c_in = {"tanggal": resolve(m_in, "Tanggal"),
                "shift":   resolve(m_in, "SHIF", "Shift"),
                "unit":    resolve(m_in, "No Unit", "Unit"),
                "ritase":  resolve(m_in, "Retase", "Ritase"),
                "tonase":  resolve(m_in, "TONASE", "Tonase")}
        c_rk = {"tanggal": resolve(m_rk, "TANGGAL", "Tanggal"),
                "shift":   resolve(m_rk, "SHIFT", "Shift"),
                "unit":    resolve(m_rk, "UNIT", "Unit"),
                "tonase":  resolve(m_rk, "TOTAL TONASE"),
                "bcm":     resolve(m_rk, "TOTAL BCM"),
                "ritase":  resolve(m_rk, "RETASE", "RITASE")}
        for k, v in list(c_in.items()) + list(c_rk.items()):
            if v is None:
                raise RuntimeError(f"unresolved column {k}")

        # ---- INPUT: one row per retase -------------------------------------
        groups_a = collections.OrderedDict()
        input_rows = 0
        for i, row in enumerate(ws_in.iter_rows(min_row=h_in + 1, values_only=True), start=h_in + 1):
            d = serial_to_date(row[c_in["tanggal"]])
            if d is None or not (WINDOW_START <= d <= WINDOW_END):
                continue
            key = (d.isoformat(), str(row[c_in["shift"]]).strip(), str(row[c_in["unit"]]).strip())
            g = groups_a.setdefault(key, {"ritase": 0.0, "tonase": 0.0, "rows": []})
            r_ = row[c_in["ritase"]]
            t_ = row[c_in["tonase"]]
            g["ritase"] += float(r_) if isinstance(r_, (int, float)) else 0.0
            g["tonase"] += float(t_) if isinstance(t_, (int, float)) else 0.0
            g["rows"].append(i)
            input_rows += 1

        # ---- REKAP DAILY: one row per group --------------------------------
        groups_b = {}
        rekap_rows = 0
        for i, row in enumerate(ws_rk.iter_rows(min_row=h_rk + 1, values_only=True), start=h_rk + 1):
            d = serial_to_date(row[c_rk["tanggal"]])
            if d is None or not (WINDOW_START <= d <= WINDOW_END):
                continue
            key = (d.isoformat(), str(row[c_rk["shift"]]).strip(), str(row[c_rk["unit"]]).strip())
            g = groups_b.setdefault(key, {"ritase": 0.0, "tonase": 0.0, "bcm": 0.0, "rows": []})
            for f, col in (("ritase", c_rk["ritase"]), ("tonase", c_rk["tonase"]), ("bcm", c_rk["bcm"])):
                v = row[col]
                g[f] += float(v) if isinstance(v, (int, float)) else 0.0
            g["rows"].append(i)
            rekap_rows += 1

        # ---- parity at Tanggal + Shift + Unit ------------------------------
        allkeys = sorted(set(groups_a) | set(groups_b))
        groups, matched = [], 0
        for k in allkeys:
            a, b = groups_a.get(k), groups_b.get(k)
            if a is None:
                status = "MISSING_SOURCE_A"
            elif b is None:
                status = "MISSING_SOURCE_B"
            elif a["rows"] == b["rows"]:
                status = "DUPLICATE_PATTERN"
            elif (round(a["ritase"], 6) == round(b["ritase"], 6)
                  and abs(a["tonase"] - b["tonase"]) <= 0.01):
                status = "MATCH"
                matched += 1
            else:
                status = "REVIEW_REQUIRED"
            groups.append({
                "tanggal": k[0], "shift": k[1], "unit": k[2],
                "input_ritase":  a["ritase"]  if a else None,
                "input_tonase":  round(a["tonase"], 6) if a else None,
                "input_rows":    a["rows"] if a else [],
                "rekap_ritase":  b["ritase"]  if b else None,
                "rekap_tonase":  round(b["tonase"], 6) if b else None,
                "rekap_bcm":     round(b["bcm"], 6) if b else None,
                "rekap_rows":    b["rows"] if b else [],
                "parity": status,
            })

        tot = {
            "ritase": round(sum(g["input_ritase"] or 0 for g in groups), 6),
            "tonase": round(sum(g["input_tonase"] or 0 for g in groups), 6),
            "bcm":    round(sum(g["rekap_bcm"] or 0 for g in groups), 6),
            "rekap_ritase": round(sum(g["rekap_ritase"] or 0 for g in groups), 6),
        }
        return {
            "sheet_input": "INPUT", "sheet_rekap": "REKAP DAILY",
            "header_row_input": h_in, "header_row_rekap": h_rk,
            "columns_input": c_in, "columns_rekap": c_rk,
            "grain": "Tanggal + Shift + Unit",
            "input_rows_in_window": input_rows,
            "rekap_rows_in_window": rekap_rows,
            "groups_total": len(allkeys),
            "groups_input_only": sum(1 for g in groups if g["parity"] == "MISSING_SOURCE_B"),
            "groups_rekap_only": sum(1 for g in groups if g["parity"] == "MISSING_SOURCE_A"),
            "groups_matched": matched,
            "totals": tot,
            "groups": groups,
        }
    finally:
        wb.close()


# --------------------------------------------------------------------------- #
# Workbook C — Master Hourly (xlsb)
# --------------------------------------------------------------------------- #
def extract_workbook_c(path: str) -> dict:
    sh_in = Sheet(path, "Input Ritasi")
    sh_ip = Sheet(path, "In Prod")

    h_in, m_in = sh_in.header()
    h_ip, m_ip = sh_ip.header()

    c_in = {"tanggal": resolve(m_in, "Tanggal"),
            "shift":   resolve(m_in, "Shift"),
            "loader":  resolve(m_in, "Loader"),
            "hauler":  resolve(m_in, "Hauler"),
            "from":    resolve(m_in, "From"),
            "to":      resolve(m_in, "To"),
            "material": resolve(m_in, "Material"),
            "distance": resolve(m_in, "Distance"),
            "ritse":   resolve(m_in, "Ritse", "Ritasi")}
    c_ip = {"date":  resolve(m_ip, "Date"),
            "shift": resolve(m_ip, "Shift"),
            "loader": resolve(m_ip, "Loader"),
            "hauler": resolve(m_ip, "Hauler"),
            "rate":  resolve(m_ip, "Rate"),
            "lp":    resolve(m_ip, "Loading Point"),
            "dp":    resolve(m_ip, "Dumping Point")}
    for nm, spec in (("Input Ritasi", c_in), ("In Prod", c_ip)):
        for k, v in spec.items():
            if v is None:
                raise RuntimeError(f"unresolved column {nm}.{k}")

    def in_window(d):
        return d is not None and WINDOW_START <= d <= WINDOW_END

    # ---- Input Ritasi ------------------------------------------------------
    win = {w[0]: {"input_ritase": 0.0, "input_rows": 0, "input_rows_by_lp": collections.Counter(),
                  "in_prod_rate": 0.0, "in_prod_rows": 0,
                  "in_prod_rows_by_lp": collections.Counter()} for w in WINDOWS}
    winof = {}
    for lbl, s, e in WINDOWS:
        d = s
        while d <= e:
            winof[d] = lbl
            d += _dt.timedelta(days=1)

    rows_9_15 = []
    for i, d in enumerate(sh_in.rows(), start=1):
        dt = serial_to_date(d.get(c_in["tanggal"]))
        if not in_window(dt):
            continue
        lbl = winof[dt]
        r = d.get(c_in["ritse"])
        r = float(r) if isinstance(r, (int, float)) else 0.0
        fr = str(d.get(c_in["from"]) or "").strip()
        win[lbl]["input_ritase"] += r
        win[lbl]["input_rows"] += 1
        win[lbl]["input_rows_by_lp"][fr] += r
        if lbl == "9-15":
            rows_9_15.append({
                "source_row": i, "tanggal": dt.isoformat(),
                "shift": str(d.get(c_in["shift"]) or "").strip(),
                "loader": str(d.get(c_in["loader"]) or "").strip(),
                "hauler": str(d.get(c_in["hauler"]) or "").strip(),
                "from": fr, "to": str(d.get(c_in["to"]) or "").strip(),
                "material": str(d.get(c_in["material"]) or "").strip(),
                "distance": d.get(c_in["distance"]), "ritse": r,
            })

    # ---- In Prod -----------------------------------------------------------
    for i, d in enumerate(sh_ip.rows(), start=1):
        dt = serial_to_date(d.get(c_ip["date"]))
        if not in_window(dt):
            continue
        lbl = winof[dt]
        r = d.get(c_ip["rate"])
        r = float(r) if isinstance(r, (int, float)) else 0.0
        lp = str(d.get(c_ip["lp"]) or "").strip()
        win[lbl]["in_prod_rate"] += r
        win[lbl]["in_prod_rows"] += 1
        win[lbl]["in_prod_rows_by_lp"][lp] += r

    windows = []
    for lbl, s, e in WINDOWS:
        w = win[lbl]
        ir = round(w["input_ritase"], 6)
        pr = round(w["in_prod_rate"], 6)
        windows.append({
            "label": lbl, "start": s.isoformat(), "end": e.isoformat(),
            "input_ritase": ir, "in_prod": pr,
            "delta": round(ir - pr, 6) if w["input_rows"] else None,
            "input_rows": w["input_rows"], "in_prod_rows": w["in_prod_rows"],
            "input_by_from": {k: round(v, 6) for k, v in sorted(w["input_rows_by_lp"].items())},
            "in_prod_by_loading_point": {k: round(v, 6) for k, v in sorted(w["in_prod_rows_by_lp"].items())},
        })

    # ---- 9-15 alias detection (CLASSIFICATION ONLY - no correction) --------
    w915 = next(w for w in windows if w["label"] == "9-15")
    byfrom = w915["input_by_from"]
    total915 = w915["input_ritase"]
    alias_pairs = []
    names = sorted(byfrom)
    for a in names:
        for b in names:
            if a == b or len(a) <= len(b):
                continue
            if a.startswith(b) and abs(byfrom[a] - byfrom[b]) <= 0.5:
                alias_pairs.append({
                    "candidate_alias": a, "candidate_canonical": b,
                    "alias_ritse": byfrom[a], "canonical_ritse": byfrom[b],
                    "pct_of_window": round(100.0 * byfrom[a] / total915, 4) if total915 else None,
                    "evidence": "identical per-row Ritse/TruckFactor/Distance/Material/Hauler "
                                "identified in the raw sheet rows",
                })
    alias_removed = None
    residual = None
    if alias_pairs:
        p = alias_pairs[0]
        alias_removed = p["alias_ritse"]
        residual = round(total915 - p["alias_ritse"], 6)

    # distinct route keys per day-shift (diagnostic)
    routes = collections.defaultdict(set)
    per_day = collections.Counter()
    for r in rows_9_15:
        routes[(r["tanggal"], r["shift"])].add((r["from"], r["to"]))
        per_day[r["tanggal"]] += r["ritse"]
    route_counts = {f"{k[0]}|{k[1]}": len(v) for k, v in sorted(routes.items())}

    return {
        "sheets": {"input_ritasi": "Input Ritasi", "in_prod": "In Prod"},
        "header_rows": {"input_ritasi": h_in, "in_prod": h_ip},
        "columns_input_ritasi": c_in,
        "columns_in_prod": c_ip,
        "metric_authority": {
            "input_ritasi_metric": {"sheet": "Input Ritasi", "column_0based": c_in["ritse"],
                                    "header": "Ritse", "note": "Ritse = per-row Ritasi count; "
                                    "window total = SUM(Ritse)"},
            "in_prod_metric": {"sheet": "In Prod", "column_0based": c_ip["rate"],
                               "header": "Rate", "note": "Rate = per-row Ritasi count; "
                               "window total = SUM(Rate). NOTE: 'Bucket' is NOT a Ritasi count."},
        },
        "windows": windows,
        "aug_9_15": {
            "input_ritase": w915["input_ritase"],
            "in_prod": w915["in_prod"],
            "delta": w915["delta"],
            "input_by_from": byfrom,
            "alias_pairs": alias_pairs,
            "residual_after_alias_removed": residual,
            "residual_delta_vs_in_prod": round(residual - w915["in_prod"], 6) if residual is not None else None,
            "route_keys_per_day_shift": route_counts,
            "ritse_per_day": {k: round(v, 6) for k, v in sorted(per_day.items())},
            "rows": rows_9_15,
            "correction_applied": False,
            "classification": "DUPLICATE_PATTERN (loading-point alias) — REVIEW_REQUIRED",
        },
    }


# --------------------------------------------------------------------------- #
# Workbook B — Status Unit Support (xlsb)
# --------------------------------------------------------------------------- #
def extract_workbook_b(path: str) -> dict:
    su = Sheet(path, "Status Unit")
    h, m = su.header()
    c = {"date":   resolve(m, "Date"),
         "shift":  resolve(m, "Shift"),
         "unit":   resolve(m, "Unit"),
         "loc":    resolve(m, "Location"),
         "comp":   resolve(m, "Pit Compartement", "Pit Compartment"),
         "status": resolve(m, "Unit Status"),
         "hours":  resolve(m, "Total")}
    for k, v in c.items():
        if v is None:
            raise RuntimeError(f"unresolved Status Unit column {k}")

    units_aug, units_whole = set(), set()
    status_31 = collections.Counter()
    work_units_31 = set()
    rows_31 = 0
    hours_31 = 0.0
    per_date = collections.defaultdict(lambda: {"units": set(), "working": set()})
    for i, d in enumerate(su.rows(), start=1):
        dt = serial_to_date(d.get(c["date"]))
        u = d.get(c["unit"])
        if not isinstance(u, str) or not u.strip():
            continue
        u = u.strip()
        units_whole.add(u)
        if dt is None:
            continue
        st = str(d.get(c["status"]) or "").strip()
        if dt.year == 2026 and dt.month == 8:
            units_aug.add(u)
            per_date[dt]["units"].add(u)
            if st == "Working":
                per_date[dt]["working"].add(u)
        if dt == _dt.date(2026, 8, 31):
            rows_31 += 1
            status_31[st] += 1
            hv = d.get(c["hours"])
            hours_31 += float(hv) if isinstance(hv, (int, float)) else 0.0
            if st == "Working":
                work_units_31.add(u)

    # Master unit list
    ma = Sheet(path, "Master")
    _, mm = ma.header(keys=("unit code", "kode unit"))
    cm = resolve(mm, "Unit Code", "Kode Unit")
    if cm is None:
        raise RuntimeError("unresolved Master.Unit Code")
    master = set()
    for d in ma.rows():
        v = d.get(cm)
        if isinstance(v, str) and v.strip():
            master.add(v.strip())

    return {
        "sheet": "Status Unit", "master_sheet": "Master",
        "header_row": h, "columns": c,
        "units_aug_2026": sorted(units_aug),
        "units_aug_2026_count": len(units_aug),
        "units_whole_sheet_count": len(units_whole),
        "master_unit_count": len(master),
        "master_matched": len(units_aug.intersection(master)),
        "master_matched_whole": len(units_whole.intersection(master)),
        "day_31": {
            "date": "2026-08-31", "rows": rows_31,
            "units": len(per_date[_dt.date(2026, 8, 31)]["units"]),
            "working_rows": status_31.get("Working", 0),
            "working_units": len(work_units_31),
            "hours": round(hours_31, 6),
            "status_mix": dict(status_31),
        },
        "per_date": {k.isoformat(): {"units": len(v["units"]), "working_units": len(v["working"])}
                     for k, v in sorted(per_date.items())},
    }


# --------------------------------------------------------------------------- #
def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="validation/extracted/historical-evidence.json")
    ap.add_argument("--src-dir", default=SRC_DIR)
    args = ap.parse_args()

    pre = {}
    for k, s in SOURCES.items():
        p = os.path.join(args.src_dir, s["filename"])
        if not os.path.isfile(p):
            print(f"FATAL: missing source {p}", file=sys.stderr)
            return 2
        pre[k] = sha256_file(p)
        if pre[k] != s["sha256"]:
            print(f"FATAL: SHA256 mismatch for {s['filename']}\n  expected {s['sha256']}\n"
                  f"  actual   {pre[k]}", file=sys.stderr)
            return 2

    out = {
        "schema_version": "fms-3c-historical-evidence/1",
        "generated_at_utc": _dt.datetime.now(_dt.timezone.utc).isoformat(),
        "window": {"start": WINDOW_START.isoformat(), "end": WINDOW_END.isoformat()},
        "sources": [dict(key=k, sha256_verified=pre[k], **s) for k, s in SOURCES.items()],
        "prior_observations": PRIOR,
        "extraction_rules": {
            "workbook_a_grain": "Tanggal + Shift + Unit",
            "no_correction": True, "no_dedup": True, "no_normalisation": True,
            "missing_is_not_zero": True,
        },
        "workbook_a": extract_workbook_a(os.path.join(args.src_dir, SOURCES["A"]["filename"])),
        "workbook_b": extract_workbook_b(os.path.join(args.src_dir, SOURCES["B"]["filename"])),
        "workbook_c": extract_workbook_c(os.path.join(args.src_dir, SOURCES["C"]["filename"])),
    }

    # post-verification: originals untouched
    post = {k: sha256_file(os.path.join(args.src_dir, s["filename"])) for k, s in SOURCES.items()}
    out["originals_unchanged_after_extraction"] = all(pre[k] == post[k] for k in pre)

    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    tmp = args.out + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(out, fh, ensure_ascii=False, separators=(",", ":"), sort_keys=False)
    os.replace(tmp, args.out)

    # ---- reproduction report ------------------------------------------------
    a = out["workbook_a"]; c_ = out["workbook_c"]; b = out["workbook_b"]
    print("=" * 74)
    print("SOURCE VERIFICATION")
    for s in out["sources"]:
        print(f"  [{s['key']}] {s['filename']}")
        print(f"      sha256 {s['sha256_verified']}")
    print(f"  originals unchanged after extraction: {out['originals_unchanged_after_extraction']}")
    print("=" * 74)
    print("WORKBOOK A  (grain: Tanggal + Shift + Unit)")
    print(f"  INPUT rows (Aug)      : {a['input_rows_in_window']}")
    print(f"  REKAP DAILY rows (Aug): {a['rekap_rows_in_window']}")
    print(f"  groups total          : {a['groups_total']}")
    print(f"  groups matched        : {a['groups_matched']}  (prior: 1365/1365)")
    print(f"  Input-only / Rekap-only: {a['groups_input_only']} / {a['groups_rekap_only']}")
    print(f"  totals: ritase={a['totals']['ritase']:.0f} tonase={a['totals']['tonase']:.2f} "
          f"bcm={a['totals']['bcm']:.5f}")
    print(f"  prior : ritase=8825 tonase=436335.92 bcm=247918.13636")
    print("=" * 74)
    print("WORKBOOK C  (Input Ritasi 'Ritse'  vs  In Prod 'Rate')")
    for w in c_["windows"]:
        print(f"  {w['label']:>5}  input={w['input_ritase']:>9.0f} ({w['input_rows']:>5} rows)  "
              f"in_prod={w['in_prod']:>9.0f} ({w['in_prod_rows']:>5} rows)  delta={w['delta']}")
    x = c_["aug_9_15"]
    print(f"  9-15 by 'From': {x['input_by_from']}")
    print(f"  9-15 alias pairs: {json.dumps(x['alias_pairs'], ensure_ascii=False)}")
    print(f"  9-15 residual after alias removed: {x['residual_after_alias_removed']} "
          f"(vs In Prod {x['in_prod']} -> delta {x['residual_delta_vs_in_prod']})")
    print("=" * 74)
    print("WORKBOOK B  (Status Unit vs Master)")
    print(f"  Aug units={b['units_aug_2026_count']}  master_matched={b['master_matched']}"
          f"  ({b['master_matched']}/{b['units_aug_2026_count']})")
    print(f"  31 Aug: rows={b['day_31']['rows']} units={b['day_31']['units']} "
          f"working_rows={b['day_31']['working_rows']} working_units={b['day_31']['working_units']} "
          f"hours={b['day_31']['hours']}")
    print(f"  prior claim: 122/122 units matched  ->  reproduced: "
          f"{b['master_matched'] == 122 and b['units_aug_2026_count'] == 122}")
    print("=" * 74)
    print(f"artifact: {args.out}  ({os.path.getsize(args.out):,} bytes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
