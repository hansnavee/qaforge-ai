# Scaling Strategy — QAForge AI

- Horizontal workers with BullMQ concurrency caps per organization
- Browser pool autoscaling with hard max per plan
- Priority queues for paid tiers
- LLM response caching and budget circuit breakers
- Artifact retention by plan; R2 lifecycle rules
- Read replicas for dashboard/report reads at growth
- Future shard by `organizationId` for multi-region
- Observability: Sentry, structured logs, PostHog, queue lag alerts
