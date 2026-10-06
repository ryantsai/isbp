# Module development guide

Every feature of IS Big Platform — including the platform's own identity/RBAC/audit features (the
`core` module) — is a **module** built on `@isbp/sdk`. Custom modules use exactly the same SDK; there
are no special cases. This guide builds one end to end.

## 1. Concepts

| Term            | Meaning                                                                                                                                                                                                            |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Installed**   | The module package is in `modules/` and compiled into the API and web builds (via generated registries).                                                                                                           |
| **Enabled**     | Runtime switch in **Admin → Modules**. A disabled module's API returns `404 MODULE_DISABLED`, its pages 404, its navigation disappears, and its jobs/event handlers/search are skipped. No redeploy, no data loss. |
| **Manifest**    | Declarative description (`src/manifest.ts`): navigation, permissions, default roles, events, settings, AI tools, search. Validated at boot.                                                                        |
| **Server part** | `defineServerModule(manifest, { routes, events, jobs, ai, search, seed, migrations })`                                                                                                                             |
| **Web part**    | `defineWebModule(manifest, { routes })` — pages served at `/<module-id>/*`                                                                                                                                         |

## 2. Create a module

```bash
pnpm create-module asset-tracker --icon package --description "Track hardware through its lifecycle"
```

This scaffolds `modules/asset-tracker`, installs it into both apps, generates the first migration and
regenerates the registries. With `pnpm dev` running, the API restarts, applies the migration and the
new module appears in the sidebar at `/asset-tracker`.

The scaffold is a complete, working CRUD module (list + detail pages, create/edit dialog, audit,
events, a scheduled job, an AI tool, global search, seed data, en/zh-TW/ja-JP catalogs and tests).
`modules/announcements` is the same scaffold shaped into a real feature — read it as a worked example.

```text
modules/asset-tracker/
├─ src/manifest.ts          ← start here
├─ src/contracts.ts         Zod schemas shared by API routes and pages
├─ src/server/schema.ts     Drizzle tables in Postgres schema "asset_tracker"
├─ src/server/routes.ts     REST endpoints under /api/v1/asset-tracker
├─ src/server/index.ts      defineServerModule(...)
├─ src/web/index.tsx        defineWebModule(...)
├─ src/web/pages/*.tsx      pages (client components)
├─ messages/{en,zh-TW,ja-JP}.json
├─ migrations/              generated SQL + embedded index.ts
└─ test/manifest.test.ts
```

To remove a module: delete its folder and run `pnpm modules:sync && pnpm install`. Its data stays in
the database (drop the schema yourself if you really want it gone).

## 3. The manifest

```ts
export const manifest = defineManifest({
  id: 'asset-tracker', // kebab-case; also URL segment and permission/event prefix
  version: '0.1.0',
  name: 'asset-tracker.meta.name', // i18n keys — the module's catalog namespace is its id
  description: 'asset-tracker.meta.description',
  icon: 'package', // any lucide icon name
  dependsOn: [], // other module ids (enforced on enable/disable)
  navigation: [
    {
      id: 'home',
      label: 'asset-tracker.nav.home',
      href: '/asset-tracker',
      icon: 'package',
      permission: 'asset-tracker.assets.read',
      section: 'main',
      order: 50,
    },
  ],
  permissions: [
    {
      key: 'asset-tracker.assets.read',
      description: 'asset-tracker.permissions.read',
      scopes: ['global', 'department'],
    },
    { key: 'asset-tracker.assets.manage', description: 'asset-tracker.permissions.manage' },
  ],
  roles: [
    {
      key: 'asset-tracker-viewer',
      name: 'Asset viewer',
      permissions: ['asset-tracker.assets.read'],
      grantByDefault: true,
    },
    { key: 'asset-tracker-manager', name: 'Asset manager', permissions: ['asset-tracker.assets.*'] },
  ],
  events: {
    emits: [{ name: 'asset-tracker.asset.retired', schema: z.object({ assetId: z.uuid() }) }],
    consumes: ['core.user.offboarded'],
  },
  settings: [{ key: 'tagPrefix', label: 'asset-tracker.settings.tagPrefix', type: 'string', default: 'IT-' }],
  ai: {
    tools: [
      {
        name: 'asset-tracker.find_assets',
        description: 'Find assets by tag, serial or owner.',
        input: z.object({ query: z.string() }),
        permission: 'asset-tracker.assets.read',
      },
    ],
  },
  search: { entities: ['asset'] },
});
```

Rules the validator enforces: permission keys are `module.resource.action` and start with the module
id; events are `module.entity.verb_past_tense`; AI tool names start with the module id; ids that
collide with platform routes are reserved.

- **Permissions** are synced into the catalog at boot. **Role templates** become read-only system roles;
  `grantByDefault: true` grants the role to every active user (via the implicit _Everyone_ group) when
  the role is first created — admins can revoke it afterwards.
- **Settings** render automatically as a form in Admin → Modules (`advanced: true` hides behind a
  disclosure; `type: 'secret'` is encrypted at rest and never returned).
- **AI tools** are listed for the AI gateway / MCP server (Phase 5). Mark anything privileged or
  destructive with `destructive: true` — it will always require human confirmation.

## 4. Server side

### Routes

Routes mount at `/api/v1/<module-id>` and are **authenticated and permission-gated by default**:

```ts
app.get('/assets', {
  config: { permission: 'asset-tracker.assets.read' },          // global grant required…
  schema: { tags: ['Assets'], querystring: assetQuerySchema, response: { 200: pageSchema(assetSchema) } },
}, async (req) => list(req.query));

app.patch('/assets/:id', {
  config: { permission: 'asset-tracker.assets.manage', scoped: true }, // …unless the handler checks scope itself
  schema: { params: z.object({ id: z.uuid() }), body: updateAssetSchema, response: { 200: assetSchema } },
}, async (req) => {
  const asset = await find(req.params.id);
  req.auth.require('asset-tracker.assets.manage', { departmentId: asset.departmentId }); // 403 + audited denial
  …
});
```

- `config.public: true` opts out of authentication; `config.csrf: false` skips CSRF (only for flows that
  carry their own proof, e.g. SAML POST).
- Use `req.auth.reach(permission)` to filter list queries by department/record scope.
- Zod schemas give validation, typed handlers **and** the OpenAPI document — every route you add appears
  in `/api/docs`. Dates use the `dateTime` codec from `@isbp/contracts` (handlers return `Date`).
- Shared helpers: `listQuerySchema` (page/pageSize/q/sort), `pageSchema(item)`, `likePattern(term)` for
  safe `ILIKE`, `httpErrors.*` and `new HttpError(status, code, message, details)`.

### The module context

Every route, job, event handler and AI tool receives a `ModuleContext`:

| Member                                                                                       | Use                                                                                 |
| -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `ctx.db`                                                                                     | Drizzle database (node-postgres)                                                    |
| `ctx.transaction(tx => …)`                                                                   | Run work atomically; pass `tx` to `audit.record` and `events.publish`               |
| `ctx.audit.record({ action, entityType, entityId, entityLabel, changes, metadata }, { tx })` | Immutable audit row; actor, IP, request id and trace id are filled in automatically |
| `ctx.audit.diff(before, patch)`                                                              | Field-level `[before, after]` changes (secrets redacted)                            |
| `ctx.events.publish(name, payload, { tx })`                                                  | Transactional outbox; delivered after commit                                        |
| `ctx.jobs.enqueue(name, data)`                                                               | Queue a background job                                                              |
| `ctx.settings.get(key)`                                                                      | Typed module setting (stored value or manifest default)                             |
| `ctx.rbac.permissionsFor(userId)`                                                            | Another user's effective permissions                                                |
| `ctx.logger`                                                                                 | Structured pino logger tagged with the module id                                    |

```ts
await ctx.transaction(async (tx) => {
  const [asset] = await tx.update(assets).set({ status: 'retired' }).where(eq(assets.id, id)).returning();
  await ctx.audit.record(
    {
      action: 'asset-tracker.asset.retired',
      entityType: 'asset-tracker.asset',
      entityId: id,
      entityLabel: asset.tag,
    },
    { tx },
  );
  await ctx.events.publish('asset-tracker.asset.retired', { assetId: id }, { tx });
});
```

### Database

- Each module owns **one Postgres schema** named after its id (`-` → `_`). Never write to another
  module's tables — use its API or events. Foreign keys to `core.users`/`core.departments` are fine.
- Change `src/server/schema.ts`, then run `pnpm --filter @isbp/module-asset-tracker db:generate`. This
  writes a SQL migration **and** embeds it into `migrations/index.ts` (the API bundle carries migrations,
  so images never read them from disk). For hand-written SQL use `pnpm exec drizzle-kit generate --custom`
  in the module folder, fill in the file, then run the embed step.
- Migrations run in order per module with an advisory lock, so many replicas can start safely. An
  applied migration must never change — the runner refuses to start if its hash differs.

### Events, jobs, search, seed

```ts
export default defineServerModule(manifest, {
  migrations,
  routes,
  events: {
    // At-least-once delivery with retries: handlers must be idempotent.
    'core.user.offboarded': async (event, ctx) => { /* release the person's assets */ },
  },
  jobs: {
    'warranty-reminders': { schedule: { cron: '0 8 * * 1', tz: 'Asia/Taipei' }, attempts: 3,
                            handler: async (job, ctx) => { await job.log('…'); } },
  },
  ai: { 'asset-tracker.find_assets': async (input, ctx, auth) => { … } },
  search: async (query, ctx, auth, limit) => [/* { id, type, title, subtitle, href, icon } */],
  seed: async (ctx) => { /* idempotent demo data for `pnpm db:seed` */ },
});
```

Event handlers and jobs run in the **worker** with a system principal (`module:<id>` / `job:<id>.<name>`),
so their audit rows are attributed correctly. Disabled modules' handlers are skipped.

## 5. Web side

```tsx
// src/web/index.tsx
export default defineWebModule(manifest, {
  routes: [
    { path: '/', load: () => import('./pages/list-page'), permission: 'asset-tracker.assets.read' },
    { path: '/:id', load: () => import('./pages/detail-page'), permission: 'asset-tracker.assets.read' },
  ],
});
```

Pages are client components that receive `{ params }`. Use the same building blocks as core pages:

| Import                | Provides                                                                                                                                                                                 |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@isbp/ui/query`      | `useApiQuery(path, query)`, `useApiMutation(fn, { invalidate, success })`, `applyServerErrors`                                                                                           |
| `@isbp/sdk/web`       | `useCan(permission)`, `usePlatform()` (user, permissions), `useApi()` (CSRF-aware fetch)                                                                                                 |
| `@isbp/ui/data-table` | Server-side `DataTable` + `useListState()` (paging/sort/filters kept in the URL)                                                                                                         |
| `@isbp/ui/*`          | Button, Dialog, Sheet, Form (React Hook Form), Select, Tabs, Badge, Card, EmptyState, PageHeader, SearchInput, RelativeTime, motion primitives (`FadeIn`, `Stagger`, `AnimatedNumber`) … |

UX conventions: `PageHeader` on every page, skeletons while loading, `EmptyState` for empty results,
advanced options behind a disclosure, permission-gated actions (`useCan`), and motion via
`motion/react` (the app's `MotionConfig` already honours `prefers-reduced-motion`).

### i18n

- All text comes from `messages/<locale>.json`; the namespace is the module id:
  `useTranslations('asset-tracker')`. Ship **en, zh-TW and ja-JP** — the catalog test fails if keys or ICU
  placeholders differ between locales.
- Manifest strings (names, nav labels, permission descriptions, setting labels) are keys into the same
  catalog.
- Label your audit actions under `audit` (`asset-tracker.asset.retired` → `audit.asset_retired`) and the
  audit log, dashboard and activity feeds show them translated.

## 6. Testing

- Unit tests live in the module (`pnpm --filter @isbp/module-asset-tracker test`).
- API-level tests use the integration harness in `apps/api/test/integration/harness.ts`
  (`pnpm test:integration`), which builds the real kernel against an `*_test` database — see
  `platform.test.ts` and `events.test.ts` for examples, including asserting audit rows, outbox events and
  cross-module event delivery.
- User journeys go in `e2e/tests` (Playwright + axe accessibility scans).

## 7. Checklist before shipping a module

- [ ] Every route declares a permission (or is deliberately `public`) and scoped routes call `req.auth.require`.
- [ ] Mutations run in a transaction with an audit record and (where useful) an event.
- [ ] Event handlers are idempotent; jobs have sensible `attempts`/`timeoutMs`.
- [ ] Destructive AI tools are marked `destructive: true`.
- [ ] Catalogs exist for en, zh-TW and ja-JP, including `audit` labels.
- [ ] `pnpm lint && pnpm typecheck && pnpm test && pnpm modules:check` pass.
