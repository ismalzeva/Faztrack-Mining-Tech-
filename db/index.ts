import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const DATABASE_URL =
  process.env.FMS_DATABASE_URL ??
  "postgresql://fms_admin:***@localhost:5439/fms_db";

let _client: ReturnType<typeof postgres> | null = null;
let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;

function getClient() {
  if (!_client) {
    _client = postgres(DATABASE_URL, { max: 10 });
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
