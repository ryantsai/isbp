# __TITLE__ module

__DESCRIPTION__

Scaffolded with `pnpm create-module __ID__`. It is a complete, working module built on the same SDK as
every built-in module:

| File | What it does |
| --- | --- |
| `src/manifest.ts` | Declares navigation, permissions, default roles, events, settings, AI tools and search |
| `src/contracts.ts` | Zod schemas shared by the API routes and the web pages |
| `src/server/schema.ts` | Drizzle tables in the `__SCHEMA__` Postgres schema |
| `src/server/routes.ts` | REST endpoints under `/api/v1/__ID__` (permission-gated, audited, evented) |
| `src/server/index.ts` | `defineServerModule` — routes, event handlers, jobs, AI tools, search, seed |
| `src/web/index.tsx` | `defineWebModule` — pages served at `/__ID__/*` |
| `messages/*.json` | en, zh-TW and ja-JP strings (namespace `__ID__`) |

Common tasks:

```bash
pnpm --filter @isbp/module-__ID__ db:generate   # after changing src/server/schema.ts
pnpm --filter @isbp/module-__ID__ test
```

See `docs/module-development.md` for the full guide.
