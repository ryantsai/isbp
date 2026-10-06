# IS Big Platform

A unified resource-management platform for IT operations — identity, access, service management,
assets, automation and AI — built as a **modular monolith**: a small kernel plus modules that all use
the same SDK. The UI ships in **English, 繁體中文（台灣）and 日本語**.

> **Status: Phase 0 (Foundation) complete.** Identity, RBAC, audit, the module system, SSO, the app
> shell and the deployment/CI foundation are in place. See [docs/architecture.md](docs/architecture.md)
> for the design and the phase plan.

## Quick start (no Docker needed)

Requirements: Node 22.12+ (24 recommended), pnpm 12.

```bash
pnpm install
```

```bash
pnpm dev:services
```

```bash
pnpm db:seed
```

```bash
pnpm dev
```

- `pnpm dev:services` runs an embedded PostgreSQL and Redis (data in `.dev-data/`). Keep it running in its
  own terminal. With Docker you can instead run
  `docker compose -f infra/compose/docker-compose.dev.yml up -d`.
- `pnpm db:seed` applies migrations and loads demo data: ~180 people across a 15-department org (English,
  Taiwanese and Japanese names), groups, roles, scoped and time-bound assignments, sample sign-in
  providers, two weeks of audit history and a few announcements.
- `pnpm dev` starts the API + worker (http://localhost:4000) and the web app (http://localhost:3000). If port 3000 is busy, use `WEB_PORT=3100 pnpm dev`.

Sign in at http://localhost:3000 with **`admin` / `ChangeMe-2026!`**. Other demo accounts (password
`Demo-2026!pass`) show least-privilege in action:

| User         | What they can do                                                        |
| ------------ | ----------------------------------------------------------------------- |
| `hr.partner` | Identity administration **only for the Sales department subtree**       |
| `helpdesk`   | Look up people and groups; manage members of the _VPN Users_ group only |
| `auditor`    | Read-only access to every module and the audit trail                    |

API reference (OpenAPI 3.1, interactive): http://localhost:4000/api/docs · raw spec: `/api/openapi.json`.

## What's in Phase 0

| Area              | Highlights                                                                                                                                                                                                                                              |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **App shell**     | Animated sidebar (collapsible, mobile drawer), page transitions, ⌘K / Ctrl K command palette with federated search, light/dark/system theme, language switcher, skip links; motion honours `prefers-reduced-motion`                                     |
| **Identity**      | People with a lifecycle (pre-board → onboard → suspend/reactivate → offboard), org hierarchy, groups, manager chains, sessions                                                                                                                          |
| **Sign-in**       | Local accounts (argon2id, lockout), **OIDC** (Microsoft Entra ID preset, PKCE), **SAML 2.0**, **LDAP/AD** bind + scheduled directory sync, JIT provisioning, IdP group → platform group mapping                                                         |
| **RBAC**          | `module.resource.action` permissions with wildcards; roles assigned to people or groups, scoped **global / department subtree / single record**, optionally **time-bound**; privilege-escalation guard; "why does this person have access" explanations |
| **Audit**         | Append-only (enforced by Postgres triggers), per-row SHA-256 integrity hash, searchable UI with diffs and verification, CSV export                                                                                                                      |
| **Module system** | Manifest-driven modules (routes, nav, permissions, roles, events, jobs, settings, AI tools, search), runtime enable/disable, `pnpm create-module <name>` scaffolder, sample **Announcements** module                                                    |
| **Event bus**     | Transactional outbox → BullMQ with per-subscriber retries; modules react to each other without imports                                                                                                                                                  |
| **Ops**           | OpenTelemetry tracing, structured JSON logs, Prometheus metrics, health/readiness probes, Docker images, docker-compose, Helm chart, GitHub Actions CI                                                                                                  |

## Repository layout

```text
apps/api          Fastify API + worker (one image: main, worker, migrate, seed)
apps/web          Next.js 16 app shell and core admin pages
packages/sdk      Module SDK — manifest spec, defineServerModule, defineWebModule, permissions
packages/db       Drizzle schema for core, migration runner, embedded migrations
packages/contracts Zod DTOs shared by API and web
packages/ui       Component library (shadcn/ui on Radix + Motion), DataTable, data hooks
packages/i18n     Locales and core message catalogs (en, zh-TW, ja-JP)
packages/create-module  `pnpm create-module` scaffolder + registry sync
modules/*         Feature modules (announcements is the sample)
infra/            Dockerfiles, docker-compose, Helm chart
e2e/              Playwright end-to-end + accessibility tests
docs/             Architecture, module guide, API guide, deployment
```

## Everyday commands

| Command                                              | What it does                                                                           |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `pnpm dev`                                           | API + worker + web with hot reload                                                     |
| `pnpm dev:services`                                  | Embedded Postgres + Redis for local development                                        |
| `pnpm db:migrate` / `pnpm db:seed` / `pnpm db:reset` | Migrations, demo data, drop everything and reseed (dev only)                           |
| `pnpm create-module <name>`                          | Scaffold a working module and wire it into both apps                                   |
| `pnpm modules:sync`                                  | Regenerate installed-module registries (after adding/removing a module)                |
| `pnpm lint` · `pnpm typecheck` · `pnpm format`       | Code quality                                                                           |
| `pnpm test`                                          | Unit tests (SDK, contracts, i18n catalog parity, API, modules)                         |
| `pnpm test:integration`                              | API integration tests against a real Postgres/Redis (`isbp_test` database)             |
| `pnpm e2e`                                           | Playwright journeys + axe accessibility scans against a running stack (`E2E_BASE_URL`) |
| `pnpm build`                                         | Production builds (API bundle via tsdown, Next.js standalone)                          |

## Documentation

- [Architecture](docs/architecture.md) — diagrams, data model, manifest spec, key decisions, security model
- [Module development guide](docs/module-development.md) — build a module end to end
- [API guide](docs/api.md) — authentication, conventions, errors, OpenAPI
- [Deployment](docs/deployment.md) — Docker Compose, Helm, secrets, observability, CI/CD
