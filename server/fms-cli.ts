#!/usr/bin/env node
/**
 * FMS P2 — Device onboarding + First-Packet verification CLI.
 *
 * ATURAN (owner, P2 "ADAPTIVE DEVICE RULE"):
 *   FMC650 adalah DEVICE #1, bukan arsitektur FMS.
 *   Semua yang spesifik-vendor (IMEI, protokol, model) BERHENTI di batas adapter/source.
 *   CLI ini hanya MENDATAKAN identitas perangkat; tidak ada asumsi FMC650 di hilir.
 *
 * Perintah:
 *   registry-status                       — baca-saja: registry + binding + kesiapan
 *   bind-device                           — daftarkan IMEI/uniqueId → Traccar → fms_units
 *   first-packet-test --mode preflight    — baca-saja: reachability + handshake protokol
 *   first-packet-test --mode sandbox      — uji rantai penuh via jalur Teltonika NYATA
 *   first-packet-test --mode real         — untuk saat FMC650 tiba (fisik)
 *
 * Tidak pernah melaporkan sukses palsu: setiap langkah diverifikasi dari balasan
 * protokol Traccar dan dari baris database.
 */
import { readFileSync } from "node:fs";
import net from "node:net";
import { Client } from "pg";
import { resolveFmsDatabaseUrl } from "../lib/fms/database-url.js";
import {
  loadDeviceBindings,
  registerDevice,
  resolveSourceType,
  summarizeRegistry,
} from "../lib/fms/device-registry.js";
// CATATAN: telemetry-pipeline diimpor DINAMIS di dalam perintah, karena modul itu
// membaca konfigurasi database saat inisialisasi. Impor statis akan gagal sebelum
// .env sempat dimuat oleh loadEnv().

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_TELTONIKA_PORT = 5027;

// ─── .env (tanpa pernah mencetak nilai) ────────────────────────────
function loadEnv(path = ".env"): void {
  try {
    const raw = readFileSync(path, "utf8");
    for (const line of raw.split("\n")) {
      const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
      if (!m) continue;
      const key = m[1];
      let val = m[2].trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = val;
    }
  } catch {
    /* .env opsional bila env sudah ter-inject */
  }
}

// ─── args ──────────────────────────────────────────────────────────
function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && i + 1 < process.argv.length && !process.argv[i + 1].startsWith("--")) {
    return process.argv[i + 1];
  }
  if (i >= 0) return "true";
  return fallback;
}
const has = (name: string) => process.argv.includes(`--${name}`);

// ─── Teltonika codec 8 (encoder device-agnostic; ini "vendor boundary") ────
function crc16Ibm(buf: Buffer): number {
  let crc = 0x0000;
  for (const byte of buf) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) {
      crc = crc & 1 ? (crc >> 1) ^ 0xa001 : crc >> 1;
    }
  }
  return crc & 0xffff;
}

function imeiHandshakeFrame(uniqueId: string): Buffer {
  const id = Buffer.from(uniqueId, "ascii");
  const head = Buffer.alloc(2);
  head.writeUInt16BE(id.length, 0);
  return Buffer.concat([head, id]);
}

interface Codec8Record {
  timestampMs: number;
  priority: number;
  lon: number;
  lat: number;
  altitude: number;
  angle: number;
  satellites: number;
  speed: number;
  eventIoId: number;
  io: Array<{ id: number; size: 1 | 2 | 4 | 8; value: number }>;
}

function codec8Packet(rec: Codec8Record): Buffer {
  // Header AVL Codec 8: waktu, prioritas, posisi, kecepatan, event, total IO.
  const head = Buffer.alloc(8 + 1 + 4 + 4 + 2 + 2 + 1 + 2 + 1 + 1);
  let o = 0;
  head.writeBigUInt64BE(BigInt(rec.timestampMs), o); o += 8;
  head.writeUInt8(rec.priority, o); o += 1;
  head.writeInt32BE(Math.round(rec.lon * 1e7), o); o += 4;
  head.writeInt32BE(Math.round(rec.lat * 1e7), o); o += 4;
  head.writeInt16BE(rec.altitude, o); o += 2;
  head.writeUInt16BE(rec.angle, o); o += 2;
  head.writeUInt8(rec.satellites, o); o += 1;
  head.writeUInt16BE(rec.speed, o); o += 2;
  head.writeUInt8(rec.eventIoId, o); o += 1;
  head.writeUInt8(rec.io.length, o); o += 1; // total IO records

  if (rec.io.some((p) => p.size === 8)) {
    throw new Error("codec 8 (globalMask 0x0f) tidak punya grup 8-byte — pakai size 1/2/4");
  }

  // SEMANTIK PENTING (diverifikasi dari TeltonikaProtocolDecoder v6.15.3,
  // decodeLocation): IO Codec 8 dikelompokkan per LEBAR NILAI, bukan daftar datar.
  // globalMask default = 0x0f → grup 1-byte, 2-byte, 4-byte SELALU hadir dan
  // masing-masing diawali 1 byte jumlah elemen. Mengirim daftar datar (id+nilai
  // campur) membuat Traccar membaca byte jumlah dari id pertama lalu membaca jauh
  // melewati akhir frame: IndexOutOfBounds + koneksi menggantung tanpa ACK.
  const group = (size: 1 | 2 | 4): Buffer => {
    const list = rec.io.filter((p) => p.size === size);
    const parts: Buffer[] = [Buffer.from([list.length])];
    for (const p of list) {
      const b = Buffer.alloc(1 + size);
      b.writeUInt8(p.id, 0);
      if (size === 1) b.writeUInt8(p.value, 1);
      else if (size === 2) b.writeUInt16BE(p.value, 1);
      else b.writeUInt32BE(p.value, 1);
      parts.push(b);
    }
    return Buffer.concat(parts);
  };

  const body = Buffer.concat([
    Buffer.from([0x08]), // codec id
    Buffer.from([0x01]), // number of data
    head,
    group(1),
    group(2),
    group(4),
    Buffer.from([0x00]), // number of data 2
  ]);
  const crc = crc16Ibm(body);
  // PENTING — semantik panjang frame Teltonika (terverifikasi dari sumber Traccar
  // v6.15.3, TeltonikaFrameDecoder): frame dianggap lengkap bila
  //   readableBytes >= dataLength + 12
  // yaitu preamble(4) + field panjang(4) + dataLength + CRC(4).
  // Karena itu dataLength = panjang body TANPA CRC. Menambahkan +4 di sini membuat
  // Traccar menunggu 4 byte yang tak pernah datang (koneksi menggantung tanpa error).
  const len = Buffer.alloc(4);
  len.writeUInt32BE(body.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc, 0);
  return Buffer.concat([Buffer.alloc(4), len, body, crcBuf]);
}

// ─── TCP helpers ───────────────────────────────────────────────────
function tcpProbe(host: string, port: number, timeoutMs = 6000): Promise<{ open: boolean; error?: string }> {
  return new Promise((resolve) => {
    const sock = net.createConnection({ host, port });
    const done = (r: { open: boolean; error?: string }) => {
      sock.destroy();
      resolve(r);
    };
    sock.setTimeout(timeoutMs);
    sock.once("connect", () => done({ open: true }));
    sock.once("timeout", () => done({ open: false, error: "timeout" }));
    sock.once("error", (e) => done({ open: false, error: (e as Error).message }));
  });
}

interface HandshakeResult {
  ok: boolean;
  response: number | null;
  detail: string;
  socket: net.Socket | null;
}

function teltonikaHandshake(host: string, port: number, uniqueId: string, timeoutMs = 8000): Promise<HandshakeResult> {
  return new Promise((resolve) => {
    const sock = net.createConnection({ host, port });
    let settled = false;
    const finish = (r: HandshakeResult) => {
      if (settled) return;
      settled = true;
      if (!r.ok && r.socket === null) sock.destroy();
      resolve(r);
    };
    sock.setTimeout(timeoutMs);
    sock.once("connect", () => sock.write(imeiHandshakeFrame(uniqueId)));
    sock.once("data", (chunk) => {
      const code = chunk[0];
      if (code === 0x01) {
        finish({ ok: true, response: 0x01, detail: "Traccar menerima IMEI (0x01)", socket: sock });
      } else {
        const detail =
          code === 0x00
            ? "Traccar menolak IMEI (0x00) — perangkat belum terdaftar di Traccar"
            : `balasan tak terduga: 0x${code.toString(16)}`;
        sock.destroy();
        finish({ ok: false, response: code, detail, socket: null });
      }
    });
    sock.once("timeout", () => {
      sock.destroy();
      finish({ ok: false, response: null, detail: "timeout menunggu balasan handshake", socket: null });
    });
    sock.once("error", (e) => {
      sock.destroy();
      finish({ ok: false, response: null, detail: `error socket: ${(e as Error).message}`, socket: null });
    });
  });
}

/** Kirim satu paket codec-8, tunggu ACK 4-byte (jumlah record diterima). */
function sendCodec8(sock: net.Socket, packet: Buffer, timeoutMs = 10000): Promise<number | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (v: number | null) => {
      if (!settled) {
        settled = true;
        resolve(v);
      }
    };
    const onData = (chunk: Buffer) => {
      sock.off("data", onData);
      if (chunk.length >= 4) finish(chunk.readUInt32BE(0));
      else finish(chunk[0]);
    };
    sock.on("data", onData);
    sock.setTimeout(timeoutMs);
    sock.once("timeout", () => finish(null));
    sock.write(packet);
  });
}

// ─── Traccar API ───────────────────────────────────────────────────
const TRACCAR_API = process.env.TRACCAR_API_URL ?? "http://localhost:8082";

async function traccarLogin(): Promise<string> {
  const email = process.env.TRACCAR_EMAIL ?? process.env.TRACCAR_ADMIN_EMAIL;
  const password = process.env.TRACCAR_PASSWORD ?? process.env.TRACCAR_ADMIN_PASSWORD;
  if (!email || !password) throw new Error("kredensial Traccar tidak tersedia di env (nama var saja, nilai tidak dicetak)");
  const res = await fetch(`${TRACCAR_API}/api/session`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `email=${encodeURIComponent(email)}&password=${encodeURIComponent(password)}`,
    redirect: "manual",
  });
  const cookie = res.headers.getSetCookie?.().find((c) => c.includes("JSESSIONID"));
  const jsid = cookie?.split("JSESSIONID=")[1]?.split(";")[0];
  if (!jsid) throw new Error(`login Traccar gagal (status ${res.status})`);
  return `JSESSIONID=${jsid}`;
}

interface TraccarDevice { id: number; name: string; uniqueId: string }

async function traccarListDevices(cookie: string): Promise<TraccarDevice[]> {
  const res = await fetch(`${TRACCAR_API}/api/devices`, { headers: { Cookie: cookie } });
  if (!res.ok) throw new Error(`GET /api/devices gagal (status ${res.status})`);
  const arr = (await res.json()) as Array<{ id: number; name: string; uniqueId: string }>;
  return arr.map((d) => ({ id: d.id, name: d.name, uniqueId: d.uniqueId }));
}

async function traccarCreateDevice(cookie: string, name: string, uniqueId: string): Promise<TraccarDevice> {
  const res = await fetch(`${TRACCAR_API}/api/devices`, {
    method: "POST",
    headers: { Cookie: cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ name, uniqueId }),
  });
  if (!res.ok) throw new Error(`POST /api/devices gagal (status ${res.status})`);
  const d = (await res.json()) as { id: number; name: string; uniqueId: string };
  return { id: d.id, name: d.name, uniqueId: d.uniqueId };
}

async function traccarDeleteDevice(cookie: string, id: number): Promise<void> {
  await fetch(`${TRACCAR_API}/api/devices/${id}`, { method: "DELETE", headers: { Cookie: cookie } });
}

// ─── DB ────────────────────────────────────────────────────────────
async function connect(): Promise<Client> {
  const client = new Client({ connectionString: resolveFmsDatabaseUrl() });
  await client.connect();
  return client;
}

async function deviceForUnit(client: Client, unit: string) {
  const r = await client.query(
    "SELECT unit, tipe_unit, traccar_device_id, active FROM fms_units WHERE unit = $1",
    [unit],
  );
  return r.rows[0] ?? null;
}

// ─── COMMANDS ──────────────────────────────────────────────────────
async function cmdRegistryStatus(): Promise<void> {
  const client = await connect();
  try {
    const summary = await summarizeRegistry(client);
    const bindings = await loadDeviceBindings(client);
    console.log("=== FMS DEVICE REGISTRY (P2B) ===");
    console.log(JSON.stringify({ summary, bindings: [...bindings.entries()] }, null, 2));
    const unitRows = await client.query(
      "SELECT unit, traccar_device_id, active FROM fms_units ORDER BY unit",
    );
    console.log("\n=== fms_units → traccar_device_id ===");
    for (const u of unitRows.rows) {
      console.log(`  ${u.unit.padEnd(16)} traccar_device_id=${u.traccar_device_id ?? "-"} active=${u.active}`);
    }
  } finally {
    await client.end();
  }
}

async function cmdBindDevice(): Promise<void> {
  const uniqueId = arg("imei") ?? arg("unique-id");
  const unit = arg("unit");
  if (!uniqueId || !unit) {
    console.error("wajib: --imei <IMEI/uniqueId> --unit <UNIT>");
    process.exit(2);
  }
  const vendor = arg("vendor", "teltonika")!;
  const model = arg("model", "FMC650")!;
  const protocol = arg("protocol", "teltonika")!;
  const transport = arg("transport", "tcp")!;
  const isSimulator = has("simulator");
  const dryRun = has("dry-run");
  const { sourceType, sourceName } = resolveSourceType(arg("source-type", null) ?? undefined);

  const client = await connect();
  try {
    const unitRow = await deviceForUnit(client, unit);
    if (!unitRow) {
      console.error(`STOP: unit '${unit}' tidak ada di fms_units. Buat unit lebih dulu (bukan tugas CLI ini).`);
      process.exit(3);
    }
    if (!unitRow.active) {
      console.error(`STOP: unit '${unit}' tidak aktif (active=${unitRow.active}).`);
      process.exit(3);
    }
    console.log(`unit: ${unitRow.unit} (${unitRow.tipe_unit}) traccar_device_id saat ini: ${unitRow.traccar_device_id ?? "-"}`);

    const cookie = await traccarLogin();
    const devices = await traccarListDevices(cookie);
    let device = devices.find((d) => d.uniqueId === uniqueId) ?? null;
    if (device) {
      console.log(`Traccar: perangkat ditemukan id=${device.id} name=${device.name}`);
    } else if (dryRun) {
      console.log(`[dry-run] Traccar: perangkat uniqueId=${uniqueId} BELUM ada → akan dibuat.`);
    } else {
      device = await traccarCreateDevice(cookie, unit, uniqueId);
      console.log(`Traccar: perangkat dibuat id=${device.id} name=${device.name}`);
    }
    if (!device) {
      console.log("[dry-run] berhenti sebelum menulis registry.");
      return;
    }

    const conflict = await client.query(
      "SELECT unit FROM fms_units WHERE traccar_device_id = $1 AND unit <> $2",
      [device.id, unit],
    );
    if (conflict.rowCount) {
      console.error(`STOP: traccar_device_id=${device.id} sudah terikat ke unit '${conflict.rows[0].unit}'.`);
      process.exit(4);
    }

    if (dryRun) {
      console.log("[dry-run] tidak ada perubahan ditulis.");
      return;
    }

    const saved = await registerDevice(client, {
      uniqueId,
      unit,
      vendor,
      model,
      protocol,
      transport,
      traccarDeviceId: device.id,
      traccarUniqueId: device.uniqueId,
      sourceType,
      sourceName,
      isSimulator,
    });
    if (unitRow.traccar_device_id !== device.id) {
      await client.query("UPDATE fms_units SET traccar_device_id = $1, updated_at = now() WHERE unit = $2", [
        device.id,
        unit,
      ]);
    }
    const check = await client.query(
      "SELECT unit, traccar_device_id FROM fms_units WHERE unit = $1",
      [unit],
    );
    console.log("\n=== HASIL BINDING ===");
    console.log(JSON.stringify({ registry: saved, fms_units: check.rows[0] }, null, 2));
    console.log(`\nLANGKAH BERIKUT: node server/build/fms-cli.mjs first-packet-test --mode real --imei ${uniqueId} --unit ${unit}`);
  } finally {
    await client.end();
  }
}

async function cmdFirstPacketTest(): Promise<void> {
  const mode = arg("mode", "preflight")!;
  const host = arg("host", DEFAULT_HOST)!;
  const port = Number(arg("port", String(DEFAULT_TELTONIKA_PORT)));
  const uniqueId = arg("imei") ?? arg("unique-id");
  const unit = arg("unit");

  console.log("=== FMS FIRST-PACKET TEST HARNESS (P2D) ===");
  console.log(`mode=${mode} target=${host}:${port}`);
  console.log("CATATAN: sampai FMC650 fisik tiba → REAL_DEVICE_PHYSICAL_TEST = PENDING\n");

  if (mode === "preflight") {
    const reach = await tcpProbe(host, port);
    console.log(`[1] TCP reachability ${host}:${port} → ${reach.open ? "OPEN" : `TERTUTUP (${reach.error})`}`);
    if (!reach.open) {
      console.log("\nHASIL: FAIL — port ingress tidak dapat dijangkau.");
      process.exit(1);
    }
    const probeId = uniqueId ?? "000000000000000";
    const hs = await teltonikaHandshake(host, port, probeId);
    console.log(`[2] handshake Teltonika (uniqueId=${probeId}) → response=${hs.response === null ? "null" : `0x${hs.response.toString(16)}`}`);
    console.log(`    ${hs.detail}`);
    if (hs.socket) hs.socket.destroy();
    const interpreted =
      hs.response === 0x00
        ? "PORT 5027 MEMANG TELTONIKA (menolak karena device belum terdaftar) — perilaku benar"
        : hs.response === 0x01
          ? "PORT 5027 TELTONIKA dan device SUDAH terdaftar"
          : "respons tidak dikenali — periksa protokol/port";
    console.log(`    interpretasi: ${interpreted}`);
    console.log("\nHASIL PREFLIGHT: ingress protokol terverifikasi (tidak ada tulisan DB).");
    return;
  }

  if (!uniqueId || !unit) {
    console.error(`mode ${mode} wajib menyertakan --imei <IMEI> --unit <UNIT>`);
    process.exit(2);
  }

  const client = await connect();
  let sock: net.Socket | null = null;
  try {
    const unitRow = await deviceForUnit(client, unit);
    if (!unitRow) {
      console.error(`STOP: unit '${unit}' tidak ada di fms_units.`);
      process.exit(3);
    }
    const bindings = await loadDeviceBindings(client);
    const traccarDeviceId = unitRow.traccar_device_id as number | null;
    const binding = traccarDeviceId !== null ? bindings.get(traccarDeviceId) : undefined;
    console.log(`[1] DEVICE REGISTERED: unit=${unit} traccar_device_id=${traccarDeviceId ?? "-"} registry=${binding ? binding.uniqueId : "TIDAK ADA"}`);
    if (!binding) {
      console.error("STOP: perangkat belum terdaftar di registry P2B. Jalankan: bind-device --imei <IMEI> --unit <UNIT>");
      process.exit(4);
    }
    if (binding.uniqueId !== uniqueId) {
      console.error(`STOP: IMEI yang diberikan (${uniqueId}) != IMEI terdaftar untuk unit ini (${binding.uniqueId}).`);
      process.exit(4);
    }

    const before = await chainCounts(client, unit);
    // ID maksimum SEBELUM paket dikirim — batas bawah ingest, sehingga bukti rantai
    // hanya boleh berasal dari baris tc_positions yang diciptakan paket protokol ini.
    const maxTcIdBefore = (
      await client.query("SELECT COALESCE(MAX(id), 0) AS max_id FROM tc_positions")
    ).rows[0].max_id as number;
    console.log(
      `[baseline] raw=${before.raw} canonical=${before.canonical} tc_positions=${before.tcPositions} max_tc_id=${maxTcIdBefore}`,
    );

    const hs = await teltonikaHandshake(host, port, binding.uniqueId);
    console.log(`[2] HANDSHAKE: response=${hs.response === null ? "null" : `0x${hs.response.toString(16)}`} — ${hs.detail}`);
    if (!hs.ok || !hs.socket) {
      console.error("STOP: handshake gagal; tidak ada paket dikirim (tidak ada hasil palsu).");
      process.exit(5);
    }
    sock = hs.socket;

    const now = Date.now();
    const lon = Number(arg("lon", "116.8412"));
    const lat = Number(arg("lat", "-1.2415"));
    const packet = codec8Packet({
      timestampMs: now,
      priority: 0,
      lon,
      lat,
      altitude: 42,
      angle: 90,
      satellites: 9,
      speed: 12,
      eventIoId: 0,
      io: [
        { id: 239, size: 1, value: 1 },
        { id: 240, size: 1, value: 1 },
        { id: 1, size: 4, value: 1200 },
        { id: 16, size: 4, value: 987654 },
        { id: 21, size: 2, value: 245 },
      ],
    });
    const ack = await sendCodec8(sock, packet);
    console.log(`[3] PACKET RECEIVED: ACK records=${ack === null ? "TIDAK ADA BALASAN" : ack}`);
    sock.destroy();
    sock = null;
    if (ack === null || ack < 1) {
      console.error("FAIL: Traccar tidak mengakui paket (ACK kosong/0). Tidak ada bukti diterima.");
      process.exit(6);
    }

    // Traccar meng-ACK paket SEBELUM menulis tc_positions (pemrosesan asinkron/batch).
    // Tunggu baris nyata muncul; bila tidak muncul → berhenti, tanpa klaim sukses.
    console.log("[3b] menunggu Traccar menulis tc_positions...");
    const waited = await waitForNewTcPositions(client, maxTcIdBefore);
    if (waited === 0) {
      console.error(
        "FAIL: ACK diterima tetapi tidak ada baris tc_positions baru dalam 20s — posisi tidak tersimpan.",
      );
      process.exit(6);
    }
    console.log(`[3b] tc_positions baru: ${waited} baris`);

    // Konfigurasi DB: SATU jalur saja — resolver kanonik lib/fms/database-url.ts.
    // telemetry-pipeline membaca FMS_DATABASE_URL saat INISIALISASI modul, jadi nilainya
    // harus tersedia SEBELUM dynamic import. Tidak ada kredensial yang ditulis di sini
    // dan tidak ada jalur konfigurasi database kedua.
    if (!process.env.FMS_DATABASE_URL?.trim()) {
      process.env.FMS_DATABASE_URL = resolveFmsDatabaseUrl();
    }

    console.log("[4] ingest tc_positions (TANPA simulator) → raw → canonical...");
    const { ingestNewPositions } = await import("../lib/fms/telemetry-pipeline.js");
    const ing = await ingestNewPositions({ fromId: maxTcIdBefore, quiet: true });
    const ingestedUnits = [...new Set(ing.results.map((r) => r.unit))].join(",") || "-";
    console.log(
      `[4] INGEST: baris_tc=${ing.results.length} raw_inserted=${ing.results.filter((r) => r.rawInserted).length} unit=${ingestedUnits} (tanpa telemetri simulator)`,
    );

    const after = await chainCounts(client, unit);
    const dRaw = after.raw - before.raw;
    const dCan = after.canonical - before.canonical;
    const dTc = after.tcPositions - before.tcPositions;
    console.log(`[5] tc_positions +${dTc}  raw_telemetry +${dRaw}  canonical_events +${dCan}`);
    const reg = await client.query(
      "SELECT unique_id, vendor, model, activation_state, first_packet_at, last_packet_at FROM fms_devices WHERE unique_id = $1",
      [binding.uniqueId],
    );
    console.log(`[6] registry first_packet_at=${reg.rows[0]?.first_packet_at ?? "-"} last_packet_at=${reg.rows[0]?.last_packet_at ?? "-"}`);

    const visible = await client.query(
      "SELECT COUNT(*)::int AS n FROM fms_canonical_events WHERE unit = $1",
      [unit],
    );
    const pass = dTc >= 1 && dRaw >= 1 && dCan >= 1 && Boolean(reg.rows[0]?.first_packet_at);
    console.log(`[7] UNIT VISIBLE TO FMS: canonical_events(unit)=${visible.rows[0].n}`);
    console.log(`\nHASIL (${mode}): ${pass ? "PASS — rantai DEVICE REGISTERED → PACKET RECEIVED → RAW TELEMETRY → CANONICAL EVENT → FMS TERBUKTI" : "FAIL — ada mata rantai yang tidak terbukti"}`);
    if (mode === "sandbox") {
      console.log("CATATAN: ini bukti JALUR SOFTWARE dengan perangkat sandbox, BUKAN uji perangkat fisik.");
    }
    console.log("REAL_DEVICE_PHYSICAL_TEST = PENDING (FMC650 fisik belum tiba)");
    if (!pass) process.exit(7);
  } finally {
    if (sock) sock.destroy();
    await client.end();
  }
}

/**
 * Tunggu sampai Traccar MENULIS baris tc_positions baru.
 * ACK AVL dikirim SEBELUM posisi di-commit (Traccar memproses asinkron/batch),
 * jadi membaca tc_positions tepat setelah ACK akan salah menyimpulkan "tidak ada".
 * Ini menunggu bukti nyata; bila tidak muncul dalam batas waktu → 0 (gagal jujur).
 */
async function waitForNewTcPositions(client: Client, sinceId: number, timeoutMs = 20000): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const r = await client.query("SELECT COUNT(*)::int AS n FROM tc_positions WHERE id > $1", [sinceId]);
    const n = r.rows[0].n as number;
    if (n > 0) return n;
    if (Date.now() >= deadline) return 0;
    await new Promise((res) => setTimeout(res, 1000));
  }
}

async function chainCounts(client: Client, unit: string) {
  const raw = await client.query("SELECT COUNT(*)::int AS n FROM fms_raw_telemetry WHERE unit = $1", [unit]);
  const can = await client.query("SELECT COUNT(*)::int AS n FROM fms_canonical_events WHERE unit = $1", [unit]);
  const tc = await client.query(
    `SELECT COUNT(*)::int AS n FROM tc_positions p
       JOIN fms_units u ON u.traccar_device_id = p.deviceid
      WHERE u.unit = $1`,
    [unit],
  );
  return { raw: raw.rows[0].n as number, canonical: can.rows[0].n as number, tcPositions: tc.rows[0].n as number };
}

// ─── SANDBOX CLEANUP (P2D) ─────────────────────────────────────────
// Semua tabel ber-kolom `unit` (hasil informasi_schema) — dibersihkan eksplisit,
// TIDAK memakai rm/eval, dan hanya untuk unit sandbox ber-prefix SBX-.
const UNIT_SCOPED_TABLES = [
  "fms_reconciliation_results",
  "fms_historical_evidence",
  "fms_hourly_control",
  "fms_geofence_events",
  "fms_cycle_candidates",
  "fms_movement_observations",
  "fms_p2h_checks",
  "fms_canonical_events",
  "fms_raw_telemetry",
];

async function cmdSandboxCleanup(): Promise<void> {
  const uniqueId = arg("imei") ?? arg("unique-id");
  const unit = arg("unit");
  if (!uniqueId || !unit) {
    console.error("wajib: --imei <IMEI> --unit <UNIT>");
    process.exit(2);
  }
  if (!/^SBX-/.test(unit)) {
    console.error("STOP: hanya unit sandbox (prefix 'SBX-') yang boleh dibersihkan oleh perintah ini.");
    process.exit(2);
  }
  const client = await connect();
  try {
    console.log("=== SANDBOX CLEANUP ===");
    const dev = await client.query("SELECT traccar_device_id FROM fms_devices WHERE unique_id = $1", [uniqueId]);
    const unitRow = await client.query("SELECT traccar_device_id FROM fms_units WHERE unit = $1", [unit]);
    const deviceId: number | null =
      dev.rows[0]?.traccar_device_id ?? unitRow.rows[0]?.traccar_device_id ?? null;
    console.log(`unit=${unit} uniqueId=${uniqueId} traccar_device_id=${deviceId ?? "-"}`);

    for (const t of UNIT_SCOPED_TABLES) {
      const r = await client.query(`DELETE FROM ${t} WHERE unit = $1`, [unit]);
      if (r.rowCount) console.log(`  ${t}: -${r.rowCount}`);
    }
    if (deviceId !== null) {
      const tc = await client.query("DELETE FROM tc_positions WHERE deviceid = $1", [deviceId]);
      if (tc.rowCount) console.log(`  tc_positions: -${tc.rowCount}`);
    }
    const d = await client.query("DELETE FROM fms_devices WHERE unique_id = $1", [uniqueId]);
    const u = await client.query("DELETE FROM fms_units WHERE unit = $1", [unit]);
    console.log(`  fms_devices: -${d.rowCount}  fms_units: -${u.rowCount}`);

    if (deviceId !== null) {
      const cookie = await traccarLogin();
      await traccarDeleteDevice(cookie, deviceId);
      const still = await traccarListDevices(cookie);
      console.log(`  traccar device ${deviceId}: ${still.some((x) => x.id === deviceId) ? "MASIH ADA" : "dihapus"}`);
    }

    console.log("\n=== RESIDU ===");
    let residue = 0;
    for (const t of UNIT_SCOPED_TABLES) {
      const r = await client.query(`SELECT COUNT(*)::int AS n FROM ${t} WHERE unit = $1`, [unit]);
      residue += r.rows[0].n as number;
    }
    const residualUnit = await client.query("SELECT COUNT(*)::int AS n FROM fms_units WHERE unit = $1", [unit]);
    const residualDev = await client.query("SELECT COUNT(*)::int AS n FROM fms_devices WHERE unique_id = $1", [uniqueId]);
    residue += residualUnit.rows[0].n + residualDev.rows[0].n;
    console.log(`total residu = ${residue}`);
    console.log(residue === 0 ? "BERSIH — tidak ada sisa uji." : "PERINGATAN: masih ada sisa, periksa manual.");
    if (residue !== 0) process.exit(8);
  } finally {
    await client.end();
  }
}

// ─── OFFLINE / RECOVERY (BACKFILL) TEST ────────────────────────────
// Memakai jalur produksi yang SUDAH ADA (runOfflineSimulation): operasi normal →
// jeda komunikasi (buffer) → pemulihan dengan backlog. Tidak ada logika kedua dan
// tidak ada simulasi baru di sini — hanya memanggil dan merangkum hasilnya.
async function cmdOfflineTest(): Promise<void> {
  console.log("=== FMS OFFLINE / RECOVERY TEST (jalur produksi) ===");
  if (!process.env.FMS_DATABASE_URL?.trim()) {
    process.env.FMS_DATABASE_URL = resolveFmsDatabaseUrl();
  }
  const { runOfflineSimulation } = await import("../lib/fms/telemetry-pipeline.js");
  const r = await runOfflineSimulation({ quiet: true });
  const p1 = r.phase1Normal.filter((x) => x.rawInserted).length;
  const p3 = r.phase3Recovered.filter((x) => x.rawInserted).length;
  const dupes = r.phase3Recovered.filter((x) => x.qualityFlags.includes("DUPLICATE")).length;
  console.log(`Phase 1 normal   : ${p1}/${r.phase1Normal.length} masuk raw`);
  console.log(`Offline buffered : ${r.offlineBufferedCount} posisi (simulasi jeda komunikasi)`);
  console.log(`Phase 3 recovery : ${p3}/${r.phase3Recovered.length} masuk raw, ditandai DUPLICATE=${dupes}`);
  const pass = p1 > 0 && r.offlineBufferedCount > 0 && p3 > 0;
  console.log(
    `\nHASIL: ${pass ? "PASS — backlog dipulihkan setelah komunikasi kembali" : "FAIL — pemulihan backlog tidak terbukti"}`,
  );
  console.log("CATATAN: COMMUNICATION_OFFLINE != UNIT_OFFLINE — jeda komunikasi bukan breakdown.");
  if (!pass) process.exit(7);
}

// ─── ENTRY ─────────────────────────────────────────────────────────
loadEnv();
const cmd = process.argv[2];
const runners: Record<string, () => Promise<void>> = {
  "registry-status": cmdRegistryStatus,
  "bind-device": cmdBindDevice,
  "first-packet-test": cmdFirstPacketTest,
  "sandbox-cleanup": cmdSandboxCleanup,
  "offline-test": cmdOfflineTest,
};

if (!cmd || !runners[cmd]) {
  console.log(`FMS CLI (P2) — perintah:
  registry-status
  bind-device --imei <IMEI> --unit <UNIT> [--vendor teltonika] [--model FMC650]
              [--protocol teltonika] [--transport tcp] [--source-type ...] [--simulator] [--dry-run]
  first-packet-test --mode preflight [--host 127.0.0.1] [--port 5027] [--imei <IMEI>]
  first-packet-test --mode sandbox|real --imei <IMEI> --unit <UNIT> [--lon ..] [--lat ..]
  offline-test          — uji jeda komunikasi + pemulihan backlog (jalur produksi)
  sandbox-cleanup       — hapus HANYA residu uji ber-prefix SBX-`);
  process.exit(cmd ? 2 : 0);
}

runners[cmd]().catch((e) => {
  console.error("CLI ERROR:", (e as Error).message);
  process.exit(1);
});

export { codec8Packet, crc16Ibm, imeiHandshakeFrame };
