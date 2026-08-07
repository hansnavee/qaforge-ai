# Security Architecture — QAForge AI

## Credential policy

- Never request, store, or log target application usernames/passwords
- Users enter credentials only in the live browser session
- Session tokens remain in memory for the run only
- Destroy browser session after execution

## Platform security

- Project configuration encrypted at rest (AES-GCM)
- Secure file uploads: mime allowlist, size caps, private R2, signed URLs
- Better Auth sessions: httpOnly, Secure, SameSite
- RBAC on every organization resource
- CSRF protection, CSP, XSS-safe React, Helmet on Nest
- Rate limiting per org and IP
- Audit logs with secret redaction
- LLM prompts: no secrets; minimize PII
- Compliance path: SOC2 controls mapping in Phase 3
