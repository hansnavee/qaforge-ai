# Folder Structure — QAForge AI

```text
/
├── apps/
│   ├── web/                 # Next.js UI
│   ├── api/                 # NestJS HTTP + WS
│   └── worker/              # BullMQ consumers + agents
├── packages/
│   ├── database/            # Prisma schema + client
│   ├── shared/              # types, zod schemas, constants
│   ├── agent-sdk/           # AgentHandler, context, LLM router
│   ├── browser-session/     # Playwright session lifecycle
│   ├── report-engine/       # HTML/PDF/JUnit builders
│   ├── ui/                  # shared UI primitives
│   └── config/              # eslint, tsconfig, tailwind
├── docker/
│   ├── api.Dockerfile
│   ├── worker.Dockerfile
│   └── browser.Dockerfile
├── docs/architecture/
├── .github/workflows/
├── turbo.json
└── README.md
```
