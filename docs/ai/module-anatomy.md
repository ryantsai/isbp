# Module anatomy

What a module is made of, file by file, and where each kind of code goes. `pnpm create-module <id>` produces a
working skeleton with an "items" example. Replace the example, but keep the layout. The mature modules to copy
from are `modules/alm`, `modules/itam`, `modules/projects`, `modules/etl`, `modules/scheduler` and `modules/dbaccess`.

## Layout

```text
modules/<id>/
├── package.json            @isbp/module-<id>; "isbp": { "module": true, "id": "<id>" }; exports (below)
├── tsconfig.json, eslint.config.js, drizzle.config.ts
├── README.md               what the module owns, its rules, its API — for humans and agents
├── messages/
│   ├── en.json             namespace "<id>": meta, nav, permissions, settings, audit, notifications, …
│   ├── zh-TW.json          same keys, same ICU arguments
│   └── ja-JP.json
├── migrations/             generated: NNNN_*.sql, meta/, index.ts (embedded) — never hand-edit applied ones
├── src/
│   ├── manifest.ts         defineManifest({...}): everything the module declares (pure data + Zod)
│   ├── contracts.ts        Zod DTOs and enums shared by server and web (no server imports)
│   ├── model.ts            pure domain logic: state machines, calculations, formatting (unit-tested)
│   ├── server/
│   │   ├── index.ts        defineServerModule(manifest, { migrations, routes, events, jobs, ai, records, taskTypes, workflows, search, seed })
│   │   ├── schema.ts       Drizzle tables in pgSchema('<id>')
│   │   ├── access.ts       who may do what (pure, used everywhere)
│   │   ├── services.ts     services(ctx): one object per entity with list/get/create/update/remove
│   │   ├── <entity>.ts     service implementation (transactions, audit, events)
│   │   ├── routes.ts       routes(app, ctx): thin HTTP layer → services
│   │   ├── records.ts      record resolvers + search provider
│   │   ├── ai.ts           AI tool handlers (call the same services)
│   │   └── seed.ts         idempotent demo data
│   └── web/
│       ├── index.tsx       defineWebModule(manifest, { routes, slots })
│       ├── pages/*.tsx     one default-exported component per route
│       ├── slots/*.tsx     one default-exported component per slot contribution
│       └── *.tsx           shared components, lib.ts (hrefs, formatting), badges.tsx (status → tone/icon)
└── test/
    ├── manifest.test.ts    manifest valid + every catalog key in 3 locales with matching ICU args
    └── model.test.ts       pure logic
```

Tests that need the database live in `apps/api/test/integration/<id>.test.ts`, and the e2e spec in
`e2e/tests/<id>.spec.ts`.

## package.json exports

```json
{
  "name": "@isbp/module-<id>",
  "isbp": { "module": true, "id": "<id>" },
  "exports": {
    "./manifest": "./src/manifest.ts",
    "./contracts": "./src/contracts.ts",
    "./model": "./src/model.ts",
    "./schema": "./src/server/schema.ts",
    "./server": "./src/server/index.ts",
    "./web": "./src/web/index.tsx",
    "./messages/*": "./messages/*"
  }
}
```

Other modules may import only `./manifest`, `./contracts`, `./model` and (when they `dependsOn` you) `./schema`.
`./server` and `./web` are loaded by the platform's generated registries.

## Boundaries inside a module

| Layer          | May import                                                                                       | Must not                                   |
| -------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------ |
| `manifest.ts`  | `@isbp/sdk`, `zod`, `./contracts`                                                                | server or web code                         |
| `contracts.ts` | `@isbp/sdk`, `@isbp/contracts`, `zod`                                                            | Drizzle, React, Node APIs                  |
| `model.ts`     | `./contracts`, pure libraries                                                                    | I/O of any kind                            |
| `server/*`     | `@isbp/sdk/server`, `@isbp/db/schema` (core tables), `@isbp/sql` (pure helpers), deps' `/schema` | `apps/*`, other modules' services, `fetch` |
| `web/*`        | `@isbp/sdk/web`, `@isbp/ui/*`, `@isbp/contracts`, `@isbp/sql/params`, `./contracts`, `./model`   | `./server/*`, `@isbp/sql` root, Node APIs  |

## Naming

| Thing                | Pattern                                                                                                                                              | Example                                     |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| Module id            | kebab-case                                                                                                                                           | `helpdesk-ai`                               |
| Postgres schema      | id with `_`                                                                                                                                          | `helpdesk_ai`                               |
| Permission           | `<id>.<resource-plural>.<action>`                                                                                                                    | `itam.licenses.reveal`                      |
| Role key             | `<id>-<persona>`                                                                                                                                     | `alm-release-manager`                       |
| Event / audit action | `<id>.<entity>.<verb_past>`                                                                                                                          | `itsm.change.approved`                      |
| Notification type    | `<id>.<entity>.<verb>`                                                                                                                               | `scheduler.run.failed`                      |
| Workflow trigger     | `<id>.<name>`                                                                                                                                        | `dbaccess.request`                          |
| AI tool              | `<id>.<verb>_<noun>`                                                                                                                                 | `etl.run_pipeline`                          |
| Record type          | `<id>.<entity>`                                                                                                                                      | `projects.task`                             |
| Task type            | `<id>.<type>`                                                                                                                                        | `etl.pipeline`                              |
| Slot (hosted)        | `<id>.<page>.<place>`                                                                                                                                | `itsm.ticket.aside`                         |
| Job                  | kebab-case, shown as `<id>:<job>`                                                                                                                    | `itam:recompute-compliance`                 |
| Human reference      | `PREFIX-00042` (per entity, zero-padded)                                                                                                             | `INC-00042`, `AST-00007`, `NET-12`          |
| Catalog keys         | `<id>.<area>.<key>`; notifications `<id>.notifications.<type minus id, . and - → _>.{label,title,body}`; audit `<id>.audit.<action minus id, . → _>` | `alm.notifications.deployment_failed.title` |

## Minimal skeletons

### `src/manifest.ts`

```ts
import { defineManifest } from '@isbp/sdk';
import { z } from 'zod';

const thingRef = z.object({ thingId: z.uuid(), name: z.string() });

export const manifest = defineManifest({
  id: 'things',
  version: '0.1.0',
  name: 'things.meta.name',
  description: 'things.meta.description',
  icon: 'box',
  dependsOn: [], // modules whose tables you read
  navigation: [
    {
      id: 'home',
      label: 'things.nav.home',
      href: '/things',
      icon: 'box',
      permission: 'things.items.read',
      section: 'main',
      group: 'things.nav.group',
      order: 70,
    },
  ],
  permissions: [
    { key: 'things.items.read', description: 'things.permissions.read' },
    {
      key: 'things.items.manage',
      description: 'things.permissions.manage',
      scopes: ['global', 'department'],
    },
  ],
  roles: [
    {
      key: 'things-viewer',
      name: 'Things viewer',
      description: 'Read things',
      permissions: ['things.items.read'],
    },
    {
      key: 'things-manager',
      name: 'Things manager',
      description: 'Manage things',
      permissions: ['things.items.*'],
    },
  ],
  events: {
    emits: [
      { name: 'things.item.created', schema: thingRef },
      { name: 'things.item.updated', schema: thingRef.extend({ changes: z.array(z.string()) }) },
    ],
    consumes: ['core.user.offboarded'],
  },
});
```

### `src/server/index.ts`

```ts
import { defineServerModule } from '@isbp/sdk/server';
import migrations from '../../migrations';
import { manifest } from '../manifest';
import { routes } from './routes';
import { seed } from './seed';
import { services } from './services';

export default defineServerModule(manifest, {
  migrations,
  routes,
  events: {
    'core.user.offboarded': async (event, ctx) => {
      await services(ctx).items.releaseOwner((event.payload as { userId: string }).userId);
    },
  },
  seed,
});
```

### `src/server/services.ts` + an entity service

```ts
// services.ts — one bundle per context: routes, AI tools, record resolvers, event handlers, jobs and the seed
// all call these, so the business rules live in one place.
export interface ThingServices {
  items: ItemService;
}
const cache = new WeakMap<ModuleContext, ThingServices>();
export function services(ctx: ModuleContext): ThingServices {
  let s = cache.get(ctx);
  if (!s) {
    s = { items: new ItemService(ctx) };
    cache.set(ctx, s);
  }
  return s;
}

// items.ts
export class ItemService {
  constructor(private readonly ctx: ModuleContext) {}

  async create(input: CreateItemInput, auth: AuthContext) {
    auth.require('things.items.manage');
    return this.ctx.transaction(async (tx) => {
      const [row] = await tx
        .insert(items)
        .values({ ...input, createdBy: auth.user?.id ?? null })
        .returning();
      await this.ctx.audit.record(
        {
          action: 'things.item.created',
          entityType: 'things.item',
          entityId: row!.id,
          entityLabel: row!.name,
        },
        { tx },
      );
      await this.ctx.events.publish('things.item.created', { thingId: row!.id, name: row!.name }, { tx });
      return row!;
    });
  }
}
```

### `src/server/routes.ts`

```ts
export function routes(app: ModuleRouter, ctx: ModuleContext) {
  const s = services(ctx);
  const tags = ['Things'];
  app.get(
    '/items',
    {
      config: { permission: 'things.items.read' },
      schema: {
        tags,
        summary: 'List items',
        querystring: itemQuerySchema,
        response: { 200: pageSchema(itemSchema) },
      },
    },
    async (req) => s.items.list(req.query, req.auth),
  );

  app.post(
    '/items',
    {
      config: { permission: 'things.items.manage' },
      schema: { tags, summary: 'Create an item', body: createItemSchema, response: { 201: itemSchema } },
    },
    async (req, reply) => reply.code(201).send(await s.items.create(req.body, req.auth)),
  );
}
```

Routes are thin. The service holds the rules, so the AI tool calling `s.items.create(input, auth)` behaves exactly
like the UI.

### `src/web/index.tsx`

```ts
import { defineWebModule } from '@isbp/sdk/web';
import { manifest } from '../manifest';

export default defineWebModule(manifest, {
  routes: [
    { path: '/', load: () => import('./pages/list-page'), permission: 'things.items.read' },
    { path: '/:id', load: () => import('./pages/detail-page'), permission: 'things.items.read' },
  ],
  slots: [
    {
      slot: 'core.dashboard.work',
      load: () => import('./slots/dashboard-card'),
      permission: 'things.items.read',
      order: 80,
    },
  ],
});
```

Static segments must come before dynamic ones (`/settings` before `/:id`). A page component receives
`{ params }` (`WebPageProps`) and starts with `'use client'`.

### `messages/en.json` (shape)

```json
{
  "meta": { "name": "Things", "description": "…" },
  "nav": { "group": "Things", "home": "Things" },
  "systemRoles": {
    "things-manager": { "name": "Things manager", "description": "Create and edit things" }
  },
  "permissions": { "read": "View things", "manage": "Create and edit things" },
  "entities": { "item": "Thing" },
  "audit": { "item_created": "Created a thing", "item_updated": "Updated a thing" },
  "notifications": {
    "item_assigned": { "label": "Things assigned to me", "title": "{name} was assigned to you", "body": "…" }
  },
  "settings": { "someSetting": "…", "someSettingHelp": "…" }
}
```

## Server definition options (all optional except migrations when you have tables)

| Option                   | Shape                                                    | Validated at start-up against                    |
| ------------------------ | -------------------------------------------------------- | ------------------------------------------------ |
| `migrations`             | from `../../migrations` (generated)                      | applied in dependency order, hashes checked      |
| `routes`                 | `(app: ModuleRouter, ctx) => void`                       | mounted at `/api/v1/<id>`                        |
| `events`                 | `{ [eventName]: (event, ctx) => Promise<void> }`         | `manifest.events.consumes`                       |
| `jobs`                   | `{ [kebab-name]: { handler, schedule?, attempts?, … } }` | kebab-case names                                 |
| `ai`                     | `{ [toolName]: (input, ctx, auth) => Promise<unknown> }` | `manifest.ai.tools` (every tool needs a handler) |
| `workflows`              | `{ [triggerKey]: { onCompleted(result, ctx) } }`         | `manifest.workflows`                             |
| `records`                | `{ [type]: { resolve, search } }`                        | `manifest.records.types` (every type needs one)  |
| `taskTypes`              | `{ [type]: { run, validate?, describe? } }`              | `manifest.taskTypes` (every type needs one)      |
| `sync`                   | `{ [entity]: SyncAdapter }`                              | `manifest.syncEntities` (every entity needs one) |
| `connectors`             | `{ [type]: ConnectorHandler }`                           | `manifest.connectors` (every type needs one)     |
| `onSyncChange`           | `(change, ctx) => Promise<void>`                         | gets sync entities' change events (the hub)      |
| `customizations`         | `{ [kind]: CustomizationHandler }`                       | `manifest.customizations` (every kind needs one) |
| `search`                 | `(query, ctx, auth, limit) => Promise<SearchHit[]>`      | global search / command palette                  |
| `seed`                   | `(ctx) => Promise<void>` (idempotent)                    | `pnpm db:seed`                                   |
| `onEnable` / `onDisable` | `(ctx) => Promise<void>`                                 | admin toggles the module                         |

## After creating or changing a module

1. `pnpm --filter @isbp/module-<id> db:generate` if `schema.ts` changed.
2. `pnpm modules:sync` if the module was added or removed. The API dev process restarts on registry changes.
3. `pnpm docs:reference` if the manifest, slots or web routes changed.
4. Grant the module's roles to demo groups in the platform seed (`apps/api/src/seed-phase*.ts` → `GRANTS`) when
   the demo should show them.
5. Add icons used in `navigation` to `apps/web/src/components/nav-icon.tsx` (static map). Unknown names
   lazy-load, but the static map avoids a flash.
6. Run the quality gate (see [checklist.md](checklist.md)).
