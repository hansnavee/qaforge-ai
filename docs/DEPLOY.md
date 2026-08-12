# Free hosting deploy guide — QAForge AI

Host a **testable demo** for free/trial credits:

| Service | Platform | Role |
|---------|----------|------|
| Web | [Vercel](https://vercel.com) Hobby | Next.js UI |
| API | [Railway](https://railway.app) trial | NestJS API |
| Worker | Railway trial | Agents + Playwright |
| Postgres | [Neon](https://neon.tech) free | Database |
| Redis | [Upstash](https://upstash.com) free | Queues / pub-sub |

Estimated time: **20–30 minutes**.

---

## 1. Neon (Postgres)

1. Create project at https://console.neon.tech  
2. Copy the connection string → `DATABASE_URL`  
3. Ensure it includes `?sslmode=require`

---

## 2. Upstash (Redis)

1. Create database at https://console.upstash.com  
2. Copy **Redis URL** (starts with `rediss://`) → `REDIS_URL`  
3. Do **not** use the REST API URL (BullMQ needs Redis protocol)

---

## 3. Railway — API service

1. https://railway.app → **New Project** → **Deploy from GitHub** → `hansnavee/qaforge-ai`  
2. Add service settings:
   - **Config file:** `hosting/railway.api.toml`
   - **Dockerfile path:** `docker/api.Dockerfile`
   - **Branch:** `master` (must be set — CLI-only `railway up` uploads do **not** auto-deploy later GitHub pushes)
3. **Variables** (API service):

```env
DATABASE_URL=<neon url>
REDIS_URL=<upstash url>
BETTER_AUTH_SECRET=<random 32+ chars>
ENCRYPTION_KEY=0123456789abcdef0123456789abcdef
PORT=4000
NODE_ENV=production
NEXT_PUBLIC_APP_URL=https://placeholder.vercel.app
NEXT_PUBLIC_API_URL=https://placeholder.up.railway.app
BETTER_AUTH_URL=https://placeholder.up.railway.app
```

4. Generate a **public domain** for the API service (Railway → Settings → Networking → Generate Domain)  
5. Update `BETTER_AUTH_URL` and `NEXT_PUBLIC_API_URL` to that domain  
6. Health check path: `/api/v1/health`

On first boot the entrypoint runs `prisma db push` automatically.

---

## 4. Railway — Worker service

1. Same GitHub repo → **Add service** → config `hosting/railway.worker.toml` (Dockerfile `docker/worker.Dockerfile`)  
2. Connect GitHub source with branch **`master`** (required for auto-deploy)  
3. Variables:

```env
DATABASE_URL=<same neon>
REDIS_URL=<same upstash>
ENCRYPTION_KEY=<same as api>
BROWSER_HEADLESS=true
OPENROUTER_API_KEY=          # optional; mock LLM used when empty
OPENROUTER_USE_FREE=true     # default: free OpenRouter models for testing
# OPENROUTER_MODEL_FAST=nvidia/nemotron-3-nano-30b-a3b:free
# OPENROUTER_MODEL_REASONING=nvidia/nemotron-3-nano-30b-a3b:free
# On 429/unavailable the client also tries openrouter/free, gpt-oss-20b:free, then Gemma free IDs
# Set OPENROUTER_USE_FREE=false to use paid openai/gpt-4o-mini + anthropic/claude-sonnet-4
NODE_ENV=production
```

4. Give the worker **at least 2GB RAM** if the plan allows (Playwright). On tiny free instances, runs may OOM — still OK for API/UI testing.

Config reference: [`hosting/railway.worker.toml`](../hosting/railway.worker.toml)

---

## 5. Vercel — Web

1. https://vercel.com → **Add New Project** → import `hansnavee/qaforge-ai`  
2. Framework: **Next.js**  
3. Root: repository root (uses [`vercel.json`](../vercel.json))  
4. Environment variables:

```env
NEXT_PUBLIC_APP_URL=https://YOUR-APP.vercel.app
NEXT_PUBLIC_API_URL=https://YOUR-API.up.railway.app
```

5. Deploy  
6. After first deploy, set `NEXT_PUBLIC_APP_URL` to the real Vercel URL and redeploy  
7. On Railway API, set `NEXT_PUBLIC_APP_URL` to the Vercel URL (CORS + Better Auth trusted origin)

---

## 6. Smoke test checklist

1. Open `https://YOUR-APP.vercel.app`  
2. Sign up / log in  
3. Create a project with URL `https://www.saucedemo.com`  
4. Start execution → complete login pause → Continue  
5. Open report when finished  

API health: `https://YOUR-API.up.railway.app/api/v1/health` → `{"status":"ok",...}`

---

## 7. Common issues

| Symptom | Fix |
|---------|-----|
| GitHub push does not update Railway API | **Root cause:** Railway account has no GitHub App access, so `deploymentTriggers` is empty and pushes never build. Fix: (1) Open https://railway.com/account/github and connect GitHub, (2) Install the Railway GitHub App on `hansnavee/qaforge-ai` (https://github.com/apps/railway-app/installations/new), (3) In each service → Settings → Source → branch `master` + config `hosting/railway.api.toml` / `hosting/railway.worker.toml`, (4) Confirm triggers exist (`deploymentTriggers` non-empty). Until then deploy with `railway up --service api`. |
| CORS / auth cookie errors | `NEXT_PUBLIC_APP_URL` on API must match Vercel URL exactly (https, no trailing slash) |
| Queue jobs never run | Worker not deployed or `REDIS_URL` mismatch |
| Prisma SSL errors | Add `?sslmode=require` to Neon URL |
| Worker crashes | Increase Railway memory; keep `BROWSER_HEADLESS=true` |
| Cold starts | Free/trial services sleep — wait 30–60s on first request |

### GitHub Actions backup deploy

Workflow: [`.github/workflows/deploy-railway.yml`](../.github/workflows/deploy-railway.yml)

1. Create a Railway token at https://railway.app/account/tokens  
2. Add GitHub secret `RAILWAY_TOKEN`  
3. Pushes that touch API/worker paths (or manual **Run workflow**) call `railway up`

---

## Env template

See [`hosting/.env.production.example`](../hosting/.env.production.example).

---

## Optional: one-click-ish after accounts exist

```bash
# Install CLIs
npm i -g vercel @railway/cli

# Web
vercel link
vercel env pull
vercel --prod

# Railway (after `railway login` + project linked)
railway up --service api
railway up --service worker
```
