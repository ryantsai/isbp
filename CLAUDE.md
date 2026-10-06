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
  never colour-only.

## Gotchas

- pnpm 12: install scripts must be listed under `allowBuilds` in `pnpm-workspace.yaml`.
- Next 16 differs from older versions: read `apps/web/node_modules/next/dist/docs/` before using an API.
  `proxy.ts` (not middleware) forwards `/api/*` to `API_INTERNAL_URL` at runtime and sets the CSP nonce.
- Turbopack dev can panic after `pnpm install` changes `node_modules`: stop it, `rm -rf apps/web/.next`, restart.
- The API dev process must run under `tsx watch` to reload; registry changes restart it.
- tsdown is configured with `fixedExtension: false` so entrypoints stay `dist/*.js` (Docker/Helm/CI rely on it).
