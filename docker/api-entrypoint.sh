#!/bin/sh
set -e

echo "PGHOST=${PGHOST:-unset} PORT=${PORT:-4000}"

echo "Applying Prisma schema..."
cd /app/packages/database
pnpm exec prisma db push --skip-generate --accept-data-loss

echo "Starting API on 0.0.0.0:${PORT:-4000}..."
cd /app/apps/api
exec node dist/main.js

# deploy-trigger 2026-08-09T15:32:55.5072871+05:30
