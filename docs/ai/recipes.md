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
5. **Web:** the list page uses `PageHeader` + `DataTable` (with the query's `error`/`refetch`) + `useListState` +
   `FilterBar`/`SearchInput`, with an `EmptyState` for none (copy by whether the viewer can create) and
   none-matching (`variant="filtered"`). The detail page has a `DetailHeader`, tabs and the record panels (recipe 3).
   Create and edit happen in a `Sheet` (more than 4 fields) or `Dialog` form with
   `useApiMutation({ invalidate: ['/things/items'], success })`.
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
6. So request forms and workflows can route on your records (a form's record field, "the item's owner group
   approves"), declare approval **facts** and serve them — see recipe 24.

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

An approval step can ask its approver to fill in fields with the decision (`fields: FieldDef[]`, at most 20, and
`fieldsRequiredOn: 'approve' | 'both'`): an evaluation result, a completion date, who handled it. The inbox shows
them next to Approve and Reject, the engine validates them like form answers, and later steps read them as facts
`steps.<stepId>.<key>` — e.g. `when: { fact: 'steps.review.result', op: 'eq', value: 'cab' }`. Administrators add
them in the workflow builder ("Fields the approver fills in"); your trigger needs nothing for it.

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

Home hosts `core.dashboard.work` for the people who **own an area** (the service desk queue for agents, asset
attention for asset managers: link to your overview page) and `core.home.news`. Something that waits for one person
(a decision, a form, a check, a task) is not a card: put it on My work (recipe 29).

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

Work that belongs to a period ("this month's inspection") keys off the run's slot, not the clock:
`task.scheduledFor` in `task.timeZone` (the job's time zone). `periodKey(at, 'month', tz)` and `assignmentDueAt` in
`@isbp/contracts` do the calendar arithmetic; make the run idempotent per period (a retry or "Run now" in the same
period changes nothing).

_See:_ `modules/etl/src/server/task-type.ts`, `modules/etl/src/web/slots/task-config.tsx`,
`apps/api/src/core/task-types.ts` (`core.assign-form`, one assignment per period).

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
server definition. Return `[]` without permission, and hits `{ id, type, title, subtitle, href, icon, status? }`:
`status` is an i18n key (`things.status.open`), never a raw code in `subtitle`; set `exact: true` when the query is the
record's reference; give translations of one record the same `group` and their `locale`. Add a palette heading for a
new `type` under `shell.commandPalette.types.<type>`.

## 12. Custom fields on your entity

Manifest: `customFields: { entities: [{ type: 'item', name: 'things.entities.item' }] }`. Add an `attributes jsonb`
column. Validate on create and update with
`attributes = await ctx.fields.validate('things.item', input.attributes ?? {}, before?.attributes)`. Render the form
with `FormRenderer` from `@isbp/ui/form-renderer` using `ctx.fields.definitions('things.item')` (expose them
through a route). Admins may add `record` fields (pick CIs, applications, …): `validate` checks the picked records are
readable by the caller of the current request (pass `auth` explicitly from jobs that act for someone) and match the
field's filter; read-only views show them with `FormAnswers` / `RecordValues`. When your workflow trigger's subject has
custom fields, set `customFieldEntity: 'things.item'` on the trigger and spread
`...(await ctx.fields.facts('things.item', row.attributes))` into `start({ facts })`, so workflows can use
`attributes.<key>` and `records.<key>.<fact>`.

_See:_ `modules/alm` (`custom-fields.tsx`).

## 13. Settings

Declare them in `manifest.settings` (labels are i18n keys) and read them with `await ctx.settings.get<boolean>('policy.strict')`.
Admins edit them in Administration → Modules. Don't build a second settings store. A read-only summary page that
links there is fine.

## 14. Attachments

Host `core.record.files` (recipe 3). Never accept uploads in your routes (`ctx.files.attach` is for server-side
generated files, such as an export saved on a record).

Form requests are records too (`core.request`, the request page hosts both panels): evidence for a process goes
there, and a process action can link what it created (`record` in its result is linked to the request for you) or
attach a generated file with `ctx.files.attach({ type: 'core.request', id: input.request.id }, …)`.

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
   preview on the change set page: web slot `assistant.preview.<module>.<kind>` (`AssistantPreviewProps`: the item,
   its value and the change set's other `items`, so a preview can name what the same set creates). A template
   that needs objects of other kinds returns them in `before` with a `ref`, and refers to them as `"$ref:<ref>"`
   (core's "Request process" proposes a workflow, then the form using it). When people use your objects somewhere
   else than their admin page, return `links: [{ href, label }]` from `get` (labels from your catalog in three
   languages, only while the object is usable): the applied change set and the agent's reply show them.
4. Hold `check` to what your admin page refuses, not only what the API refuses, and leave permission problems to
   `apply` (a 403 with `details.permission`): a dry run then marks the item as needing a reviewer who holds it.
5. Test through `h.kernel.customizations`: every operation applied in a transaction, a dry run that leaves nothing
   behind, `CHANGE_SET_STALE` on a moved `baseVersion`, `check` issues, refusal without the apply permission, and
   that `get().value` applied as an update keeps the version.

_See:_ `apps/api/src/core/customizations` (workflows, forms, custom fields, roles), `modules/scheduler` (jobs),
`modules/itsm` (categories, SLA policies, catalog items), `modules/integrations` (sync profiles).

## 24. Let approvals route on your records (record facts)

A request form can hold a **record field** (`type: 'record'`, e.g. "the CIs this change touches"); its workflow then
reads `records.<field>.<fact>` and can ask "the CI's support group" to approve. Your record type provides the facts:

```ts
// manifest.ts
const fact = (key: string) => `things.recordFacts.${key}`;
export const itemFactsSchema = z.object({
  risk: z.enum(RISKS).meta({ label: fact('risk'), valueLabels: 'things.risk' }), // labels: things.risk.<value>
  ownerId: z.uuid().nullable().meta({ label: fact('ownerId'), ref: 'user' }),      // a person (user id)
  ownerGroup: z.string().nullable().meta({ label: fact('ownerGroup'), ref: 'group' }), // a group KEY
});
records: { types: [{ type: 'item', name: 'things.entities.item', icon: 'box', permission: 'things.items.read',
  facts: itemFactsSchema }] },

// server: the resolver's facts, by id, in one query — NOT permission-filtered (they route approvals, nobody sees them)
records: { item: { resolve, search,
  async facts(ids, ctx) {
    const rows = await ctx.db.select({ i: items, group: groups.key }).from(items)
      .leftJoin(groups, eq(groups.id, items.ownerGroupId)).where(inArray(items.id, ids.filter(isUuid)));
    return new Map(rows.map(({ i, group }) => [i.id, { risk: i.risk, ownerId: i.ownerId, ownerGroup: group }]));
  } } },
```

- Add every `label` key (and the `valueLabels.<value>` keys) to the three catalogs; `apps/api/test/unit/phase8.test.ts`
  fails otherwise. Keep facts approval-relevant and cheap (≤ 20 records per field, one query).
- People are user ids, groups are group keys (approver rules `{ type: 'fact', fact, kind: 'group' }` resolve the
  group's members). Facts are captured when the workflow starts.
- Record fields filter the picker with `where` on these facts, and the API re-checks every picked record (exists,
  readable by the person through your resolver, matches `where`), so your `resolve` must apply the same visibility
  as your pages (R18).
- Form rules (`FormSchema.rules`) and the request form's "Who will approve this?" (`POST /forms/by-key/:key/preview`)
  need nothing from you. Your own requests can show the same preview with `ctx.workflows.preview(trigger, input)`.

_See:_ `modules/cmdb` (`ciFactsSchema`, `CiService.facts`), `modules/itsm/src/server/records.ts`,
`apps/api/test/integration/process-builder.test.ts`.

## 25. Add a process action (what a request form does next)

A request form can run **process actions** after it is sent, approved or rejected ("on approval, raise a change for
the picked CIs"). Administrators add them in the form builder's Actions tab; your module provides the type:

```ts
// manifest.ts — `permission` is what an admin needs to add the action to a form
processActions: [{ action: 'create-item', name: 'things.processActions.createItem.name',
  description: 'things.processActions.createItem.description', icon: 'box', permission: 'things.items.manage' }],

// server/process-actions.ts
export const createItemAction: ProcessActionHandler = {
  // The configuration, as FieldDefs (labels in three languages). Options may come from live data and from the
  // form's own fields (`form`); text fields accept templates such as {{data.title}} or {{request.reference}}.
  async fields(ctx, { form }) {
    return [
      { key: 'title', type: 'text', label: text((c) => c.processActions.createItem.title), required: true,
        defaultValue: '{{request.form}} ({{request.reference}})', validation: { maxLength: 400 } },
      { key: 'ownerField', type: 'select', label: text((c) => c.processActions.createItem.owner),
        options: formFields(form).filter((f) => f.type === 'user').map((f) => ({ value: f.key, label: f.label })) },
    ];
  },
  // Checks for the admin who adds or changes it (optional): throw HttpError (400 with issues, or 403).
  async validate(config, ctx, { auth }) { /* e.g. may this admin hand this out? */ },
  // In the worker, after commit, as a system principal holding only `things.*`. Idempotent on runId (R52).
  async run({ config, request, runId, auth }, ctx) {
    const existing = await services(ctx).items.bySource(runId);
    const item = existing ?? (await services(ctx).items.create({
      title: String(config.title), ownerId: request.data[String(config.ownerField)] as string | undefined,
      source: { runId, submissionId: request.id, reference: request.reference },
    }, auth));
    return { reference: item.reference, href: `/things/${item.reference}`, summary: 'things.processActions.createItem.created',
      record: { type: 'things.item', id: item.id } };
  },
};
// server/index.ts
defineServerModule(manifest, { …, processActions: { 'create-item': createItemAction } });
```

- `config` arrives validated against `fields()` with templates rendered in `text`/`textarea` fields only
  (`renderTemplate`: plain paths, unknown ones empty; URLs, choices and people are used as configured). Values available: `data.<key>`, `answers.<key>` (as shown), `records.<key>.<fact>`, `requester.*`,
  `request.{reference,href,url,form,formKey,outcome}`, `decidedBy.*`, `steps.<stepId>.<key>` (what approvers filled
  in; also `input.request.steps`). Keys in `jsonTemplates` are rendered with JSON
  escaping; keys in `secrets` are sealed on save, never returned, and arrive opened in `run`.
- A thrown `HttpError` fails the run at once; other errors are retried (3 attempts, exponential backoff). Failed runs
  notify the form's editors (`core.process-action.failed`), show the error to form admins on the request page, and
  can be retried there. The first result with an `href` becomes the request's fulfilment unless a module set one.
- Audit entries written during the run carry `metadata.processAction` (request, form, requester, approver); the actor
  is `form:<key>`.
- Never skip an approval your record needs (R53): start its own workflow as a person submitting it would.
- Choices need no option in your action: the form gives the action a condition (`FormAction.when`, "Only when…" in the
  builder) on the answers, records, step fields, requester or `today`; when it doesn't hold the run is recorded as
  skipped and your `run` is never called. A table answer (`type: 'rows'`) arrives as a list of row objects in
  `request.data`; in text templates it renders one line per row.
- A summary can carry arguments: return `summary: '<id>.processActions.x.done'` with `summaryParams: { date:
dueAt.toISOString() }` and write the catalog text as `"Due {date, date, long}"` (ISO dates become dates).
- A value that is a date or a record (not text) comes from a field the action names, not a template: offer the form's
  fields of that type as `field:<key>` options plus `step` with a `<step>.<key>` text field (`visibleWhen` the select is
  `step`), and read `request.data[key]` or `request.steps[step][key]`. So "the device IS picks at the approval step" or
  "the retention date IS enters" work as well as answers (`core.remind`, `itam.return-asset`).
- Something that happens to an existing record (assign, return) is idempotent through the record's own history: store
  the run on the entry it writes (`asset_events.request.runId`) and do nothing when it is there, under the record's
  row lock (`itam.assign-asset`).
- Test it through a form: create the form with `actions` via `PATCH /forms/:id`, publish, submit, poll the runs
  (`core.process_action_runs`) with the worker started, then check the record and that a second `execute` changes
  nothing.

_See:_ `modules/itsm/src/server/process-actions.ts` (create a change and submit it to CAB), `modules/itam` (approve software, assign and return a device), `modules/cmdb`
(`update-ci`), `modules/scheduler` (`run-job`), `apps/api/src/core/process-actions.ts` (grant a platform or application
role, notify, webhook with a sealed header, `remind` on a date), `apps/api/test/integration/process-actions*.test.ts`,
`process-plumbing.test.ts` (tables, conditional actions, reminders).

## 26. A recurring checklist (assigned and recurring forms)

"Every month IS operations fill in the server room inspection" needs no module code: it is a **form** plus a
**`core.assign-form` scheduled job**.

1. The form: a request form (`core.form` kind or the form builder) with the checklist's fields. Its audience may be
   narrow: an assignee fills it in through the assignment whatever the audience.
2. The schedule: a `scheduler.job` (kind or Scheduled jobs) of type `core.assign-form`:

```ts
{
  type: 'core.assign-form',
  config: {
    formKey: 'server-room-inspection',
    assignee: { type: 'group', groupKey: 'it-ops' }, // or { type: 'user', userId }
    period: 'month', // day | week | month | quarter | year — the run's period, in the trigger's time zone
    due: { type: 'end-of-period' }, // or { type: 'days', days: 7 }
    title: 'Server room inspection {{period}}', // 2026-10, 2026-Q4, 2026-W41, …
  },
  trigger: { kind: 'cron', cron: '0 9 1 * *', timezone: 'Asia/Taipei' }, // at the start of each period
}
```

Each run opens one assignment for the period (idempotent per form, assignee and period). People see it under **To
do** (request portal, dashboard) and complete it by submitting the form from it
(`/requests/forms/<key>?assignment=<id>`); reminders, the editors' overdue notice and the per-period compliance on the
form's **Assignments** tab come with it. Form administrators can also assign by hand
(`POST /forms/:id/assignments`). React to `core.form-assignment.completed` / `.overdue` (payload: `assignmentId`,
`formId`, `periodKey`, …) when your module needs to know — e.g. to record that a stocktake was done.

_See:_ `apps/api/src/core/services/form-assignments.ts`, `apps/api/test/integration/form-assignments.test.ts`,
`docs/architecture.md` §15.8a.

## 27. Import and export a register as CSV (spreadsheets people already keep)

Many processes start from a spreadsheet (an asset register, a system's account list). Keep it round-trippable:

- **Export** from a route returning `text/csv; charset=utf-8` with `Content-Disposition: attachment`. Write it with a
  BOM (Excel shows CJK text correctly only with one), CRLF lines and formula hardening (cells starting with `=`, `+`,
  `-`, `@` get an apostrophe), in a fixed column order, with headers in the reader's language (`?locale=`, default the
  person's). Audit the export. The page links to the route with the list's filters (`<a href download>`), so the file
  is exactly what the list shows.
- **Import** with a JSON body `{ csv, dryRun }` (route `bodyLimit` raised, rate-limited); the browser only reads the
  file (UTF-8, or Big5/UTF-16 by BOM). Parse on the server with a pure, unit-tested reader: RFC 4180 records, comma /
  semicolon / tab, a title line above the header skipped, columns found by key **or** by their label in any of the
  three languages. Validate every row against live data (codes, names in any language, people by e-mail, username or
  a unique display name) and return a report — counts and `{ line, column, code, value }` issues the page translates
  by code. Apply the valid rows in one transaction through your service (audit and events per record); a dry run only
  reports. Rows naming an existing record update it, and empty cells keep the current value.

_See:_ `modules/isms/src/model.ts` (`csvRecords`, `readCsvTable`, `toCsv`), `modules/isms/src/server/assets.ts`
(`exportCsv`, `importCsv`), `modules/isms/src/web/import-dialog.tsx`, `modules/itam/src/discovery-csv.ts`.

## 28. Ship a ready-made process (a built-in change-set package)

When your module comes with a whole process to set up — its request forms, approval workflows, groups, scheduled
jobs, service desk categories — ship it as a **built-in package**. An administrator reads what it creates, process by
process, and installs it on **Process packs** (**Install a process pack** on Forms or Change sets): it becomes one draft
change set, grouped by process and dry-run like any other, applied (or sent for review) by a person
and rolled back in one step. Nothing you ship is live until then, and every item goes through its kind's checks.

1. Declare it (name and description in your three catalogs):

```ts
customizationPackages: [
  {
    key: 'processes', // kebab-case; installed as POST /assistant/packages/things/processes/install
    name: 'things.packages.processes.name',
    description: 'things.packages.processes.description',
    icon: 'package',
  },
],
```

2. Write the package as data, typed by `ChangeSetPackage` from `@isbp/sdk` (one file per process keeps it readable),
   and return it from `defineServerModule`:

```ts
// server/packages/processes.ts
import type { ChangeSetPackage, Locale } from '@isbp/sdk';
const t = (en: string, zh: string, ja: string) => ({ en, 'zh-TW': zh, 'ja-JP': ja });

// Built for the installer's language: what a kind keeps as plain text (a group's name) is written in it.
export const processes = (locale: Locale): ChangeSetPackage => {
  const say = (en: string, zh: string, ja: string) => t(en, zh, ja)[locale];
  return {
    format: 'isbp.change-set-package',
    version: 1,
    key: 'things-processes',
    title: t('Thing processes', '物品流程', '物品のプロセス'), // the change set's title, in the installer's language
    summary: t('…', '…', '…'),
    requires: { modules: ['itsm'] }, // besides the modules owning the items' kinds (an action's, a record type's)
    items: [
      // Referred to by key below: write the key. Its id is "$ref:reviewers" (e.g. a job's ownerGroupId).
      {
        ref: 'reviewers',
        kind: 'core.group',
        op: 'create',
        value: { key: 'thing-reviewers', name: say('Thing reviewers', '物品審核人員', '物品のレビュー担当') },
      },
      {
        ref: 'approval',
        kind: 'core.workflow',
        op: 'create',
        value: {
          name: say('Thing request approval', '物品申請簽核', '物品申請の承認'),
          description: null,
          triggerKey: 'core.form-submission',
          isDefault: false,
          graph: { steps: [{ id: 'review', type: 'approval', name: t('Review', '審核', 'レビュー'), approvers: [{ type: 'group', groupKey: 'thing-reviewers' }], mode: 'any' }] },
        },
      },
      { ref: 'form', kind: 'core.form', op: 'create', value: { key: 'thing-request', /* … */ workflowId: '$ref:approval' } },
    ],
  };
};

// server/index.ts
defineServerModule(manifest, { …, customizationPackages: { processes: ({ locale }) => processes(locale) } });
```

3. Rules of the format (`isbp.change-set-package`, version 1; schema `changeSetPackageSchema` in
   `@isbp/module-assistant/contracts`, extra checks `packageIssues` in `@isbp/module-assistant/packages`):
   - Items are proposals, exactly what `POST /assistant/change-sets/:id/items` takes: `kind`, `op`, `value` in the
     kind's schema (`assistant.describe_kind` shows the schema, the guide and worked examples; kinds are listed in
     [reference.md](reference.md)), optional `ref`, `label`, `note`. Unknown fields are refused.
   - A package that sets something up uses `create`. `update`, `archive` and `delete` need a `targetId`, which is an
     id of one environment — fine for a file moved between environments that share it, wrong for a built-in package.
   - Order matters: an item may only refer to earlier ones. Wherever an **id** goes, write `"$ref:<ref>"` (a form's
     `workflowId`, a job's `ownerGroupId`); things named by **key** are written as keys (`groupKey`, `formKey`) and
     must come later in the list than the item creating them.
   - At most 300 items. Text people read in three languages. No secrets and no people (group members, assignees by
     user id): they are per site, and group members are never configuration.
   - The content function gets the installer's `locale` (`en` for API clients; built once per locale): `LocalizedText`
     fields carry all three languages, values a kind keeps as plain text (group and job names, reminder, notification
     and ticket texts, workflow descriptions, item labels) are written in `locale`, with the same keys, refs and
     `{{…}}` placeholders in each (the ISMS pack's `plain()` in `modules/isms/src/server/packages/isms-processes`).
   - Installing twice fails the dry run with duplicate keys: change sets don't merge, a person reviews each one.
4. Test: `apps/api/test/unit/packages.test.ts` checks every installed module's packages, built in each language
   (format, kinds and operations, references, required modules, catalog keys). Add an integration test that installs yours on a fresh
   platform as an administrator (`POST /api/v1/assistant/packages/<module>/<key>/install`), expects `ready: true`
   (every item passed its kind's checks in the dry run), applies it and rolls it back.

_See:_ `apps/api/test/integration/assistant-packages.test.ts` (a test module with packages),
`modules/assistant/src/lib/packages.ts`, `docs/architecture.md` §15.8b, `docs/api.md` ("Change-set packages").

## 29. Put what waits for people on My work (and keep the sidebar for the people who work there)

My work (`/my-work`) is everyone's one place for "what needs me": approvals, forms to fill in, records to check,
tasks. A module adds a **source**, and the platform shows its items on My work, on Home ("Needs you") and in the
sidebar badge.

1. Manifest: `work: [{ key: 'reviews', label: 'things.work.reviews', kind: 'review', icon: 'clipboard-check',
permission: 'things.self.use', href: '/things/reviews' }]`. `kind` picks the section: `approval` (decide),
   `todo` (fill in or do), `review` (check records), `task` (assigned work; listed, not counted in the badge).
2. Server: `defineServerModule({ work: { reviews: async (auth, ctx, { limit }) => ({ count, items }) } })`. Answer
   for `auth` only (the reviewer, the assignee, members of the assigned group), one or two indexed queries; with
   `limit: 0` return just the count. Each item opens the item itself (`/things/reviews/REV-7?view=mine`), with plain
   `title`/`subtitle` and an optional translated `detail: { key: 'things.work.toCheck', params: { count } }`.
3. Navigation: gate sidebar entries on the permission of the people who run the area (`things.reviews.manage`), not
   the self-service one everyone holds; participants reach their part from My work and the notification. Group your
   pages as `children` of one entry, sub-pages behind section tabs as `tabs`, settings as `section: 'admin'` with an
   `area` and a `description` (an Administration hub card). Show an entry only to people who take part (members of a
   project) with `check: true` + `defineServerModule({ navigation: { [id]: (auth, ctx) => boolean } })`.
4. Notify with an `href` that opens the item (the same as the work item's), so the bell and My work agree.

_See:_ `modules/isms/src/server/work.ts` (stocktake checks, account reviews, password changes),
`modules/dbaccess/src/server/work.ts`, `apps/api/src/core/work.ts` (approvals, assigned forms),
`modules/projects/src/server/work.ts` (tasks and the "member of a project" check).

## 30. Keep deletes from breaking open work (references)

A group or a record must not disappear while something still needs it: a request in approval whose action notifies
the group, an open to-do assigned to it, a ticket in its queue, a published form whose settings name a CI. The
platform refuses such deletes with 409 `IN_USE` and lists what still uses it, so the administrator can resolve those
first (decision 93).

1. Your record deletes call `ctx.records.forget(ref, { tx })` in the deleting transaction (R15): it runs every
   module's finders for the record (open requests whose answers name it, published forms whose settings do) and
   refuses before anything is committed.
2. When your module's **open work or live settings** name another module's record or a group, report them:
   `defineServerModule({ references: { 'core.group': async (target, ctx, { tx, limit }) => [...] } })`, keyed by the
   referenced type with its prefix (`*` answers for every record type). Read in `tx`, at most `limit` rows, one or two
   indexed queries. Return `{ kind, label, href }`: `kind` is `request`, `approval`, `todo`, `work` (an open ticket, a
   stocktake still in progress) or `setting` (a job or form whose next run would fail); `label` is a
   reference and a name with no other words (`INC-00123 · VPN drops`, or localized text); `href` opens it.
3. Report only what would break or be orphaned, and that an administrator can resolve (finish, reassign, cancel or
   archive). Closed work and history never block a delete, and a column your
   foreign key clears (`on delete set null`, e.g. an owner group) doesn't count.
4. Settings kept as JSON name groups by id or by key: match them with
   `sql\`jsonb_path_match(${col}, ${GROUP_JSONPATH}::jsonpath, ${groupPathVars(target)}::jsonb)\`` (a select option
   that reads like the key doesn't match).
5. UI: a confirm dialog shows `<InUseList error={mutation.error} />` (`@isbp/ui/in-use`); every error toast already
   names the first use ("Still used by INC-00123 · VPN drops and 2 more.").

_See:_ `apps/api/src/core/references.ts` (requests, approvals, to-dos, forms, approval processes),
`modules/itsm/src/server/references.ts`, `modules/scheduler/src/server/references.ts`,
`apps/api/test/integration/references.test.ts`.
