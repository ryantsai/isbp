# IS Big Platform — working notes

Modular monolith: Fastify API + worker (`apps/api`), Next.js 16 web (`apps/web`), module SDK
(`packages/sdk`), feature modules (`modules/*`). Design: `docs/architecture.md`. Module how-to:
`docs/module-development.md`. **Building or reviewing a module: follow `docs/ai/` (rules, system map, anatomy,
API reference, recipes, generated extension-point reference, testing, UI, definition of done); skills
`/new-module` and `/review-module`.** **Building any UI: `docs/ai/ui-components.md` (Astryx first: which component for
what, never invent one) and `docs/ai/ui-guidelines.md`.** Delivery is phased; finish a phase, then stop for review.

@packages/ui/AGENTS.md

## Commands

- Local infra without Docker: `pnpm dev:services` (embedded Postgres + Redis, data in `.dev-data/`)
- Run: `pnpm dev` (API + worker on :4000, web on :3000) · seed: `pnpm db:seed` · reset: `pnpm db:reset`
- Quality gate: `pnpm format:check && pnpm lint && pnpm typecheck && pnpm modules:check && pnpm docs:check && pnpm ui:check && pnpm test`
- UI: components come from Astryx — `pnpm astryx component <Name> --dense` (props), `pnpm astryx search "…"`, `pnpm astryx build "<idea>"`
  (page template). After editing the theme (`packages/ui/src/theme/tel.ts`): `pnpm ui:theme` and commit `src/theme/built`.
- After changing a manifest, slot or error code: `pnpm docs:reference` (regenerates `docs/ai/reference.md`)
- After changing the user guide: `pnpm docs:guide`; after changing screens it shows: `pnpm db:reset`, then
  `pnpm docs:screenshots` (stack running)
- Integration tests (real Postgres/Redis, `isbp_test` DB): `pnpm test:integration`
- E2E (stack must be running): `E2E_BASE_URL=http://localhost:3000 pnpm e2e`
- GitHub Actions CI is **disabled** (out of minutes; `gh workflow enable CI` turns it back on): run the gate,
  integration tests and e2e locally before pushing.
- New module: `pnpm create-module <id>` · after adding/removing modules: `pnpm modules:sync`

## Conventions

- **Everything is a module.** Core is `apps/api/src/core` (manifest + routes + services). Permissions are
  `module.resource.action`; events `module.entity.verb_past`; routes are permission-gated by default
  (`config.permission`, `scoped: true` + `req.auth.require(perm, scope)` for department/record scope).
- Mutations: `ctx.transaction` + `ctx.audit.record(..., { tx })` + `ctx.events.publish(..., { tx })`.
- Errors: throw `HttpError(status, ErrorCodes.X, message, details)`; the UI keys off **codes**, never
  messages. New codes go in `packages/sdk/src/http.ts` and every `errors.json`.
- DTOs/validation: Zod in `packages/contracts` (dates via the `dateTime` codec; query booleans via
  `z.stringbool()`, never `z.coerce.boolean()`).
- DB: Drizzle; one Postgres schema per module. After schema changes run the package's `db:generate`
  (generates SQL **and** embeds it into `migrations/index.ts`). Never edit an applied migration.
- i18n: every string in en, zh-TW **and** ja-JP; core catalogs are per namespace in
  `packages/i18n/messages/<locale>/`, module catalogs in `modules/<id>/messages/`. The catalog test
  (`packages/i18n`) fails on missing keys or mismatched ICU placeholders. zh-TW uses Taiwan IT vocabulary
  (人員, 群組, 角色, 權限, 稽核日誌, 工作階段); ja-JP uses Microsoft-style terms (ユーザー, ロール, 監査ログ).
- Web: **UI is Astryx** (`@astryxdesign/core/<Name>`, TEL theme in `packages/ui/src/theme`) plus the composites in
  `@isbp/ui`; never hand-roll a control or paste a shadcn/Radix snippet (ESLint rejects those imports, `pnpm ui:check`
  catches leftovers). Tailwind is layout glue only. Data hooks from `@isbp/ui/query` (`useApiQuery`, `useApiMutation`),
  theme mode from `@isbp/ui/theme` (not next-themes), toasts from `@isbp/ui/toast`, lists via `DataTable` + `useListState`
  (state in the URL). The React Compiler lint rules are on: don't create components or mutate outer variables during render.
- Accessibility & motion: WCAG 2.1 AA (axe scans in e2e), `MotionConfig reducedMotion="user"`; status is
  never colour-only. Status text/tints are theme tokens (`--color-text-red`, `--color-background-red`… in `tel.ts`, tuned for AA
  on their own 10–15% tints): check contrast before changing them. Tabs that switch panels use `TabList role="tablist"` +
  `Tab panelId` + a `role="tabpanel"`; tabs that only filter a list are a `SegmentedControl` (axe flags `aria-controls`
  pointing at nothing); grid items holding truncated text need `min-w-0` / `grid-cols-1` or pages overflow at 375px.
- Approvals: a module declares triggers in `manifest.workflows` (`required` + `defaultGraph` for ones that
  must always be approved), starts them with `ctx.workflows.start(trigger, input, { tx })` and reacts in
  `defineModule({ workflows: { [trigger]: { onCompleted } } })`. The step
  interpreter (`advanceWorkflow` in `@isbp/sdk`) is pure and shared by the API and the builder's simulator.
- Notifications: types in `manifest.notifications`, text in the module catalog under
  `notifications.<type minus module, dots and dashes → _>.{title,body}` (ICU; dates render in the recipient's zone).
  Send with `ctx.notifications.notify({ type, recipients, params, href }, { tx })`; channels run in the worker.
- Custom fields and forms share one `FieldDef` model and validator (`@isbp/sdk` `validateFields`);
  hidden (conditional) fields are stripped. Entities declare support in `manifest.customFields`.
- API clients/Role Query: service principals never reach personal routes (`/me/*`); grant per application
  via record-scoped `core.role-query.read`.

- AI (Phase 2): every module reaches models through the kernel gateway `ctx.ai`, never a provider SDK.
  `chat`/`stream`/`embed` mask personal data, log `core.ai_usage` per `feature`, and honour the budget.
  With no chat model (the default) every feature has a builtin mode, and the UI says which mode it is in.
  Searchable content goes in the shared index with `ctx.ai.index.upsert({ …, acl })` **from an event
  handler after commit** (embedding may call a remote API). Search with the caller's `auth`.
- Cross-module calls go through the AI tool registry, `ctx.ai.tools.invoke(name, input, { auth })`. It
  enforces the same permissions as the UI, with confirmation for `destructive` tools and audit. Background
  work runs as the module's declared `ai.agent` identity (`ctx.ai.agent()`). A module may _read_ the tables
  of modules it `dependsOn`, and never writes them.
- Cross-module UI uses slots: host `<Slot name="<module>.<place>" props />`, contribute via
  `defineWebModule({ slots })`, and export the props type from the host's contracts.
- Portal: `manifest.portal.entries` adds cards to "What do you need?". `ctx.portal.track()` lists module
  records under "My requests". `ctx.forms.setFulfilment()` shows a module's progress on a Phase 1 form
  request.

- Records (Phase 3): linkable types go in `manifest.records.types`, each with a resolver in
  `defineServerModule({ records })`. The resolver returns only what the caller may read, plus `editable`.
  Record pages host `<Slot name="core.record.links" props={{ record }} />` and `core.record.files`. Deleting a
  record calls `ctx.records.forget(ref, { tx })`, which refuses with `IN_USE` while open work or live settings use it
  (modules report theirs with `references` finders; groups too). To create a record in another module already linked, navigate to
  its form with `?link=<type>:<id>` (ITSM supports it). Never call the other module's API from the UI.
- Attachments go through the core panel and `ctx.files` (policy, sniffing, AV, audit). Never accept uploads in a
  module route. Store secrets (licence keys, credentials) with `ctx.secrets.seal/open`.

- External databases (Phase 4) only through `ctx.databases` (connections registered in Administration → Database
  connections). SQL uses `:name` placeholders bound by the driver (`@isbp/sql` tokenizer); identifiers come from
  `catalog()`; DDL on a target server is built by that server's quoting from bound parameters (`QUOTENAME`,
  `format('%I')`, `DBMS_ASSERT`). Never build SQL text from values. Name a `purpose` (`data`/`admin`) on every call.
- Work Scheduled Jobs can run is a task type: `manifest.taskTypes` + `defineServerModule({ taskTypes })`, run through
  `ctx.taskTypes`; its config editor is the web slot `scheduler.task-config.<module>.<type>`.
- Outbound HTTP only via `ctx.http` (connect-time SSRF guard, allow-lists); per-module Redis via `ctx.cache`;
  untrusted scripts only via `ctx.sandbox` (container runners; `local` is dev-only). Web code may import
  `@isbp/sql/params` (pure) but never the `@isbp/sql` root (drivers). SQL/script editors use `@isbp/ui/code-editor`.

- Integrations (Phase 5): records sync with outside systems through a **sync adapter** in the owning module
  (`manifest.syncEntities` + `defineServerModule({ sync })`, a `<module>.<resource>.sync` permission; writes in the
  hub's `tx`, held to the module's rules and approvals). Outside systems are **connector** modules
  (`manifest.connectors` + `connectors`; only `conn.http`, which refuses plain HTTP unless the connection's audited
  "Allow insecure HTTP" switch is on; typed `REMOTE_*` errors; settings form in the slot
  `integrations.connector-config.<module>.<type>`). The `integrations` module owns connections, profiles, mappings,
  links (remote ids live only there), runs and conflicts. Webhooks only trigger re-reads. Stand-ins for ServiceDesk
  Plus and Azure DevOps Server (both on-premises) are in `tooling/integration-mocks` (port 4100 via `pnpm dev:services`).

- AI agent (Phase 6): admin-configurable surfaces are **customisation kinds** owned by their module
  (`manifest.customizations` + `defineServerModule({ customizations })`: schema = the admin API's, `guide` with live
  reference data, `get` that round-trips, a transactional `apply` using only the `ctx` it gets — bound to the change
  set's transaction; creates need archive or delete for rollbacks). The `assistant` module turns proposals into
  **change sets**: dry-run in a rolled-back transaction, applied in one transaction by a person (or as the approver of
  an `assistant.change-set` review), rolled back in one. AI tools never write configuration in place: they propose.
  The **built-in agent** works through the platform's own MCP plumbing (`ctx.ai.mcp(auth, { includeDestructive })`,
  in-process, the same tools outside agents get); destructive tools (`assistant.apply_change_set`, any `destructive`
  tool) become a confirmation card and run as the person only when they confirm. Mark read-only tools
  `readOnly: true`. Outside agents use `POST /api/v1/mcp` (API clients with `core.mcp.use`; revisions 2026-07-28 and
  initialize-based 2025-x; destructive tools not offered). The scripted
  stand-in chat model for tests is `/llm/v1` in `tooling/integration-mocks`.

- User guide (Phase 7): `docs/guide/<locale>/*.md` (style and screenshot lists: `docs/guide/CONTRIBUTING.md`) is the
  user documentation, in all three languages with the UI's exact labels; translations keep the English `##`/`###`
  structure. `pnpm docs:guide` embeds it into `@isbp/guide` (and localises translations' anchors); the knowledge base
  publishes it as "Using IS Big Platform" (`guide-sync` job; the guide is the source of truth). In-app links are
  `guideHref(slug, anchor)` from `@isbp/guide/meta` (web code never imports the package root: it holds every guide).
  Screenshots: `pnpm docs:screenshots` against a freshly reset demo → `apps/web/public/help/<locale>/`. When a change
  alters what people see or do, update the guide in all three languages.

- Process builder (Phase 8, design §15): forms take `record` and `rows` (table) fields, form rules (`validateForm`;
  conditions read table columns across rows, `today` and `valueOffsetDays`) and actions (`FormAction`, optional
  `when`). What a request does after it's sent/approved/rejected is a module's **process action**
  (`manifest.processActions` + `defineServerModule({ processActions })`; runs as the module, in form order, retried).
  Approval steps can ask the approver for `fields`; values become facts `steps.<stepId>.<key>`. Records expose
  `facts` (only what readers may see) for record-field filters and routing. Requests are records (`core.request`:
  files and links). Recurring checklists are form assignments (task type `core.assign-form`, To do); dated reminders
  are the `core.remind` action. Ready-made process sets are built-in **change-set packages**
  (`manifest.customizationPackages`, content built per installer locale; installed as a draft change set, all or
  nothing). The `isms` module ships the ISMS process pack.
- **A process is configuration, never code** (`docs/architecture.md` §1, R56): code is only a **building block** any
  process can use, a **record type** (a module) or a **connector**. Name new code after what it does, never after the
  process or organisation that asked for it.

## Gotchas

- Astryx theme: `typography.*.family` is ONE font name (extra faces go in `fallbacks`); inside the nested dark `Theme` (navy rail,
  phone drawer) `light-dark()` always resolves dark; the built theme must be rebuilt (`pnpm ui:theme`) after every `tel.ts` edit.
  Dialogs/Sheets are controlled (no trigger component); `AlertDialog onAction` doesn't close; `Selector` has no empty-string value.
  Full list: `docs/ai/ui-components.md` → Pitfalls.
- pnpm 12: install scripts must be listed under `allowBuilds` in `pnpm-workspace.yaml`.
- Next 16 differs from older versions: read `apps/web/node_modules/next/dist/docs/` before using an API.
  `proxy.ts` (not middleware) forwards `/api/*` to `API_INTERNAL_URL` at runtime and sets the CSP nonce.
- Turbopack dev can panic after `pnpm install` changes `node_modules`: stop it, `rm -rf apps/web/.next`, restart.
- The API dev process must run under `tsx watch` to reload; registry changes restart it.
- tsdown is configured with `fixedExtension: false` so entrypoints stay `dist/*.js` (Docker/Helm/CI rely on it).
- Drizzle `sql` templates: never interpolate a JS array into `= any(...)` ("malformed array literal"); use
  `inArray()` or build the list with `sql.join`.
- Recursive Zod schemas need an explicit `z.ZodType<X, X>` annotation, or `z.input<>` collapses to `unknown`.
- ICU catalog strings can't contain `<…>` (parsed as tags); a self-referencing `useCallback` fails the
  React Compiler lint — recurse through an inner function instead.
- Outbox side effects (grants, deliveries) land asynchronously in the worker: tests poll (`eventually`,
  `expect.toPass`) instead of asserting right after the request.
- `core.ai_chunks.embedding` is `vector` (pgvector, HNSW per dimension) or `real[]` (embedded dev Postgres
  has no pgvector). The mode is chosen at migration time. The column is not in the Drizzle schema, so use raw SQL.
- Integration tests reset every module schema in their database. Parallel runs need their own
  `DATABASE_URL` (`*_test`) and `REDIS_URL` db index.
- E2E runs 2 workers (`e2e/playwright.config.ts`): every test signs in as the same admin, and more workers exceed the
  API's per-user rate limit (`RATE_LIMIT_MAX`), so random specs fail with 429.
- `assets` (and other static paths) are reserved module ids: Asset Management is `itam`.
- The web proxy buffers request bodies (`experimental.proxyClientMaxBodySize` in `next.config.ts`, 52 MB) and
  truncates beyond it. Uploads stream through `/tmp` in the API, so the Helm `api.tmpSizeLimit` must fit
  concurrent uploads.
- `core.record_links` ends are ordered by byte order (`collate "C"`); always go through `ctx.records`.
- Zod 4 `.partial()` keeps `.default()`s: an update schema derived from a create schema with defaults fills omitted
  fields and overwrites data on PATCH. Redefine defaulted fields without defaults first (contracts test enforces it).
- Node's `BlockList` matches IPv4 addresses against IPv6 rules such as `::ffff:0:0/96`: keep one list per family.
- `oracledb` runs in Thin mode (pure JS); its install script is disabled in `allowBuilds`. SQL Server, Oracle and
  MySQL driver tests run only in CI (`ISBP_TEST_*_URL`); locally there is no container runtime.
