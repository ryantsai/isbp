# Itsm module

Incidents, requests, problems and changes with SLAs

Scaffolded with `pnpm create-module itsm`. It is a complete, working module built on the same SDK as
every built-in module:

| File                   | What it does                                                                           |
| ---------------------- | -------------------------------------------------------------------------------------- |
| `src/manifest.ts`      | Declares navigation, permissions, default roles, events, settings, AI tools and search |
| `src/contracts.ts`     | Zod schemas shared by the API routes and the web pages                                 |
| `src/server/schema.ts` | Drizzle tables in the `itsm` Postgres schema                                           |
| `src/server/routes.ts` | REST endpoints under `/api/v1/itsm` (permission-gated, audited, evented)               |
| `src/server/index.ts`  | `defineServerModule` — routes, event handlers, jobs, AI tools, search, seed            |
| `src/web/index.tsx`    | `defineWebModule` — pages served at `/itsm/*`                                          |
| `messages/*.json`      | en, zh-TW and ja-JP strings (namespace `itsm`)                                         |

**Sync (Phase 5).** `src/server/sync.ts` adapts `itsm.ticket` (incidents, service requests, problems, with public
replies and internal notes; permission `itsm.tickets.sync`) and `itsm.change` (`itsm.changes.sync`) for the
Integrations Hub. Writes go through `TicketService` as the hub's agent: statuses move step by step along
`TRANSITIONS` (resolving to resolved/fulfilled without a code uses `solved` and "Resolved in {connection} {ref}"; cancelling and people in ISBP still give both), an explicit priority overrides the matrix, a
change's plan is frozen once submitted, and a change never gets past `authorization` but through its CAB
approval (409 `INVALID_TRANSITION`, `reason: 'approval_required'`). Created tickets use the `integration`
channel; timeline entries carry `data.via` ("via ServiceDesk Plus #1234").

**Customisation kinds (Phase 6).** `src/server/customizations.ts`, applied with `ConfigService`
(`itsm.config.manage` to read and apply): `itsm.category` and `itsm.sla-policy` (archive deactivates; template
`sla-targets`) and `itsm.catalog-item` (id = the form key). Inside a transaction the configuration lookups
(`lookups.ts`) read the tables directly and cache nothing, and the catalog checks forms through `ctx.db`, so a
change set sees its own changes and a rolled-back dry run leaves nothing in the cache.

Common tasks:

```bash
pnpm --filter @isbp/module-itsm db:generate   # after changing src/server/schema.ts
pnpm --filter @isbp/module-itsm test
```

See `docs/module-development.md` for the full guide.
