# Testing Strategy — QAForge AI

- **Unit:** agent transforms, schema validation, RBAC guards
- **Integration:** API + Prisma + Redis (testcontainers)
- **E2E (platform):** Playwright against QAForge web
- **Security tests:** assert no credentials in DB, logs, or artifacts
- **Contract tests:** artifact JSON schemas
- **Load:** worker concurrency and browser pool soak before launch
- **CI gate:** lint, typecheck, unit, integration on every PR
