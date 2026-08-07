# Deployment Strategy — QAForge AI

| Service | Target |
|---------|--------|
| `apps/web` | Vercel |
| `apps/api` | Railway (Docker) |
| `apps/worker` | Railway (Docker, scaled separately) |
| Browser | Railway private / Fly.io containers |
| Postgres | Railway or Neon |
| Redis | Railway / Upstash |
| Objects | Cloudflare R2 |
| CI | GitHub Actions |

Environments: `dev` / `staging` / `prod`. Prisma migrations in CD. Feature flags for agent rollout.
