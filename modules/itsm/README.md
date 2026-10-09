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

**Change acceptance (Phase 8).** In a change's post-implementation review (`review`) its requester (or the person it
was requested for) is notified (`itsm.change.acceptance_requested`) and answers with `POST /tickets/:ref/acceptance`:
"Accept the change", or "Report a problem" with the reason. The latest verdict is kept on the change
(`changes.acceptance*`), each one is in the conversation and audited (`itsm.change.accepted` /
`itsm.change.problem_reported`), the event `itsm.change.acceptance_recorded` is published and the implementer is told.
Closing a change from review records whether it was accepted (timeline `data.accepted`, audit metadata); with the
setting `changes.requireAcceptance` (default off) a change that has a requester closes only once accepted (409
`INVALID_STATE`, `details.reason: 'acceptance_required'`).

**Resolution sign-off (Phase 8).** The optional workflow trigger `itsm.resolution` (facts `ticket.type`, `category`,
`priority`, `impact`, `urgency`, `major`, `groupKey`, `resolutionCode`, `ciCount`, `ciCriticality`, `criticalCis`, and
the custom fields as `attributes.<key>`). With a workflow bound, resolving or fulfilling an incident, service request
or problem starts it with the resolver as requester (so "their manager" signs off): when a step asks someone, the
ticket is `pending_approval` with `sign_off_instance_id` set ("Waiting for sign-off"; the resolution is kept on the
ticket), and only going back to work (which withdraws the sign-off) or cancelling is allowed. Approval resolves it
with the kept resolution; a rejection sends it back to in progress with the reason (`itsm.ticket.sign_off_rejected`
to the resolver and the assignee). Admins scope it with step conditions (e.g. `ticket.category` = an "equipment
anomaly" category); out of scope, the ticket resolves at once. A sync that resolves a ticket starts the same sign-off
and goes no further.

**Desk flows.** The ticket page's primary button is the next lifecycle step (`nextStep` in `src/web/logic.ts`):
a draft change goes to `authorization` in one call (the assessment is passed in the same transaction), and "Start
implementation" makes the person starting an unowned change its assignee. Status changes, confirmations, acceptance
and edits lock the ticket row inside their transaction and re-check it: two simultaneous resolves give one 200 and one
409 `INVALID_TRANSITION` (`details.reason: 'changed'`); an edit computed from a stale row (impact and urgency changed
at once, a sync pulling a value) is recomputed from the fresh row instead of overwriting it. Resolving can name the
article that solved it (`articleId`, checked as the caller through `knowledge.get_article`; a platform link between
the ticket and `knowledge.article`, and `data.article` on the status entry). `POST /tickets` takes `ticketLinks`
(a problem raised from its incidents) and `POST /tickets/:ref/links` a `direction` (`incoming`: the other ticket
points at this one). `POST /tickets/:ref/problem/article` writes the known-error article as a knowledge draft for
agents through `knowledge.create_draft` (as the caller) and sets it as the problem's article. The queues count open
incidents and service requests (`DESK_TYPES`, drafts never), `attention` = breached or at risk, `types` filters the
list by several types and `sort=slaDue` orders by the earliest running deadline. "My requests" and form fulfilments
use requester words (`itsm.requesterStatus.*`: "Received" for new). The configuration lookups compare a one-row stamp
(count and latest `updated_at`) with the database on every use, so a category made by the API is valid in the worker
at once.

Common tasks:

```bash
pnpm --filter @isbp/module-itsm db:generate   # after changing src/server/schema.ts
pnpm --filter @isbp/module-itsm test
```

See `docs/module-development.md` for the full guide.
