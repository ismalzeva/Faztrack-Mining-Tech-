#!/usr/bin/env bash
# FMS P2 — build CLI device onboarding / first-packet harness.
# Pola sama dengan runtime P1: esbuild bundle, dependency EXTERNAL, dijalankan node biasa.
set -euo pipefail
cd "$(dirname "$0")/.."

ESBUILD="./node_modules/.bin/esbuild"
if [ ! -x "$ESBUILD" ]; then
  echo "FATAL: esbuild tidak ditemukan di $ESBUILD" >&2
  exit 1
fi

mkdir -p server/build
"$ESBUILD" server/fms-cli.ts \
  --bundle \
  --platform=node \
  --format=esm \
  --target=node20 \
  --packages=external \
  --log-level=warning \
  --outfile=server/build/fms-cli.mjs

echo "built: server/build/fms-cli.mjs"
node -e "const s=require('fs').statSync('server/build/fms-cli.mjs');console.log('size='+s.size)"
