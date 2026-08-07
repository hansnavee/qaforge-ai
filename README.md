# QAForge AI

Enterprise multi-agent AI QA platform. Understand requirements, inspect live web apps (credential-safe login handoff), generate Playwright automation, execute tests, and deliver professional reports.

## Run without local Docker (GitHub Actions)

Push to GitHub, then:

1. **Actions** → **Docker Stack** → **Run workflow**
2. GitHub builds and starts the full Compose stack on an Ubuntu runner and smoke-tests API + Web

Details: [`docs/DOCKER.md`](docs/DOCKER.md)

Or open a **GitHub Codespace** and run `docker compose up --build`.

## Full stack with Docker Compose

```bash
docker compose up --build
```

| Service | URL |
|---------|-----|
| Web | http://localhost:3000 |
| API health | http://localhost:4000/api/v1/health |
| API | http://localhost:4000 |
| Postgres | localhost:5432 |
| Redis | localhost:6379 |

## Architecture docs

See [`docs/architecture/`](docs/architecture/README.md).

## Monorepo layout

| Path | Purpose |
|------|---------|
| `apps/web` | Next.js dashboard |
| `apps/api` | NestJS API + Better Auth + WebSocket |
| `apps/worker` | BullMQ agent orchestrator + Playwright |
| `packages/*` | Shared libraries (database, agents, reports, …) |

## Local development (Node on host)

```bash
pnpm install
docker compose up -d postgres redis   # infra only
cp .env.example .env
pnpm db:generate && pnpm db:push
pnpm --filter @qaforge/shared build
pnpm --filter @qaforge/agent-sdk build
pnpm --filter @qaforge/browser-session build
pnpm --filter @qaforge/report-engine build
pnpm --filter @qaforge/worker exec playwright install chromium
pnpm dev
```

## Security highlights

- Target app credentials are **never** requested or stored
- AES-GCM encryption, audit redaction, Helmet, CORS, rate limiting, RBAC

## Scripts

| Script | Description |
|--------|-------------|
| `pnpm docker:up` | `docker compose up --build` |
| `pnpm docker:down` | `docker compose down` |
| `pnpm dev` | Run web, api, worker on host |
| `pnpm test` | Unit tests |
| `pnpm db:push` | Push Prisma schema |

## Deploy

- Docker Compose / Railway (see `docker/`)
- Web can also target Vercel
- CI: `.github/workflows/ci.yml` + `.github/workflows/docker-stack.yml`
