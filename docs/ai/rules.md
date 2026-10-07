# Rules

Numbered so reviews can cite them ("violates R14"). **MUST** and **MUST NOT** are hard rules: CI, the
platform's start-up validation or a reviewer will reject the change. **SHOULD** marks the default you need a
reason to leave. Each rule says why, and how to check it.

## Module boundaries

**R1. A module MUST live in `modules/<id>` and reach the platform only through `ModuleContext` (server) and
`@isbp/sdk/web` + `@isbp/ui` (browser).** The kernel (`apps/api/src/kernel`) and core
(`apps/api/src/core`) are not importable from modules. _Check:_ no `apps/` import paths in `modules/`.

**R2. A module MUST NOT write another module's tables, nor call another module's services or HTTP routes.**
Cross-module effects go through events (R3), slots (R4), the record registry, task types, the AI tool registry
(`ctx.ai.tools.invoke`) or navigation to the other module's form (`?link=`). _Why:_ each module keeps its own
invariants, audit and permissions.

**R3. A module MAY read the tables of modules it lists in `dependsOn`** (import `@isbp/module-<dep>/schema`). It
SHOULD prefer events and the record registry, so the dependency can stay optional. Core tables (`@isbp/db/schema`)
may be read by every module.

**R4. Cross-module UI MUST use slots.** The host renders `<Slot name="<host>.<place>" props={…} />` and exports
the props type from its contracts (or `@isbp/contracts` for core slots). A contributor registers
`defineWebModule({ slots: [{ slot, load, permission }] })`. Existing slots are in [reference.md](reference.md).

**R5. Module ids MUST be kebab-case, 3–40 characters, and not reserved** (`assets`, `admin`, `api`, `settings`, …:
see `RESERVED_MODULE_IDS`). The id is the URL segment (`/api/v1/<id>`, `/<id>`), the Postgres schema
(dashes → underscores) and the prefix of every name the module declares.

## Manifest

**R6. Everything a module exposes MUST be declared in `manifest.ts` with the module's prefix:**
permissions `<id>.<resource>.<action>`, events `<id>.<entity>.<verb_past>`, notifications, workflow triggers
`<id>.<name>`, AI tools `<id>.<verb_noun>`, record types and task types. `defineManifest` and
`defineServerModule` refuse unprefixed names, handlers for undeclared names, and declared names without handlers.

**R7. User-visible manifest text MUST be an i18n key in the module's catalog** (`name`, `description`, nav
labels, permission descriptions, setting labels, record and task type names). The exceptions are role `name`
and `description`, which are plain English: they are stored in the database and admins can rename them.

**R8. Event payloads MUST have a Zod `schema` in the manifest, carry ids plus enough context to act without a
query (e.g. `{ ticketId, number, status }`), and never carry secrets or personal data beyond ids and display
names.** Consumers list the event in `events.consumes`.

## Data and migrations

**R9. Each module MUST own exactly one Postgres schema (`pgSchema('<id>')`) and keep all its tables in it.**
Columns referencing core rows (users, groups, departments) use foreign keys to `core.*` with
`onDelete: 'set null'` or `'cascade'` as appropriate. Never foreign-key into another module's schema.

**R10. Migrations MUST be generated, never hand-edited once applied:** change `src/server/schema.ts`, run
`pnpm --filter @isbp/module-<id> db:generate`, commit the SQL and the embedded `migrations/index.ts`. An applied
migration's hash is verified at start-up.

**R11. Lists MUST paginate on the server** (`listQuerySchema` + `pageSchema(item)`) and filter with indexed
columns. Pages must stay under 1 s for 100k rows. Add indexes for every filter and sort you offer.

**R12. Drizzle `sql` templates MUST NOT interpolate JS arrays** (`= any(${arr})` fails). Use `inArray()` or
`sql.join`. Search input goes through `likePattern()` (escapes `%` and `_`).

## Mutations

**R13. Every state change MUST run in `ctx.transaction(async (tx) => …)` and, in the same transaction, call
`ctx.audit.record({ action, entityType, entityId, entityLabel, changes }, { tx })` and
`ctx.events.publish(name, payload, { tx })`.** Notifications that belong to the change use `{ tx }` too. The audit
action equals the event name when there is one.

**R14. Side effects outside the database (HTTP calls, embeddings, provisioning, emails) MUST happen after commit:**
in an event handler, a job (`ctx.jobs.enqueue`) or the worker, never inside the transaction. Handlers MUST be
idempotent: delivery is at-least-once.

**R15. Deleting a linkable record MUST call `ctx.records.forget(ref, { tx })`** in the same transaction (it drops
its links and attachments).

## Security and authorization

**R16. Every route MUST declare `config.permission`.** Without `scoped`, a global grant is required. With
`scoped: true`, the handler MUST check the scope itself: `req.auth.require(perm, { recordType, recordId })` or
`{ departmentId }`, or filter lists with `req.auth.reach(perm)`. Routes without a permission are personal
(`/me/*`) and refused to API clients. `config.public` is only for sign-in, health and callbacks.

**R17. Authorization MUST live in one place per entity** (a pure `access.ts`: "who may do what with X"). Routes,
record resolvers, AI tools and DTO `viewer` blocks all use it, so the UI and the API can't disagree.

**R18. Record resolvers and search providers MUST return only what the caller may read**, with the same rules as
the module's own pages. `editable` means "may change this record's links and attachments".

**R19. Secrets (passwords, API keys, licence keys, tokens, connection credentials) MUST be sealed with
`ctx.secrets.seal` before storage, MUST NOT be returned by any API (return `{ set: true }`), MUST NOT be logged
or audited in clear, and reveals MUST be audited.**

**R20. SQL against external databases MUST go through `ctx.databases` with `:name` placeholders. Values MUST NOT
be concatenated into SQL text**, identifiers MUST come from `catalog()`, and DDL on a target server MUST be built
by that server's own quoting from bound parameters (`QUOTENAME` + `sp_executesql`, `format('%I %L')`,
`DBMS_ASSERT`). Every call names a `purpose` the connection allows.

**R21. Outbound HTTP MUST use `ctx.http`** (connect-time SSRF guard, allow-lists, caps). Untrusted code MUST run
through `ctx.sandbox`. Never use `fetch`, `child_process` or `vm` for these.

**R22. Destructive or privileged AI tools MUST set `destructive: true`** (the gateway then asks a person to
confirm), and every tool's `permission` MUST equal what the matching route requires.

**R23. User-provided Markdown/HTML MUST render through `@isbp/ui/markdown` (sanitised) or as text.** Never use
`dangerouslySetInnerHTML` with user content. Download routes set `Content-Disposition: attachment`.

## Errors and contracts

**R24. Errors MUST be thrown as `new HttpError(status, ErrorCodes.X, message, details)`.** The UI keys off
`code`, never `message`. A new code goes into `packages/sdk/src/http.ts` and every `errors.json` (en, zh-TW,
ja-JP).

**R25. Request and response shapes MUST be Zod schemas in the module's `contracts.ts`**, used by the route's
`schema` (querystring/params/body/response). Use the `dateTime` codec for timestamps, `z.stringbool()` for query
booleans (never `z.coerce.boolean()`), and `z.uuid()` for ids.

**R26. Update (PATCH) schemas MUST NOT inherit defaults.** Zod 4 `.partial()` keeps `.default()`, so omitted
fields would be overwritten. Build the update schema from a defaults-free field map (see
`packages/contracts/src/databases.ts`). A contracts test enforces this for core.

## i18n

**R27. Every user-visible string MUST exist in `messages/en.json`, `zh-TW.json` and `ja-JP.json`**, with the same
keys and the same ICU arguments. No string literals in JSX, toasts, `aria-label`s or emails. ICU strings MUST NOT
contain `<…>`. Use the terminology in [ui-guidelines.md](ui-guidelines.md#terminology).

**R28. Dates, numbers and relative times MUST be formatted with next-intl's formatter** (`useFormatter`) in the
viewer's locale and time zone. Never use `toLocaleString` or hand-built formats.

## UI and accessibility

**R29. Pages MUST meet WCAG 2.1 AA:** labelled controls, visible focus, keyboard operable (no traps), contrast
via the theme tokens, `role="status"`/`"alert"` for async results. Status MUST NOT be colour-only (icon + text).

**R30. Pages MUST work at 375 px without horizontal page scroll.** Wide tables and charts scroll inside their
own container. Grid children holding truncated text need `min-w-0` (and `grid-cols-1` before breakpoints).

**R31. List state (page, filters, search, tab) MUST live in the URL via `useListState`.** Tabs that only filter
still render a `TabsContent` per tab.

**R32. React components MUST NOT be created during render, and render MUST NOT mutate outer variables** (the
React Compiler lint enforces this). Self-referencing `useCallback`s recurse through an inner function.

**R33. Motion MUST respect reduced motion** (the app sets `MotionConfig reducedMotion="user"`; add
`motion-reduce:` variants to CSS transitions).

## Testing

**R34. A module MUST ship:** unit tests for pure logic and the manifest/catalog test (`test/manifest.test.ts`),
integration tests for its API (`apps/api/test/integration/<id>.test.ts`, real Postgres + Redis), and an e2e spec
(`e2e/tests/<id>.spec.ts`) covering its main flows, an axe scan of every page in light and dark mode, and a
375 px check.

**R35. Integration tests MUST use a `*_test` database** (the harness refuses others) and MUST poll for outbox
side effects (`eventually`/`expect.poll`) instead of asserting right after the request.

**R36. Demo data MUST come from the module's idempotent `seed(ctx)`.** Cross-module demo data (links, jobs
that reference other modules' records) goes into the platform seed (`apps/api/src/seed-phase*.ts`).

## Platform changes

**R37. A change to the SDK, kernel or contracts MUST keep existing modules compiling and passing.** Add, don't
break. Document new services in [api-reference.md](api-reference.md), add the rule here when there is one, and
regenerate [reference.md](reference.md).

**R38. Generated files MUST NOT be edited by hand:** `apps/*/src/generated/*` (`pnpm modules:sync`),
`migrations/index.ts` (`db:generate`) and `docs/ai/reference.md` (`pnpm docs:reference`).

**R39. Dependencies with install scripts MUST be listed under `allowBuilds` in `pnpm-workspace.yaml`** (pnpm
12). Prefer pure-JavaScript packages. Shared versions go in the `catalog:`.

## Integrations (Phase 5)

**R40. Records that should sync with an outside system MUST be exposed through a sync adapter**
(`manifest.syncEntities` + `defineServerModule({ sync })`) with a dedicated `<module>.<resource>.sync` permission.
Modules MUST NOT store remote ids or call connectors: the Integrations Hub's links hold the ids. _Why:_ one place
for mappings, conflicts and audit; a record can link to several systems.

**R41. An adapter's `write` MUST hold the module's rules, never fewer.** Write through the module's own service
logic in the hub's `tx`, publish the usual events with `{ tx }`, audit with `source` in the metadata, and refuse
what the UI would refuse, including statuses that need an approval (409 `INVALID_TRANSITION`,
`details.reason: 'approval_required'`). _Check:_ an integration test per refused transition.

**R42. A connector MUST reach its system only through `conn.http`** (the connection's own hosts), keep tokens in
`conn.cache`, never log or return secrets, and map remote failures to `REMOTE_AUTH_FAILED`, `REMOTE_RATE_LIMITED`, `REMOTE_CONFLICT` and `REMOTE_REJECTED`.

Config schemas accept `http://` and `https://`: the kernel refuses plain HTTP (422 `INSECURE_HTTP`) unless the
connection's audited **Allow insecure HTTP** switch is on. Connectors MUST NOT work around it.

**R43. Webhook bodies MUST NOT be trusted for data.** A connector's `webhook()` only says which records changed;
the hub re-reads them with `get`.

**R44. A connector SHOULD ship a stand-in in `tooling/integration-mocks`** and test against it in-process. Tests
and the demo never reach real tenants.
