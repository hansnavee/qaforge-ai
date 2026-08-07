# QAForge AI

Enterprise multi-agent AI QA platform. Understand requirements, inspect live web apps (credential-safe login handoff), generate Playwright automation, execute tests, and deliver professional reports.

## Host for free and test in the browser

Follow the step-by-step guide: **[`docs/DEPLOY.md`](docs/DEPLOY.md)**

| Piece | Free / trial |
|-------|----------------|
| Web | Vercel Hobby |
| API + Worker | Railway trial |
| Postgres | Neon free |
| Redis | Upstash free |

Config files ready in-repo:

- [`vercel.json`](vercel.json) — Next.js web
- [`railway.toml`](railway.toml) / [`deploy/railway.api.toml`](deploy/railway.api.toml) — API Docker
- [`deploy/railway.worker.toml`](deploy/railway.worker.toml) — Worker Docker
- [`deploy/.env.production.example`](deploy/.env.production.example) — env template

## Run without local Docker (GitHub Actions)

1. **Actions** → **Docker Stack** → **Run workflow**
2. Or open a **GitHub Codespace** → `docker compose up --build`

Details: [`docs/DOCKER.md`](docs/DOCKER.md)

## Full stack with Docker Compose

```bash
docker compose up --build
```

| Service | URL |
|---------|-----|
| Web | http://localhost:3000 |
| API health | http://localhost:4000/api/v1/health |

## Architecture docs

See [`docs/architecture/`](docs/architecture/README.md).

## Local development (Node on host)

```bash
pnpm install
docker compose up -d postgres redis
cp .env.example .env
pnpm db:generate && pnpm db:push
pnpm --filter @qaforge/shared build
pnpm --filter @qaforge/agent-sdk build
pnpm --filter @qaforge/browser-session build
pnpm --filter @qaforge/report-engine build
pnpm --filter @qaforge/worker exec playwright install chromium
pnpm dev
```

## Scripts

| Script | Description |
|--------|-------------|
| `pnpm docker:up` | Full Compose stack |
| `pnpm docker:infra` | Postgres + Redis only |
| `pnpm dev` | Web + API + worker on host |
| `pnpm test` | Unit tests |
