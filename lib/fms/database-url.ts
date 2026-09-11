/**
 * Resolve the Faztrack FMS PostgreSQL/PostGIS connection string.
 *
 * Priority:
 *   1. FMS_DATABASE_URL  — explicit override (tests, CI, migration tooling).
 *   2. Composed from FMS_PG_* pieces — used by the operational runtime so the
 *      credential lives in exactly ONE place (.env, mode 600, gitignored).
 *
 * Secrets never appear in source, Git, logs, or error messages.
 */

const DEFAULTS = {
  user: "fms_admin",
  host: "localhost",
  port: "5439",
  database: "fms_db",
} as const;

export function resolveFmsDatabaseUrl(): string {
  const explicit = process.env.FMS_DATABASE_URL?.trim();
  if (explicit) return explicit;

  const password = process.env.FMS_PG_PASS;
  if (!password) {
    throw new Error(
      "FMS database is not configured: set FMS_DATABASE_URL, or set FMS_PG_PASS " +
        "so the connection string can be composed.",
    );
  }

  const user = process.env.FMS_PG_USER?.trim() || DEFAULTS.user;
  const host = process.env.FMS_PG_HOST?.trim() || DEFAULTS.host;
  const port = process.env.FMS_PG_PORT?.trim() || DEFAULTS.port;
  const database = process.env.FMS_PG_DB?.trim() || DEFAULTS.database;

  // URL() performs the required percent-encoding of user/password.
  const url = new URL(`postgresql://${host}:${port}/${database}`);
  url.username = user;
  url.password = password;
  return url.toString();
}
