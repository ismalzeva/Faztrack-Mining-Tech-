/**
 * Faztrack FMS — native Node operational backend (P1).
 *
 * Why this exists: the Vinext app bundle is built for the Cloudflare runtime
 * (`@cloudflare/vite-plugin`), so the `postgres` TCP driver always resolves to
 * its Cloudflare target and fails under Node with
 *   ERR_UNSUPPORTED_ESM_URL_SCHEME: Received protocol 'cloudflare:'
 * This backend reaches PostgreSQL/PostGIS directly over native TCP and the
 * Vinext app proxies to it. ONE product, one public surface.
 *
 * Run:  node --import tsx server/fms-api.ts
 * Bind: 127.0.0.1 only (loopback). Never exposed publicly; the web app is the
 *       only client.
 *
 * Semantics live in `lib/fms/operational-api.ts` (single source of truth).
 * This file is transport only: routing, parsing, status codes, logging.
 *
 * Discipline: no secret ever appears in a log line or error body.
 */

import http from "node:http";
import { OPERATIONS } from "../lib/fms/operational-api";
import { resolveFmsDatabaseUrl } from "../lib/fms/database-url";

const HOST = process.env.FMS_API_HOST?.trim() || "127.0.0.1";
const PORT = Number(process.env.FMS_API_PORT?.trim() || "3097");
const MAX_BODY_BYTES = 1_048_576; // 1 MiB

/* ---------------------------- helpers ---------------------------- */

function send(res: http.ServerResponse, status: number, body: unknown) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "cache-control": "no-store",
  });
  res.end(payload);
}

async function readBody(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new Error("BODY_TOO_LARGE");
    chunks.push(chunk as Buffer);
  }
  if (!size) return {};
  const text = Buffer.concat(chunks).toString("utf8");
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("INVALID_JSON");
  }
}

function redactedTarget(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.username}:***@${u.host}${u.pathname}`;
  } catch {
    return "<unparseable>";
  }
}

/* ---------------------------- health ---------------------------- */

async function health() {
  // Imported lazily so a DB outage cannot prevent the process from starting
  // and reporting unhealthiness.
  const { getDb } = await import("../db");
  const { sql } = await import("drizzle-orm");

  const started = Date.now();
  try {
    const db = getDb();
    const rows = (await db.execute(
      sql`select current_database() as db, current_user as usr,
                 (select postgis_version()) as postgis,
                 (select count(*)::int from fms_canonical_events) as canonical_events,
                 (select count(*)::int from fms_shift_assignments) as shift_assignments,
                 (select count(*)::int from fms_p2h_checks) as p2h_checks,
                 (select count(*)::int from fms_hourly_control) as hourly_control`,
    )) as unknown as Array<Record<string, unknown>>;
    const row = rows[0] ?? {};
    return {
      status: "ok",
      service: "faztrack-fms-api",
      database: {
        connected: true,
        name: row.db,
        user: row.usr,
        postgis: row.postgis,
        tables: {
          fms_canonical_events: row.canonical_events,
          fms_shift_assignments: row.shift_assignments,
          fms_p2h_checks: row.p2h_checks,
          fms_hourly_control: row.hourly_control,
        },
      },
      latency_ms: Date.now() - started,
    };
  } catch (error) {
    return {
      status: "degraded",
      service: "faztrack-fms-api",
      database: { connected: false, error: String((error as Error).message).slice(0, 200) },
      latency_ms: Date.now() - started,
    };
  }
}

/* ---------------------------- server ---------------------------- */

const server = http.createServer((req, res) => {
  const started = Date.now();
  const requestId = crypto.randomUUID().slice(0, 8);
  const url = new URL(req.url ?? "/", `http://${HOST}:${PORT}`);
  const pathname = url.pathname;
  // Kept as a plain string: an unknown verb (PUT/PATCH/DELETE) must resolve to
  // no operation and be rejected with 405 — never silently served as GET.
  const method = (req.method ?? "GET").toUpperCase();

  const finish = (status: number, body: unknown, note = "") => {
    send(res, status, body);
    console.log(
      `[fms-api] ${requestId} ${method} ${pathname} -> ${status} ` +
        `${Date.now() - started}ms${note ? " " + note : ""}`,
    );
  };

  (async () => {
    if (pathname === "/health") {
      const result = await health();
      return finish(result.status === "ok" ? 200 : 503, result);
    }

    const known = Object.keys(OPERATIONS).map((k) => k.split(":")[0]);
    if (!known.includes(pathname)) {
      return finish(404, { error: "not found" });
    }

    const operation = OPERATIONS[method === "GET" ? pathname : `${pathname}:${method}`];
    if (!operation) {
      return finish(405, { error: `method ${method} not allowed for ${pathname}` });
    }

    try {
      if (method === "POST") {
        const body = await readBody(req);
        const result = await operation.handler(body);
        return finish(result.status, result.body);
      }
      const result = await operation.handler(url.searchParams);
      return finish(result.status, result.body);
    } catch (error) {
      const code = (error as Error).message;
      if (code === "BODY_TOO_LARGE") return finish(413, { error: "payload too large" });
      if (code === "INVALID_JSON") return finish(400, { error: "invalid JSON body" });
      // Generic outward error: never leak SQL, driver internals or credentials.
      console.error(
        `[fms-api] ${requestId} ${method} ${pathname} FAILED ${(error as Error).name}: ` +
          String((error as Error).message).split("\n")[0].slice(0, 300),
      );
      return finish(500, { error: "internal_error", request_id: requestId });
    }
  })();
});

/* --------------- startup: fail fast on misconfiguration --------------- */

try {
  const target = redactedTarget(resolveFmsDatabaseUrl());
  server.listen(PORT, HOST, () => {
    console.log(`[fms-api] listening on http://${HOST}:${PORT}`);
    console.log(`[fms-api] database target ${target}`);
    console.log(`[fms-api] routes ${Object.keys(OPERATIONS).join(", ")}, /health`);
  });
} catch (error) {
  console.error(`[fms-api] FATAL: ${(error as Error).message}`);
  process.exit(78); // EX_CONFIG
}

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    console.log(`[fms-api] ${signal} received, shutting down`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5_000).unref();
  });
}
