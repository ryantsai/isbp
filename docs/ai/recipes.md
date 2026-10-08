# Recipes

Working patterns for the tasks modules do most. Each recipe says what to declare, what to write, and how to check
it. Names in the examples belong to a fictional `things` module. Find real ones in the modules named under
"See".

## 1. An entity with a list and a detail page

1. **Schema:** add the table to `src/server/schema.ts` (`thingsSchema.table('items', { id: id(), …, createdAt:
createdAt(), updatedAt: updatedAt() }, (t) => [index(...)])`). Run `db:generate`.
2. **Contracts:** in `contracts.ts`, define:
   - `itemSchema` (response, `dateTime` for timestamps);
   - `itemQuerySchema = listQuerySchema.extend({ status: … .optional() })`;
   - `createItemSchema`;
   - `updateItemSchema`, built from a defaults-free field map (R26).
3. **Service** (`items.ts`):
   - `list(query, auth)` uses `pageSchema` paging, `likePattern` search and a sort whitelist.
   - `get(id, auth)` throws 404 when the row is missing or invisible.
   - `create` and `update` run in a transaction with audit and events (R13). `update` audits
     `ctx.audit.diff(before, after)`.
   - `remove` calls `ctx.records.forget` for a linkable type (R15).
4. **Routes:** one per operation, each with `config.permission` and full `schema`.
5. **Web:** the list page uses `PageHeader` + `DataTable` + `useListState` + `SearchInput`, with an `EmptyState`
   for none and none-matching. The detail page has a heading, tabs and the record panels (recipe 3). Create and
   edit happen in a `Sheet`/`Dialog` form with `useApiMutation({ invalidate: ['/things/items'], success })`.
6. **i18n:** fields, statuses, empty states, toasts and audit labels go in all three catalogs.

_See:_ `modules/alm/src/server/applications.ts`, `modules/alm/src/web/pages/inventory-page.tsx`.

## 2. Department- or record-scoped access

```ts
// manifest: { key: 'things.items.read', description: '…', scopes: ['global', 'department'] }
// route:    config: { permission: 'things.items.read', scoped: true }
const reach = auth.reach('things.items.read');
const where = reach.global
  ? undefined
  : (or(
      reach.departmentIds.length ? inArray(items.departmentId, reach.departmentIds) : undefined,
      reach.records.filter((r) => r.type === 'things.item').length
        ? inArray(
            items.id,
            reach.records.filter((r) => r.type === 'things.item').map((r) => r.id),
          )
        : undefined,
    ) ?? sql`false`);
// single record:
auth.require('things.items.manage', { departmentId: row.departmentId });
```

Put the rule in `access.ts` and use it from routes, resolvers and AI tools (R17).

## 3. Make records linkable and attachable

1. Manifest: `records: { types: [{ type: 'item', name: 'things.entities.item', icon: 'box', permission: 'things.items.read' }] }`.
2. Server: `records: { item: { resolve(ids, ctx, auth), search(query, ctx, auth, limit) } }`. Return
   `{ id, reference, title, subtitle, status: { key, tone }, href, editable }` only for rows `auth` may read
   (R18).
3. Detail page:
   `<Slot name="core.record.links" props={{ record: { type: 'things.item', id } }} />` and the same with
   `core.record.files`.
4. On delete: `await ctx.records.forget({ type: 'things.item', id }, { tx })`.
5. To create something in another module already linked, link to its form with `?link=things.item:<id>` (ITSM's
   report and change forms support it).

_See:_ `modules/alm/src/server/records.ts`, `modules/itam/src/web/record-panels.tsx`.

## 4. Require approval

```ts
// manifest
workflows: [{
  key: 'things.publish', name: 'things.workflows.publish', subject: 'item',
  facts: z.object({ item: z.object({ risk: z.enum(['low', 'high']), ownerId: z.uuid().nullable() }) }),
  required: true,
  defaultGraph: { steps: [
    { id: 'owner', type: 'approval', name: { en: 'Owner', 'zh-TW': '擁有者', 'ja-JP': '所有者' },
      approvers: [{ type: 'fact', fact: 'item.ownerId', fallback: { type: 'manager' } }], mode: 'any' },
    { id: 'security', type: 'approval', name: { en: 'Security', 'zh-TW': '資訊安全', 'ja-JP': 'セキュリティ' },
      when: { fact: 'item.risk', op: 'eq', value: 'high' },
      approvers: [{ type: 'group', groupKey: 'security-team' }], mode: 'any',
      sla: { dueHours: 48, remindHours: 24, onBreach: 'notify' } },
  ] },
}],

// service, inside the transaction that marks the item "pending"
const started = await ctx.workflows.start('things.publish', {
  subject: { type: 'item', id: row.id, label: row.name, href: `/things/${row.id}` },
  facts: { item: { risk: row.risk, ownerId: row.ownerId } },
  requesterId: auth.user?.id ?? null,
}, { tx });

// server definition
workflows: { 'things.publish': { onCompleted: (r, ctx) => services(ctx).items.onPublishDecided(r) } },
```

`onCompleted` receives `outcome: 'approved' | 'rejected' | 'cancelled'` through the outbox. It must be
idempotent. Approvers act in the platform's Approvals inbox; you build no approval UI.

_See:_ `modules/itam/src/manifest.ts` (`itam.disposal`), `modules/projects` (`projects.proposal`).

## 5. Notify people

```ts
// manifest
notifications: ([{ type: 'things.item.assigned', defaultChannels: ['inApp', 'email'] }],
  // catalog: things.notifications.item_assigned.{label,title,body} (ICU; {name} etc.)
  await ctx.notifications.notify(
    {
      type: 'things.item.assigned',
      recipients: [row.ownerId],
      params: { name: row.name, due: row.dueAt },
      href: `/things/${row.id}`,
    },
    { tx },
  ));
```

Dates in `params` render in each recipient's language and time zone. Recipients that are null, duplicated or
inactive are dropped. People choose channels in their preferences.

## 6. React to another module (or core)

```ts
// manifest: events.consumes: ['core.user.offboarded', 'itsm.change.approved']
events: {
  'core.user.offboarded': async (event, ctx) => {
    const { userId } = event.payload as { userId: string };
    await services(ctx).items.reassignFrom(userId); // idempotent: safe to run twice
  },
},
```

Payload shapes are in [reference.md](reference.md). Handlers run in the worker after commit, as
`system:module:<id>`, on behalf of the original actor.

## 7. Show something on another module's page (slot)

```ts
// web/index.tsx
slots: [
  { slot: 'core.dashboard.work', load: () => import('./slots/dashboard-card'), permission: 'things.items.read', order: 70 },
  { slot: 'core.user.overview', load: () => import('./slots/person-things'), permission: 'things.items.read' },
],
```

The component's props are the host's contract (`UserOverviewSlotProps` from `@isbp/contracts`). It fetches from
**your own** API and renders `null` when it has nothing to show, so it never leaves an empty card.

_See:_ `modules/alm/src/web/slots/dashboard-work.tsx`, `modules/itam/src/web/slots/*`.

## 8. Requests portal: an entry and "My requests"

- Manifest: `portal: { entries: [{ id: 'request-thing', label: 'things.portal.request', description: '…', icon: 'box', href: '/things/request', permission: 'things.self.request' }] }`.
- Track the record so the requester sees it:
  `ctx.portal.track({ kind: 'things.request', id, reference, title, state: 'open', statusKey: 'things.status.pending', tone: 'info', href, icon: 'box', people: [requesterId] }, { tx })`.
  Update it on every status change and set `state: 'closed'` when done.

_See:_ `modules/itsm/src/server/tickets.ts` (`portal.track`), `modules/dbaccess` (request wizard).

## 9. Background work: module job vs task type

**Fixed schedule your module owns** (purges, recomputations, reminders):

```ts
jobs: {
  'recompute-scores': {
    description: 'Recomputes item scores',
    schedule: { cron: '15 2 * * *', tz: 'Asia/Taipei' }, // or { everyMs: 300_000 }
    attempts: 3, timeoutMs: 10 * 60_000,
    handler: async (job, ctx) => ({ updated: await services(ctx).items.recomputeScores((m) => job.log(m)) }),
  },
},
// on demand: await ctx.jobs.enqueue('recompute-scores', { itemId }, { jobId: `recompute:${itemId}` });
```

**Work an administrator schedules** (with retries, run history, live logs and alerts in Scheduled jobs):

```ts
// manifest
taskTypes: [{ type: 'refresh', name: 'things.taskTypes.refresh.name', description: 'things.taskTypes.refresh.description',
  icon: 'refresh-cw', permission: 'things.items.manage', config: z.object({ itemId: z.uuid() }) }],
// server
taskTypes: { refresh: {
  validate: async ({ itemId }, ctx, auth) => { await services(ctx).items.get(itemId, auth); },
  describe: async ({ itemId }, ctx) => ({ label: `Refresh ${await nameOf(ctx, itemId)}`, href: `/things/${itemId}` }),
  run: async ({ itemId }, task, ctx) => {
    task.log('Refreshing…');
    const n = await services(ctx).items.refresh(itemId, { signal: task.signal });
    return { summary: `${n} rows refreshed`, metrics: { rows: n }, href: `/things/${itemId}` };
  },
} },
// web/index.tsx — a real editor instead of the JSON fallback
slots: [{ slot: 'scheduler.task-config.things.refresh', load: () => import('./slots/task-config'), permission: 'things.items.manage' }],
```

The config editor receives `TaskConfigSlotProps` (`{ type, value, onChange, errors?, disabled? }`). To offer
"Schedule this", link to `/scheduler/jobs/new?type=things.refresh&name=…&config=${encodeURIComponent(JSON.stringify({ itemId }))}`
(show it only when `usePlatform().enabledModules.includes('scheduler')`).

_See:_ `modules/etl/src/server/task-type.ts`, `modules/etl/src/web/slots/task-config.tsx`.

## 10. An AI tool

```ts
// manifest (input schema shared with the handler via contracts)
ai: { tools: [{ name: 'things.find_items', description: 'Search things by name or reference (e.g. "THG-12"). Returns …. Use it when …',
  input: aiFindItemsInput, permission: 'things.items.read' }] },
// server
ai: { 'things.find_items': async (input, ctx, auth) => services(ctx).items.list(aiFindItemsInput.parse(input), auth) },
```

Write descriptions for a model: what it returns, when to use it, example values. Mark writes and privileged
actions `destructive: true` (R22). The handler gets the caller's `auth`. Reuse the service, never a separate
query.

## 11. Global search (command palette)

`search: { entities: ['item'] }` in the manifest, and `search: async (q, ctx, auth, limit) => SearchHit[]` in the
server definition. Return `[]` without permission, and hits `{ id, type, title, subtitle, href, icon }`.

## 12. Custom fields on your entity

Manifest: `customFields: { entities: [{ type: 'item', name: 'things.entities.item' }] }`. Add an `attributes jsonb`
column. Validate on create and update with
`attributes = await ctx.fields.validate('things.item', input.attributes ?? {}, before?.attributes)`. Render the form
with `FormRenderer` from `@isbp/ui/form-renderer` using `ctx.fields.definitions('things.item')` (expose them
through a route).

_See:_ `modules/alm` (`custom-fields.tsx`).

## 13. Settings

Declare them in `manifest.settings` (labels are i18n keys) and read them with `await ctx.settings.get<boolean>('policy.strict')`.
Admins edit them in Administration → Modules. Don't build a second settings store. A read-only summary page that
links there is fine.

## 14. Attachments

Host `core.record.files` (recipe 3). Never accept uploads in your routes (`ctx.files.attach` is for server-side
generated files, such as an export saved on a record).

## 15. Query an external database

```ts
const conn = (await ctx.databases.list({ purpose: 'data', enabledOnly: true })).find(
  (c) => c.key === settingKey,
);
const catalog = await ctx.databases.catalog(conn.id, { purpose: 'data' });
const table = catalog.tables.find((t) => t.schema === input.schema && t.name === input.table); // identifiers from the catalog only
if (!table) throw new HttpError(400, ErrorCodes.VALIDATION_FAILED, 'Unknown table');
const result = await ctx.databases.query(
  conn.id,
  'SELECT code, name FROM erp.customers WHERE region = :region ORDER BY code',
  { purpose: 'data', params: { region: input.region }, maxRows: 500, readOnly: true },
);
```

Show `DATABASE_ERROR` details (`dbCode`, `message`) to administrators. Show API clients a generic message plus the
request id. Never build SQL from values (R20).

_See:_ `modules/etl` (Data APIs, pipelines), `modules/dbaccess` (server-side quoting for DDL).

## 16. Call an external HTTP API with a stored credential

```ts
// store: sealed on save, never returned
await tx.update(connectors).set({ apiKeySealed: ctx.secrets.seal(input.apiKey) });
// use (worker / job)
const res = await ctx.http.request(`${base}/api/v3/requests`, {
  method: 'GET',
  headers: { authtoken: ctx.secrets.open(row.apiKeySealed) },
  timeoutMs: 15_000,
  maxBytes: 5 * 1024 * 1024,
  allowHosts: (await ctx.settings.get<string>('allowedHosts'))?.split('\n') ?? [],
});
if (res.status >= 400)
  throw new HttpError(502, ErrorCodes.UPSTREAM_FAILED, `HTTP ${res.status}`, { reason: 'status' });
```

Put the calls in jobs or event handlers, not in request handlers that hold a transaction (R14). Rate-limit with
`ctx.cache.rateLimit`.

## 17. Make content findable by meaning (semantic search)

Upsert into the shared index **from your own event handler** (after commit), with an ACL:

```ts
events: { 'things.item.updated': async (e, ctx) => services(ctx).items.reindex(e.payload.thingId) },
// reindex:
await ctx.ai.index.upsert({ type: 'things.item', id, title, text: markdown, locale, href,
  acl: { permission: 'things.items.read' }, metadata: { status } });
// or ctx.ai.index.remove('things.item', id) when it should no longer be found
```

_See:_ `modules/knowledge/src/server/articles.ts`.

## 18. Demo data

`seed(ctx)` must be idempotent (return early when your data exists), produce realistic volume and history (weeks
of activity, a mix of states including failures), and use the demo groups and users (see
`apps/api/src/seed.ts`). Seeds may call your own services, as the admin or the module's agent. Cross-module demo
data goes into the platform seed (R36).

## 19. A new error code

1. Add it to `ErrorCodes` in `packages/sdk/src/http.ts`, with a doc comment that says what `details` carries.
2. Add the message to `packages/i18n/messages/{en,zh-TW,ja-JP}/errors.json`.
3. Throw `new HttpError(status, ErrorCodes.X, 'English message for logs', details)`.
4. Run `pnpm docs:reference`.

## 20. Extending the platform itself

When modules need a capability the kernel lacks, add a **service** instead of a workaround:

1. Add the type to `packages/sdk/src/server.ts` (`ModuleContext` member + doc comment) and, if it needs it, a
   manifest field with Zod validation in `manifest.ts`.
2. Implement it in `apps/api/src/kernel/<service>.ts` and wire it in `kernel.ts` (`contexts.set(…)`).
3. Test it with unit tests and an integration test (`apps/api/test/integration/*.test.ts`).
4. Document it in [api-reference.md](api-reference.md), [system-map.md](system-map.md) and, if it carries a rule,
   [rules.md](rules.md).
5. Record the decision in `docs/architecture.md` (the current phase's decisions table).

## 21. Make your records syncable with outside systems

```ts
// manifest.ts
permissions: [{ key: 'things.items.sync', description: 'things.permissions.items_sync' }],
events: { emits: [{ name: 'things.item.created' }, { name: 'things.item.updated' }] },
syncEntities: [{ entity: 'item', name: 'things.entities.items', icon: 'box',
  permission: 'things.items.sync', events: ['things.item.created', 'things.item.updated'] }],

// server/sync.ts
export const itemSync: SyncAdapter = {
  fields: async () => [
    { key: 'title', label: 'things.sync.title', type: 'string', required: true, maxLength: 200 },
    { key: 'status', label: 'things.sync.status', type: 'choice',
      choices: STATUSES.map((s) => ({ value: s, label: `things.status.${s}` })) },
    { key: 'owner', label: 'things.sync.owner', type: 'user' },
    { key: 'ref', label: 'things.sync.ref', type: 'string', readOnly: true },
  ],
  read: (id, ctx) => services(ctx).items.syncRecord(id),
  readMany: (ids, ctx) => services(ctx).items.syncRecords(ids),
  list: (opts, ctx) => services(ctx).items.syncPage(opts), // updated_at asc, cursor-paged
  findBy: (field, value, _opts, ctx) => services(ctx).items.findByTitle(String(value)),
  matchKeys: ['title'],
  // Same rules as the UI, in the hub's transaction; events with { tx }; audit metadata { source }.
  write: (input, { auth, tx, source }, ctx) => services(ctx).items.applySync(input, auth, tx, source),
  idFromEvent: (e) => (e.payload as { id?: string }).id ?? null,
};
// server/index.ts
defineServerModule(manifest, { …, sync: { item: itemSync } });
```

The kernel validates values against your catalogue before `write` runs. Test through `ctx.sync` with an agent
holding `*.*.sync`: create, update, refusals (403, 409, 422), events and `findBy`.

_See:_ `modules/itsm` (tickets with comments), `modules/projects` (tasks in a project container),
`modules/alm` (repositories, pull only).

## 22. Connect a new outside system (a connector)

1. `pnpm create-module <system>`; no tables or navigation. Declare `manifest.connectors: [{ type, name, config,
secrets, objects }]` with Zod schemas (URLs may be `http://` or `https://`; the kernel enforces HTTPS unless the
   connection allows insecure HTTP) and each remote object's
   capabilities and usual target entities.
2. Implement `ConnectorHandler`: `hosts`, `test`, `fields`, `changes` (oldest first, a cursor that never skips equal
   timestamps), `get`, and where the API allows `create`, `update` (`expectedVersion` → `REMOTE_CONFLICT`),
   `comments`, `webhook`, `scopes`, `defaultMapping` (against the target adapters' field keys in
   [reference.md](reference.md)). Call the API only with `conn.http`; cache tokens in `conn.cache`.
3. Contribute the settings form: web slot `integrations.connector-config.<module>.<type>` with
   `ConnectorConfigSlotProps` (secrets as password inputs, "Stored. Leave empty to keep it.").
4. Add a stand-in under `tooling/integration-mocks/src/<system>` (same paths and shapes, seeded data, `/_mock/*`
   controls) and test the connector against it in-process.

_See:_ `modules/sdp` (technician API key, form-encoded `input_data`), `modules/azdo` (PAT, WIQL, JSON Patch with
`test /rev`, hierarchy).

## 23. Let the AI agent customise your configuration (a customisation kind)

1. Declare the kind next to your permissions:

```ts
customizations: [
  {
    kind: 'category',
    label: 'things.kinds.category', // i18n key, three locales
    description: 'Categories things are filed under, with a default owner group', // English, for models
    icon: 'folder-tree',
    readPermission: 'things.config.read', // to see it and propose changes
    applyPermission: 'things.config.manage', // to apply them
    operations: ['create', 'update', 'archive'], // create needs archive or delete
  },
],
```

2. Implement it with your own service, constructed with the `ctx` you receive (it is bound to the change set's
   transaction while applying):

```ts
// server/customizations.ts
const value = upsertCategorySchema.omit({ active: true }); // flags like `active` become `archived`
export const customizations = {
  category: {
    schema: value,
    guide: async (ctx) => ({
      instructions: 'Keys are lowercase slugs. Names need en, zh-TW and ja-JP.',
      reference: { groups: await groupsFor(ctx) }, // live ids and keys, never guesses
      examples: [{ description: 'Printers', value: { key: 'printers', name: { en: 'Printers', … } } }],
    }),
    list: (opts, ctx) => new ConfigService(ctx).categorySummaries(opts),
    get: async (id, ctx) => toObject(await new ConfigService(ctx).category(id)), // { id, label, archived, value }
    check: async ({ op, id, value }, ctx) => (await keyTaken(ctx, value?.key, id)) ? [{ path: 'key', message: 'Taken', code: 'duplicate' }] : [],
    apply: async ({ op, id, value }, ctx, auth) => {
      const s = new ConfigService(ctx);
      if (op === 'create') return { id: (await s.createCategory({ ...value!, active: true })).id };
      if (op === 'update') await s.updateCategory(id!, value!);
      else await s.updateCategory(id!, { active: op === 'restore' });
      return { id: id! };
    },
  } satisfies CustomizationHandler<z.infer<typeof value>>,
};
// server/index.ts
defineServerModule(manifest, { …, customizations });
```

3. Optional: a guided template for builtin mode (`templates: [{ id, label, description, fields, build }]`), and a
   preview on the change set page: web slot `assistant.preview.<module>.<kind>` (`AssistantPreviewProps`).
4. Test through `h.kernel.customizations`: every operation applied in a transaction, a dry run that leaves nothing
   behind, `CHANGE_SET_STALE` on a moved `baseVersion`, `check` issues, refusal without the apply permission, and
   that `get().value` applied as an update keeps the version.

_See:_ `apps/api/src/core/customizations` (workflows, forms, custom fields, roles), `modules/scheduler` (jobs),
`modules/itsm` (categories, SLA policies, catalog items), `modules/integrations` (sync profiles).
