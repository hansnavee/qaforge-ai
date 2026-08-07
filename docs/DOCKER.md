# Docker / GitHub Actions runbook — QAForge AI

You do **not** need Docker installed on your Windows machine. Use either:

1. **GitHub Actions (recommended online)** — builds and smoke-tests the full stack on Ubuntu runners
2. **Local Docker Desktop / Colima / OrbStack** — when available
3. **GitHub Codespaces** — cloud VS Code with Docker built-in

---

## Option A — Run on GitHub Actions (no local Docker)

1. Push this repo to GitHub.
2. Open **Actions** → **Docker Stack**.
3. Click **Run workflow** (workflow_dispatch).
4. Watch the job:
   - `docker compose build`
   - `docker compose up`
   - health checks on API (`/api/v1/health`) and Web (`/`)
   - tear down

Workflow file: [`.github/workflows/docker-stack.yml`](../.github/workflows/docker-stack.yml)

It also runs automatically on changes to `docker/`, `docker-compose.yml`, apps, or packages.

---

## Option B — Full stack with Docker Compose (local or Codespaces)

```bash
# From repo root
docker compose up --build
```

Services:

| Service  | URL / port              |
|----------|-------------------------|
| Web      | http://localhost:3000   |
| API      | http://localhost:4000   |
| Health   | http://localhost:4000/api/v1/health |
| Postgres | localhost:5432          |
| Redis    | localhost:6379          |
| Worker   | background (BullMQ)     |

Stop:

```bash
docker compose down
```

Reset volumes:

```bash
docker compose down -v
```

Infra only (Postgres + Redis) for local `pnpm dev`:

```bash
docker compose up -d postgres redis
```

---

## Option C — GitHub Codespaces

1. On GitHub: **Code** → **Codespaces** → **Create codespace**.
2. In the terminal:

```bash
docker compose up --build
```

Codespaces includes Docker; no Windows Docker Desktop required.

---

## Images

| File | Image |
|------|--------|
| [`docker/api.Dockerfile`](../docker/api.Dockerfile) | NestJS API + Prisma migrate on start |
| [`docker/worker.Dockerfile`](../docker/worker.Dockerfile) | Agent worker + Playwright Chromium |
| [`docker/web.Dockerfile`](../docker/web.Dockerfile) | Next.js standalone |
| [`docker/browser.Dockerfile`](../docker/browser.Dockerfile) | Optional Playwright sidecar |

---

## Environment

Compose uses defaults suitable for local/CI. Override via `.env` at repo root:

```env
BETTER_AUTH_SECRET=...
ENCRYPTION_KEY=0123456789abcdef0123456789abcdef
OPENROUTER_API_KEY=   # optional; mock LLM used when empty
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_API_URL=http://localhost:4000
```
