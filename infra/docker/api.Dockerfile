# syntax=docker/dockerfile:1
#
# isbp-api — one image, four entrypoints:
#   api      node --import ./dist/telemetry.js dist/main.js      (default CMD; HTTP :4000, metrics :9464)
#   worker   node --import ./dist/telemetry.js dist/worker.js    (metrics/probes :9464)
#   migrate  node dist/migrate.js                                (one-shot; run before rolling out api/worker)
#   seed     node dist/seed.js                                   (one-shot demo data — never in production)
#
# Build from the repo root (the context must be the whole monorepo):
#   docker build -f infra/docker/api.Dockerfile -t isbp-api .
#
# tsdown bundles every @isbp/* workspace package into dist/, so the runtime stage only needs dist/ plus the
# production npm dependencies produced by `pnpm deploy --prod`.

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
# pnpm 12 ships as a native binary via the npm `pnpm` wrapper package (corepack support for pnpm >= 11 depends
# on the corepack version bundled with Node, so install it explicitly). Strips an optional "+sha512..." suffix.
RUN npm install --global "$(node -p "require('./package.json').packageManager.split('+')[0]")" \
 && pnpm --version

# ── pruner: reduce the monorepo to @isbp/api and its workspace dependencies ─────────────────────────────
# out/json = manifests + pruned lockfile (dependency layer), out/full = sources of the pruned workspaces.
FROM node:${NODE_VERSION}-slim AS pruner
ARG TURBO_VERSION
ENV TURBO_TELEMETRY_DISABLED=1 \
    npm_config_update_notifier=false \
    npm_config_fund=false
WORKDIR /app
RUN npm install --global "turbo@${TURBO_VERSION}"
COPY . .
RUN turbo prune @isbp/api --docker

# ── builder: install (cached), build, then assemble a self-contained production bundle ─────────────────
FROM base AS builder
# Dependency layer: invalidated only when a package.json, pnpm-workspace.yaml or the lockfile changes.
# pnpm-workspace.yaml carries `allowBuilds` (pnpm 12 refuses unapproved install scripts).
COPY --from=pruner /app/out/json/ ./
RUN --mount=type=cache,id=isbp-pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --store-dir /pnpm/store

COPY --from=pruner /app/out/full/ ./
RUN pnpm turbo run build --filter=@isbp/api

# Fail fast (with the fix) if the bundler's entrypoint names drift from the commands used by compose/Helm/CI.
RUN for entry in main worker migrate seed telemetry; do \
      if [ ! -f "apps/api/dist/${entry}.js" ]; then \
        echo "ERROR: apps/api/dist/${entry}.js was not produced (found: $(ls apps/api/dist | tr '\n' ' '))." >&2; \
        echo "       tsdown emits .mjs for platform 'node' by default; set 'fixedExtension: false' in apps/api/tsdown.config.ts." >&2; \
        exit 1; \
      fi; \
    done

# `pnpm deploy --prod` copies the package with only its production dependencies into /prod/api, with
# workspace packages copied (not symlinked out of the tree) so the directory can be moved to another stage.
RUN --mount=type=cache,id=isbp-pnpm-store,target=/pnpm/store \
    pnpm --filter @isbp/api deploy --prod --store-dir /pnpm/store /prod/api

# ── runtime ────────────────────────────────────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION}-slim AS runtime
ARG APP_VERSION=0.1.0
ARG VCS_REF=unknown

LABEL org.opencontainers.image.title="isbp-api" \
      org.opencontainers.image.description="IS Big Platform — API, worker, migrations and demo seed" \
      org.opencontainers.image.vendor="IS Big Platform" \
      org.opencontainers.image.version="${APP_VERSION}" \
      org.opencontainers.image.revision="${VCS_REF}"

# Drop the package managers we never use at runtime (smaller attack surface, fewer scanner findings) and
# create a dedicated unprivileged user. A numeric UID lets Kubernetes verify `runAsNonRoot`.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
           /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
           /opt/yarn-* /usr/local/bin/yarn /usr/local/bin/yarnpkg \
 && groupadd --system --gid 10001 isbp \
 && useradd --system --uid 10001 --gid isbp --home-dir /nonexistent --no-create-home --shell /usr/sbin/nologin isbp

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4000 \
    METRICS_PORT=9464 \
    APP_VERSION=${APP_VERSION}

WORKDIR /app
# Files stay root-owned and read-only for the app user; nothing under /app is written at runtime, so the
# container also runs with a read-only root filesystem. package.json is required ("type": "module").
COPY --from=builder /prod/api/package.json ./package.json
COPY --from=builder /prod/api/node_modules ./node_modules
COPY --from=builder /prod/api/dist ./dist

USER 10001:10001
EXPOSE 4000 9464

# Probes the internal metrics server, which both the API and the worker run (the worker has no :4000).
# Compose/Kubernetes override this per process (API: /healthz + /readyz on :4000).
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.METRICS_PORT||9464)+'/healthz',{signal:AbortSignal.timeout(4000)}).then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]

CMD ["node", "--import", "./dist/telemetry.js", "dist/main.js"]
