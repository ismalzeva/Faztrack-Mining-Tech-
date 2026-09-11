/**
 * Digital Shift Board — GET/POST proxy to the native Node FMS operational
 * backend. Transport only; semantics live in `lib/fms/operational-api.ts`.
 *
 * Shift Assignment remains HUMAN AUTHORITY.
 */

import { forwardToFmsBackend } from "@/lib/fms/backend-proxy";

export async function GET(request: Request): Promise<Response> {
  return forwardToFmsBackend(request, "/api/fms/assignments");
}

export async function POST(request: Request): Promise<Response> {
  return forwardToFmsBackend(request, "/api/fms/assignments");
}
