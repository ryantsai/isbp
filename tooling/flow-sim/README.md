# @isbp/flow-sim — the flow simulator

Runs the product's user flows hundreds of times with random data against a running stack, through the public API as
the people in them would, and reports what broke: failed checks grouped by signature, 5xx responses, requests slower
than 3 s (and p50/p95/p99 per route), races, background work that never finished, failed jobs and process actions,
and error-level log entries.

```bash
pnpm turbo run build --filter=@isbp/api      # once (don't rebuild while a simulation runs)
pnpm sim:stack --reset                       # the simulator's own stack: API :4010, worker, database isbp_sim
pnpm sim --iterations 5 --concurrency 4      # a quick check
pnpm sim --iterations 500 --concurrency 6 --seed 42 --report /tmp/sim-500
```

`pnpm sim --list` shows the flows and personas; `pnpm sim --help` every option.

## The simulator's stack

`stack.sh` (`pnpm sim:stack`) runs the API and the worker from the production build (`apps/api/dist`) on their own
database, Redis index, ports and integration stand-ins, so a simulation never touches the demo stack (web :3000,
API :4000, database `isbp`) or the integration test databases.

| Variable                  | Default                                           | What                                                        |
| ------------------------- | ------------------------------------------------- | ----------------------------------------------------------- |
| `SIM_DIR`                 | `tooling/flow-sim/.state/stack`                   | logs (`api.log`, `worker.log`), pids, uploads, seed log     |
| `SIM_DB_NAME`, `SIM_PG`   | `isbp_sim`, `postgres://isbp:isbp@localhost:5432` | the database (never `isbp` or `*_test`)                     |
| `SIM_REDIS_URL`           | `redis://localhost:6379/12`                       | its own Redis database index (never 0)                      |
| `SIM_API_PORT`            | `4010`                                            | API (`PUBLIC_URL=http://127.0.0.1:4010`)                    |
| `SIM_API_METRICS_PORT`    | `9474`                                            | the API's Prometheus endpoint                               |
| `SIM_WORKER_METRICS_PORT` | `9475`                                            | the worker's (`/metrics`, `/readyz`)                        |
| `SIM_MOCKS_PORT`          | `4110`                                            | its own integration stand-ins (`tooling/integration-mocks`) |
| `SIM_MOCKS_URL`           | —                                                 | use running stand-ins instead (see below)                   |
| `SIM_LOG_LEVEL`           | `info`                                            | `LOG_LEVEL` of the API and worker (JSON logs)               |

- `pnpm sim:stack` starts what isn't running (creating, migrating and seeding the database the first time);
  `--reset` drops and recreates the database and empties its Redis index, then migrates, seeds and starts;
  `stop`, `status` and `env` do what they say.
- The stack runs with `RATE_LIMIT_MAX=100000`, `RATE_LIMIT_ROUTE_SCALE=1000` (every route's own limit, such as 60 uploads
  a minute, times 1000), `LOGIN_MAX_ATTEMPTS=1000` and `ISBP_ALLOW_PRIVATE_WEBHOOKS=true`, so the simulation measures the
  product, not the rate limiter.
- It starts its **own** integration stand-ins: the seed resets the stand-ins' state and registers webhooks on them, and
  the sync profiles push the simulation's tickets and assets to them. Sharing the dev stack's stand-ins (`:4100`) would
  reset them under the dev stack and carry simulated records into its database.
- The seed's output (it prints the demo passwords and API keys) goes to `$SIM_DIR/seed.log` and is never printed.

## Personas

Flows act as personas: `ctx.as('agent')`. The seed's accounts sign in with the seed's passwords (`SEED_ADMIN_PASSWORD`,
`SEED_DEMO_PASSWORD`, or the seed's defaults). The simulator's own people (`sim.*`, in the departments
"Flow simulation", "· Business" and "· IT") are created through the public admin API the first time a persona can't
sign in (or with `--setup`): departments and their managers, people with their managers, group memberships and role
assignments, and a random password each (`POST /users/:id/password`, so nobody has to change it at first sign-in).

| Persona                             | Pool        | Who                                                                                                 |
| ----------------------------------- | ----------- | --------------------------------------------------------------------------------------------------- |
| `admin`                             |             | the seed's platform administrator                                                                   |
| `helpdesk`, `hr.partner`, `auditor` |             | the seed's named demo users                                                                         |
| `itlead`                            |             | manager of the IT staff and agents (approves their requests, signs off their resolutions)           |
| `manager`                           |             | manager of the employees                                                                            |
| `employee1`…`employee4`             | `employee`  | employees without IT roles: raise tickets                                                           |
| `requester1`…`requester3`           | `requester` | employees who request access: only the access-request flow uses them (their roles change during it) |
| `itstaff1`…`itstaff3`               | `itstaff`   | IT staff in the DBA team (they read the CMDB): request configuration changes                        |
| `agent1`…`agent3`                   | `agent`     | service desk agents (Service Desk group, `itsm-agent`)                                              |
| `approver`                          |             | member of every CI support group (IT admins, network, security, DBA, service desk, app owners)      |
| `cab`                               |             | member of the Change Advisory Board                                                                 |
| `roleowner`                         |             | owner of the roles the access-request flow makes requestable                                        |
| `finance`                           |             | member of the Finance Team (expensive equipment, paid licences)                                     |
| `ismsofficer`                       |             | joins the ISMS process pack's groups while the `isms-pack` flow has it applied                      |

A pool name picks one member for the whole flow run (seeded), so concurrent runs spread over the pool. Need someone
new? Add a `PersonaSpec` to `PERSONAS` in `src/personas.ts` (managers before their reports) and run with `--setup`.

The passwords live only in `.state/personas-<host>-<port>.json` (mode 600, gitignored). Nothing the simulator prints or
writes to a report contains a password, a token or an API key: response excerpts drop every key that looks secret.

## The flow contract

A flow is one user journey, in `src/flows/<area>.ts`, registered in `src/flows/index.ts`:

```ts
import { defineFlow } from '../flow';

export const raiseTicket = defineFlow({
  name: 'ticket-lifecycle', // kebab-case, unique: --flows ticket-lifecycle
  area: 'itsm', // the module it exercises (and the file it lives in)
  description: 'Employee raises an incident → agent resolves → confirmed',
  personas: ['employee', 'agent'], // checked before the run starts
  timeoutMs: 180_000, // optional (default --flow-timeout)
  async run(ctx) {
    const me = ctx.as('employee');
    const sfx = ctx.rand.suffix();
    const t = await ctx.step('the employee raises an incident', async () => {
      const res = ctx.expect.status(await me.post('/itsm/tickets', { title: `VPN drops ${sfx}` }), 201);
      ctx.expect.equal(res.body.status, 'new', 'status');
      return res.body;
    });
    await ctx.step('an agent finds it', async () => {
      const list = ctx.expect.ok(await ctx.as('agent').get('/itsm/tickets', { query: { q: sfx } })).body
        .items;
      ctx.expect.find(list, (x: { id: string }) => x.id === t.id, 'the queue lists it');
    });
  },
});
```

What `ctx` gives a flow:

| Member                                                              | What it does                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `as(persona)`                                                       | an `ApiClient`: `get/delete(path, { query })`, `post/patch/put(path, body, { query })` → `{ status, body, ms, … }`. Paths are relative to `/api/v1`. Never throws: a refusal is a response, no response is status 0. Cookie + CSRF handled; an expired session signs in again (and is counted). |
| `user(persona)`, `personaOf(userId)`                                | who a persona is (`id`, `username`, `displayName`), and back                                                                                                                                                                                                                                    |
| `rand`                                                              | seeded randomness: `int`, `float`, `bool(p)`, `pick`, `weighted`, `sample`, `shuffle`, `word(s)`, `sentence`, `paragraph` (some Chinese and Japanese), `date(minDays, maxDays)`, `dateRange`, `instant`, `suffix()`, `fork(label)`                                                              |
| `step(label, fn)`                                                   | names a part of the flow; failures say which (nested) step they happened in                                                                                                                                                                                                                     |
| `expect.ok / status / code / equal / truthy / match / find / oneOk` | checks that throw a `FlowError` with the step, the request and an excerpt of the response                                                                                                                                                                                                       |
| `eventually(fn, check, { timeoutMs, label })`                       | polls until background work shows (event handlers, workflow completions, process actions); the report shows how long each wait took                                                                                                                                                             |
| `approvals.taskOf / decide / approveAll / instance`                 | approval workflows as the people in them see them: decide a persona's task (from the instance page or the inbox, `twice: true` for a double click), or approve as whichever personas the instance waits for until it finishes                                                                   |
| `forms.published(key, persona)`, `forms.answers(schema, overrides)` | a form as a person sees it, and random valid answers from its own schema (record, user and table fields, and answers form rules tie together, are yours to give)                                                                                                                                |
| `tag(name)`                                                         | counts a variant the run took (`manager rejects`, `double submit`): the report shows them per flow                                                                                                                                                                                              |
| `log(message)`, `fail(message, details)`                            | a line for the failure's trail; fail on purpose                                                                                                                                                                                                                                                 |

### Rules for flows

1. **Self-contained.** Create what you need, named with `ctx.rand.suffix()` (unique per run, iteration and flow, and
   across runs). Never rely on another flow's records, and leave shared configuration as you found it (a flow that
   makes a role requestable retires it again).
2. **Thousands of records are already there.** Never assume a list is short or that page 1 holds your record: filter
   with `q` (your suffix, a reference) or by id.
3. **Background work lands later.** Anything done by the worker (grants, process actions, notifications, completions)
   is checked with `ctx.eventually`, never right after the request.
4. **Act as the person who would.** The requester requests, their manager approves from their inbox, the agent works
   the ticket. Use `admin` only for what an administrator would do.
5. **Check outcomes, not just statuses**: the state each party sees afterwards (the requester's page, the approver's
   inbox, the agent's queue), counts that must be exactly one (one grant, one change raised).
6. **Random but valid**, plus the refusals that matter (a duplicate, a missing comment, a broken form rule) and the
   races people cause: send the same request twice at once and require `ctx.expect.oneOk(responses, …)`.
7. **Don't change what other flows see.** A persona whose access or settings a flow changes belongs to that flow alone
   (a pool of its own, like `requester`): an employee who briefly holds a ticket-reading role is an agent to every
   other flow's tickets.
8. Keep a run under the flow timeout (default 180 s) and tag the variants it takes.
9. **Global changes run one at a time.** A flow that changes what every flow sees (installing a built-in package, a
   default workflow, a platform setting) does that part under a named harness lock, `exclusive(name, fn)` from
   `src/lock.ts` (in-process; the wait counts towards the flow's timeout), undoes it before releasing the lock, and
   cleans up after a failure too (the `isms-pack` flow waits for an apply still running on the server, then rolls it
   back).

## The report

`report.json` (everything) and `report.md` (for people) in `--report` (default `.state/reports/<time>/`). The run exits
1 when any flow run failed, a 5xx or a request without a response was seen, background work did not drain, a job or a
process action failed, or the API or worker logged at error level; 2 when it could not start.

- **Flows**: runs, passes, failures, p50/p95/max duration and the variants taken.
- **Failures by signature**: flow › step › message with ids, references, numbers, dates and suffixes replaced, sorted
  by count; the first occurrence with the personas, the request and response excerpt, details and the run's trail.
- **5xx responses**, **no response**, **slow requests** (`--slow-ms`, default 3 s) and **latency by route** (route
  templates: ids → `:id`, `INC-00042` → `:ref`).
- **Waiting for background work**: how long each `eventually` took (p50/p95/max) and how many timed out.
- **Background work**: after the last flow, the simulator polls until the outbox has relayed everything, the BullMQ
  queues have nothing waiting or active (and no retries pending on the event and process-action queues), and no
  process action is queued or running (`--drain-timeout`, default 120 s). It also lists jobs that failed for good and
  process-action runs that failed during the run, and the worker's handler errors (retried) from its `/metrics`.
  These are read-only reads of the stack's database (`--db`, a read-only session), Redis (`--redis`) and worker
  metrics (`--worker-metrics`); `none` turns one off. The defaults match `pnpm sim:stack`.
- **Log entries at error level**: what the API and worker logged at level ≥ 50 during the run (`--logs <dir>` with
  `api.log` and `worker.log`, or `--api-log`/`--worker-log`), grouped by message and error; plus warning counts.
- **Timing**: wall time, time per iteration and an estimate for 500 iterations.

## Files

- `src/cli.ts` (the command), `src/runner.ts` (iterations, concurrency, per-run randomness and pools)
- `src/flow.ts` (`defineFlow`, `FlowContext`, `expect`, `FlowError`), `src/workflows.ts` (approvals), `src/forms.ts`
- `src/client.ts` (API client, sign-in; `{ bearer }` sends a request as an API client's key, `{ headers }` adds headers), `src/personas.ts` (personas and their setup), `src/rand.ts`
- `src/recorder.ts` (requests, latency, 5xx), `src/checks.ts` (drain, failed jobs, logs), `src/report.ts`,
  `src/signature.ts`, `src/safety.ts` (refuses the demo stack and test databases)
- `src/flows/*.ts`, `stack.sh`, `src/stack/db.ts` (creates or drops the simulator's database)
