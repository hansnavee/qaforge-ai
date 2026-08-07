# System Architecture — QAForge AI

## Topology

- **Web (Next.js):** App Router, live execution UI via WebSocket, dark/light theme
- **API (NestJS):** REST + WebSocket, RBAC, billing webhooks
- **Worker (NestJS):** BullMQ consumers, agents, browser, codegen, reports
- **Postgres + Prisma:** system of record
- **Redis + BullMQ:** queues and pub/sub for live events
- **Cloudflare R2:** artifacts, media, ZIPs (signed URLs)
- **Playwright containers:** one isolated browser per execution; destroyed after run

## Data flow

User → Web → API → Postgres/Redis → Worker → Browser/LLM/R2 → events back via Redis pub/sub → WebSocket → UI
