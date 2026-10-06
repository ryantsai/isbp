# Announcements module

Service announcements, maintenance windows and incident notices for everyone.

Scaffolded with `pnpm create-module announcements`. It is a complete, working module built on the same SDK as
every built-in module:

| File                                 | What it does                                                                                       |
| ------------------------------------ | -------------------------------------------------------------------------------------------------- |
| `src/manifest.ts`                    | Declares navigation, permissions, default roles, events, settings, AI tools and search             |
| `src/contracts.ts`                   | Zod schemas shared by the API routes and the web pages                                             |
| `src/server/schema.ts`               | Drizzle tables in the `announcements` Postgres schema                                              |
| `src/server/service.ts`, `routes.ts` | Business rules + REST endpoints under `/api/v1/announcements` (permission-gated, audited, evented) |
| `src/server/index.ts`                | `defineServerModule` — routes, event handlers, jobs, AI tools, search, seed                        |
| `src/web/index.tsx`                  | `defineWebModule` — pages served at `/announcements/*`                                             |
| `messages/*.json`                    | en, zh-TW and ja-JP strings (namespace `announcements`)                                            |

Common tasks:

```bash
pnpm --filter @isbp/module-announcements db:generate   # after changing src/server/schema.ts
pnpm --filter @isbp/module-announcements test
```

See `docs/module-development.md` for the full guide.
