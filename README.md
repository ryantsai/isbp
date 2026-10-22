# IS Big Platform

A unified resource-management platform for IS operations — identity, access, service management,
assets, automation and AI — built as a **modular monolith**: a small kernel plus modules that all use
the same SDK. The UI ships in **English, 繁體中文（台灣）and 日本語**.

> **Status: Phase 7 complete (awaiting review).**
>
> - **Phase 7:** the user guide: how to use each area for our IS work, for every role, with end-to-end scenarios
>   across modules, a glossary and FAQ, in English, 繁體中文 and 日本語 with screenshots of each language's screens.
>   It is also published in the knowledge base ("Using IS Big Platform", **Help** in the user menu), so Ask IS and
>   the assistant cite it. Start at [docs/guide/en/README.md](docs/guide/en/README.md).
> - **Phase 6:** the AI Agent: a built-in agent on every page — no outside tools needed — that works through the
>   platform's own MCP tools as you. It handles everyday work directly and customises the platform (approval
>   workflows, forms, custom fields, roles, notification routing, settings, scheduled jobs, pipelines, Data API
>   drafts, sync profiles, service desk categories, SLA policies and catalog items) as change sets it applies once you
>   confirm, or sends for review; every change set can be rolled back. Guided templates without a chat model, and the
>   same MCP server for outside agents such as Claude Code.
> - **Phase 5:** the Integrations Hub: two-way sync with on-premises ManageEngine ServiceDesk Plus (requests,
>   problems, changes, assets, solutions) and Azure DevOps Server (team projects, work items, Git status),
>   with field mappings, per-field conflict handling, webhooks, and approvals that can't be skipped from outside.
> - **Phase 4:** Data APIs & ETL (REST endpoints from parameterized SQL, pipelines between databases),
>   Scheduled jobs (HTTP, SQL, sandboxed scripts and module tasks, with retries and live logs), and Database
>   access (self-service database roles with approval, provisioning, expiry and reviews) on SQL Server,
>   Oracle, PostgreSQL and MySQL connections; plus a developer guide for AI coding agents (`docs/ai/`).
> - **Phase 3:** Asset Management (hardware, licences, contracts, vendors), Project Management (Kanban, Gantt,
>   workload) and Application Lifecycle (releases and deployments governed by change management), plus links
>   between records of any modules and attachments.
> - **Phase 2:** ITSM (incidents, requests, problems, changes with CAB approval, SLAs on business calendars),
>   a CMDB with impact analysis, a knowledge base, and Helpdesk AI, all running on a governed AI gateway.
> - **Phase 1:** approval workflows, forms and custom fields, notifications, the access-request portal and
>   the Role Query API.
> - **Phase 0:** the foundation (identity, RBAC, audit, SSO, module system).
>
> See [docs/architecture.md](docs/architecture.md) for the design and the phase plan.

## Quick start (no Docker needed)

Requirements: Node 24 LTS (24.11+), pnpm 12.

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
| **Helpdesk AI**         | <ul><li>Triage on every new ticket (with optional auto-apply), similar tickets, reply drafts with citations, summaries, and KB drafts from resolved tickets.</li><li>A virtual agent ("Ask IS") that answers from the knowledge base and opens a ticket only after you confirm.</li><li>Metrics for triage acceptance and deflection.</li></ul>                                                                                                                                                                          |
| **AI gateway**          | <ul><li>Anthropic (Claude) or any OpenAI-compatible model, including self-hosted ones; works fully offline with the builtin embedder.</li><li>Masks personal data before a prompt leaves the platform; tracks usage and cost; enforces a monthly budget.</li><li>One permission-aware semantic index (pgvector).</li><li>A governed tool registry: same RBAC, confirmation and audit as the UI.</li></ul>                                                                                                                |

## What's in Phase 6

| Area                        | Highlights                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Assistant** (`assistant`) | <ul><li>A built-in agent in a panel on every page: it knows where you are (the page, the record on it) and works through the platform's own MCP tools, as you — no outside tool needed.</li><li>Everyday work directly (tickets, comments, tasks, drafts); configuration as change sets it applies when you confirm (one click, with your permissions), or sends for review when you can't apply it yourself.</li><li>Without a chat model, guided templates (approval chain, request form, custom field, SLA targets, HTTP check, …) instead of free text.</li></ul> |
| **Change sets**             | <ul><li>Every proposal lands in a change set with a readable diff, a dry run of the whole set (in a transaction that is rolled back) and previews (the workflow diagram with the simulator, the form as people will see it).</li><li>Applied in one transaction by someone with the permissions, or through a review: approving applies it as the approver.</li><li>Rolled back in one transaction; refused when someone changed the configuration in between.</li></ul>                                                                                              |
| **Customisation kinds**     | <ul><li>Thirteen surfaces in core, Scheduled jobs, ETL, the Integrations Hub and ITSM; each owned by its module, built on its admin schemas and services, so an agent can't produce what the admin UI would refuse.</li><li>Any module can make its own configuration customisable the same way (`docs/ai/recipes.md` §23).</li></ul>                                                                                                                                                                                                                                 |
| **MCP server**              | <ul><li>`/api/v1/mcp` for Claude Code, Claude Desktop and other MCP clients: MCP 2026-07-28 and the initialize-based 2025 revisions.</li><li>API clients only (`core.mcp.use`), the same permission checks and audit as inside the platform; destructive tools are not offered; proposals become change sets a person applies.</li></ul>                                                                                                                                                                                                                              |

The demo seed leaves three change sets: one applied (a laptop-request approval, form and service catalog item), one
waiting in the administrator's approval inbox, and one draft. With no chat model configured, the panel shows the
guided templates.

## What's in Phase 5

| Area                                          | Highlights                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Integrations Hub** (`integrations`)         | <ul><li>Administration → Integrations: connections (sealed credentials, health, webhook secret), sync profiles with a field-mapping editor, value maps and a dry-run preview.</li><li>Two-way sync with a per-field three-way merge: independent edits merge, real conflicts go to a queue (or a rule decides), echoes are ignored.</li><li>Runs with live logs, linked records, a "Synced with" card on every record page.</li></ul> |
| **ServiceDesk Plus** (`sdp`, on-premises)     | <ul><li>Requests and problems ↔ tickets (notes ↔ comments), changes, assets (build 15100+ asset API, matched by serial number), solutions ↔ knowledge articles.</li><li>Technician API key; webhooks from custom triggers.</li></ul>                                                                                                                                                                                                  |
| **Azure DevOps Server** (`azdo`, on-premises) | <ul><li>Team projects, work items ↔ tasks (hierarchy, states, assignees, comments; Agile, Scrum and Basic), repositories → Git status on ALM applications (branches, last commit, pull requests).</li><li>Server 2019 to 2025 (API 5.0–7.2), personal access token, service hooks.</li></ul>                                                                                                                                          |
| **Safeguards**                                | <ul><li>Sync writes follow each module's rules: CAB approval, asset disposal and project proposals can't be skipped from outside.</li><li>HTTPS by default; plain HTTP only with an explicit, audited per-connection switch.</li><li>A dedicated `.sync` permission per entity; webhooks only trigger re-reads.</li></ul>                                                                                                             |

The demo connects to stand-in servers for both systems (`tooling/integration-mocks`, started by
`pnpm dev:services`), so the demo opens with linked tickets, assets, articles, tasks and repositories, one conflict to
resolve, and one asset whose disposal in ServiceDesk Plus waits for ISBP's approval.

## What's in Phase 4

| Area                             | Highlights                                                                                                                                                                                                                                                                                                                                                                                     |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Database connections** (core)  | <ul><li>Administration → Database connections: SQL Server, PostgreSQL, MySQL and Oracle, with encrypted credentials, TLS, and purposes (data or account administration).</li><li>Test before saving and browse the catalog. Every statement uses bound parameters (no SQL is ever built from values).</li></ul>                                                                                |
| **Data APIs & ETL** (`etl`)      | <ul><li>Publish REST endpoints from SQL with `:parameters` or from stored procedures: typed validation, versions, API-client allow-lists, rate limits, caching, CSV, OpenAPI and a test console.</li><li>Execution logs with latency and error rates.</li><li>Pipelines that stream rows between databases (insert, upsert or replace, column transforms, incremental watermarks).</li></ul>   |
| **Scheduled jobs** (`scheduler`) | <ul><li>HTTP calls, SQL tasks, Python/Node.js/PowerShell/shell scripts in container sandboxes, and tasks from other modules (ETL pipelines, inventory syncs).</li><li>Cron (time zones), intervals and "after another job".</li><li>Retries with backoff, timeouts, run history, live logs, failure alerts and a monitoring dashboard.</li></ul>                                               |
| **Database access** (`dbaccess`) | <ul><li>People request database roles in the portal. Approval goes to the manager, then the role owner, then security for high risk.</li><li>Accounts are provisioned automatically, and passwords are delivered as a one-time reveal.</li><li>Time-bound access with automatic revocation; access reviews; drift detection (unmanaged access) on SQL Server, Oracle and PostgreSQL.</li></ul> |
| **AI developer guide**           | <ul><li>`docs/ai/`: numbered rules, system map, module anatomy, API reference, recipes, testing, UI guidelines and definition of done.</li><li>A generated extension-point reference, checked in CI.</li><li>`AGENTS.md` and Claude Code skills (`/new-module`, `/review-module`).</li></ul>                                                                                                   |

The demo seed creates a demo database (`isbp_demo`, a small ERP and data warehouse) on the platform's Postgres,
so Data APIs, pipelines, SQL jobs and account provisioning run for real. The SQL Server, Oracle and MySQL demo
connections point at hosts that don't exist, so the failure states are visible too.

## What's in Phase 3

| Area                       | Highlights                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Assets** (`itam`)        | <ul><li>Hardware through its lifecycle (ordered → in stock → deployed → retired → disposed), with straight-line book value.</li><li>Disposal approval: asset manager, plus security for data-bearing devices.</li><li>Software licences: entitlement vs usage and discovered installs, with compliance alerts.</li><li>Contracts with renewal reminders and the signed PDF attached; vendors and spend.</li><li>"My devices" for every employee, with "Report a problem" that opens a ticket already linked to the device.</li></ul> |
| **Projects**               | <ul><li>Projects with members, allocation, milestones and health updates; large proposals go through approval.</li><li>A Kanban board with keyboard drag-and-drop and a "Move to…" menu.</li><li>A Gantt timeline with dependencies and milestones (plus a table view).</li><li>Workload per person per week against capacity.</li><li>Tasks link to tickets, changes, CIs and releases.</li></ul>                                                                                                                                   |
| **Applications** (`alm`)   | <ul><li>Application inventory: owners, team, stage, criticality, hosting, CMDB CI and repositories.</li><li>Environments with the version they run; releases with a readiness checklist and Markdown release notes.</li><li>Deployments recorded in the UI or by CI/CD pipelines (`POST /api/v1/alm/deployments`).</li><li>Production needs an approved change (overrides are audited), and DORA delivery metrics per application.</li></ul>                                                                                         |
| **Linked records & files** | <ul><li>Link any record to any other (a task ↔ an incident, a release ↔ a change); each module decides who may see its records.</li><li>Attachments on tickets, CIs, assets, contracts, tasks and releases: local volume or S3, type and content checks, optional ClamAV scanning.</li></ul>                                                                                                                                                                                                                                         |

Integrations with **ManageEngine ServiceDesk Plus** (on-premises) and **Azure DevOps Server** (two-way) are planned for
Phase 5; the Phase 3 data models already map onto them (work item types and hierarchy, repositories, asset
identifiers).

## Repository layout

```text
apps/api          Fastify API + worker (one image: main, worker, migrate, seed)
apps/web          Next.js 16 app shell and core admin pages
packages/sdk      Module SDK — manifest spec, defineServerModule, defineWebModule, permissions
packages/db       Drizzle schema for core, migration runner, embedded migrations
packages/contracts Zod DTOs shared by API and web
packages/ui       UI layer: Astryx TEL theme, app composites (DataTable, Sheet…), Motion, data hooks
packages/i18n     Locales and core message catalogs (en, zh-TW, ja-JP)
packages/create-module  `pnpm create-module` scaffolder + registry sync + docs generators
packages/guide    The user guide embedded for the knowledge base's in-app help (generated)
modules/*         Feature modules: announcements (the sample), cmdb, knowledge, itsm, helpdesk-ai, itam, projects, alm,
                  etl, scheduler, dbaccess
packages/sql      Driver-neutral access to external databases (bound parameters, dialects, catalog, writers)
infra/            Dockerfiles, docker-compose, Helm chart
e2e/              Playwright end-to-end + accessibility tests
docs/             Architecture, module guide, API guide, deployment; docs/guide: the user guide (3 languages)
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
| `pnpm docs:guide` · `pnpm docs:screenshots`          | Embed the user guide for in-app help · re-capture its screenshots (+ `tour`)           |
| `pnpm build`                                         | Production builds (API bundle via tsdown, Next.js standalone)                          |

## Documentation

- **User guide** — how to use ISBP for our work: [English](docs/guide/en/README.md) ·
  [繁體中文](docs/guide/zh-TW/README.md) · [日本語](docs/guide/ja-JP/README.md) (also in the app: **Help** in the
  user menu); contributing: [docs/guide/CONTRIBUTING.md](docs/guide/CONTRIBUTING.md)
- [Architecture](docs/architecture.md) — diagrams, data model, manifest spec, key decisions, security model
- [Module development guide](docs/module-development.md) — build a module end to end
- [API guide](docs/api.md) — authentication, conventions, errors, OpenAPI
- [Deployment](docs/deployment.md) — Docker Compose, Helm, secrets, observability, CI/CD
