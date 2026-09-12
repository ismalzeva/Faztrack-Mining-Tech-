/**
 * Transport helper: forward a Vinext route request to the native Node FMS
 * operational backend on loopback.
 *
 * Why: the `postgres` TCP driver cannot be loaded through the
 * Cloudflare-targeted Vinext bundle — it always resolves to its Cloudflare
 * target and dies under Node with
 *   ERR_UNSUPPORTED_ESM_URL_SCHEME: Received protocol 'cloudflare:'
 * Database access therefore lives in `server/fms-api.ts`. These route handlers
 * are transport only: status code and body pass through unchanged, and the
 * business semantics stay owned by `lib/fms/operational-api.ts`.
 */

const FMS_API_BASE = process.env.FMS_API_BASE?.trim() || "http://127.0.0.1:3097";

export async function forwardToFmsBackend(request: Request, path: string): Promise<Response> {
  const url = new URL(request.url);
  const init: RequestInit = { method: request.method };
  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = await request.text();
    init.headers = { "content-type": "application/json" };
  }

  try {
    const upstream = await fetch(`${FMS_API_BASE}${path}${url.search}`, init);
    const text = await upstream.text();
    return new Response(text, {
      status: upstream.status,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  } catch {
    // Backend down must be reported as unavailable — never as an empty success,
    // and never as a fabricated value.
    return Response.json({ error: "fms_backend_unavailable" }, { status: 503 });
  }
}
