import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
import { resolveFmsDatabaseUrl } from "@/lib/fms/database-url";

let _client: ReturnType<typeof postgres> | null = null;
let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;

function getClient() {
  if (!_client) {
    // Resolved lazily so a misconfigured environment surfaces as a handled
    // error instead of an import-time crash. Never logs the credential.
    _client = postgres(resolveFmsDatabaseUrl(), { max: 10 });
  }
  return _client;
}

export function getDb() {
  if (!_db) {
    _db = drizzle(getClient(), { schema });
  }
  return _db;
}

/** For tests: close the connection pool */
export async function closeDb() {
  if (_client) {
    await _client.end();
    _client = null;
    _db = null;
  }
}
