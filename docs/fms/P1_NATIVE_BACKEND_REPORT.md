# P1 — NATIVE NODE OPERATIONAL BACKEND (FMS DEVICE-READY PRE-POC)

**Status: P1 COMPLETE — awaiting Owner review. P2 NOT started.**
**Date:** 2026-09-10
**Branch:** `feat/fms-b001-canonical-event-contract`
**HEAD:** `7fa1309d480bd43bba242c0405c91fc8ec559287` (unchanged — P1 work is uncommitted)
**Scope authority:** skill `FAZTRACK_FMS_DEVICE_READY_PREPOC` v1.0, §22 (P1 only)
**North Star:** DIGITAL MIRROR + MACHINE EVIDENCE + AUTOMATION + OPERATIONAL VISIBILITY.
Client process (Plan / P2H / Shift Assignment) remains HUMAN_AUTHORITY — not reengineered.

---

## 1. Architecture implemented

The **postgres-js TCP driver provably cannot load through the Cloudflare-targeted
Vinext bundle** — it always resolves its Cloudflare target and dies under Node with
`ERR_UNSUPPORTED_ESM_URL_SCHEME: Received protocol 'cloudflare:'`. Proven inside
`postgres` itself, not at the credentials layer.

Therefore P1 implements the skill's intent as a **native Node operational backend as a
separate process inside the same product** (no microservice, no new product boundary):

```
Vinext route handler (transport only)
  → lib/fms/backend-proxy.ts  forwardToFmsBackend()
    → http://127.0.0.1:3097  (native Node, direct PostgreSQL/PostGIS)
      → lib/fms/operational-api.ts  (ALL business semantics live here)
        → db/index.ts → resolveFmsDatabaseUrl() → postgres-js (node target)
```

- **Semantics are centralized**, not duplicated: `lib/fms/operational-api.ts` owns the
  operation registry and validation messages.
- **Vinext routes are pure transport**: status code and body pass through unchanged.
- **Backend down is reported, never faked**: proxy returns `503 {"error":"fms_backend_unavailable"}`.

## 2. Service and port

| Property | Value |
|---|---|
| Unit | `faztrack-fms-api.service` (systemd **user** unit) |
| State | **active + enabled** |
| Bind | **`127.0.0.1:3097` only — loopback, NOT publicly exposed** |
| Runtime | `node server/build/fms-api.mjs` (esbuild bundle, deps external) |
| Env | `.env` via `EnvironmentFile` (mode 600, gitignored) |
| Build artifact | `server/build/fms-api.mjs` (gitignored — `.gitignore:49`) |

## 3. Existing endpoints tested

All 7 documented operations, exercised over real HTTP:

| Endpoint | GET | POST |
|---|---|---|
| `/health` | ✅ 200 | — |
| `/api/fms/assignments` | ✅ 200 | ✅ 201 |
| `/api/fms/events` | ✅ 200 | ✅ 201 |
| `/api/fms/p2h` | ✅ 200 | ✅ 201 |

Transport discipline: unknown path → **404**, `PUT`/`DELETE` → **405**, malformed JSON → **400**.

## 4. HTTP evidence

P1 acceptance verifier: **42/42 PASS** (read + transport + validation + write + clean-up).
Transport-layer verifier against the live backend: **16/17** — the single mismatch is a
harness expectation error of mine (I asserted the single-field message `"tanggal wajib
diisi"` while sending three missing fields; the handler's original combined message
`"Tanggal, Shift, Unit, dan Keputusan P2H wajib diisi"` came back **verbatim**).

Original validation strings preserved unchanged and confirmed over the wire:
`"tanggal wajib diisi"`, `"shift wajib diisi"`, `"Keputusan P2H tidak dikenal"`,
`"event_type tidak dikenal"`, `"canonical event belum lengkap"`.

Dead-backend behaviour: **`503 fms_backend_unavailable`** — never an empty success,
never a fabricated value.

## 5. PostgreSQL evidence (direct, not through the API)

Rows written through the API were read back with **`psql` directly**:

```
created_at 2026-09-10 15:44:05.032  (server now)
waktu      2026-09-10 03:15:00       ← ORIGINAL supplied instant preserved
received_at 2026-09-10 03:15:07      ← ORIGINAL supplied instant preserved
```

`waktu` retaining the **supplied** instant (not `now()`) is the proof that no timestamp
was invented. Post-cleanup state is byte-identical to baseline:

```
Baseline (before P1 write tests): events=3032  assignments=0  p2h=0
Final    (after cleanup):         events=3032  assignments=0  p2h=0
Residue (P1-% rows):              p2h=0  assignments=0  events=0
```

Cleanup touched **only** P1 test rows, by primary key / marker prefix. No unrelated FMS
data was modified. `fms_canonical_events` (3,032 rows) is untouched.

## 6. Security / network boundary

- Backend listens on **127.0.0.1:3097 only**; `ss -ltnp` shows no external bind.
- Hardening active in the unit: `NoNewPrivileges`, `ProtectSystem=full`, empty
  `CapabilityBoundingSet`, `MemoryMax=512M`.
- **Credentials exist only in `.env`** (mode 600, gitignored — `git check-ignore` confirms).
  `.env` is **not** tracked by git.
- **No secret value appears in any tracked file, any P1 file, or the build artifact** —
  verified by value-matching against the live `.env`, not by pattern guessing.
- The one hit reported by the scanner is the **non-secret local placeholder email**
  `fms-admin@faztrack.local`, already present in `lib/fms/telemetry-pipeline.ts` and two
  pre-existing test files (phases 3A/3B). It is a default, not a credential. No P1 file
  contains it, and neither password is leaked anywhere.

## 7. Files changed

**New (P1):**

| File | Lines | Role |
|---|---|---|
| `lib/fms/operational-api.ts` | 254 | Semantics + operation registry (the only DB-aware layer) |
| `lib/fms/database-url.ts` | 41 | Single source of truth for connection URL resolution |
| `lib/fms/backend-proxy.ts` | 39 | Transport-only forwarder to loopback backend |
| `server/fms-api.ts` | 191 | Native Node HTTP server (7 operations) |
| `server/build/fms-api.mjs` | — | esbuild artifact (gitignored) |
| `docs/fms/P1_NATIVE_BACKEND_REPORT.md` | — | this report |

**Modified (uncommitted; `git diff --numstat`):**

```
3   0   .gitignore
12 40   app/api/fms/assignments/route.ts
13 40   app/api/fms/events/route.ts
13 40   app/api/fms/p2h/route.ts
4   5   db/index.ts
```

Each route lost ~40 lines of inline DB logic and gained ~12 lines of transport; the net
removal is the duplicated database code, now owned in exactly one place.

**Root cause of the write-path failure:** `db/schema.ts` declares every `timestamp`
column with `mode: 'date'`, but the **original handler passed ISO strings**, so Drizzle
called `.toISOString()` on a string. This was a **latent bug in the pre-existing handler**,
previously masked by the runtime blocker. Fixed by converting at the three call-sites via
the existing `toDate()` helper — **no schema change, no fallback timestamp, no weakened
validation**; an unparseable timestamp fails validation (`400`) instead of being replaced.

## 8. Tests / regression results

Full existing regression over all six test files:

```
# tests 131   # pass 130   # fail 1
```

| Suite | Result |
|---|---|
| Phase 2 pipeline | ✅ PASS |
| Phase 3A geofence | ✅ PASS |
| Phase 3B cycle | ✅ PASS |
| Phase 3C historical | ✅ PASS — incl. **T13/T14/T15 REAL parity** and **T22** |
| Traccar adapter | ✅ PASS |
| Persistence | ❌ 1 failure — **pre-existing, not a P1 regression** |

**Honest analysis of the single failure** — `tests/fms-persistence.test.ts` dies with a
Node test-runner IPC error (`Unable to deserialize cloned data`, `uncaughtException`),
triggered by *"generated asynchronous activity after the test ended"* with
*"terminating connection due to administrator command"*: another test file's fixture
teardown kills the pooled connection while the persistence test is still finishing.

Proof it is pre-existing and **not** caused by P1: the identical batch was run at
**HEAD `7fa1309` in a detached worktree** and `fms-persistence.test.ts` failed there with
the same error class. P1 does not touch `tests/fms-persistence.test.ts`, `db/schema.ts`,
or anything it imports. The regression tests are frozen (§21) and were **not modified** —
`git diff -- tests/` is empty. Fixing this test-isolation defect is **not** P1 scope.

Also verified in that HEAD worktree: with the workbooks absent, T13/T14/T15 **fail closed**
rather than fabricating evidence — the §16 gate behaves correctly in the negative direction.

## 9. Business semantics unchanged — confirmation

**No diff on any frozen file** (`git diff --stat` empty):
`lib/fms/cycle-engine.ts`, `lib/fms/geofence-engine.ts`, `lib/fms/persistence.ts`,
`lib/fms/historical-replay.ts`, `lib/fms/telemetry-pipeline.ts`, `db/schema.ts`,
`scripts/extract-historical-workbooks.py`, all of `drizzle/`, all of `tests/`.

Scanned P1 code for forbidden concepts (`VERIFIED_RITASI`, `RITASI`, `PRODUCTION_FORECAST`,
`OFFICIAL_PRODUCTION`, `UNIT_OFFLINE`, `IS_BREAKDOWN`, `SLIPPERY`, `FUEL_CONSUMED`,
`AUTO_STATUS`) → **none present**.

Therefore: **no Ritasi authority change** (remains `HOLD / REVIEW`) · **no production
inference added** · **no Phase 2/3A/3B/3C engine logic changed** · service remains
**loopback-only on 127.0.0.1:3097** · **no secret committed**. All fixed semantics hold:
`COMMUNICATION_OFFLINE ≠ UNIT_OFFLINE ≠ STANDBY ≠ BREAKDOWN ≠ NOT_WORKING`,
`CYCLE_CANDIDATE ≠ RITASI ≠ VERIFIED_RITASI ≠ PRODUCTION`, `FUEL_ISSUED ≠ FUEL_CONSUMED`,
`RAIN ≠ SLIPPERY`.

## 10. Proposed P2 action

**Nothing yet — P2 is not started and not authorized.**

One item needs an explicit Owner decision before it can happen, because it is a
**deployment**, not a P1 change:

> The public Vinext app on **:3099 still returns 500** for the three FMS endpoints, because
> it is running the previously built bundle. The P1 transport layer is verified in-process
> against the live backend, but switching the public path over requires rebuilding and
> restarting `faztrack-minetech.service`. That is a deploy step outside P1 scope, so it
> was **not** performed.

| Path | `GET /api/fms/events` | `GET /api/fms/assignments` | `GET /api/fms/p2h` |
|---|---|---|---|
| `127.0.0.1:3097` (P1 backend) | **200** | **200** | **200** |
| `127.0.0.1:3099` (public app) | 500 | 500 | 500 |

**Requested Owner decision:** authorize a separate, Owner-reviewed run to rebuild +
restart `faztrack-minetech.service` so the public app picks up the transport proxy.

---

**No commit was created.** HEAD is still `7fa1309`; all P1 changes sit uncommitted in the
working tree for review. Untracked items deliberately left alone: `static/` (pre-existing
Sep 3–4 assets, unrelated to P1) and `docs/fms/PREBUILD_FMS-HW-POC-01.md` (superseded
prebuild report).
