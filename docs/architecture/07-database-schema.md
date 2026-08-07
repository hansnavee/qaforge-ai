# Database Schema — QAForge AI

## Core models

- `User`, `Session`, `Account`, `Verification` — Better Auth
- `Organization`, `Membership` — roles: OWNER | ADMIN | MEMBER | VIEWER
- `Project` — name, appUrl, framework, language, environment, encryptedConfig
- `RequirementDocument` — storageKey, mime, parsed text reference
- `Execution` — status, phase, scores JSON, timestamps, errorSummary
- `AgentRun` — agentId, status, input/output refs, tokens, duration
- `Artifact` — type, storageKey, mime, size, checksum
- `BrowserSession` — executionId, status, containerId, expiresAt (no cookies/tokens)
- `GitHubConnection`, `GitHubPush`
- `Subscription`, `UsageEvent`
- `AuditLog` — redacted metadata

## Indexing

`organizationId`, `projectId`, `executionId`, `status`, `createdAt`
