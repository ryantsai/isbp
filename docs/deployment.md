# IS Big Platform — Deployment & Operations

> Status: Phase 0. Covers local development, the Docker Compose stack, the Helm chart and CI.
> Every environment variable is documented in [`.env.example`](../.env.example).

## 1. What gets deployed

Two images are built from this monorepo (build context = repo root):

| Image      | Dockerfile                    | Processes (same image, different command)                                                                                                                                                                             |
| ---------- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `isbp-api` | `infra/docker/api.Dockerfile` | **api** `node --import ./dist/telemetry.js dist/main.js` (default)<br>**worker** `node --import ./dist/telemetry.js dist/worker.js`<br>**migrate** `node dist/migrate.js`<br>**seed** `node dist/seed.js` (demo only) |
| `isbp-web` | `infra/docker/web.Dockerfile` | **web** `node apps/web/server.js` (Next.js standalone)                                                                                                                                                                |

| Process | Port                | Probes                                                      | Notes                                                          |
| ------- | ------------------- | ----------------------------------------------------------- | -------------------------------------------------------------- |
| api     | 4000 `PORT`         | `GET /healthz` (liveness), `GET /readyz` (Postgres + Redis) | Serves `/api/v1/*`, `/api/docs`                                |
| api     | 9464 `METRICS_PORT` | `/metrics`, `/healthz`, `/readyz`                           | Internal only — never route it through an ingress              |
| worker  | 9464 `METRICS_PORT` | `/healthz`, `/readyz` on the metrics port                   | Outbox relay + BullMQ jobs; no public port                     |
| web     | 3000 `PORT`         | `GET /healthz`                                              | Proxies `/api/*` to `API_INTERNAL_URL` at runtime              |
| migrate | —                   | exit code                                                   | Idempotent, takes a Postgres advisory lock; run before rollout |

Both images run as UID/GID `10001` on `node:24-slim`, contain no package managers, and work with a read-only
root filesystem (only `/tmp`, plus `/app/apps/web/.next/cache` for the web app, must be writable).
`isbp-web` is environment-agnostic: `API_INTERNAL_URL` is read at runtime, so the same image runs everywhere.

**Stateful dependencies are not bundled** into the Helm chart:

- **PostgreSQL 17+** with `pg_trgm` available (and `vector`/pgvector from Phase 2; use an image or managed
  service that ships it). Migrations run `CREATE EXTENSION IF NOT EXISTS …`, so the migration user needs that
  privilege, or a DBA pre-creates the extensions. The worker uses `LISTEN/NOTIFY`: a PgBouncer in front must run
  in **session** mode (or the worker must bypass it).
- **Redis 7+ / Valkey** with `maxmemory-policy noeviction` (required by BullMQ) and persistence (AOF) if queued
  jobs must survive restarts.

## 2. Local development

Pick one way to get Postgres + Redis on `localhost:5432` / `localhost:6379` (user/password/db `isbp`/`isbp`/`isbp`,
plus a throwaway `isbp_test` database):

```bash
# A) No Docker: embedded Postgres + Redis, data in .dev-data/ (Ctrl+C to stop)
pnpm dev:services

# B) Docker: pgvector/pgvector:pg17 + redis:7-alpine, bound to 127.0.0.1 only
docker compose -f infra/compose/docker-compose.dev.yml up -d
```

Then:

```bash
pnpm install
pnpm db:migrate        # core + module migrations
pnpm db:seed           # demo data (idempotent)
pnpm dev               # API :4000 + worker (one process) and web :3000 → http://localhost:3000
```

Sign in as `admin` / `ChangeMe-2026!` (demo accounts `helpdesk`, `hr.partner`, `auditor` use `Demo-2026!pass`).

The built-in defaults match this setup, so no `.env` is required. To override something, copy `.env.example`
to `.env` and export it into your shell (`set -a; . ./.env; set +a`) — the apps do not load it on their own.

| Task              | Command                                                                                                                                                                 |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit tests        | `pnpm test`                                                                                                                                                             |
| Integration tests | `DATABASE_URL=postgres://isbp:isbp@localhost:5432/isbp_test pnpm test:integration`                                                                                      |
| End-to-end tests  | `pnpm --filter @isbp/e2e exec playwright install chromium` once, then `pnpm e2e` (needs the app running and seeded; `E2E_BASE_URL` defaults to `http://localhost:3000`) |
| Reset the DB      | `pnpm db:reset` (refuses to run with `NODE_ENV=production`)                                                                                                             |
| Wipe Docker data  | `docker compose -f infra/compose/docker-compose.dev.yml down -v`                                                                                                        |

## 3. Full stack with Docker Compose

`infra/compose/docker-compose.yml` builds both images and runs Postgres (pgvector), Redis, a one-shot `migrate`
service, the API, the worker and the web app. Only the web app is published; it proxies `/api/*` to the API.

```bash
cd infra/compose
cp .env.example .env
# Required: the master key for secrets at rest
sed -i.bak "s|^ISBP_MASTER_KEY=.*|ISBP_MASTER_KEY=$(openssl rand -base64 32)|" .env && rm .env.bak

docker compose up -d --build               # → http://localhost:3000
docker compose --profile demo up -d        # + idempotent demo seed (admin / ChangeMe-2026!)
docker compose ps                          # migrate should be "Exited (0)", the rest healthy
docker compose logs -f api worker
```

Start order is enforced with health checks: `postgres`/`redis` healthy → `migrate` completes successfully →
`api` + `worker` (and `seed` with `--profile demo`) → `web` once the API is ready.

**Observability profile** — Jaeger (OTLP traces) and Prometheus (scrapes `api:9464` and `worker:9464` via DNS
discovery, so `--scale worker=3` is picked up):

```bash
# in infra/compose/.env
OTEL_EXPORTER_OTLP_ENDPOINT=http://jaeger:4318

docker compose --profile observability up -d
# Jaeger UI  http://localhost:16686    Prometheus  http://localhost:9090
```

**Operations**

| Task                       | How                                                                                                                                                                              |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Upgrade                    | `git pull && docker compose up -d --build` — `migrate` runs again before the new API/worker start                                                                                |
| Run published images       | Set `ISBP_API_IMAGE=ghcr.io/<owner>/isbp-api`, `ISBP_WEB_IMAGE=ghcr.io/<owner>/isbp-web`, `ISBP_IMAGE_TAG=<sha-…>` in `.env`, then `docker compose pull && docker compose up -d` |
| Back up the database       | `docker compose exec -T postgres pg_dump -U isbp -Fc isbp > isbp-$(date +%F).dump`                                                                                               |
| Restore                    | `docker compose exec -T postgres pg_restore -U isbp -d isbp --clean --if-exists < isbp-YYYY-MM-DD.dump`                                                                          |
| psql                       | `docker compose exec postgres psql -U isbp isbp`                                                                                                                                 |
| Start over (deletes data!) | `docker compose down -v`                                                                                                                                                         |

The containers mirror the Kubernetes hardening (read-only root FS, all capabilities dropped,
`no-new-privileges`). The web port binds to `127.0.0.1` by default; to serve other machines set `WEB_BIND=0.0.0.0`,
put a TLS-terminating reverse proxy in front, set `PUBLIC_URL=https://…`, and change `POSTGRES_PASSWORD`
(URL-safe characters only — it is embedded in `DATABASE_URL`; change it before the volume is first created, or
`ALTER ROLE` afterwards).

## 4. Building images

```bash
docker build -f infra/docker/api.Dockerfile -t isbp-api .
docker build -f infra/docker/web.Dockerfile -t isbp-web .
# optional build args: APP_VERSION (reported as the OTel service.version), VCS_REF, NODE_VERSION (default 24)
```

How the builds work: a `pruner` stage runs `turbo prune <app> --docker`; the builder installs from the pruned
manifests and lockfile first (cached until a `package.json`/lockfile changes; BuildKit cache mount for the pnpm
store), then copies the sources and runs `turbo run build`. pnpm itself is installed at the version pinned in
`package.json#packageManager`; install scripts follow the `allowBuilds` list in `pnpm-workspace.yaml`.

- **api**: tsdown bundles the `@isbp/*` workspace packages into `dist/`; `pnpm deploy --prod` produces the
  production-only `node_modules` that is copied into the runtime stage.
- **web**: Next.js `output: 'standalone'` with the repo root as tracing root; `.next/static` and `public/` are
  copied next to `apps/web/server.js`.

CI builds `linux/amd64`. For arm64, add `linux/arm64` to `platforms` (QEMU — slow for the Next.js build) or
build on native arm64 runners and merge the manifests.

## 5. Kubernetes with Helm

Chart: `infra/helm/isbp` (`apiVersion: v2`, Kubernetes ≥ 1.27). It deploys `<release>-api`, `<release>-worker`
and `<release>-web` Deployments, Services, an optional Ingress, HPAs, PDBs, ServiceMonitors and NetworkPolicies,
plus a `<release>-migrate` Job. All options are documented in
[`values.yaml`](../infra/helm/isbp/values.yaml).

### 5.1 Quick start (dev/test cluster)

`secrets.mode=create` lets the chart render the Secret from values — convenient, but the values end up in the
Helm release history, so use it only for disposable environments.

```bash
helm upgrade --install isbp infra/helm/isbp -n isbp --create-namespace \
  --set api.image.repository=ghcr.io/<owner>/isbp-api \
  --set web.image.repository=ghcr.io/<owner>/isbp-web \
  --set image.tag=sha-<commit> \
  --set config.PUBLIC_URL=http://localhost:3000 \
  --set secrets.values.DATABASE_URL='postgres://isbp:<pw>@postgres.db:5432/isbp' \
  --set secrets.values.REDIS_URL='redis://redis.db:6379' \
  --set secrets.values.ISBP_MASTER_KEY="$(openssl rand -base64 32)" \
  --set migrations.seedDemoData=true          # demo data — never on a real database

kubectl -n isbp port-forward svc/isbp-web 3000:3000
```

### 5.2 Production values

```yaml
# values-production.yaml
image:
  tag: sha-1a2b3c4 # immutable tag (or set api.image.digest / web.image.digest)
api:
  image: { repository: ghcr.io/acme/isbp-api }
  autoscaling: { enabled: true, minReplicas: 3, maxReplicas: 12 }
worker:
  replicaCount: 2
web:
  image: { repository: ghcr.io/acme/isbp-web }
  autoscaling: { enabled: true, minReplicas: 2, maxReplicas: 8 }

config:
  LOG_LEVEL: info
  DATABASE_POOL_MAX: '15' # × (api + worker pods) must fit max_connections
  OTEL_EXPORTER_OTLP_ENDPOINT: http://otel-collector.observability:4318
  # PUBLIC_URL is derived from the ingress: https://isbp.example.com

ingress:
  enabled: true
  className: nginx
  host: isbp.example.com
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt-prod
  tls:
    enabled: true # secretName defaults to <release>-tls (issued by cert-manager)

# Option 1 — a Secret you manage (Sealed Secrets, SOPS, Vault injector, kubectl …)
secrets:
  mode: existing
  existingSecret: isbp-runtime # keys: DATABASE_URL, REDIS_URL, ISBP_MASTER_KEY[, ISBP_MASTER_KEY_PREVIOUS]

serviceMonitor:
  enabled: true
  labels: { release: kube-prometheus-stack }

networkPolicy:
  enabled: true # adjust ingressFrom / metricsFrom to your ingress controller and Prometheus namespaces
```

```yaml
# Option 2 — External Secrets Operator (ESO ≥ 0.16 for external-secrets.io/v1)
secrets:
  mode: external
  external:
    secretStoreRef: { kind: ClusterSecretStore, name: vault-backend }
    refreshInterval: 1h
    data:
      - { secretKey: DATABASE_URL, remoteRef: { key: isbp/production, property: DATABASE_URL } }
      - { secretKey: REDIS_URL, remoteRef: { key: isbp/production, property: REDIS_URL } }
      - { secretKey: ISBP_MASTER_KEY, remoteRef: { key: isbp/production, property: ISBP_MASTER_KEY } }
```

```bash
kubectl -n isbp create secret generic isbp-runtime \
  --from-literal=DATABASE_URL='postgres://isbp:<pw>@pg.internal:5432/isbp?sslmode=require' \
  --from-literal=REDIS_URL='rediss://:<pw>@redis.internal:6380/0' \
  --from-literal=ISBP_MASTER_KEY="$(openssl rand -base64 32)"   # store this key in your vault too!

helm upgrade --install isbp infra/helm/isbp -n isbp -f values-production.yaml --wait --timeout 15m
```

The Ingress sends `/api` to the API service and everything else to the web service; the metrics port is never
routed. Pods roll automatically when the ConfigMap (or a chart-managed Secret) changes. With
`existing`/`external` secrets, restart after a secret change (`kubectl -n isbp rollout restart deploy -l
app.kubernetes.io/instance=isbp`) or add a reloader annotation via `api.podAnnotations` /
`worker.podAnnotations`.

Scaling notes: API and web are stateless (HPA on CPU/memory). Workers scale horizontally (the outbox relay uses
`SKIP LOCKED`); CPU is only a rough proxy for queue depth — consider KEDA's Redis scaler for queue-based scaling.
Default PDBs use `maxUnavailable: 1` and replicas are soft-spread across zones and nodes.

### 5.3 Upgrades and migrations

`migrations.enabled=true` (default) renders a Job (`node dist/migrate.js`, api image) as a Helm hook on
`pre-install,pre-upgrade` with `hook-delete-policy: before-hook-creation,hook-succeeded`. New Deployments are only
applied after the Job succeeds; if it fails, `helm upgrade` fails and the running version keeps serving.

- Hooks run before the release's own resources exist or are updated, so the Job receives its configuration
  inline and its secrets from a hook-scoped copy (`<release>-migrate` Secret, or an ExternalSecret that ESO syncs
  while the Job's pod waits). With `secrets.mode=existing` it reads your Secret directly. It uses the namespace's
  `default` ServiceAccount unless `migrations.serviceAccountName` names one that already exists.
- Failed Jobs are kept for `migrations.ttlSecondsAfterFinished` (1 day):
  `kubectl -n isbp logs job/isbp-migrate --all-containers`.
- Migrations are forward-only: take a database backup (or rely on PITR) before upgrading; `helm rollback` does
  not revert the schema.
- Argo CD maps these hooks to `PreSync` (hook weights become sync order); Flux runs Helm hooks natively.
- To migrate outside Helm, set `migrations.enabled=false` and run `node dist/migrate.js` from the api image in
  your pipeline (or `config.AUTO_MIGRATE: 'true'` for small single-replica installs).

### 5.4 Validating the chart

`values.yaml` intentionally has no usable secrets or URL, so lint/template with the CI values files:

```bash
helm lint infra/helm/isbp -f infra/helm/isbp/ci/create-values.yaml
helm template isbp infra/helm/isbp -f infra/helm/isbp/ci/external-values.yaml | kubeconform -strict -ignore-missing-schemas
```

## 6. Secrets and the master key

`ISBP_MASTER_KEY` encrypts secrets at rest (AES-256-GCM: IdP client secrets, LDAP bind passwords, …). It is
**required in production** and must be base64 of exactly 32 random bytes:

```bash
openssl rand -base64 32
```

Store it in your secret manager **and** in your break-glass/backup procedure: a database backup is useless for
those settings without the key that encrypted them. Never reuse the development fallback key (the API logs when it
is in use).

**Rotation** — every ciphertext records the id of the key that produced it; new writes always use
`ISBP_MASTER_KEY`, reads also accept `ISBP_MASTER_KEY_PREVIOUS`:

1. Generate a new key.
2. Set `ISBP_MASTER_KEY_PREVIOUS=<current key>` and `ISBP_MASTER_KEY=<new key>` in the Secret (compose: `.env`).
3. Roll out every process (Helm: `helm upgrade`, plus `kubectl rollout restart` for existing/external secrets;
   compose: `docker compose up -d`).
4. Re-save each encrypted setting (e.g. identity provider client secrets, LDAP bind passwords) so it is
   re-encrypted with the new key. There is no bulk re-encryption command yet.
5. Only then remove `ISBP_MASTER_KEY_PREVIOUS` and roll out again. Removing it early makes values still encrypted
   with the old key unreadable ("encrypted with an unknown key").

Other secrets: `DATABASE_URL` and `REDIS_URL` carry credentials — keep them in the Secret, never in the ConfigMap.
Use `sslmode=require` (or stricter) for remote Postgres and `rediss://` for Redis over untrusted networks.

## 7. Observability

- **Logs**: structured JSON on stdout (pino) with credentials redacted; ship them with your node-level collector.
- **Metrics**: Prometheus format on `:9464/metrics` for both the API and the worker (`isbp_http_request_duration_seconds`,
  `isbp_auth_logins_total`, `isbp_jobs_total`, `isbp_events_total`, Node.js runtime metrics). Scrape them with the
  chart's ServiceMonitors or the compose Prometheus.
- **Traces**: OpenTelemetry auto-instrumentation (HTTP, Fastify, pg, ioredis, pino) is enabled when
  `OTEL_EXPORTER_OTLP_ENDPOINT` is set (OTLP/HTTP, e.g. `http://otel-collector:4318`). Service names are
  `isbp-api`, `isbp-worker`, `isbp-migrate`; standard `OTEL_*` variables apply.

## 8. Production checklist

- [ ] **TLS everywhere at the edge** and `PUBLIC_URL=https://…` — session cookies are marked `Secure` only when
      `PUBLIC_URL` is https; the web app sends HSTS.
- [ ] Secrets via `secrets.mode=existing` or `external`, never `create`; nothing secret in values files or Git.
- [ ] `ISBP_MASTER_KEY` generated with `openssl rand -base64 32`, stored in the secret manager and in the
      recovery runbook; rotation procedure understood (§6).
- [ ] Postgres: managed or operator-run (CloudNativePG) with automated backups, **point-in-time recovery** and a
      tested restore; `pg_trgm` (and pgvector for Phase 2) available; connection budget
      (`DATABASE_POOL_MAX × pods`) below `max_connections`; PgBouncer, if any, in session mode.
- [ ] Redis: `maxmemory-policy noeviction`, persistence/replication as required, TLS + auth.
- [ ] Back up the database before every upgrade; migration Job succeeded before traffic moved.
- [ ] Metrics port 9464 never exposed via ingress/LoadBalancer (chart default); `networkPolicy.enabled=true`
      with the right `ingressFrom`/`metricsFrom` selectors.
- [ ] `TRUST_PROXY` matches your proxy chain (default trusts private ranges, i.e. in-cluster ingress
      controllers); otherwise client IPs for rate limiting and audit logs are wrong.
- [ ] `config.API_DOCS` stays `false` on internet-facing installs unless the API reference must be public.
- [ ] Immutable image tags or digests (no `latest`); images scanned in your registry.
- [ ] Requests/limits sized from real metrics; HPA + PDB enabled; ≥ 2 replicas of api, worker and web.
- [ ] Never run the demo seed (`migrations.seedDemoData`, compose `--profile demo`) against production data.
- [ ] Alerts on `/readyz` failures, 5xx rate and latency (`isbp_http_request_duration_seconds`), job failures
      (`isbp_jobs_total{status="failed"}`), and Postgres/Redis health.

## 9. CI/CD

`.github/workflows/ci.yml` runs on pushes to `main` and on pull requests (superseded PR runs are cancelled):

| Job           | What it does                                                                                                                                                                                                                      |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `quality`     | `pnpm install --frozen-lockfile`, `format:check`, `lint`, `typecheck`, `modules:check`, `test` (Turborepo cache restored)                                                                                                         |
| `integration` | `pnpm test:integration` against `pgvector/pgvector:pg17` + `redis:7-alpine` service containers (`isbp_test`)                                                                                                                      |
| `e2e`         | Builds api + web, migrates and seeds, starts API, worker and the standalone web server, runs Playwright; uploads report + logs on failure                                                                                         |
| `docker`      | After `quality`: builds both images (GHA layer cache), smoke-tests them (non-root, migrate → API/worker ready, web health) and, on `main` only, pushes `ghcr.io/<owner>/isbp-{api,web}` tagged `main`, `sha-<short>` and `latest` |

Images are pushed with the workflow's `GITHUB_TOKEN` (`packages: write` is granted to the `docker` job only).
Deployments consume the immutable `sha-<short>` tags.
