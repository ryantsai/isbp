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

Common tasks:

```bash
pnpm --filter @isbp/module-itsm db:generate   # after changing src/server/schema.ts
pnpm --filter @isbp/module-itsm test
```

See `docs/module-development.md` for the full guide.
