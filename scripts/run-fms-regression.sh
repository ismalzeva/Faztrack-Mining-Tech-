#!/usr/bin/env bash
# Jalankan suite regresi FMS (frozen) dengan FMS_DATABASE_URL dari resolver KANONIK.
#
# Kenapa ada script ini:
#   - lib/fms/telemetry-pipeline.ts membaca FMS_DATABASE_URL saat INISIALISASI modul
#     (bukan saat dipanggil). Suite frozen mengharapkan variabel ini ada, jika tidak → throw.
#   - Nilai koneksi diambil dari lib/fms/database-url.ts (resolveFmsDatabaseUrl()) —
#     SATU jalur konfigurasi yang sama dengan produksi. Tidak ada jalur kedua,
#     tidak ada kredensial hardcoded, dan nilai tidak pernah dicetak.
#
# Pakai:
#   bash scripts/run-fms-regression.sh            # semua file (default)
#   bash scripts/run-fms-regression.sh <file...>  # file tertentu
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ ! -f .env ]]; then
  echo "FATAL: .env tidak ada (wajib, mode 600, gitignored)" >&2
  exit 2
fi
set -a; . ./.env; set +a

FILES=("$@")
if [[ ${#FILES[@]} -eq 0 ]]; then
  FILES=(
    tests/fms-phase2-pipeline.test.ts
    tests/fms-phase3a-geofence.test.ts
    tests/fms-phase3b-cycle.test.ts
    tests/fms-phase3c-historical.test.ts
    tests/fms-persistence.test.ts
    tests/fms-traccar-adapter.test.ts
  )
fi

# Jalur konfigurasi tunggal (kanonik) — bukan duplikasi logika.
FMS_DATABASE_URL="$(
  node --import tsx --input-type=module -e \
    'import { resolveFmsDatabaseUrl } from "./lib/fms/database-url.ts"; process.stdout.write(resolveFmsDatabaseUrl());'
)"
export FMS_DATABASE_URL

# WAJIB: jalankan di dalam scope memori sendiri.
# Tanpa ini, suite berat (Phase 3C) memicu tekanan memory.high cgroup gateway sehingga
# kanal IPC node:test-runner terpotong, dan muncul kegagalan PALSU:
#   "Unable to deserialize cloned data due to invalid or unsupported version."
# Terbukti 2026-09-11: tanpa scope → crash di ~247 s tanpa hasil valid;
#                      dengan scope → 43/43 PASS dalam ~57 s.
# Kegagalan yang sama juga muncul di HEAD P1 (74753fb) → bukan regresi kode.
if command -v systemd-run >/dev/null 2>&1; then
  exec systemd-run --user --scope --collect -q \
    -p MemoryHigh=800M -p MemoryMax=2G -p TasksMax=512 \
    node --import tsx --test "${FILES[@]}"
else
  exec node --import tsx --test "${FILES[@]}"
fi
