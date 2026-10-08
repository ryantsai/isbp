# Scheduled jobs (`scheduler`)

HTTP calls, SQL statements, sandboxed scripts and the task types other modules contribute (ETL pipelines,
inventory syncs), on cron / interval / after-job / manual triggers, with retries, timeouts, run history, live
logs, alerts and a monitoring dashboard. Design: `docs/architecture.md` §11.5.

| File                   | What it does                                                                                        |
| ---------------------- | --------------------------------------------------------------------------------------------------- |
| `src/manifest.ts`      | Navigation, permissions, roles, events, settings, AI tools, notifications, record type, task types  |
| `src/model.ts`         | Pure rules (browser-safe): backoff, expected status, cycles, all/any, log caps, cron text, secrets  |
| `src/schedule.ts`      | Cron and interval arithmetic in a job's time zone, misfire planning (server only: `cron-parser`)    |
| `src/contracts.ts`     | Zod schemas of the API, the built-in task configs and the DTOs                                      |
| `src/server/engine.ts` | Tick (`FOR UPDATE SKIP LOCKED`), execution (heartbeat, timeout, cancel, retries), downstream, purge |
| `src/server/tasks.ts`  | The built-in task types `scheduler.http`, `scheduler.sql`, `scheduler.script`                       |
| `src/server/jobs.ts`   | Job CRUD, validation, the ownership rule, secrets sealing                                           |
| `src/server/runs.ts`   | Runs, cancel/retry, log lines (the SSE stream lives in `routes.ts`)                                 |
| `src/server/seed.ts`   | Demo jobs and history; `seedJob` / `seedRunHistory` are exported for the platform seed              |
| `src/web/pages/*`      | Overview (dashboard), jobs, job, job form (`/jobs/new?type=&name=&config=` deep link), runs, run    |
| `src/web/slots/*`      | "Failing jobs" on the home dashboard (`core.dashboard.work`)                                        |

Task types of other modules get their config editor from the slot `scheduler.task-config.<type>` (props
`TaskConfigSlotProps` from `@isbp/contracts`); without one the job form shows a JSON editor checked against the
type's schema.

**Customisation kind (Phase 6).** `scheduler.job` (`src/server/customizations.ts`): the job form without
`enabled` (archive disables, restore enables; the task type is fixed), applied with `JobService` as the person
applying, so the task type's permission and the ownership rule still apply. Secrets read back as placeholders and
keep their stored value. Template `http-check` (name, URL, every N minutes).

```bash
pnpm --filter @isbp/module-scheduler db:generate   # after changing src/server/schema.ts
pnpm --filter @isbp/module-scheduler test
```
