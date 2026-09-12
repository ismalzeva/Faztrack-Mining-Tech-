/**
 * Canonical FMS events — GET/POST proxy to the native Node FMS operational
 * backend. Transport only; semantics live in `lib/fms/operational-api.ts`.
 *
 * Canonical events are MACHINE EVIDENCE. Nothing here promotes a canonical
 * event into an official operational status.
 */

import { forwardToFmsBackend } from "@/lib/fms/backend-proxy";

export async function GET(request: Request): Promise<Response> {
  return forwardToFmsBackend(request, "/api/fms/events");
}

export async function POST(request: Request): Promise<Response> {
  return forwardToFmsBackend(request, "/api/fms/events");
}
