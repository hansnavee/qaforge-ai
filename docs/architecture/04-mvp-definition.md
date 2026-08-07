# MVP Definition — QAForge AI

## In scope (Phase 1, ~8–10 weeks)

- Better Auth, organizations, projects
- Requirement text + PDF ingest (DOCX in phase 1.5)
- Playwright browser session + manual login pause + session resume
- Agents: Requirement, Auth, Discovery, Functional (smoke/core), Test Case Gen, Automation Gen (Playwright + TypeScript), Execution, Report, Failure Analysis (basic)
- HTML report + PDF summary + ZIP download
- Dashboard: Projects, Executions, Reports, basic scores
- Stripe Free / Pro
- Deploy: Vercel (web) + Railway (api/worker) + R2 + Postgres + Redis

## Out of MVP

- Selenium Java / Cypress / C# generation
- Full GitHub Actions Agent (scaffold workflow file in ZIP only)
- Security Agent beyond headers/cookies/HTTPS checklist
- Team activity feeds, advanced charts
- Deep a11y/perf scoring (basic axe/Lighthouse in MVP)
- UI/UX + Product Improvement agents (Phase 2)
- Full API Agent Postman/OpenAPI (basic network capture in MVP)

## Acceptance criteria

- End-to-end demo on a public demo app with login pause
- ZIP contains runnable Playwright TypeScript POM project
- No credentials in DB, logs, or generated code
