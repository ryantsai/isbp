# Definition of done

Tick every box before you report a module (or a change to one) as done. When a box doesn't apply, say why in
your report. The rule numbers point to [rules.md](rules.md).

## Declarations

- [ ] `manifest.ts` declares every permission, role, event (with Zod payload), notification, workflow trigger,
      record type, task type, AI tool, setting and nav entry the code uses, all prefixed with the module id (R6).
- [ ] User-visible manifest text is i18n keys. Role names and descriptions are plain English (R7).
- [ ] `events.consumes` lists exactly the events the server handles (R8).
- [ ] Nav entries have a `group`, `order` and `permission`; new icons are in `nav-icon.tsx`.

## Server

- [ ] Every route declares `config.permission`. Scoped routes check the scope in the service (R16).
- [ ] Authorization lives in `access.ts` and is reused by routes, resolvers and AI tools (R17).
- [ ] Every mutation is in `ctx.transaction` with audit + event in the same `tx` (R13). Side effects happen after
      commit, idempotently (R14).
- [ ] Lists paginate on the server, and filters and sorts are indexed (R11).
- [ ] Request and response bodies are Zod schemas in `contracts.ts`. PATCH schemas have no defaults (R25, R26).
- [ ] Errors use `HttpError` + `ErrorCodes`. New codes are in the SDK and all three `errors.json` (R24).
- [ ] Secrets are sealed, never returned or logged, and reveals are audited (R19).
- [ ] External databases, HTTP and scripts go only through `ctx.databases` / `ctx.http` / `ctx.sandbox`, with bound
      parameters and catalog identifiers (R20, R21).
- [ ] Deleting a linkable record calls `ctx.records.forget` (R15).
- [ ] Sync adapters write through the module's own logic in the hub's `tx`, with a `.sync` permission, and refuse
      what the UI refuses, approvals included (R40, R41). Connectors use only `conn.http`, typed remote errors
      and a mock-backed test (R42–R44).
- [ ] Resolvers and search providers return only what the caller may read (R18).
- [ ] Migrations are generated (`db:generate`), and no applied migration was edited (R10).
- [ ] `seed(ctx)` is idempotent and makes the UI look alive. Roles are granted to demo groups in the platform seed
      (R36).

## Web

- [ ] Pages follow the patterns in [ui-guidelines.md](ui-guidelines.md): `PageHeader`, `DataTable` +
      `useListState`, empty states, sheets/dialogs for forms, confirmations for destructive actions.
- [ ] Status is icon + text. Times are relative in lists and absolute in details (R28, R29).
- [ ] No string literals in JSX, `aria-label`s or toasts. Every key is in en, zh-TW and ja-JP with matching ICU
      arguments (R27).
- [ ] Keyboard-only use works. Focus is visible. Dialogs return focus. Charts have a table twin (R29).
- [ ] 375 px works without horizontal page scroll (R30).
- [ ] No components are created during render, and no outer variables are mutated during render (R32).

## Tests

- [ ] Unit tests cover pure logic, plus the manifest/catalog test (R34).
- [ ] Integration tests cover each route's happy path, permission refusals (403), validation (400), conflict and
      state errors (409), and the module's key business rules, on a `*_test` database. They poll for async
      effects (R35).
- [ ] The e2e spec covers the main flows, an axe scan of every page in light and dark mode, and a 375 px check.

## Integration with the platform

- [ ] `pnpm modules:sync` was run if the module was added or removed.
- [ ] `pnpm docs:reference` was run, and `docs/ai/reference.md` is committed (R38).
- [ ] The module `README.md` says what it owns, its rules, its API surface and its events.
- [ ] Notable decisions are added to `docs/architecture.md` (the phase's design section and decisions table).

## Commands (all must pass)

```bash
pnpm format:check && pnpm lint && pnpm typecheck && pnpm modules:check && pnpm docs:check && pnpm test
pnpm test:integration
E2E_BASE_URL=http://localhost:3000 pnpm e2e
```

## Review prompts

Ask these of every change, as an author before you report, or as a reviewer:

1. Can a user reach data or actions through this change that the UI would not show them (API, AI tool,
   resolver, search, export, slot)?
2. Is there any place where a value from a request ends up in SQL text, a shell command, a URL host, HTML or a
   log line?
3. If the worker crashes halfway, or an event is delivered twice, is the state still right?
4. Does every new string exist in three languages, and does the page work at 375 px with a keyboard and a
   screen reader?
5. Would another module's author find every name they need in `reference.md`, and every rule in the docs?
