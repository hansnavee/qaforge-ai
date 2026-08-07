# GitHub Integration Design — QAForge AI

## Capabilities

- Connect GitHub via OAuth (org-level connection; tokens encrypted)
- List / create repositories
- Create branch, commit tree, open pull request
- Push package: automation framework, README, `.gitignore`, Dockerfile, GitHub Actions workflow, `.env.example`

## Safety

- Least-privilege scopes
- Never commit `.env` secrets
- Revoke connection support
- Repository must run after `npm i && npx playwright test`
