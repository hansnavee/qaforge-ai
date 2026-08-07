#!/bin/sh
set -e

DB_HOST="${PGHOST:-postgres}"
echo "Waiting for Postgres at ${DB_HOST}:5432..."
i=0
until node -e "const net=require('net');const host=process.env.PGHOST||'postgres';const s=net.connect({host,port:5432},()=>{s.end();process.exit(0)});s.on('error',()=>process.exit(1))" 2>/dev/null; do
  i=$((i+1))
  if [ "$i" -gt 60 ]; then
    echo "Postgres not reachable"
    exit 1
  fi
  sleep 2
done

echo "Applying Prisma schema..."
cd /app/packages/database
pnpm exec prisma db push --skip-generate --accept-data-loss

echo "Starting API on port ${PORT:-4000}..."
cd /app/apps/api
exec node dist/main.js
