# FMC650 PRE-POC COMMISSIONING — Faztrack FMS

**Status:** `REAL_DEVICE_PHYSICAL_TEST = PENDING_SOFTWARE_HARNESS_VALIDATED`
**Perangkat:** Teltonika FMC650 = **DEVICE #1** (bukan arsitektur)
**Basis bukti:** commit P1 `74753fb` (frozen) + pekerjaan P2 (belum di-commit)
**Ruang lingkup:** menyiapkan penerimaan **paket pertama** dari perangkat fisik.

> Dokumen ini adalah prosedur operasional untuk Owner/teknisi saat perangkat FMC650 tiba.
> Semua yang ditandai **VERIFIED** sudah dibuktikan langsung ke sistem yang berjalan —
> bukan dari dokumentasi vendor. Yang ditandai **UNVERIFIED** wajib dicek ke manual/SIM.

---

## 0. Aturan yang tidak boleh dilanggar saat commissioning

| Aturan | Alasan |
|---|---|
| Jangan mengubah alur kerja klien (Plan / P2H / Shift Assignment) | Itu wewenang manusia (`HUMAN_AUTHORITY`) |
| Jangan mengekspos PostgreSQL (`5439`) atau backend FMS (`:3097`) ke publik | `:3097` = loopback-only; `5439` ditutup firewall |
| Jangan menyalin kredensial ke dokumen/jawaban chat | Secret hanya di `.env` (mode 600, gitignored) |
| Jangan memakai port Postgres proyek lain (`5436/5437/5438/5440`) | FMS Postgres = `5439` saja |
| Timestamp tidak valid → `FAIL`, jangan menambal/mengarang waktu | Data harus bisa diaudit |
| `COMMUNICATION_OFFLINE != UNIT_OFFLINE != BREAKDOWN` | Jeda sinyal bukan kerusakan unit |
| CAN/J1939 **ditunda** sampai telemetri dasar stabil | Lihat §10 |

---

## 1. Endpoint & port — nilai terverifikasi

| Item | Nilai | Status bukti |
|---|---|---|
| Alamat server untuk perangkat | `43.134.112.7` | **VERIFIED** |
| Port TCP Teltonika | **`5027`** | **VERIFIED** — handshake IMEI asli dijawab Traccar |
| Protokol | **TCP** + **Codec 8** (`0x08`) | **VERIFIED** — AVL diterima, ACK `00000001` |
| Handler Traccar | `teltonika` (default, tidak dioverride di `traccar.xml`) | **VERIFIED** |
| Port lain Traccar | `5055` (OsmAnd/HTTP), `5150`, `8082` (web/API) | **VERIFIED** (bukan jalur FMC650) |
| Jangkauan dari internet | Ya — handshake dari vantage eksternal (prod VPS `43.163.7.128`) dijawab | **VERIFIED** |
| Pemeriksaan pihak ketiga | `5027` OPEN 6/6 node, `3097` refused 6/6, `5439` semula OPEN → kini CLOSED | **VERIFIED** |
| Traccar | v6.15.3, host network, satu proses Java | **VERIFIED** |

**Jangan** mengarahkan perangkat ke `:3097` atau `:5439`. Keduanya bukan jalur perangkat.

---

## 2. Registrasi IMEI di FMS — lakukan SEBELUM perangkat di-pasang

Idealnya IMEI didaftarkan lebih dulu; saat perangkat menyala, ia langsung dikenali
(handshake dijawab `0x01`), bukan diperlakukan sebagai perangkat asing (`0x00`).

```bash
cd /home/ubuntu/faztrack-mining-tech
set -a; . ./.env; set +a            # kredensial hanya dari .env

# 1) Lihat kondisi registry
node server/build/fms-cli.mjs registry-status

# 2) Daftarkan IMEI fisik (IMEI tertera di label perangkat)
node server/build/fms-cli.mjs bind-device \
  --imei <IMEI_FISIK> \
  --unit <KODE_UNIT> \
  --vendor teltonika --model FMC650 --protocol teltonika --transport tcp
```

Yang dilakukan perintah ini (satu tindakan, tiga sistem konsisten):
1. membuat device di Traccar,
2. menulis baris registry `fms_devices` (`unique_id`, `vendor`, `model`, `protocol`, `transport`, `source_type`),
3. mengikat `fms_units.traccar_device_id`.

**Terverifikasi pada harness:** `--imei 999900000000001 --unit SBX-TLT-01`
→ Traccar device `id=3` → registry `DEV-999900000000001` → `fms_units.traccar_device_id=3`.

Catatan penting: `vendor` / `model` / `protocol` adalah **data**, bukan kode.
Menambah perangkat merek lain tidak mengubah FMS, Traccar, maupun kontrak kanonik.

### Field SIM / APN
SIM/APN adalah konfigurasi **sisi perangkat**, **bukan** field registry FMS — registry
sengaja tidak punya kolom SIM/APN agar tidak menyerap detail vendor.
Jika kelak perlu dicatat, pakai kolom `notes` pada registry atau tabel terpisah.

---

## 3. Instalasi fisik — wiring, antena, daya

> **UNVERIFIED terhadap manual.** Saya tidak punya akses ke manual/unit fisik saat
> dokumen ini dibuat, jadi **angka pin tidak saya tulis** — salah pinout merusak unit.
> Ikuti manual yang disertakan dalam kotak. Tabel di bawah = daftar wajib, bukan angka pin.

| Item | Yang harus dipastikan | Status |
|---|---|---|
| **Power** | Tegangan sesuai spesifikasi unit (kelas 12/24 V kendaraan), lewat fuse | UNVERIFIED (manual) |
| **GND** | Ground ke bodi, kontak bersih, jalur pendek | UNVERIFIED (manual) |
| **IGN** | Sambungan ignition → deteksi mesin hidup/mati (dipakai untuk status operasi) | UNVERIFIED (manual) |
| **Antena GNSS** | Terpasang, sisi pandang langit, bukan di bawah logam | UNVERIFIED (manual) |
| **Antena LTE** | Terpasang, jauh dari sumber derau | UNVERIFIED (manual) |
| **SIM** | Aktif, kuota data, PIN mati, APN sesuai operator | UNVERIFIED |

**Prinsip:** unit dianggap belum siap bila salah satu baris di atas belum dicek.
Jangan menyalakan unit untuk uji paket sebelum wiring daya/GND benar.

---

## 4. Konfigurasi Teltonika Configurator

> **UNVERIFIED terhadap UI Configurator versi terbaru.** Yang **VERIFIED** adalah
> persyaratan sisi server (port/protokol/codec) — nilai di bawah harus sama persis.

Setelan yang **wajib** (dibuktikan dari sisi penerima, bukan dari manual):

| Setelan | Nilai wajib | Kenapa |
|---|---|---|
| Server / Domain | `43.134.112.7` | alamat publik yang sudah diuji |
| Port | `5027` | satu-satunya handler Teltonika yang aktif |
| Protokol | **TCP** | handshake & AVL terverifikasi lewat TCP |
| Data Protocol / Codec | **Codec 8** (`0x08`) | codec ini yang terbukti diterima Traccar |
| Mode | GPS + Ignition (minimal) | cukup untuk `Lokasi`/`Kecepatan`/`IGN` |

Codec 8 Extended (`0x8E`) **belum diverifikasi** pada P2 — jangan dijadikan default uji pertama.

Langkah umum: pilih model → set server/port/protokol → set APN → tulis ke perangkat
→ cabut dari Configurator (agar perangkat kembali dalam mode operasi).

---

## 5. First handshake — verifikasi

Saat perangkat menyala dan tersambung, Traccar membalas **`0x01`** (perangkat dikenali),
bukan `0x00` (perangkat asing).

```bash
docker exec fms-traccar sh -c 'tail -50 /opt/traccar/logs/tracker-server.log'
```

Yang dicari: baris masuk `teltonika <` (paket handshake) diikuti balasan `> 01`.
Bila `0x00`: IMEI belum terdaftar (ulangi §2) atau IMEI berbeda dari label.

**Bukti harness yang setara** (tanpa perangkat fisik): `first-packet-test --mode preflight`
untuk handshake dari VPS (loopback + alamat publik) → PASS.

---

## 6. First AVL packet — verifikasi

Setelah handshake, perangkat mengirim paket AVL; Traccar membalas ACK berisi jumlah record:

```bash
docker exec fms-traccar sh -c 'tail -80 /opt/traccar/logs/tracker-server.log' | grep -E "teltonika|ACK|lat:|lon:"
```

Tanda berhasil: baris ACK `00000001` (1 record diterima) dan Traccar men-decode posisi
(`id: <IMEI>, lat: ..., lon: ...`).

**Jangan menilai keberhasilan hanya dari ACK** — Traccar meng-ACK **sebelum** menulis
baris posisi (pemrosesan asinkron). Keberhasilan sesungguhnya ada di §7.

Catatan teknis (agar tidak salah diagnosis): panjang frame Teltonika dihitung
`dataLength + 12` dengan `dataLength` **tidak termasuk** 4 byte CRC; IO Codec 8
dikelompokkan **per lebar nilai** (1/2/4 byte) dan tiap grup diawali byte jumlah.

---

## 7. Verifikasi Traccar — `tc_positions`

```bash
systemd-run --user --scope --collect -q -p TasksMax=128 -p MemoryMax=512M \
  docker exec -i fms-postgres psql -U fms_admin -d fms_db -c \
  "SELECT id, deviceid, fixtime, latitude, longitude, speed, valid
   FROM tc_positions WHERE deviceid = <TRACCAR_DEVICE_ID> ORDER BY id DESC LIMIT 5;"
```

Lulus bila ada baris baru dengan waktu sesuai perangkat. Bila ACK ada tapi tabel kosong,
tunggu beberapa detik dan ulangi — **bukan** alasan untuk mengarang data.

---

## 8. Verifikasi raw telemetry — `fms_raw_telemetry`

```bash
node server/build/fms-cli.mjs first-packet-test --mode real --imei <IMEI_FISIK> --unit <KODE_UNIT>
```

perintah di atas menyertakan pengukuran sebelum/sesudah pada rantai penuh.
Query manual:

```sql
SELECT id, device_id, unit, fix_time, latitude, longitude, speed, ignition
FROM fms_raw_telemetry WHERE unit = '<KODE_UNIT>' ORDER BY id DESC LIMIT 5;
```

Ingest **tidak** memakai simulator: `ingestNewPositions({ fromId })` mengambil baris
`tc_positions` yang lebih baru dari ID sebelum paket dikirim — jadi bukti berasal dari
paket nyata.

---

## 9. Verifikasi canonical event & FMS

```sql
SELECT event_type, source_type, source_name, authority_status, record_status
FROM fms_canonical_events WHERE unit = '<KODE_UNIT>' ORDER BY waktu DESC LIMIT 10;
```

Nilai yang **harus** muncul (terverifikasi pada harness):
`source_type = FMC650/Traccar`, `source_name = Traccar:<device_id>`,
`authority_status = PROVISIONAL`, `record_status = RAW`.
Event yang terbentuk dari paket pertama: `Lokasi`, `Kecepatan`, `KM`, `HM`.

Verifikasi lapisan FMS (aplikasi):

```bash
curl -s "http://127.0.0.1:3097/api/fms/events?unit=<KODE_UNIT>" | head -c 500     # backend (loopback)
curl -s "http://127.0.0.1:3099/api/fms/events?unit=<KODE_UNIT>" | head -c 500     # lewat proxy aplikasi
```

Keduanya terverifikasi menjawab `HTTP 200`. Untuk Owner, cek juga di UI FMS pada
`https://minetech.gofaztrack.com` (halaman `/fms`).

Status registry setelah paket pertama masuk:

```sql
SELECT unique_id, vendor, model, protocol, activation_state, first_packet_at, last_packet_at
FROM fms_devices WHERE unique_id = '<IMEI_FISIK>';
```

`first_packet_at` terisi = perangkat benar-benar pernah mengirim data nyata.

---

## 10. Uji komunikasi offline & pemulihan (backfill)

```bash
node server/build/fms-cli.mjs offline-test
```

Hasil terverifikasi (2026-09-11) — jalur produksi yang sama, bukan simulasi baru:

```
Phase 1 normal   : 12/12 masuk raw
Offline buffered : 540 posisi (simulasi jeda komunikasi)
Phase 3 recovery : 543/543 masuk raw, ditandai DUPLICATE=0
HASIL: PASS — backlog dipulihkan setelah komunikasi kembali
```

Arti operasional: saat perangkat kehilangan sinyal, posisi tertahan di perangkat
lalu **dikirim menyusul** saat sinyal kembali; FMS menyerap backlog tanpa duplikasi.
Jeda ini **tidak** boleh diterjemahkan sebagai unit rusak.

Saat perangkat fisik sudah terpasang: matikan antena/daya sementara, nyalakan lagi,
lalu ulangi query §7–§9 untuk memastikan baris susulan masuk.

---

## 11. CAN / J1939 — DITUNDA

CAN/J1939 **belum** diimplementasikan dan **tidak** diuji pada P2.
Alasannya: telemetri dasar (posisi, kecepatan, ignition, KM/HM) harus stabil dulu.
Jangan mengaktifkan kanal CAN pada commissioning pertama.

Label tetap: `FUEL_ISSUED != FUEL_CONSUMED`; `CYCLE_CANDIDATE != RITASI != PRODUCTION`.
Definisi RITASI masih `BUSINESS_DEFINITION_UNCONFIRMED / CLIENT_VALIDATION_REQUIRED`.

---

## 12. Troubleshooting cepat

| Gejala | Kemungkinan | Tindakan |
|---|---|---|
| Handshake dijawab `0x00` | IMEI belum terdaftar / beda label | ulangi §2 |
| Tidak ada koneksi sama sekali | Port/protokol salah, APN salah, SIM tidak aktif | cek §4 |
| ACK ada, `tc_positions` kosong | Belum ter-commit (asinkron) | tunggu, ulangi §7 — jangan mengarang data |
| Data masuk Traccar tapi FMS kosong | Registry/`fms_units` tidak terikat | `registry-status`, cek §2 |
| Semua kosong padahal unit menyala | Antena GNSS/wiring daya | cek §3 ke manual |

---

## 13. Yang TIDAK berubah & yang belum

- Alur kerja klien (Plan / P2H / Shift Assignment) — tidak disentuh.
- Kontrak kanonik & logika Phase 2 / 3A / 3B / 3C — tidak disentuh.
- Perangkat baru cukup menambah baris registry + adapter/protokol; UI Fleet, Geofence,
  Cycle, CCR, dan kontrak MEI **tidak** perlu diubah.
- `REAL_DEVICE_PHYSICAL_TEST = PENDING` sampai perangkat fisik benar-benar mengirim paket.
- Bila ada blocker: **berhenti dan laporkan**, jangan menambal dengan data karangan.

---

## 14. Ringkasan bukti (dapat direproduksi)

| Bukti | Cara reproduksi |
|---|---|
| Port 5027 = Teltonika | kirim handshake IMEI → balasan `0x00`/`0x01` |
| Jangkauan publik | handshake dari VPS lain (IP berbeda) |
| Binding IMEI → Traccar → unit | `bind-device` lalu `registry-status` |
| Rantai paket → FMS | `first-packet-test --mode sandbox` (5/5 PASS) |
| Offline & backfill | `offline-test` (PASS, 0 duplikat) |
