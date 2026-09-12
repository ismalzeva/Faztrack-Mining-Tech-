/**
 * Digital P2H — GET/POST proxy to the native Node FMS operational backend.
 * Transport only; semantics live in `lib/fms/operational-api.ts`.
 *
 * The P2H operability decision (LAYAK / TIDAK LAYAK DIOPERASIKAN) remains
 * HUMAN AUTHORITY. Telemetry never overrides it.
 */

import { forwardToFmsBackend } from "@/lib/fms/backend-proxy";

export async function GET(request: Request): Promise<Response> {
  return forwardToFmsBackend(request, "/api/fms/p2h");
}

export async function POST(request: Request): Promise<Response> {
  return forwardToFmsBackend(request, "/api/fms/p2h");
}
