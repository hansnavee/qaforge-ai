# Authentication Flow — QAForge AI

## Platform users

1. User signs up / logs in via Better Auth (email or Google/GitHub OAuth)
2. Session stored in Postgres; httpOnly cookie issued to web app
3. Web sends authenticated requests to API
4. API validates session and enforces organization RBAC

## Invites

Owner invites email → pending membership → accept → role applied (OWNER | ADMIN | MEMBER | VIEWER)
