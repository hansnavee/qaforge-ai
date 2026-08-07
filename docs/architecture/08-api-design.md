# API Design — QAForge AI

Base path: `/api/v1`

| Area | Endpoints |
|------|-----------|
| Auth | `/api/auth/*` (Better Auth) |
| Orgs | `CRUD /orgs`, members invite/update |
| Projects | `CRUD /orgs/:orgId/projects` |
| Requirements | `POST .../requirements/upload` |
| Executions | `POST/GET`, `POST .../continue-after-login` |
| Live | `WS /executions/:id/events` |
| Artifacts | list + `download-zip` |
| Reports | `GET /reports/:id` |
| GitHub | connect, repos, push |
| Billing | Stripe webhook + customer portal |

## Cross-cutting

- Idempotency keys on `POST /executions`
- Rate limits per org and IP
- Zod validation on all bodies
- RBAC on every org-scoped resource
