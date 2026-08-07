# syntax=docker/dockerfile:1

FROM node:20-bookworm-slim AS base
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
RUN apt-get update && apt-get install -y --no-install-recommends \
    openssl ca-certificates \
    libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 \
    libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libasound2 \
    libpango-1.0-0 libcairo2 fonts-liberation \
  && rm -rf /var/lib/apt/lists/*

FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml turbo.json ./
COPY packages ./packages
COPY apps/worker ./apps/worker
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
RUN pnpm install --frozen-lockfile || pnpm install

FROM deps AS build
RUN pnpm --filter @qaforge/shared build \
 && pnpm --filter @qaforge/database generate \
 && pnpm --filter @qaforge/database build \
 && pnpm --filter @qaforge/agent-sdk build \
 && pnpm --filter @qaforge/browser-session build \
 && pnpm --filter @qaforge/report-engine build \
 && pnpm --filter @qaforge/worker build \
 && cd /app/apps/worker && pnpm exec playwright install --with-deps chromium || pnpm exec playwright install chromium

FROM base AS runner
ENV NODE_ENV=production
ENV BROWSER_HEADLESS=true
COPY --from=build /app /app
# Playwright browsers from build stage
COPY --from=build /root/.cache/ms-playwright /root/.cache/ms-playwright
WORKDIR /app/apps/worker
CMD ["node", "dist/main.js"]
