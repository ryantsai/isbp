# IS Big Platform — working notes

Modular monolith: Fastify API + worker (`apps/api`), Next.js 16 web (`apps/web`), module SDK
(`packages/sdk`), feature modules (`modules/*`). Design: `docs/architecture.md`. Module how-to:
`docs/module-development.md`. Delivery is phased; finish a phase, then stop for review.

## Commands

- Local infra without Docker: `pnpm dev:services` (embedded Postgres + Redis, data in `.dev-data/`)
- Run: `pnpm dev` (API + worker on :4000, web on :3000) · seed: `pnpm db:seed` · reset: `pnpm db:reset`
- Quality gate: `pnpm format:check && pnpm lint && pnpm typecheck && pnpm modules:check && pnpm test`
- Integration tests (real Postgres/Redis, `isbp_test` DB): `pnpm test:integration`
- E2E (stack must be running): `E2E_BASE_URL=http://localhost:3000 pnpm e2e`
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
- Web: data hooks from `@isbp/ui/query` (`useApiQuery`, `useApiMutation`), theme from `@isbp/ui/theme`
  (not next-themes), lists via `DataTable` + `useListState` (state in the URL). The React Compiler lint
  rules are on: don't create components or mutate outer variables during render.
- Accessibility & motion: WCAG 2.1 AA (axe scans in e2e), `MotionConfig reducedMotion="user"`; status is
  never colour-only. Status text uses the `--success/--info/--destructive` tokens (tuned for AA on their
  own 8–15% tints): check contrast before changing them. Tabs that only filter a list still render a
  `TabsContent` per tab (axe flags `aria-controls` pointing at nothing); grid items holding truncated text
  need `min-w-0` / `grid-cols-1` or pages overflow at 375px.
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

## Gotchas

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
