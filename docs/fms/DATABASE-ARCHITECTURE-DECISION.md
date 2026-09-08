# FAZTRACK FMS — DATABASE ARCHITECTURE DECISION REPORT

**Date:** 2026-09-08
**Status:** OWNER_APPROVED — PostgreSQL on Faztrack VPS
**Decision Date:** 2026-09-08
**Prepared by:** Hermes (Personal Assistant)

---

## 1. EXISTING ARCHITECTURE FINDINGS

### 1.1 Mengapa Existing Implementation Menggunakan Cloudflare D1?

**Temuan: D1 BUKAN intentional architecture decision.**

Repository `ismalzeva/Faztrack-Mining-Tech-` dimulai dari **vinext-starter** — template resmi Cloudflare untuk Next.js on Cloudflare Workers/Pages. D1 adalah database default dari template tersebut.

Evidence:
- `README.md` baris 1: `# vinext-starter — A clean full-stack starter running on vinext, with optional Cloudflare D1 and Drizzle support.`
- `package.json`: dependencies `vinext`, `@cloudflare/vite-plugin`, `wrangler`
- `vite.config.ts`: memuat `.openai/hosting.json` untuk D1 binding
- `db/index.ts`: `import { env } from "cloudflare:workers"` — hardcoded ke Cloudflare Workers env
- `drizzle.config.ts`: `dialect: "sqlite"` (D1-compatible)
- `.openai/hosting.json`: `"d1": null` — binding tidak pernah di-setup

**Kesimpulan:** ChatGPT membangun FMS di atas template vinext. D1 dipilih oleh template, bukan oleh evaluasi workload mining.

### 1.2 Infrastructure Faztrack Existing di VPS

| Resource | Detail |
|----------|--------|
| **VPS** | Ubuntu 22.04, 2 CPU, 7.4GB RAM (6.1GB available), 79GB disk (30GB free) |
| **PostgreSQL** |2 Docker containers, masing-masing ~25MB RAM |
| ├ metro-postgres | `:5436` — PostgreSQL 16 Alpine (Attendance) |
| └ audit-bubur-fay-pg | `:5438` — PostgreSQL 16 Audit (Bubur Fay) |
| **MEI Backend** | FastAPI + SQLAlchemy + SQLite (`mei_demo.db`), port 8000 |
| **MEI Frontend** | Next.js, port 3003 |
| **Traccar** | **BELUM TERINSTALL** (tidak ada container/service/directory) |
| **Redis** | Tidak ada |
| **Other** | Meilisearch (:7700), various Flask apps |

### 1.3 Deployment Architecture

| Component | Stack | Database |
|-----------|-------|----------|
| MEI Backend | FastAPI (Python) | SQLite (SQLAlchemy) |
| MEI Frontend | Next.js | — |
| Faztrack Attendance | FastAPI + Next.js | PostgreSQL (Docker) |
| Audit Bubur Fay | Flask | PostgreSQL (Docker) |
| FMS (current) | Next.js on vinext/Cloudflare Pages | D1 (not provisioned) |

**Pattern yang konsisten:** Semua project existing berjalan di VPS, menggunakan PostgreSQL atau SQLite. Tidak ada yang menggunakan Cloudflare D1.

---

## 2. FMS WORKLOAD ANALYSIS

### 2.1 Data Flow Architecture

```
FMC650/FMB130 (Hardware)
    ↓ (cellular/satellite)
Traccar Server (GPS/HM/KM/ignition/fuel)
    ↓ (Traccar API / webhooks)
Traccar Adapter (normalize)
    ↓
RAW TELEMETRY (high-frequency, timestamp+unit+lat+lon+speed+hm+km+ignition+fuel)
    ↓ normalize + contextualize
NORMALIZED TELEMETRY (with shift/date/site context)
    ↓ business logic
FMS OPERATIONAL EVENTS (assignments, P2H, hourly control)
    ↓ canonical contract
CANONICAL FMS OUTPUT (event_type, authority, payload)
    ↓
MEI Input (analytics, KPI, intelligence)
```

### 2.2 Write Pattern

| Data Type | Frequency | Volume (100 units) | Volume (1000 units) |
|-----------|-----------|---------------------|----------------------|
| Raw telemetry | per 10-30 detik | ~10K writes/jam | ~100K writes/jam |
| Normalized telemetry | per menit | ~6K writes/jam | ~60K writes/jam |
| Canonical events | per event | ~500-2K/hari | ~5K-20K/hari |
| Shift assignments | per shift (2x/hari) | ~200/hari | ~2K/hari |
| P2H checks | per shift (2x/hari) | ~200/hari | ~2K/hari |
| Hourly control | per jam | ~2.4K/hari | ~24K/hari |

### 2.3 Query Pattern

| Query Type | Contoh | Frequency |
|------------|--------|-----------|
| **Time-series** | "HM unit EX-501 dari 1-7 Sep" | Tinggi |
| **Geospatial** | "Unit dalam geofence Pit A" | Tinggi |
| **Latest state** | "Status terakhir semua unit" | Tinggi |
| **Aggregation** | "Total ritasi per loader per shift" | Sedang |
| **Historical** | "Trend fuel consumption 3 bulan" | Rendah |
| **Join** | "P2H → Assignment → Event untuk unit X" | Sedang |

---

## 3. EVALUATION MATRIX

| Criteria | Option A: Cloudflare D1 | Option B: PostgreSQL (VPS) |
|----------|------------------------|---------------------------|
| **Compatibility with current code** | ✅ Sudah di-setup (Drizzle/sqlite dialect) | ⚠️ Perluubah dialect + driver |
| **Traccar integration** | ⚠️ Traccar di VPS, D1 di Cloudflare — latency | ✅ Co-located, low latency |
| **Telemetry write pattern** | ❌ High-frequency writes queued, single-writer bottleneck for fleet-scale telemetry | ✅ Full MVCC, row-level locking, designed for high-throughput ingestion |
| **Concurrent writes** | ❌ Single-writer, queue-based | ✅ Full MVCC, row-level locking |
| **Historical telemetry** | ⚠️ Storage constrained for high-volume fleet telemetry over months | ✅ 30GB available, expandable |
| **Time-series query** | ❌ No native support, manual indexing | ✅ Indexes, window functions, future TimescaleDB |
| **Geospatial query** | ❌ No PostGIS, manual haversine | ✅ PostGIS extension available |
| **Multi-site scaling** | ⚠️ Perlu D1 per region? | ✅ Single DB, site_id partitioning |
| **Backup/recovery** | ⚠️ Cloudflare-managed, no pg_dump | ✅ Full control, pg_dump, WAL archiving |
| **Data ownership** | ❌ Data di Cloudflare infra | ✅ Data di VPS Ismal |
| **Latency (VPS→DB)** | ⚠️ ~50-100ms (internet) | ✅ ~1ms (localhost) |
| **Offline/site connectivity** | ❌ Butuh internet ke Cloudflare | ⚠️ Butuh internet ke VPS (sama) |
| **MEI integration** | ❌ MEI di VPS, D1 di Cloudflare — cross-network | ✅ Same VPS, bisa share DB atau local network |
| **Operational complexity** | ⚠️ Wrangler auth, Cloudflare dashboard | ✅ Sudah familiar, Docker pattern existing |
| **Infrastructure cost** | ✅ Free tier (tapi limit ketat) | ✅ Existing VPS, marginal cost ~0 |
| **Migration effort** | ✅ Tidak perlu (status quo) | ⚠️ Medium:ubah dialect, buat Docker PG, migrate schema |
| **Vendor lock-in** | ❌ Cloudflare Workers + D1 + Wrangler | ✅ PostgreSQL = universal, portable |
| **Future analytics/AI** | ❌ Tidak bisaJOIN besar, no window functions | ✅ Full SQL, bisa materialized views, future ML pipeline |

### Skor

| Option | Compatible | Scalable | Operational | Total |
|--------|-----------|----------|-------------|-------|
| **A: D1** | 8/10 | 2/10 | 4/10 | **14/30** |
| **B: PostgreSQL** | 6/10 | 9/10 | 9/10 | **24/30** |

---

## 4. ARCHITECTURE DIAGRAM

### Recommended: PostgreSQL on Existing VPS

```
┌─────────────────────────────────────────────────────────────┐
│                        VPS (43.134.112.7)                    │
│                                                              │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐   │
│  │  Traccar      │    │  FMS Backend │    │  MEI Backend │   │
│  │  (to deploy)  │───▶│  (Next.js)   │───▶│  (FastAPI)   │   │
│  │  :8082        │    │  :TBD        │    │  :8000       │   │
│  └──────┬───────┘    └──────┬───────┘    └──────┬───────┘   │
│         │                   │                   │            │
│         ▼                   ▼                   ▼            │
│  ┌──────────────────────────────────────────────────────┐   │
│  │              PostgreSQL (Docker)                       │   │
│  │              fms-postgres :5437                        │   │
│  │                                                        │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌──────────────┐ │   │
│  │  │ Raw Telemetry│  │ FMS Ops     │  │ Canonical    │ │   │
│  │  │ (high-freq)  │  │ Tables      │  │ Events       │ │   │
│  │  │              │  │             │  │              │ │   │
│  │  │ fms_telemetry│  │ fms_units   │  │ fms_canonical│ │   │
│  │  │ (partitioned)│  │ fms_shifts  │  │ _events      │ │   │
│  │  │              │  │ fms_p2h     │  │              │ │   │
│  │  │              │  │ fms_hourly  │  │              │ │   │
│  │  └─────────────┘  └─────────────┘  └──────────────┘ │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│  Existing: metro-postgres(:5436), audit-bubur-fay-pg(:5438) │
└─────────────────────────────────────────────────────────────┘
```

### Data Pipeline (Layered Architecture)

```
LAYER 1: RAW TELEMETRY
  fms_raw_telemetry (partitioned by date)
  ─ timestamp, unit_id, lat, lon, speed, ignition, hm, km, fuel, raw_payload
  ─ Write: high-frequency (10-30s per unit)
  ─ Retention: 90 days raw, then archive

LAYER 2: NORMALIZED TELEMETRY
  fms_normalized_events
  ─ + shift context, site context, geofence match
  ─ Derived from Layer 1 + shift assignments + geofences

LAYER 3: FMS OPERATIONAL EVENTS
  fms_units, fms_shift_assignments, fms_p2h_checks, fms_hourly_control
  ─ Human-entered or derived from telemetry
  ─ Source of truth for operational decisions

LAYER 4: CANONICAL FMS OUTPUT
  fms_canonical_events
  ─ Contract: event_type, authority_status, payload
  ─ Consumed by MEI
  ─ Idempotent (conflict-do-nothing)
```

---

## 5. MIGRATION IMPACT

### 5.1 Code Changes Required

| Component | Change | Effort |
|-----------|--------|--------|
| `db/index.ts` | Ubah dari `cloudflare:workers` env ke `@neon/serverless` atau `pg` driver | Kecil |
| `db/schema.ts` | Ubah `sqliteTable` → `pgTable`, tipe `text` → `varchar`/`uuid`, `real` → `numeric`, `integer` → `boolean` | Sedang |
| `drizzle.config.ts` | `dialect: "postgresql"`, connection string | Kecil |
| `lib/fms/persistence.ts` | Tidak perluubah (Drizzle abstract dialect) | Tidak ada |
| `app/api/fms/*` | Tidak perluubah (sudah pakai Drizzle ORM) | Tidak ada |
| `.openai/hosting.json` | Tidak relevan lagi (bukan Cloudflare Pages) | N/A |
| `vite.config.ts` | Hapus D1 binding, pakai standard Vite | Kecil |
| `package.json` | Tambah `pg`, `@types/pg`, hapus `wrangler`, `@cloudflare/vite-plugin` | Kecil |
| Docker | Buat `fms-postgres` container (copy pattern metro-postgres) | Kecil |

### 5.2 Effort Estimate

| Task | Time |
|------|------|
| Create Docker PostgreSQL container | 15 menit |
| Update Drizzle schema (sqlite→pg) | 1-2 jam |
| Update DB connection layer | 30 menit |
| Add `fms_raw_telemetry` table | 1 jam |
| Generate & apply migration | 30 menit |
| Test persistence (8 scenarios) | 1-2 jam |
| **Total** | **4-6 jam** |

### 5.3 Risks

| Risk | Mitigation |
|------|-----------|
| Schemaubah breaking existing data | Tidak ada data existing (D1 belum provisioned) |
| Drizzle sqlite→pg incompatibility | Drizzle mendukungkedua dialect, migration relatif mudah |
| VPS resource exhaustion | PG container ~25MB RAM, masih6GB available |
| Traccar latency | Co-located di VPS sama, ~1ms |

---

## 6. RECOMMENDATION

### RECOMMEND: B — PostgreSQL on Existing VPS

**Alasan Arsitektur:**

1. **Telemetry workload characteristics:** FMS memproses high-frequency telemetry (10-30 detik per unit). D1 adalah single-writer database dengan queue-based writes — tidak dirancang untuk fleet-scale real-time ingestion. PostgreSQL dengan MVCC dan row-level locking menangani concurrent writes secara native.

2. **PostgreSQL/PostGIS suitability:** FMS membutuhkan time-series queries (HM/KM trends), geospatial queries (unit dalam geofence), dan aggregation (ritasi per loader per shift). PostgreSQL mendukung semua ini secara native — indexes, window functions, materialized views — plus PostGIS untuk geospatial. D1 tidak memiliki kemampuan ini.

3. **Co-location with Traccar/FMS:** Traccar, FMS backend, dan MEI backend semua berjalan di VPS yang sama. Database di Cloudflare berarti 50-100ms latency per write dari VPS ke internet, vs ~1ms localhost PostgreSQL. Untuk high-frequency telemetry, ini perbedaan signifikan.

4. **Time-series capability:** PostgreSQL mendukung window functions, CTEs, dan bisa upgrade ke TimescaleDB untuk time-series optimization. D1 tidak memiliki native time-series support.

5. **Infrastructure consistency:** Semua project Faztrack existing (Attendance, Audit Bubur Fay, MEI) menggunakan PostgreSQL atau SQLite di VPS. Tidak ada yang menggunakan Cloudflare D1. Konsistensi infrastructure mengurangi operational complexity.

6. **Data control:** Data mining operations sensitif (lokasi unit, ritasi, fuel consumption). Data di VPS sendiri = kontrol penuh atas backup, recovery, access control, dan compliance. Data di Cloudflare = dependency pada pihak ketiga.

7. **MEI integration:** MEI dan FMS di VPS sama, bisa berbagi database atau local network. Cross-cloud integration (Cloudflare D1 → VPS MEI) akan menambah latency dan complexity yang tidak perlu.

8. **Reduced unnecessary vendor dependency:** D1 memerlukan Wrangler authentication, Cloudflare Workers binding, dan Cloudflare dashboard untuk management. PostgreSQL di Docker = standard tooling, familiar, portable.

**Trade-off yang diterima:**
- Perlu effort 4-6 jam untuk migrate schema dari sqlite→pg dialect
- Perlu manage satu lagi Docker container (tapi pattern sudah ada)
- Tidak bisa deploy ke Cloudflare Pages (perlu deploy ke VPS atau standard hosting)

---

## 7. RECOMMENDED NEXT MILESTONE

### Phase 1: Database Foundation (Owner approve → eksekusi)
1. Create `fms-postgres` Docker container (port 5437)
2. Migrate Drizzle schema: sqlite → postgresql dialect
3. Add `fms_raw_telemetry` table (high-frequency writes)
4. Generate migration SQL
5. Apply migration
6. Verify 5 existing tables + 1 new table

### Phase 2: Persistence Gate (setelah Phase 1)
7. Jalankan 8 E2E persistence tests
8. Verify idempotent writes
9. Verify cross-unit isolation

### Phase 3: Traccar Integration (setelah Phase 2)
10. Install Traccar di VPS
11. Configure FMC650 → Traccar
12. Build Traccar → FMS pipeline

---

## 8. DECISION

```
╔══════════════════════════════════════════════════════════════════╗
║  OWNER DECISION: PostgreSQL on Faztrack VPS (APPROVED)          ║
║                                                                  ║
║  D1 REJECTED — not due to universal limits, but because          ║
║  PostgreSQL is architecturally superior for FMS workload:        ║
║  telemetry characteristics, co-location, time-series,            ║
║  PostGIS, data control, MEI integration, reduced vendor lock.    ║
╚══════════════════════════════════════════════════════════════════╝
```

**OWNER DECISION RECEIVED 2026-09-08. PROCEEDING TO IMPLEMENTATION.**
