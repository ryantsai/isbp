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

- **PostgreSQL 18** (17 also works) with `pg_trgm` available (and `vector`/pgvector from Phase 2; use an image or managed
  service that ships it). Migrations run `CREATE EXTENSION IF NOT EXISTS …`, so the migration user needs that
  privilege, or a DBA pre-creates the extensions. The worker uses `LISTEN/NOTIFY`: a PgBouncer in front must run
  in **session** mode (or the worker must bypass it).
- **Redis 8** (7.2+ also works) / Valkey with `maxmemory-policy noeviction` (required by BullMQ) and persistence (AOF) if queued
  jobs must survive restarts.

### Component versions

Every component is on its latest stable release (checked 2026-10-08); upgrade them together and rerun the full test
suites.

| Component                       | Version                                                                                               | Notes                                                                                                               |
| ------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Node.js                         | 24 LTS (images `node:24-slim`, `.nvmrc`)                                                              | Node 26 becomes LTS on 2026-10-28; move then (`NODE_VERSION`, `.nvmrc`, `@types/node`).                             |
| pnpm                            | 12.10                                                                                                 | `package.json#packageManager`                                                                                       |
| PostgreSQL + pgvector           | 18 + 0.8.7 (`pgvector/pgvector:0.8.7-pg18-trixie`)                                                    | 17 also works. PostgreSQL 19 is due 2026-10-29. The Docker-free dev Postgres is 18.4 (the newest embeddable build). |
| Redis                           | 8.10 (`redis:8.10-alpine`)                                                                            | Clients speak RESP2 (`protocol: 2`), which BullMQ's scripts expect.                                                 |
| Next.js / React                 | 16.4 / 19.3                                                                                           |                                                                                                                     |
| TypeScript / ESLint             | 6.0 / 9.39                                                                                            | TypeScript 7 and ESLint 10 exist, but typescript-eslint and eslint-config-next's plugins don't support them yet.    |
| CI test targets                 | SQL Server 2025, MySQL 9.7 LTS, Oracle Database Free 23, PostgreSQL 18                                | Driver tests (`ISBP_TEST_*_URL`)                                                                                    |
| Script sandboxes                | `python:3.14-alpine`, `node:24-alpine`, `mcr.microsoft.com/powershell:lts-alpine-3.20`, `alpine:3.24` | `SANDBOX_IMAGES`                                                                                                    |
| Observability (compose profile) | Jaeger 2.22, Prometheus 3.15                                                                          | `JAEGER_VERSION`, `PROMETHEUS_VERSION`                                                                              |

> **Upgrading an existing Compose install from PostgreSQL 17:** the PG18 images keep their data in
> `/var/lib/postgresql/18/docker` (the volume is now mounted at `/var/lib/postgresql`). Dump with `pg_dumpall` on the
> old container and restore into the new one, or use `pg_upgrade`; an old volume is not upgraded in place.

## 2. Local development

Pick one way to get Postgres + Redis on `localhost:5432` / `localhost:6379` (user/password/db `isbp`/`isbp`/`isbp`,
plus a throwaway `isbp_test` database):

```bash
# A) No Docker: embedded Postgres + Redis, data in .dev-data/ (Ctrl+C to stop)
pnpm dev:services

# B) Docker: pgvector/pgvector:0.8.7-pg18-trixie + redis:8.10-alpine, bound to 127.0.0.1 only
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
to `.env`. The API's pnpm scripts load it automatically; export it into your shell
(`set -a; . ./.env; set +a`) for the standard web dev command.

### Local debugging in VS Code

Open the repository root in VS Code after installing dependencies. Keep `pnpm dev:services` running in a
separate terminal (or use the Docker services above), and run `pnpm db:seed` once if you want demo data.
Stop any existing `pnpm dev` servers before starting a debug session.

In **Run and Debug** (`Ctrl+Shift+D`), select **ISBP: Full stack** and press `F5`. The compound profile starts
the API and worker together under `tsx watch` on port 4000 and Next.js on port 3000, then opens an Edge debug
session. Set breakpoints in API routes, worker jobs, Server Components or browser code. The debugger attaches
to child processes, including API restarts after edits. Stopping either server stops both servers; the browser
debug session closes with the web server. Postgres and Redis stay running in their separate terminal.

Use **ISBP: API + worker** or **ISBP: Web + browser** to debug just one app. The web profile runs the font
preparation task before launching Next.js. Both profiles load the root `.env` when it exists and otherwise
use the local defaults. The web debug port is fixed at 3000; if you change it in `.vscode/launch.json`, also
update `PUBLIC_URL` for the API. To use Chrome, change `serverReadyAction.action` to `debugWithChrome`.

If Windows startup fails with `ERR_SWC_NATIVE_CACHE`, the compiler rejected permissions on its native
cache or a parent directory. Set `SWC_NATIVE_BINDING_CACHE` in the root `.env` to an absolute, private cache
directory whose parents do not grant other accounts replacement rights. A cache inside a profile shared
with sandbox accounts may still be rejected. The debug profile loads this setting automatically. See
[SWC's native cache guide](https://github.com/swc-project/swc/blob/main/docs/native-addon-carriers.md).

The launch profiles use VS Code's built-in JavaScript debugger and follow the
[Next.js debugging guide](https://nextjs.org/docs/app/guides/debugging).

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

## 7a. Notifications, approvals and API clients (Phase 1)

- **Email** is configured in the UI (_Administration → Notifications → Email_): SMTP host, port, TLS mode,
  user, password (encrypted with the master key) and sender. "Send test email" checks it end to end.
  Without email, notifications are in-app only and the email column in people's preferences is disabled.
- **Microsoft Teams / Slack / generic webhooks** are added as channels on the same page and subscribe to
  notification types (`core.access-request.*`, `announcements.post.published`, …). Webhook URLs are secrets
  (encrypted, never shown again). Generic webhooks are signed: `x-isbp-signature: t=<unix>,v1=<hex>` is
  HMAC-SHA256 of `"<t>.<body>"` with the channel's signing secret.
- Outbound webhooks are an SSRF surface: in production only public `https://` targets are allowed
  (`ISBP_ALLOW_PRIVATE_WEBHOOKS=true` lifts that for internal chat/automation endpoints). Allow egress from
  the worker pods to your mail server and webhook hosts (the chart's NetworkPolicy restricts ingress only).
- Deliveries run in the **worker** after commit with retries (5 attempts); the delivery log on the same
  page shows failures. Approval reminders, SLA escalations and "access ending soon" notices are worker jobs
  (`workflow-timers` every minute, `notify-expiring-access` hourly, `purge-notifications` nightly —
  retention is a core setting, default 90 days).
- Browsers receive live counters over **Server-Sent Events** (`/api/v1/me/notifications/stream`). Ingress
  and proxies must not buffer `text/event-stream` responses; the API sets `X-Accel-Buffering: no` and sends
  a heartbeat every 25 s. Raise idle timeouts above 30 s if your load balancer closes quiet connections.
- **API clients** (Role Query API) authenticate with `Authorization: Bearer` API keys or OAuth tokens from
  `POST /api/v1/oauth/token`. Tokens live in Redis for `OAUTH_TOKEN_TTL_SECONDS` (default 3600) and are
  revoked instantly when a client or secret is revoked. Expose `/api/v1/role-query/*` and `/api/v1/oauth/token`
  to the networks your applications call from; per-client IP allow-lists are available.

## 7b. AI gateway and semantic search (Phase 2)

- **Postgres needs pgvector** for semantic search with HNSW indexes. The compose files, Helm and CI use
  `pgvector/pgvector:0.8.7-pg18-trixie`. On managed Postgres, enable the `vector` extension _before_ the first migration.
  The embedding column type is chosen when migration `0005_ai_vectors` runs:
  - with pgvector available it is `vector`;
  - without it (e.g. `pnpm dev:services`) it falls back to a slow portable `real[]` column and the API logs
    a warning in production.

  Administration → AI shows the active mode.

- **Models are configured in the UI** (_Administration → AI_), not through environment variables. Keys are
  encrypted with the master key.
  - Chat: Anthropic (Claude; default model `claude-opus-5-5`, with server-side refusal fallbacks), or any
    OpenAI-compatible endpoint (OpenAI, Azure OpenAI, Ollama, vLLM, LM Studio, LiteLLM), or none.
    OpenAI-compatible endpoints speak **Chat Completions** (`/chat/completions`) or the **Responses API**
    (`/responses`, sent stateless with `store: false`). For Azure OpenAI's v1 API use
    `https://<resource>.openai.azure.com/openai/v1` (no `api-version` needed).
  - Embeddings: the builtin offline embedder, or an OpenAI-compatible one (OpenAI, Voyage AI, Ollama).
    Changing the embedding model re-embeds the index in the background (`ai-reindex`, every 10 minutes,
    bounded).
  - Reranker (optional): a Cohere-compatible `/rerank` API (Cohere, Jina, vLLM, Infinity, LiteLLM), Hugging Face
    Text Embeddings Inference, or Voyage AI. It reorders the best 30 search results; if it is down, search keeps
    working in its own order.
  - **Compare models on your content** before switching: on a seeded stack, `pnpm ai:eval` runs labelled questions
    in English, Traditional Chinese and Japanese through the knowledge search with the configured embedder and
    reranker, and prints recall@1, recall@5 and MRR per language.
  - **Gateways and self-signed servers.** Every endpoint takes **custom headers** (tenant, routing or proxy
    headers; values are encrypted like keys) and an audited **Skip TLS certificate checks** switch for model
    servers on your own network with self-signed certificates. Prefer a certificate your servers trust: put your
    CA into the image's trust store (`NODE_EXTRA_CA_CERTS`) instead of switching checks off.
- **Egress.** Allow the api and worker pods to reach the configured provider (e.g. `api.anthropic.com`).
  Self-hosted models keep all data inside your network.
- **Privacy and cost.**
  - Masking replaces emails, phone numbers, IPs, card numbers, national IDs and secrets with placeholders
    before a prompt leaves the platform, and restores them in the reply. It is on by default, and custom
    patterns are supported.
  - Every call is logged with tokens and estimated cost (`core.ai_usage`).
  - A monthly budget stops calls once it is spent (`AI_BUDGET_EXCEEDED`).
- **No model is required.** Without a chat model, Helpdesk AI runs in builtin mode: retrieval-based triage,
  templated replies, extractive summaries and article search in the virtual agent.

## 7c. Attachments (Phase 3)

Records (contracts, tickets, CIs, tasks, releases …) carry attachments. Choose where the bytes live:

| Store | Configuration                                                                                                                                                                                                                                                              |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Local | `FILES_STORAGE=local` (default). Development: `.dev-data/files`. Compose: the `files` volume. Helm: a PVC at `/var/lib/isbp/files` in api and worker pods; it must be **ReadWriteMany** (NFS, CephFS, Azure Files, EFS).                                                   |
| S3    | `FILES_STORAGE=s3`, `S3_BUCKET`, `S3_REGION`, optional `S3_ENDPOINT` + `S3_FORCE_PATH_STYLE=true` for MinIO/Ceph, `S3_SSE`. Credentials via `S3_ACCESS_KEY_ID`/`S3_SECRET_ACCESS_KEY` in the Secret, or the pod's identity (IRSA / workload identity). Recommended for HA. |

- **Malware scanning.** Set `CLAMAV_HOST` (and `CLAMAV_PORT`, default 3310) to a `clamd` service. Every upload
  is then scanned before it is stored, and uploads are **refused while the scanner is unreachable**.
- **Limits.** Administration → Modules → **Core platform** → **Settings**, under the advanced settings: "Largest
  attachment" (default 25 MB, at most 50 MB) and "Blocked file types" (the core settings `files.maxSizeMb` and
  `files.blockedExtensions`).
- **Upload path.** Uploads pass through the web server's proxy (it accepts up to 52 MB) and stream through
  `/tmp` in the API. Size the Helm `api.tmpSizeLimit` (default 512Mi) for concurrent uploads.
- **Backups.** Back up the volume or bucket together with the database. Rows in `core.files` point at
  `storage_key`s. Deleted files' bytes are purged hourly by the `core:purge-files` job.

## 7d. External databases and script jobs (Phase 4)

**Database connections.** Data APIs, ETL pipelines, SQL jobs and database account management reach external
databases through connections that administrators register in **Administration → Database connections**.

- **Engines and drivers.** SQL Server, PostgreSQL, MySQL and Oracle. All drivers are pure JavaScript (Oracle in
  Thin mode), so nothing extra goes into the image: no Oracle Instant Client and no ODBC.
- **Network.** The api and worker pods need TCP to each database (1433, 5432, 3306, 1521 by default). The
  chart's NetworkPolicies restrict only inbound traffic. If your cluster restricts egress, allow these
  destinations. Link-local and cloud-metadata addresses are always refused as database hosts.
- **TLS.** Each connection has an encryption setting: off, encrypt without verifying, or encrypt and verify
  against a CA bundle (stored sealed). Use "verify" in production. Oracle TCPS uses the system trust store.
- **Logins.** Use dedicated, least-privilege logins:
  - `data` connections that back Data APIs: read-only, plus EXECUTE on the procedures you publish. Mark the
    connection read-only, so writes are refused and queries run in read-only transactions where the engine has
    them. SQL Server relies on the login's permissions.
  - ETL targets: write access to the target schema only.
  - `admin` connections for Database access:
    - SQL Server: `ALTER ANY LOGIN`, plus `ALTER ANY USER`/`ALTER ANY ROLE` in the managed databases.
    - PostgreSQL: `CREATEROLE` with `ADMIN OPTION` on the requestable roles.
    - Oracle: `CREATE USER`, `ALTER USER`, `GRANT ANY ROLE` or `ADMIN OPTION` on specific roles.
- **Health.** The `core:check-databases` job tests every enabled connection every 30 minutes and records its
  status (shown on the admin page). The metric is `isbp_db_statements_total{engine,purpose,kind,outcome}`.

**Script jobs (Scheduled jobs).** Python, Node.js, PowerShell and shell scripts never run in the API or worker
processes. Choose a runner with `SANDBOX_RUNNER`:

| Runner       | Where                                                                                                                                                                                                                                                                                                                                                                         |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `kubernetes` | Helm `sandbox.runner=kubernetes`. The chart creates the namespace `sandbox.namespace` (Pod Security `restricted`, quota, limits), a ServiceAccount for the worker with a Role limited to Jobs, Secrets and pod logs there, and NetworkPolicies that deny all traffic for script pods unless a job allows egress (DNS + `sandbox.egress.allow` minus `sandbox.egress.except`). |
| `docker`     | Compose `--profile sandbox` with `SANDBOX_RUNNER=docker`. The worker reaches the host's Docker daemon through a socket proxy that allows only container and image calls. Prefer rootless Docker on that host.                                                                                                                                                                 |
| `local`      | Development only (default outside production). It runs Node.js scripts as child processes with only the job's environment, but without isolation. Refused when `NODE_ENV=production`.                                                                                                                                                                                         |
| `none`       | Default in production. Script jobs can't be enabled.                                                                                                                                                                                                                                                                                                                          |

- **Images.** Allowed images are listed in `SANDBOX_IMAGES` (Helm `sandbox.images`). In air-gapped clusters, mirror
  them and list the mirrored names.
- **Container settings.** Every script container runs as UID 65534 with a read-only root filesystem, a 64 MB
  `/tmp`, all capabilities dropped, no privilege escalation, CPU/memory/PID limits and a deadline. Kubernetes
  pods also get no service-account token.

## 7e. Integrations Hub (Phase 5)

Administrators connect outside systems in **Administration → Integrations**. Phase 5 ships connectors for the
on-premises editions of **ManageEngine ServiceDesk Plus** and **Azure DevOps Server**.

- **Network.** The worker (sync runs) and the api (connection tests, previews) call both servers directly on your
  network: the ServiceDesk Plus server URL (often port 8443) and the Azure DevOps Server collection URL. Connector
  hosts may be private addresses; link-local and cloud-metadata addresses are always refused. If your cluster
  restricts egress, allow these destinations.
- **Private CAs.** Azure DevOps Server usually has a certificate from an internal CA. Mount the CA bundle and point
  Node at it in both the api and the worker:

  ```yaml
  api: &trustInternalCa
    extraEnv:
      - { name: NODE_EXTRA_CA_CERTS, value: /etc/isbp/ca/internal-ca.pem }
    extraVolumes:
      - { name: internal-ca, configMap: { name: internal-ca } }
    extraVolumeMounts:
      - { name: internal-ca, mountPath: /etc/isbp/ca, readOnly: true }
  worker: *trustInternalCa
  ```

  Use `https://` URLs. A server that only speaks plain HTTP (ServiceDesk Plus listens on 8080 by default) needs the
  connection's **Allow insecure HTTP** switch: the API key or token and all synced data then cross the network
  unencrypted. Turning it on is confirmed, audited as a security event, and flagged "Not encrypted" on the
  connection. Prefer enabling HTTPS on the server (both products support it).

- **Webhooks (optional).** Sync runs on a schedule (every 15 minutes by default, per profile). For near real-time
  sync, the servers call `POST <PUBLIC_URL>/api/v1/integrations/hooks/<connection id>` with the connection's
  webhook secret in the `X-ISBP-Webhook-Secret` header: a ServiceDesk Plus custom trigger, and an Azure DevOps
  Server service hook (Web Hooks). Both call from your network, so nothing needs to be published to the internet.
  A webhook only triggers a re-read; its body is never used as data. Without webhooks, polling alone keeps both
  sides in sync.
- **Credentials.**
  - ServiceDesk Plus: the API key of a dedicated technician whose role covers the synced objects (requests,
    problems, changes, assets, solutions).
  - Azure DevOps Server: a personal access token of a dedicated service account with Work Items (read & write),
    Code (read) and Project and Team (read). PATs must be enabled on the server; Windows authentication isn't
    supported.
  - Both are sealed with `ISBP_MASTER_KEY` and never returned by the API.
- **Who can write what.** The hub writes as its agent identity (Integrations Hub), which only holds the `*.sync`
  permissions. Configuring a profile that writes an entity also needs that entity's `.sync` permission. Sync writes
  follow each module's rules: approvals (changes, disposals, project proposals) can't be skipped from outside.
- **Health.** Connections are tested every 15 minutes. Failing credentials mark the connection failing and notify
  integration administrators. Runs, conflicts and per-record errors are on the connection's page.
- **Development and CI** use stand-in servers (`tooling/integration-mocks`, port 4100, started by
  `pnpm dev:services`). The demo seed connects to them only when `INTEGRATION_MOCKS_URL` is set (it is by default
  in development). Production seeds create no connections.

## 7f. AI agent and MCP (Phase 6)

The **assistant** (module `assistant`) is the platform's built-in agent: it works through the platform's own MCP
tools (in-process), as the signed-in person, so nobody needs an outside tool. Configuration it builds is a **change
set**, applied in one transaction when the person confirms the agent's request (with their own permissions) or when a
reviewer approves it (the `assistant.change-set` workflow), and it can be rolled back. Destructive actions always wait
for the person's confirmation in the panel.

- **Model.** The assistant uses the chat model configured in **Administration → AI** (§7b), through the same
  gateway: masking, usage per feature (`assistant.chat`), the monthly budget. Without a chat model it offers guided
  templates instead of free text and says so. A capable model with tool use is needed for free-text requests
  (Claude Opus or Sonnet class; OpenAI-compatible endpoints that support streaming tool calls also work).
- **Who.** Everyone may use the assistant only if you grant it: the `assistant-user` role (`assistant.agent.use`).
  People can propose changes to the surfaces they can read; applying needs each surface's own manage permission.
  The default review workflow asks a platform administrator; bind your own in **Administration → Approval
  workflows** (trigger "Change set review"), e.g. role changes to identity administrators.
- **MCP for outside agents.** `POST <PUBLIC_URL>/api/v1/mcp` serves Claude Code, Claude Desktop and other MCP clients
  (Streamable HTTP; revision 2026-07-28 and the initialize-based 2025 revisions). It is reached through the web
  app's proxy like the rest of the API, needs no extra ingress rule, and keeps no sessions (any replica answers).
  Give each outside agent its own **API client** holding `core.mcp.use` plus what it should reach — usually
  `assistant.agent.use` and the read permissions of the surfaces it may propose changes to. Destructive tools are
  never offered over MCP, and its proposals are drafts until a person applies them. Requests with a browser
  `Origin` other than `PUBLIC_URL` are refused.
- **Audit.** Tool calls (`core.ai.tool_invoked`, with `via: mcp` for MCP), change sets (`assistant.change-set.*`)
  and every module audit entry written while applying (with the change set as `source`) are in the audit log.

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
- [ ] Email sender configured and tested; webhook channels point at public HTTPS endpoints (or
      `ISBP_ALLOW_PRIVATE_WEBHOOKS` deliberately enabled); ingress does not buffer Server-Sent Events.
- [ ] API clients scoped to the applications they need, keys with an expiry, IP allow-lists where possible.
- [ ] pgvector installed before the first migration. If AI is enabled: provider egress allowed, masking
      categories reviewed with your privacy officer, and a monthly budget set.
- [ ] Attachments: S3 bucket (versioning, SSE) or a backed-up ReadWriteMany volume; ClamAV `clamd` reachable
      (`CLAMAV_HOST`); upload limit and blocked types reviewed; `api.tmpSizeLimit` sized for concurrent uploads.
- [ ] Database connections use dedicated least-privilege logins (read-only for Data APIs; role administration
      only for account management) with TLS verification; egress from api/worker pods to those servers allowed.
- [ ] Script jobs: `sandbox.runner=kubernetes` (or none); sandbox namespace enforces Pod Security `restricted`;
      only reviewed images in `sandbox.images`; egress for scripts limited to what they need.
- [ ] Integrations: dedicated technician / service accounts with the rights listed in §7e; traffic to both
      servers allowed; internal CAs trusted with `NODE_EXTRA_CA_CERTS`; no connection left on "Allow insecure HTTP"
      without a documented reason; `INTEGRATION_MOCKS_URL` not set.
- [ ] AI agent: the `assistant-user` role granted deliberately; the change-set review workflow routes to the right
      approvers; one API client per outside agent with `core.mcp.use` and least privilege, keys with an expiry.
- [ ] Alerts on `/readyz` failures, 5xx rate and latency (`isbp_http_request_duration_seconds`), job failures
      (`isbp_jobs_total{status="failed"}`), and Postgres/Redis health.

## 9. CI/CD

`.github/workflows/ci.yml` runs on pushes to `main` and on pull requests (superseded PR runs are cancelled):

| Job           | What it does                                                                                                                                                                                                                      |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `quality`     | `pnpm install --frozen-lockfile`, `format:check`, `lint`, `typecheck`, `modules:check`, `test` (Turborepo cache restored)                                                                                                         |
| `integration` | `pnpm test:integration` against `pgvector/pgvector:0.8.7-pg18-trixie` + `redis:8.10-alpine` service containers (`isbp_test`)                                                                                                      |
| `e2e`         | Builds api + web, migrates and seeds, starts API, worker and the standalone web server, runs Playwright; uploads report + logs on failure                                                                                         |
| `docker`      | After `quality`: builds both images (GHA layer cache), smoke-tests them (non-root, migrate → API/worker ready, web health) and, on `main` only, pushes `ghcr.io/<owner>/isbp-{api,web}` tagged `main`, `sha-<short>` and `latest` |

Images are pushed with the workflow's `GITHUB_TOKEN` (`packages: write` is granted to the `docker` job only).
Deployments consume the immutable `sha-<short>` tags.
