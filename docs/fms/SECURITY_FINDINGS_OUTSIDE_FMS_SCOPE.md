# SECURITY_FINDING_OUTSIDE_FMS_SCOPE — PostgreSQL proyek lain terbuka ke internet

**Tanggal:** 2026-09-11
**Status:** `RECORDED_ONLY — TIDAK DIUBAH` (keputusan Owner: jangan menyentuh proyek lain di dalam P2)
**Konteks:** ditemukan saat mengerjakan FINDING-01 (postgres FMS `5439` terbuka). Port FMS sudah ditutup; port proyek lain **sengaja tidak disentuh**.

---

## 1. Metode pengujian (dapat direproduksi)

Diuji dari **vantage eksternal** (VPS produksi `43.163.7.128`, IP publik berbeda):
TCP connect langsung ke `43.134.112.7:<port>`. Bila koneksi terbentuk → port terbuka ke internet.

Pada host, semua port ini dipublikasikan oleh Docker sebagai `0.0.0.0:<port>->5432/tcp`
(lihat `docker ps`), dan `ufw` tidak aktif sehingga tidak ada lapisan pemblokir.

## 2. Temuan

| Port | Container (Docker) | Proyek / layanan | Eksposur terverifikasi | Catatan |
|---|---|---|---|---|
| `5436` | `metro-postgres` | proyek **Metro** (perlu konfirmasi Owner) | **OPEN dari internet** | `0.0.0.0:5436->5432` |
| `5437` | `lumin-postgres` | **Faztrack Attendance** (DB dev; prod `attendance-lumin-postgres`) | **OPEN dari internet** | `0.0.0.0:5437->5432` |
| `5438` | `audit-bubur-fay-pg` | **Audit Bubur Fay** | **OPEN dari internet** | `0.0.0.0:5438->5432` |
| `5440` | `real-woc-postgres` | **REAL-WOC (S0)** | **OPEN dari internet** | `0.0.0.0:5440->5432` |

**Risiko:** database PostgreSQL dapat dijangkau dari internet publik. Walaupun masih butuh
kredensial, ini memaparkan permukaan serangan (brute-force kredensial, eksploitasi versi,
kebocoran data bila kredensial lemah/bocor). Tidak ada bukti akses tidak sah yang diperiksa
pada P2 — pemeriksaan log bukan bagian dari scope ini.

Dua port di host ini **sudah benar** dan tidak perlu diubah:
- `:3097` (backend FMS) → loopback-only, terbukti refused dari internet.
- `:5439` (Postgres FMS) → ditutup lewat DOCKER-USER DROP, terbukti tertutup dari internet.

## 3. Rekomendasi remediasi (untuk keputusan Owner, di luar P2)

Urut dari paling cepat & paling reversibel:

1. **Segera (tanpa restart container, berlaku sampai reboot):**
   untuk tiap port, pasang DROP di chain `DOCKER-USER` —
   pola yang sama seperti perbaikan `5439`:
   ```
   iptables -I DOCKER-USER 1 -i eth0 -m conntrack --ctorigdstport <PORT> -j DROP
   ```
   Lalu buktikan dari vantage eksternal bahwa port tertutup.
2. **Permanen (butuh recreate container → butuh approval + jendela maintenance):**
   publish hanya ke loopback: `-p 127.0.0.1:<PORT>:5432` (bukan `-p <PORT>:5432`),
   sehingga tidak ada lagi bind `0.0.0.0`.
3. **Pertahankan:** buat unit systemd `oneshot` idempoten per proyek (seperti
   `fms-pg-network-hardening.service`) agar aturan bertahan setelah reboot.
4. **Audit lanjutan (disarankan):** periksa log container untuk percobaan koneksi tidak
   sah, dan pertimbangkan rotasi kredensial DB proyek terdampak.
5. **Pencegahan:** terapkan default deployment "PostgreSQL tidak boleh bind `0.0.0.0`"
   pada checklist proyek baru.

## 4. Yang TIDAK dilakukan pada P2

- Tidak mengubah/menutup `5436`, `5437`, `5438`, `5440`.
- Tidak me-restart container proyek lain.
- Tidak mengubah `docker-compose`/konfigurasi proyek lain.
- Tidak mengubah kebijakan firewall global host.

**Butuh keputusan Owner sebelum ada tindakan pada port-port tersebut.**
