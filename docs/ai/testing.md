# Testing

Three layers, and every module ships all three (R34). Use the commands at the end before you say "done".

## Unit tests (Vitest, no database)

- **Where:** `modules/<id>/test/*.test.ts`, `packages/*/test`, `apps/api/test/unit`.
- **What:** pure logic in `model.ts` (state machines, calculations, schedules, formatting), contracts
  (round-trips, refusals), statement builders, and **the manifest/catalog test**. The catalog test validates
  the manifest and checks:
  - every key referenced by the manifest exists in all three catalogs;
  - the three catalogs have the same keys;
  - ICU arguments match per key.

  Copy `modules/alm/test/manifest.test.ts`.

- **Run:** `pnpm --filter @isbp/module-<id> test` or `pnpm test` (everything).

## Integration tests (real Postgres + Redis)

- **Where:** `apps/api/test/integration/<id>.test.ts` (plus `<id>-seed.test.ts` to prove the seed is idempotent).
- **Harness:** `createHarness({ extraModules? })` from `./harness`:
  - drops every ISBP schema in the `*_test` database and migrates;
  - creates `admin` (platform admin), `hr` (identity admin scoped to a department) and `outsider` (no roles);
  - builds the Fastify app.
- **Calling the API:** `h.login(username)` returns a session; `h.call(session, method, url, body)` returns
  `{ status, body }` with the cookie and CSRF header set.
- **Worker:** start it when you test outbox side effects (event handlers, notifications, workflow completion,
  jobs): `stopWorker = await startWorker(h.kernel)`. Stop it in `afterAll`.
- **Async effects:** poll, never sleep-and-assert (R35):

```ts
async function eventually<T>(fn: () => Promise<T>, accept: (v: T) => boolean, timeoutMs = 15_000) {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (accept(v) || Date.now() > until) return v;
    await new Promise((r) => setTimeout(r, 150));
  }
}
```

- **Users with roles:**
  - Insert users with `hashPassword(PASSWORD)`.
  - Assign roles by inserting `roleAssignments` (`roleId` of your manifest's role keys).
  - Call `await h.kernel.rbac.bump()` after the inserts.
  - For a service-level test without HTTP, build an `AuthContext` with `buildAuthContext(principal,
toSessionUser(user), null, await h.kernel.rbac.permissionsFor(user.id))`.
- **API clients:** create one through `POST /api/v1/api-clients` as admin (with `permissions`), then call with
  `Authorization: Bearer <secret>` via `h.app.inject`.
- **Fake modules:** to test a platform contract (a task type, a slot-less record type), define a tiny module
  inline with `defineManifest` + `defineServerModule` and pass it in `extraModules` (see
  `apps/api/test/integration/databases.test.ts`).
- **External databases:** insert a `core.db_connections` row pointing at the test Postgres (sealed password:
  `h.kernel.box.encrypt('…')`), and create the tables or roles you need. Postgres roles are cluster-wide: name them
  `itest_<random>` and drop them afterwards.
- **Isolation:**
  - The harness refuses databases whose name does not end in `_test`.
  - To run beside other work, give each run its own database and Redis index:
    `DATABASE_URL=postgres://isbp:isbp@localhost:5432/isbp_<x>_test REDIS_URL=redis://localhost:6379/<n>`.
  - `ISBP_TEST_MODULES=<id>,<deps>` loads only those modules.
- **Run:** `pnpm dev:services` (embedded Postgres + Redis), then `pnpm test:integration` or
  `npx vitest run --project integration test/integration/<id>.test.ts` from `apps/api`.

## End-to-end tests (Playwright + axe)

- **Where:** `e2e/tests/<id>.spec.ts`. They run against a seeded, running stack as the seeded admin (global setup
  stores the session).
- **Cover:**
  - the main flows against the demo data;
  - an axe scan (`wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`) of every page and of open sheets and dialogs, in light
    and dark mode;
  - a 375 px check (`overflowing(page)` from `helpers.ts`).
- **Import from `./fixtures`, not `@playwright/test`.** Its `page.goto` and `page.reload` wait until the app
  has hydrated (`<html data-hydrated="1">`) and any lazy module page has mounted (`data-module-page` is not
  `loading`). Clicking earlier hits server-rendered markup without handlers.
- **Patterns:**
  - Address elements by role and accessible name (`getByRole('dialog', { name: … })`), not CSS.
  - Wait for state (`toBeVisible`, `toContainText`), not time.
  - Call `settle(page)` before axe, so animations have finished.
  - Specs run serially and share the seeded data. Create what you change, or give it a unique name, and clean up.
  - Theme switching: `page.emulateMedia({ colorScheme, reducedMotion: 'reduce' })` + `localStorage.theme`.
- **Run:** `pnpm dev` with a fresh `pnpm db:reset`, then
  `E2E_BASE_URL=http://localhost:3000 pnpm e2e -- --workers=1 tests/<id>.spec.ts`. Use one worker locally: the dev
  server compiles pages on first visit. CI runs the full suite against a production build.

## Outside systems (Integrations Hub)

- `tooling/integration-mocks` (`@isbp/integration-mocks`) stands in for on-premises ServiceDesk Plus and Azure DevOps
  Server. Start it in-process: `const mocks = await createMockServer(); await mocks.listen({ port: 0 })`,
  point the connection's URL overrides at it, and use `MOCK_CREDENTIALS`. `/_mock/*` routes reset state, inspect
  records, edit them "as someone in the other system" (which fires the registered webhooks) and toggle rate limits.
- `pnpm dev:services` runs the mocks on port 4100 for the dev stack and the demo connections.
- Hub tests that shouldn't depend on a real connector or adapter use an inline fake module in `extraModules`
  (see `apps/api/test/integration/integrations.test.ts`).

## The AI agent (customisation kinds, change sets, MCP)

- Test a kind through `h.kernel.customizations` (see `apps/api/test/integration/customizations-core.test.ts`):
  apply every operation inside `h.kernel.db.transaction(…)`; prove a dry run (`dryRun: true` in a transaction you roll
  back) leaves no rows, versions, audit entries or outbox events; `baseVersion` mismatch → `CHANGE_SET_STALE`.
- Change sets, reviews, the chat loop and MCP are covered in `apps/api/test/integration/assistant.test.ts` with an
  inline fake module (two kinds on their own tables) and a fake OpenAI-compatible model (a local HTTP server that
  streams tool calls). Reviews complete through the worker: start it with `startWorker(h.kernel)` and poll.
- `tooling/integration-mocks` also serves a **scripted chat model** at `/llm/v1` (OpenAI-compatible, streaming):
  a user message with a ```json block of proposals makes it describe the kind, propose each change, name the change
  set and summarise it. The e2e suite points Administration → AI at it to drive the assistant panel, and
  `apps/api/test/integration/assistant-process.test.ts` starts it in-process (`createMockServer()`, then the
  `openai-compatible` chat settings at `<url>/llm/v1`) for the Phase 8 links and the review note.
- Demo data that spans modules is tested through its seed function with a small fixture (groups, users, CIs) instead
  of the whole demo: `process-builder-seed.test.ts` runs `seedPhase8Links` twice and checks routing and the change
  its action raised.

## External engines and sandboxes

- `@isbp/sql` driver tests (`pnpm --filter @isbp/sql test:drivers`) run against every engine whose URL is set:
  `ISBP_TEST_PG_URL`, `ISBP_TEST_MSSQL_URL`, `ISBP_TEST_MYSQL_URL`, `ISBP_TEST_ORACLE_URL`. CI runs all four as
  service containers.
- The Docker script runner test runs with `ISBP_TEST_DOCKER=1` (CI).

## Quality gate (what CI runs)

```bash
pnpm format:check && pnpm lint && pnpm typecheck && pnpm modules:check && pnpm docs:check && pnpm test
pnpm test:integration
E2E_BASE_URL=http://localhost:3000 pnpm e2e
```

CI also lints and renders the Helm chart, runs the driver suite and builds and smoke-tests the images.
