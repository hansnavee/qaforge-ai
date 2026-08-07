#!/bin/sh
set -e

echo "Waiting for Postgres..."
until node -e "const net=require('net');const s=net.connect({host:process.env.PGHOST||'postgres',port:5432},()=>{s.end();process.exit(0)});s.on('error',()=>process.exit(1))" 2>/dev/null; do
  sleep 1
done

echo "Applying Prisma schema..."
cd /app/packages/database
pnpm exec prisma db push --skip-generate --accept-data-loss

echo "Starting API..."
cd /app/apps/api
exec node dist/main.js
