# syntax=docker/dockerfile:1

FROM node:20-bookworm-slim AS base
WORKDIR /app
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml turbo.json ./
COPY packages ./packages
COPY apps/api ./apps/api
COPY apps/worker/package.json ./apps/worker/package.json
COPY apps/web/package.json ./apps/web/package.json
# Hoist deps so Nest can resolve express/cookie-parser at runtime
RUN echo "shamefully-hoist=true" > .npmrc \
 && echo "node-linker=hoisted" >> .npmrc \
 && pnpm install --frozen-lockfile || pnpm install

FROM deps AS build
RUN pnpm --filter @qaforge/shared build \
 && pnpm --filter @qaforge/database generate \
 && pnpm --filter @qaforge/database build \
 && pnpm --filter @qaforge/agent-sdk build \
 && pnpm --filter @qaforge/report-engine build \
 && pnpm --filter @qaforge/api build

FROM base AS runner
ENV NODE_ENV=production
ENV PORT=4000
COPY --from=build /app /app
COPY docker/api-entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh \
 && sed -i 's/\r$//' /entrypoint.sh
WORKDIR /app
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=5s --start-period=60s --retries=8 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/entrypoint.sh"]
