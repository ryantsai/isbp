# Building on IS Big Platform — guide for AI coding agents

This folder is written for AI coding agents (and the people reviewing their work) who add or change
**modules**: the plugins every feature of the platform is made of. It describes the platform as it is now, states
the rules as checkable sentences, and gives working patterns to copy. `docs/architecture.md` explains _why_
things are the way they are, phase by phase. This folder explains _how to build_ with them today.

## Read in this order

| #   | File                                   | Read it when                                                                               |
| --- | -------------------------------------- | ------------------------------------------------------------------------------------------ |
| 1   | [rules.md](rules.md)                   | Always, before writing code. Numbered MUST / MUST NOT rules; cite them in reviews (`R12`). |
| 2   | [system-map.md](system-map.md)         | You need the big picture: processes, request lifecycle, data ownership, how modules load.  |
| 3   | [module-anatomy.md](module-anatomy.md) | You create a module or a file in one: what goes where, naming, minimal skeletons.          |
| 4   | [api-reference.md](api-reference.md)   | You call the SDK: manifest fields, `ModuleContext` services, web SDK, UI kit, contracts.   |
| 5   | [recipes.md](recipes.md)               | You implement a common task (entity + pages, approval, notification, task type, slot, …).  |
| 6   | [reference.md](reference.md)           | You need an exact name another module declares (permission, event, slot, record type, …).  |
| 7   | [testing.md](testing.md)               | You write or run unit, integration or e2e tests.                                           |
| 8   | [ui-components.md](ui-components.md)   | You build any UI: which Astryx component or composite for what (never invent one).         |
| 9   | [ui-guidelines.md](ui-guidelines.md)   | You build pages: layout, forms, status, charts, motion, accessibility, i18n vocabulary.    |
| 10  | [checklist.md](checklist.md)           | Before you say "done": the definition of done and the review prompts.                      |

`reference.md` is **generated** from the code (`pnpm docs:reference`; CI fails when it is stale). Everything
else is hand-written. When the code and a hand-written page disagree, the code wins: fix the page in the same
change.

## The five things that matter most

1. **Everything is a module.** A feature is a workspace package in `modules/<id>` with a manifest, a server half
   and a web half. It talks to the platform only through `ModuleContext` (server) and the web SDK (browser).
   Modules never import another module's services and never write another module's tables.
2. **Declare, then implement.** Permissions, events, notifications, workflow triggers, record types, task
   types, AI tools, settings and navigation are declared in `manifest.ts`. The platform validates the manifest
   and the handlers against it at start-up.
3. **Every mutation is atomic and accountable.** It happens in `ctx.transaction`, with `ctx.audit.record` and
   `ctx.events.publish` in the same transaction.
4. **The API is the security boundary.** Every route declares a permission. The UI only hides what the API
   would refuse anyway.
5. **Every string ships in three languages** (en, zh-TW, ja-JP), every page passes WCAG 2.1 AA, and every page
   works at 375 px.

## Decision tree: "where does my change go?"

- A new IT process (a form, who approves, what happens after, a recurring checklist) → **configuration, not code**:
  build it on the admin pages or with the assistant, or ship it as a **process pack** (R55). Only when it can't be
  built: add the missing **building block**, **record type** or **connector** below, in a form any process could use
  (R56; terms in `docs/architecture.md` §1).
- A new business capability with its own data → a **new module** (`pnpm create-module <id>`, see
  [module-anatomy.md](module-anatomy.md)).
- React to something another module does → **consume its event** (`manifest.events.consumes` + handler). Names
  are in [reference.md](reference.md).
- Show your data on another module's page → **contribute to its slot** (`defineWebModule({ slots })`).
- Let other modules link to, attach files to or pick your records → declare a **record type** + resolver. Let request
  forms filter on them and approvals route on them ("the CI's support group approves") → add record **facts**
  (recipe 24).
- Something must be approved → declare a **workflow trigger** and start it with `ctx.workflows.start`.
- Work that should run on a schedule chosen by an admin → a **task type** (Scheduled jobs runs it). Work that
  your module runs on a fixed schedule → a module **job** with `schedule`.
- An external database → `ctx.databases` with a connection an admin registered. An external HTTP API →
  `ctx.http`. Untrusted code → `ctx.sandbox`.
- An AI assistant or agent should be able to do it → declare an **AI tool** (same permission as the route).
- Your records should sync with an outside system (ServiceDesk Plus, Azure DevOps, …) → a **sync adapter**
  (`manifest.syncEntities` + `sync`). A new outside system → a **connector** module (`manifest.connectors` +
  `connectors`) with a stand-in in `tooling/integration-mocks`. The Integrations Hub connects the two.
- A change to the platform itself (kernel, SDK, core pages) → `apps/api/src/kernel`, `apps/api/src/core`,
  `packages/*`. This needs more care: see "Platform changes" in [rules.md](rules.md).

## Commands you will use

```bash
pnpm create-module <id>                      # scaffold modules/<id>, install, generate migration, sync registries
pnpm --filter @isbp/module-<id> db:generate  # after editing src/server/schema.ts
pnpm modules:sync                            # after adding/removing a module
pnpm docs:reference                          # after changing a manifest, slot or error code
pnpm format:check && pnpm lint && pnpm typecheck && pnpm modules:check && pnpm docs:check && pnpm test
pnpm test:integration                        # real Postgres + Redis (pnpm dev:services)
E2E_BASE_URL=http://localhost:3000 pnpm e2e  # against a seeded, running stack
```

Claude Code users also get project skills: `/new-module` (build a module end to end following this guide) and
`/review-module` (check a module against [rules.md](rules.md) and [checklist.md](checklist.md)).
