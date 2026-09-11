# P2 — DEVICE READY PRE-POC: LAPORAN GATE

**Tanggal:** 2026-09-11
**Branch:** `feat/fms-b001-canonical-event-contract`
**Commit kode P2:** `3595e41` (di atas P1 `74753fb` — P1 tidak diamend)
**Klasifikasi status:** `P2 = COMPLETE (SOFTWARE/PROTOCOL)` — dengan satu item fisik terbuka:
`REAL_DEVICE_PHYSICAL_TEST = PENDING` (perangkat FMC650 belum tiba; tidak difabrikasi).
**P3:** **TIDAK dimulai** (sesuai perintah Owner).

---

## 1. Protokol ingress FMC650 → Traccar

**Terverifikasi:** port **TCP 5027 = handler Teltonika**.

Bukti: handshake nyata dikirim ke `127.0.0.1:5027` dan ke `43.134.112.7:5027` —
paket berupa 2 byte panjang IMEI (big-endian) + IMEI ASCII. Balasan:

| IMEI dikirim | Balasan | Arti |
|---|---|---|
| belum terdaftar | `0x00` | perangkat tidak dikenal |
| terdaftar | `0x01` | perangkat dikenali, siap menerima AVL |

Port lain di container yang sama (bukan ingress FMC650): `5055` = OsmAnd, `5150` = protokol lain,
`8082` = web/API Traccar. `traccar.xml` tidak memuat blok `<entry>` protokol → semua handler default aktif.

## 2. Endpoint publik & port

| Endpoint | Nilai | Status |
|---|---|---|
| Host publik perangkat | `43.134.112.7` | dipakai perangkat |
| Port ingress | `5027/tcp` | **OPEN dari internet** (wajib — perangkat di lapangan) |
| Port aplikasi publik | `3099` (via `minetech.gofaztrack.com`) | OPEN (sesuai desain) |
| Backend FMS internal | `127.0.0.1:3097` | **loopback-only** — refused dari internet 6/6 |
| Postgres FMS | `5439` | **tertutup dari internet** (lihat bagian 3) |
| Traccar web/API | `8082` | internal |

Diuji dari **vantage eksternal** (VPS produksi `43.163.7.128`, IP publik berbeda):
`5027` OPEN · `3099` OPEN · `3097` CLOSED · `5439` CLOSED.

## 3. Bukti jaringan & firewall

**FINDING-01 (ditemukan & diperbaiki di P2):** Postgres FMS `5439` **terbuka ke internet**.
Akar masalah: Docker mempublikasikan `5432/tcp → 0.0.0.0:5439`, sementara `ufw` tidak aktif
dan policy `INPUT` = ACCEPT (jadi tidak ada lapisan pemblokir).

**Perbaikan (tanpa downtime, tanpa restart container):**
```
iptables -I DOCKER-USER 1 -i eth0 -m conntrack --ctorigdstport 5439 -j DROP
```
Dipulihkan otomatis di setiap boot + idempoten lewat unit systemd
`fms-pg-network-hardening.service` (enabled + active, `RemainAfterExit=yes`, dedup sebelum menambah).

**Bukti bahwa pengamannya benar-benar rule ini** (uji hapus → pulih):

| Langkah | Rule DOCKER-USER | Hasil probe eksternal |
|---|---|---|
| awal | ada | **CLOSED** |
| rule dihapus | kosong | **OPEN** ← membuktikan rule inilah yang menutup |
| unit di-restart | ada kembali | **CLOSED** |
| restart berulang | tetap **1** rule | CLOSED |

**Catatan ketahanan (jujur):** aturan ini bertahan saat container/service restart dan saat reboot
(unit enabled). Yang belum tertutup: bila seseorang (atau tool firewall lain) **membersihkan
iptables saat runtime**, aturan hilang sampai boot berikutnya. Rekomendasi (di luar P2):
tambahkan pemeriksaan berkala yang memverifikasi ulang aturan ini.

## 4. Desain & implementasi device binding (vendor-agnostik)

**Prinsip:** FMC650 = **DEVICE #1, bukan arsitektur**. Vendor hanya boleh diinterpretasi di
batas adapter/source. Perangkat baru = konfigurasi/registry baru — **tanpa** perubahan kontrak
Fleet UI / Geofence / Cycle / CCR / MEI.

Implementasi:
- `drizzle/0005_fms_device_registry.sql` — tabel `fms_device_registry`, 19 kolom.
- `lib/fms/device-registry.ts` — `loadDeviceBindings()`, `recordDevicePacket()`,
  binding `{traccarDeviceId, uniqueId, unit, vendor, model, protocol, transport, sourceType, sourceName}`.
- `lib/fms/traccar-adapter.ts` — `TraccarDeviceBinding` + `sourceType`/`sourceName`
  (backward compatible; default tetap perilaku P1).
- `lib/fms/telemetry-pipeline.ts` — `loadRegisteredDevices()` menarik registry;
  ekspor ingest-only **aditif** (meng-ingest baris `tc_positions` nyata tanpa menyuntik telemetri simulator).

**Bukti bahwa registry benar-benar agnostik (dievaluasi, bukan diklaim):**

| Pertanyaan | Hasil |
|---|---|
| Ada kolom khusus merek? | **Tidak** — grep `teltonika` di skema/registry: nol kolom khusus |
| Vendor/model/protokol disimpan sebagai apa? | **DATA** (bukan kolom khusus, bukan percabangan kode) |
| String vendor dipetakan ke mana? | ke union `FmsSourceType` yang **tertutup**, ada allow-list + fallback fail-closed |
| Wajib lewat Traccar? | **Tidak** — `traccar_device_id` / `traccar_unique_id` **nullable**, jadi perangkat non-Traccar (mis. logger CAN via upload) tetap bisa diwakili |
| Vendor non-FMC650 diterima? | **Ya** — `bind-device --dry-run --vendor ruptela --model FM-Eco4 --protocol ruptela` diterima, **0 baris tertulis** (dry-run terbukti tidak menulis: registry 0→0, unit uji tidak berubah) |

## 5. Prosedur commissioning (untuk saat perangkat fisik tiba)

Dokumen: **`docs/fms/FMC650_PREPOC_COMMISSIONING.md`** (294 baris, 14 bagian) —
endpoint terverifikasi, registrasi IMEI sebelum pemasangan, instalasi fisik, Configurator,
first handshake, first AVL packet, verifikasi Traccar, raw telemetry, canonical event/FMS,
uji offline & pemulihan, CAN/J1939 ditunda, troubleshooting, ringkasan bukti.

Soal hardware (pinout power/GND/IGN, antena GNSS/LTE, APN/SIM): ditandai **UNVERIFIED**
karena wiki Teltonika tidak dapat diakses (HTTP 403) dan unit fisik belum ada.
**Tidak ada pinout yang difabrikasi.**

## 6. Prosedur & hasil first-packet (harness)

Perintah:
```
set -a; . ./.env; set +a
node server/build/fms-cli.mjs first-packet-test --mode sandbox --imei <IMEI> --unit <UNIT>
```

Hasil **5/5 PASS** (2026-09-11):

| # | Target | Hasil |
|---|---|---|
| 1 | DEVICE REGISTERED | PASS |
| 2 | HANDSHAKE | PASS (balasan `0x01`) |
| 3 | PACKET RECEIVED | PASS (ACK, `records=1`) |
| 4 | RAW TELEMETRY | PASS |
| 5 | CANONICAL EVENT / FMS | PASS |

Rantai nyata terbukti: IMEI → Traccar device → registry → `fms_units.traccar_device_id` →
`tc_positions` (baris nyata `lat -1.24150, lon 116.84120, speed 6.5`) → raw telemetry → canonical event.

**Dua bug codec ditemukan & diperbaiki lewat pembacaan source Traccar 6.15.3:**
1. Panjang frame: `dataLength` **tidak termasuk** 4 byte CRC → encoder menulis `body.length` (dulu +4 → Traccar menunggu 62 byte, dapat 58 → hang senyap).
2. Struktur Codec 8: elemen IO **dikelompokkan per lebar nilai** (1/2/4/8 byte), tiap grup diawali byte jumlah — bukan daftar datar (`globalMask=0x0f`). Kesalahan asumsi ini memunculkan `readerIndex(58) + length(1) exceeds writerIndex(58)`.

**Klasifikasi jujur:** ini **PROTOCOL / SOFTWARE HARNESS VALIDATION**, **bukan**
`REAL_DEVICE_PHYSICAL_TEST`. Perangkat fisik belum pernah mengirim paket.

**Catatan penting:** ACK Traccar **bukan** berarti baris sudah tersimpan — Traccar meng-ACK
lebih dulu, baris `tc_positions` muncul ~3 detik kemudian (kejadian nyata: ACK 03:41:24 → baris 03:41:27).
Harness karena itu menunggu baris nyata dan **GAGAL** bila baris tidak muncul (tanpa klaim sukses palsu).

## 7. Perbaikan inisialisasi database (item #1 Owner)

Masalah: modul pipeline membaca `FMS_DATABASE_URL` **saat inisialisasi modul**, sehingga harness gagal
bila variabel belum ada.

Penyelesaian (satu jalur konfigurasi, tanpa jalur kedua):
- `server/fms-cli.ts` memanggil **`resolveFmsDatabaseUrl()`** (`lib/fms/database-url.ts`) dan
  mengekspor `FMS_DATABASE_URL` **sebelum** dynamic import modul pipeline.
- Tidak ada kredensial hardcoded · tidak ada duplikasi logika konfigurasi DB · tidak ada penurunan
  standar penanganan rahasia · tidak ada jalur konfigurasi kedua.
- `scripts/run-fms-regression.sh` memakai resolver kanonik yang sama untuk keperluan suite;
  nilainya tidak pernah dicetak.

## 8. Berkas yang berubah

**Commit kode `3595e41`:**

| Berkas | Status |
|---|---|
| `drizzle/0005_fms_device_registry.sql` | baru (59 baris) |
| `lib/fms/device-registry.ts` | baru (225 baris) |
| `server/fms-cli.ts` | baru (726 baris; 5 perintah) |
| `scripts/build-fms-cli.sh` | baru (24 baris) |
| `scripts/run-fms-regression.sh` | baru (55 baris) |
| `lib/fms/traccar-adapter.ts` | diubah (+22/−7) |
| `lib/fms/telemetry-pipeline.ts` | diubah (+65/−2) |
| `db/schema.ts` | diubah (+35) |

**Commit dokumen:** `docs/fms/FMC650_PREPOC_COMMISSIONING.md` (baru),
`docs/fms/SECURITY_FINDINGS_OUTSIDE_FMS_SCOPE.md` (baru), `docs/fms/P2_DEVICE_READY_REPORT.md` (baru),
`docs/fms/P1_NATIVE_BACKEND_REPORT.md` (koreksi unit systemd).

**Tidak disentuh:** `server/build/` (gitignored), `static/` dan dokumen untracked lain (bukan milik P2),
logika Phase 2/3A/3B/3C yang frozen, skema Drizzle yang sudah ada, P1 `74753fb`.

**Tidak ada service yang di-restart di P2.** Bundle backend yang berjalan **tidak** memuat
modul registry/pipeline (diverifikasi: 0 kemunculan) → P2 murni penambahan sisi CLI/registry,
tanpa perubahan perilaku layanan yang sedang live.

## 9. Tes & regresi

Suite frozen dijalankan lewat `scripts/run-fms-regression.sh` (resolver kanonik + scope memori):

```
# tests 131
# pass 130
# fail 1
```

**Identik dengan baseline P1** (131/130/1). Satu kegagalan = `tests/fms-persistence.test.ts`
= `KNOWN_PRE_EXISTING_TEST_TEARDOWN_ISSUE` (IPC test-runner; sudah ada di `74753fb`) —
**tidak diperbaiki dengan mengubah tes frozen**.

**Temuan penting (kegagalan palsu):** run pertama memberi 117/115/**2** dengan
`uncaughtException: 'Unable to deserialize cloned data due to invalid or unsupported version.'`
di dalam `node:internal/test_runner`. Investigasi:
1. Kegagalan yang sama **juga muncul di HEAD P1 `74753fb`** (worktree terpisah, tanpa perubahan P2) → bukan regresi P2.
2. Tanpa perlindungan memori: Phase 3C crash di ~247 s. **Dengan** `systemd-run --scope -p MemoryHigh=800M -p MemoryMax=2G`: **43/43 PASS dalam ~57 s**.
3. Kesimpulan: tekanan `memory.high` cgroup gateway memotong kanal IPC test-runner → kegagalan palsu. Runner regresi sekarang **selalu** dijalankan di dalam scope memori sendiri (terdokumentasi di skrip).

Bukti pendukung lain: `first-packet-test` 5/5 PASS · `offline-test` 12/12 PASS
(540 paket disangga, 543/543 ter-backfill, **0 duplikat**).

## 10. Blocker fisik yang tersisa & langkah persis saat perangkat tiba

**Blocker (hanya fisik):** unit FMC650 belum ada · IMEI fisik belum diketahui · SIM/APN belum
tersedia · akses manual/Configurator resmi belum diverifikasi · kanal CAN/J1939 belum diuji
(keputusan Owner: implementasi CAN produksi **ditunda**).

Langkah persis saat perangkat tiba (rinci di `FMC650_PREPOC_COMMISSIONING.md`):

1. Registrasi IMEI lebih dulu: `node server/build/fms-cli.mjs registry-status`,
   lalu `bind-device --imei <IMEI_FISIK> --unit <KODE_UNIT>`.
2. Pasang perangkat (power/GND/IGN, antena GNSS + LTE) sesuai manual; isi tabel bagian 3 dokumen.
3. Configurator: server `43.134.112.7`, port `5027`, TCP, Codec 8; isi APN SIM.
4. Nyalakan → cek first handshake di log Traccar (harus `0x01`).
5. Tunggu AVL pertama → verifikasi `tc_positions` (bagian 7 dokumen).
6. Verifikasi raw telemetry (bagian 8) dan canonical event/FMS (bagian 9).
7. Jalankan `first-packet-test --mode preflight` sebelum uji lapangan; catat jam ACK vs jam baris tersimpan.
8. Setelah terverifikasi: pindahkan unit uji ke unit nyata, lalu uji offline/pemulihan (bagian 10).

**Definisi selesai untuk P2:** seluruh bukti software/protokol di atas PASS; satu-satunya
yang tersisa adalah pengujian perangkat fisik (`REAL_DEVICE_PHYSICAL_TEST = PENDING`),
yang **tidak bisa** dan **tidak boleh** diklaim tanpa perangkat nyata.

## 11. Temuan di luar scope FMS (dicatat, tidak diubah)

Empat port PostgreSQL proyek lain terbuka ke internet: `5436` (`metro-postgres`),
`5437` (`lumin-postgres` / Faztrack Attendance), `5438` (`audit-bubur-fay-pg`),
`5440` (`real-woc-postgres`). Rincian + rekomendasi remediasi:
`docs/fms/SECURITY_FINDINGS_OUTSIDE_FMS_SCOPE.md`.
**Tidak ada perubahan apa pun** pada port tersebut di P2 — menunggu keputusan Owner.
