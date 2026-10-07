---
name: new-module
description: Build a new IS Big Platform module (plugin) end to end — manifest, schema, services, routes, web pages, i18n in en/zh-TW/ja-JP, tests and seed — following docs/ai. Use when asked to add a module, plugin or feature area with its own data.
---

# Build a new module

You are adding a feature module to IS Big Platform. Follow the platform guide; don't improvise patterns it already
defines.

## 0. Understand the request and the platform

1. Read `docs/ai/README.md`, `docs/ai/rules.md` (all of it) and `docs/ai/system-map.md`.
2. Decide what the module owns (its entities and lifecycle) and what it only references. Check
   `docs/ai/reference.md` for the permissions, events, record types, slots and task types that already exist:
   reuse them instead of duplicating.
3. Pick the module id (kebab-case, not reserved) and write a short design. Add it to `docs/architecture.md` under
   the current phase's design section when the change belongs to a phase:
   - entities and states;
   - permissions and roles;
   - events emitted and consumed;
   - slots hosted and contributed;
   - approvals, notifications, jobs and task types.

## 1. Scaffold

```bash
pnpm create-module <id> --description "…" --icon <lucide-name>
```

Replace the template "items" code completely (keep the layout from `docs/ai/module-anatomy.md`).

## 2. Declare (manifest.ts)

Write everything the module exposes. Follow `docs/ai/api-reference.md` §1 and the naming table in
`docs/ai/module-anatomy.md`.

## 3. Data

1. Write `src/server/schema.ts` (one `pgSchema('<id>')`, indexes for every filter and sort).
2. Run `pnpm --filter @isbp/module-<id> db:generate`.
3. Write `contracts.ts` (Zod DTOs; PATCH schemas without defaults) and `model.ts` (pure logic).

## 4. Server

1. `access.ts` (who may do what), services (transaction + audit + event for every mutation), thin `routes.ts`
   (each with a permission and full schema).
2. Event handlers, jobs, record resolvers, task types, AI tools, workflows and search, as declared.
3. An idempotent `seed.ts` with realistic history.

Use the patterns in `docs/ai/recipes.md`.

## 5. Web

`defineWebModule` routes and slots, pages per `docs/ai/ui-guidelines.md`, and catalogs in en, zh-TW and ja-JP
(same keys and ICU arguments; terminology table).

## 6. Tests

1. Unit tests (`test/model.test.ts`, `test/manifest.test.ts`).
2. Integration tests (`apps/api/test/integration/<id>.test.ts`).
3. The e2e spec (`e2e/tests/<id>.spec.ts`, with axe in light and dark mode and a 375 px check).

See `docs/ai/testing.md`.

## 7. Wire up and verify

```bash
pnpm modules:sync && pnpm docs:reference
pnpm format:check && pnpm lint && pnpm typecheck && pnpm modules:check && pnpm docs:check && pnpm test
pnpm test:integration
```

Then grant the module's roles to demo groups in the platform seed, add nav icons to
`apps/web/src/components/nav-icon.tsx`, run the e2e spec against a reset and seeded stack, and look at every page
at 1280 px and 375 px in light and dark mode.

## 8. Report

Go through `docs/ai/checklist.md` box by box. Report what you built, the decisions you took, anything not done,
and the test results. Do not commit or push unless asked.
