#!/usr/bin/env bash
set -euo pipefail

: "${FMS_D1_DATABASE:?Set FMS_D1_DATABASE to the Cloudflare D1 database name before running.}"

MIGRATION="drizzle/0000_fms_initial.sql"

if [[ ! -f "$MIGRATION" ]]; then
  echo "Migration file not found: $MIGRATION" >&2
  exit 1
fi

echo "Applying Faztrack FMS migration to D1 database: $FMS_D1_DATABASE"
npx wrangler d1 execute "$FMS_D1_DATABASE" --remote --file="$MIGRATION"

echo "Verifying FMS tables..."
npx wrangler d1 execute "$FMS_D1_DATABASE" --remote --command="SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'fms_%' ORDER BY name;"
