# Integrations Hub (`integrations`)

Connections to outside systems, sync profiles with field mappings, the two-way sync engine, runs, linked
records and conflicts (Administration → Integrations). Design: `docs/architecture.md` §12. The hub knows
neither side: **connectors** (`ctx.connectors`, e.g. `sdp`, `azdo`) talk to outside systems, **sync
adapters** (`ctx.sync`, owned by `itsm`, `itam`, `knowledge`, `projects`, `alm`) read and write ISBP records
with their module's own rules, and the hub maps fields between them.

## Files

| File                        | What it does                                                                                                                       |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `src/manifest.ts`           | Navigation (admin), permissions, roles, the `Integrations Hub` agent (`*.*.sync`), events, notifications, task type `sync`         |
| `src/contracts.ts`          | Zod schemas of the API and DTOs (route list at the top)                                                                            |
| `src/model.ts`              | Enums, field-type compatibility, push filter, capped run log, paths (browser-safe)                                                 |
| `src/merge.ts`              | The per-field three-way merge, value normalization, directions, the cursor tracker (pure)                                          |
| `src/mapping.ts`            | Profile validation against both field catalogues; the API and the editor use it (pure)                                             |
| `src/server/convert.ts`     | Conversions: HTML → Markdown/text (untrusted: scripts, styles, embeds and unsafe links dropped), Markdown → HTML, choices, tags, … |
| `src/server/connections.ts` | Connections: sealed secrets, webhook secret (SHA-256), tests, health, "Allow insecure HTTP"                                        |
| `src/server/profiles.ts`    | Profiles: validation, the `.sync` permission rule, default mapping, preview (dry run)                                              |
| `src/server/session.ts`     | Everything one sync of one profile needs: bound connector, catalogues, mapping rows, agent, lookups                                |
| `src/server/reconcile.ts`   | Per record: pull (match, create, merge), push (update, create remotely), comments, orphans, item errors                            |
| `src/server/engine.ts`      | Runs (pull, push, webhook, resync, export), rate-limit pauses, health, notifications, webhooks, local change routing, the tick     |
| `src/server/links.ts`       | Linked records, the record panel (`/links/by-record`), relink, unlink, resync                                                      |
| `src/server/conflicts.ts`   | Conflicts: list, detail, resolve per field, dismiss                                                                                |
| `src/server/seed.ts`        | Helpers for the platform seed and tests (below)                                                                                    |
| `src/web/pages/*`           | Overview, connection (tabs: overview, profiles, runs, linked records, conflicts), profile editor, run, conflicts                   |
| `src/web/slots/record-sync` | "Synced with" on every record page (`core.record.links`)                                                                           |
| `src/web/slots/task-config` | The profile picker of the `integrations.sync` task type (`scheduler.task-config.integrations.sync`)                                |

## Tables (schema `integrations`)

| Table            | Notes                                                                                                                                                 |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `connections`    | `type` (`<module>.<type>`), `config`, `secrets_sealed` (one sealed JSON object) + `secret_keys`, `webhook_secret_hash`, `allow_insecure_http`, health |
| `profiles`       | object type + scope ↔ entity + container (fixed once created), direction, create flags, match rule, push filter, mappings, policy, interval, `cursor` |
| `links`          | `(profile, remote_id)` and `(profile, local_id)` unique; `snapshot` `{ [localField]: { l, r } }`; `state` ok/conflict/error/orphaned; `rev`; `origin` |
| `comment_links`  | local comment ↔ remote comment per link (each comment synced once)                                                                                    |
| `runs`           | kind, trigger, status, `counts`, `params` (webhook items, link ids, pushed ids), log capped at 300 entries (first 100 + latest, `log_dropped`)        |
| `pending_pushes` | local changes waiting for the `push` job (batched per profile)                                                                                        |
| `conflicts`      | per link at most one `open`; `fields` `[{ field, remoteField, label, type, base, local, remote }]` in ISBP's form; `choices`                          |

A partial unique index allows one queued/running/waiting pull or export per profile (`SYNC_RUNNING` 409
otherwise).

## The engine

- **Jobs:** `tick` (every minute: due pulls of enabled pull/two-way profiles with `interval_minutes > 0`, stale
  and lost runs, stalled pushes), `pull` (`{ runId }`: executes pull, export and resync runs, and resumes paused
  ones), `push` (`{ profileId }`: drains `pending_pushes` into one `event` run), `webhook-items` (`{ runId }`),
  `check-connections` (every 15 minutes: tests, health, notifications, purges runs older than 30 days).
- **Pull:** retries links in `error` first, then pages through `changes()` from the stored cursor. The cursor
  is stored after each page (`CursorTracker`: it stays before a page whose items wait for their parent, until
  they are done). Per remote record, under a Redis lock on the record: deleted → link `orphaned`; same version
  → skip; unlinked → `findBy` on the match rule (link, then merge from an empty snapshot) or create locally;
  linked → three-way merge. The adapter write, the link, its snapshot and any conflict commit in one
  transaction whose link update checks `rev`.
- **Merge** (`decideField`, per mapped field, each side compared with its own form in the snapshot): only remote
  changed → write locally; only ISBP changed → push (two-way); both changed to the same value → agree; both
  differently → the one-way source wins, otherwise the policy (`remote`, `local`, `newest` by `updatedAt`,
  `manual` → a conflict row; the other fields still merge). A field never agreed counts as changed on each side
  that has a value, so filling an empty side is never a conflict. Pushes go first, with `expectedVersion`;
  `REMOTE_CONFLICT` re-reads and merges again. Values are normalized before comparing (trailing spaces, `\r\n`,
  null vs '', tag order and case, date-time precision, key order), so echoes of our own writes are no-ops.
- **Push** (`onSyncChange` → `pending_pushes` → `push`): linked records push fields whose local value differs
  from the snapshot (not fields in an open conflict); unlinked ones are created remotely when the profile allows
  it, the container and push filter match (parents first). A push batch that only found echoes leaves no run.
- **Parents** map through the link table (same connection and entity): a pull defers children whose parent isn't
  linked to the end of the run, then fetches the parent directly; still unlinked → the field is skipped and
  logged.
- **People** match by email (`core.users`, active, case-insensitive); unknown people leave the field out and log a
  warning. **Choices** go through the value map, then identical values (case-insensitive). Value-map rows have
  a direction (`both`, `pull`, `push`): per direction a value has at most one row (`duplicate_value`,
  `duplicate_local_value`), so several remote values can become one ISBP value while one row sends it out.
  The editor's suggested mapping is fitted to the scope's catalogue (`fitValueMap`). The validator is exported
  as `validateProfileMapping` (and `@isbp/module-integrations/mapping`); `integrations-defaults.test.ts`
  checks every shipped connector's defaults with it.
- **Comments** (both ways, append-only, each once): history comes along only for records the sync created;
  internal notes stay internal; pushed comments carry their author's name.
- **Failures:** item errors mark the link `error` (with `last_error`), the run `partial`, and are retried next
  run. `REMOTE_RATE_LIMITED` pauses the run (`waiting`) and re-enqueues it after `retryAfterSeconds`.
  `REMOTE_AUTH_FAILED` fails the run, flags the connection `failing` and tells holders of
  `integrations.connections.manage` once (until it works again); so do three failed runs in a row.
- **Webhooks** (`POST /api/v1/integrations/hooks/:connectionId`, public): secret in `X-ISBP-Webhook-Secret` or the
  Basic password, SHA-256 compared in constant time, 120 calls per minute per connection, 401 `WEBHOOK_INVALID`
  (also for unknown connections). The connector says which records changed; a `webhook` run re-reads them.
- **Plain HTTP** is refused by the connector's HTTP client (422 `INSECURE_HTTP`) unless the connection's
  "Allow insecure HTTP" switch is on (or the host is loopback). Turning it on or off is audited (`security`).

## Access

`integrations.connections.read` sees everything but secrets; titles of linked local records resolve through
`ctx.records` for the caller (hidden otherwise). `integrations.connections.manage` changes connections, runs
syncs and manages links; creating or changing a profile also needs the synced entity's `.sync` permission.
`integrations.conflicts.resolve` resolves conflicts on records the caller can see. The record panel
(`GET /links/by-record`) is for whoever can read the record. The hub writes as its agent (`*.*.sync`).

## Seed helpers (`@isbp/module-integrations/server`)

```ts
hubAuth(name?): AuthContext                                       // integrations.* + *.*.sync, for seeds/tests
connectionByName(ctx, name): Promise<ConnectionOut | null>        // idempotent seeds
createConnection(ctx, input: CreateConnectionInput, auth?): Promise<{ connection: ConnectionOut; webhookSecret: string }>
createProfile(ctx, input: CreateProfileInput & { mappings?: FieldMapping[] | 'default' }, auth?): Promise<ProfileOut>
runPullNow(ctx, profileId, trigger?: 'manual' | 'schedule'): Promise<RunDetailOut>   // a full pull (export for push-only), awaited
registerDemoWebhook(ctx, connectionId, secret?): Promise<{ path: string; secret: string }>  // known secret for a stand-in
services(ctx)                                                    // the service layer
```

## Slots

- Hosts `integrations.connector-config.<module>.<type>` (props `ConnectorConfigSlotProps` from
  `@isbp/contracts`) in the connection sheet; without a contribution it generates a form from the connector's
  JSON Schemas. The hub renders the name, "Enabled" and "Security" (Allow insecure HTTP) around it.
- Contributes `core.record.links` ("Synced with"; renders nothing without links) and
  `scheduler.task-config.integrations.sync`.

```bash
pnpm --filter @isbp/module-integrations db:generate   # after changing src/server/schema.ts
pnpm --filter @isbp/module-integrations test
# integration tests (inline fake connector + data module)
DATABASE_URL=postgres://isbp:isbp@localhost:5432/isbp_hub_test REDIS_URL=redis://localhost:6379/11 \
  ISBP_TEST_MODULES=integrations npx vitest run --project integration test/integration/integrations.test.ts  # from apps/api
```
