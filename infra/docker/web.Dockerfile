# syntax=docker/dockerfile:1
#
# isbp-web — Next.js standalone server (:3000).
#
# Build from the repo root (the context must be the whole monorepo):
#   docker build -f infra/docker/web.Dockerfile -t isbp-web .
#
# Runtime configuration (no rebuild needed per environment):
#   API_INTERNAL_URL  where src/proxy.ts forwards /api/* and where Server Components call the API
#                     (e.g. http://api:4000 in compose, http://<release>-api:4000 in Kubernetes)
#   PORT / HOSTNAME   listen address (defaults 3000 / 0.0.0.0)
# Only NEXT_PUBLIC_* variables are inlined at build time — none are used today.

ARG NODE_VERSION=24
# Only used for `turbo prune`; keep in sync with the `turbo` entry of the pnpm catalog.
ARG TURBO_VERSION=2.11.7

# ── base: Node + the exact pnpm version pinned by package.json#packageManager ─────────────────────────
FROM node:${NODE_VERSION}-slim AS base
ENV CI=true \
    TURBO_TELEMETRY_DISABLED=1 \
    NEXT_TELEMETRY_DISABLED=1 \
    npm_config_update_notifier=false \
    npm_config_fund=false \
    npm_config_audit=false
WORKDIR /app
COPY package.json ./
RUN npm install --global "$(node -p "require('./package.json').packageManager.split('+')[0]")" \
 && pnpm --version

# ── pruner: reduce the monorepo to @isbp/web and its workspace dependencies ─────────────────────────────
FROM node:${NODE_VERSION}-slim AS pruner
ARG TURBO_VERSION
ENV TURBO_TELEMETRY_DISABLED=1 \
    npm_config_update_notifier=false \
    npm_config_fund=false
WORKDIR /app
RUN npm install --global "turbo@${TURBO_VERSION}"
COPY . .
RUN turbo prune @isbp/web --docker

# ── builder ────────────────────────────────────────────────────────────────────────────────────────────
FROM base AS builder
COPY --from=pruner /app/out/json/ ./
RUN --mount=type=cache,id=isbp-pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --store-dir /pnpm/store

COPY --from=pruner /app/out/full/ ./
# `output: 'standalone'` + `outputFileTracingRoot` = repo root, so the traced server lands at
# apps/web/.next/standalone/apps/web/server.js together with a minimal node_modules.
RUN pnpm turbo run build --filter=@isbp/web

# ── runtime ────────────────────────────────────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION}-slim AS runtime
ARG APP_VERSION=0.1.0
ARG VCS_REF=unknown

LABEL org.opencontainers.image.title="isbp-web" \
      org.opencontainers.image.description="IS Big Platform — Next.js web app" \
      org.opencontainers.image.vendor="IS Big Platform" \
      org.opencontainers.image.version="${APP_VERSION}" \
      org.opencontainers.image.revision="${VCS_REF}"

RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
           /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
           /opt/yarn-* /usr/local/bin/yarn /usr/local/bin/yarnpkg \
 && groupadd --system --gid 10001 isbp \
 && useradd --system --uid 10001 --gid isbp --home-dir /nonexistent --no-create-home --shell /usr/sbin/nologin isbp

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    APP_VERSION=${APP_VERSION}

WORKDIR /app
# The standalone server does not serve .next/static or public/ unless they sit next to it.
COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /app/apps/web/public ./apps/web/public

# Everything is root-owned/read-only except the Next.js cache dir (image optimisation, fetch cache).
# In Kubernetes an emptyDir is mounted here so the root filesystem can be read-only.
RUN install -d -o 10001 -g 10001 -m 0755 /app/apps/web/.next/cache

USER 10001:10001
EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz',{signal:AbortSignal.timeout(4000)}).then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]

CMD ["node", "apps/web/server.js"]
