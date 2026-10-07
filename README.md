# IS Big Platform

A unified resource-management platform for IT operations — identity, access, service management,
assets, automation and AI — built as a **modular monolith**: a small kernel plus modules that all use
the same SDK. The UI ships in **English, 繁體中文（台灣）and 日本語**.

> **Status: Phase 2 complete.**
>
> - **Phase 2:** ITSM (incidents, requests, problems, changes with CAB approval, SLAs on business calendars),
>   a CMDB with impact analysis, a knowledge base, and Helpdesk AI, all running on a governed AI gateway.
> - **Phase 1:** approval workflows, forms and custom fields, notifications, the access-request portal and
>   the Role Query API.
> - **Phase 0:** the foundation (identity, RBAC, audit, SSO, module system).
>
> See [docs/architecture.md](docs/architecture.md) for the design and the phase plan.

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
  providers, two weeks of audit history and a few announcements — plus Phase 1 data: approval workflows,
  three published forms, custom fields, three external applications with roles, access requests and form
  submissions in every state (some waiting for `admin`), notification channels and an API client whose
  key is printed once at the end of the seed output.
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

## What's in Phase 1

| Area                              | Highlights                                                                                                                                                                                                                                                        |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Approvals**                     | Inbox with SLA badges, approve / reject (with reason) / hand over, out-of-office delegation, live counters in the navigation, a progress diagram and timeline for every request                                                                                   |
| **Workflow builder**              | Visual builder: sequential, parallel and conditional steps, approvers (people, groups, roles, manager chain, department head, "person in a field") with fallbacks, quorum, deadlines with reminders/escalation/auto-decisions, a test panel, versioned publishing |
| **Requests portal**               | Catalog of request types, "request access" wizard with a live preview of who will approve, request numbers (`REQ-01042`), progress tracking and withdrawal                                                                                                        |
| **Forms & custom fields**         | Drag-and-drop form builder with conditional logic and translations, attachable approval workflows; custom fields on people, groups and departments; one validator shared by browser and API                                                                       |
| **Notifications**                 | In-app (live via Server-Sent Events), email (SMTP), Microsoft Teams, Slack and signed webhooks; per-person preferences per notification type; delivery log                                                                                                        |
| **Applications & Role Query API** | External applications with their own permissions and roles; API clients with API keys or OAuth 2.0 client credentials; `GET /role-query/users/{user}?application=…`, `POST /role-query/check`, member listings                                                    |

## What's in Phase 2

| Area                    | Highlights                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Service desk (ITSM)** | <ul><li>Incidents, service requests, problems and changes, each with its own lifecycle (`INC-00042`, `SR-…`, `PRB-…`, `CHG-…`).</li><li>Priority from the ITIL impact × urgency matrix.</li><li>Agent workspace with queues and live SLA timers.</li><li>Timeline with public replies and internal work notes, links, affected CIs and custom fields.</li><li>A friendly "Report an issue" page that suggests knowledge articles while you type.</li><li>Requesters confirm fixes and rate the service (CSAT).</li></ul> |
| **SLA management**      | <ul><li>Policies matched by conditions, with response and resolution targets per priority on **business calendars** (time zones, working hours, holidays).</li><li>Timers pause in chosen statuses; warnings and breaches notify the right people.</li></ul>                                                                                                                                                                                                                                                             |
| **Changes & CAB**       | <ul><li>Standard, normal and emergency changes with a required approval workflow: change manager, CAB or emergency CAB, editable in the workflow builder.</li><li>A change calendar that flags overlapping changes on the same CI.</li></ul>                                                                                                                                                                                                                                                                             |
| **Service catalog**     | <ul><li>Phase 1 forms become catalog items fulfilled by the service desk.</li><li>Requesters follow one reference (`REQ-…`) from approval to fulfilment.</li></ul>                                                                                                                                                                                                                                                                                                                                                       |
| **CMDB**                | <ul><li>Configuration items with classes, owners and support groups.</li><li>Typed relationships, and an impact-analysis graph showing what breaks if this CI fails.</li></ul>                                                                                                                                                                                                                                                                                                                                           |
| **Knowledge base**      | <ul><li>Markdown articles in en, zh-TW and ja-JP with translations, review and publish (optionally with approval), versions, feedback and review dates.</li><li>Instant search that works across languages.</li></ul>                                                                                                                                                                                                                                                                                                    |
| **Helpdesk AI**         | <ul><li>Triage on every new ticket (with optional auto-apply), similar tickets, reply drafts with citations, summaries, and KB drafts from resolved tickets.</li><li>A virtual agent ("Ask IT") that answers from the knowledge base and opens a ticket only after you confirm.</li><li>Metrics for triage acceptance and deflection.</li></ul>                                                                                                                                                                          |
| **AI gateway**          | <ul><li>Anthropic (Claude) or any OpenAI-compatible model, including self-hosted ones; works fully offline with the builtin embedder.</li><li>Masks personal data before a prompt leaves the platform; tracks usage and cost; enforces a monthly budget.</li><li>One permission-aware semantic index (pgvector).</li><li>A governed tool registry: same RBAC, confirmation and audit as the UI.</li></ul>                                                                                                                |

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
modules/*         Feature modules: announcements (the sample), cmdb, knowledge, itsm, helpdesk-ai
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
