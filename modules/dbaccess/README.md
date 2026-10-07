# Database access (`dbaccess`)

Self-service database roles on SQL Server, Oracle and PostgreSQL: request → approval → automated provisioning
→ one-time credential reveal → time-bound access, early revocation, offboarding, access reviews and drift
(unmanaged access, orphan accounts). Design: `docs/architecture.md` §11.6.

| Area                                                                                                                 | Files                    |
| -------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| Pure rules (naming, identifiers, durations, drift, review policy, CSV)                                               | `src/model.ts`           |
| API contract (Zod)                                                                                                   | `src/contracts.ts`       |
| Manifest: permissions, roles, workflow `dbaccess.request`, notifications, task type `dbaccess.sync`, AI tools        | `src/manifest.ts`        |
| Tables (schema `dbaccess`)                                                                                           | `src/server/schema.ts`   |
| Per-engine statements (server-side quoting, placeholders only)                                                       | `src/server/ddl.ts`      |
| Running them through `ctx.databases` (purpose `admin`)                                                               | `src/server/engine.ts`   |
| Servers, requestable roles, inventory sync, drift                                                                    | `src/server/servers.ts`  |
| Provisioning / revocation (worker, verified, retried), reveal, expiry, offboarding, adoption                         | `src/server/grants.ts`   |
| Catalog, requests, workflow outcome                                                                                  | `src/server/requests.ts` |
| Access review campaigns                                                                                              | `src/server/reviews.ts`  |
| Demo data                                                                                                            | `src/server/seed.ts`     |
| Pages (`/dbaccess`, `/request`, `/requests/:ref`, `/grants`, `/reviews`, `/reviews/:id`, `/servers`, `/servers/:id`) | `src/web/pages/*`        |
| Slots: `scheduler.task-config.dbaccess.sync`, `core.user.overview`, `core.dashboard.work`                            | `src/web/slots/*`        |

## How provisioning works

1. A request (one per role) starts the required workflow `dbaccess.request`: the requester's manager, the role
   owner (the `role.approverIds` fact: the owner, or the members of the owning group), and the `security-team`
   group for high-risk roles.
2. On approval a grant is created (`provisioning`) and the `provision` job runs in the worker. It finds or
   creates the account (named from the server's pattern), grants the role, reads the membership back and marks
   the grant `active`. A generated password is sealed (`ctx.secrets`) as a one-time reveal for 7 days.
3. Failures are retried (3 attempts, `provisioning.retrySeconds` × 1, 4, 16), then the grant is `failed` and the
   server's DBA group is notified; DBAs can retry.
4. `expire-grants` (every 5 minutes) starts revoking expired grants, reminds grantees 3 days ahead and re-queues
   work whose job was lost. `core.user.offboarded` revokes everything and disables the person's accounts.

Statements are built by the target server from bound parameters only — SQL Server `QUOTENAME` +
`sp_executesql`, PostgreSQL `format('%I', '%L')` (the returned statement is then run), Oracle
`DBMS_ASSERT.ENQUOTE_NAME` in PL/SQL — and names are checked against strict patterns and the synced inventory.

```bash
pnpm --filter @isbp/module-dbaccess test        # model, statement builders, manifest and catalogs
pnpm --filter @isbp/module-dbaccess db:generate # after changing src/server/schema.ts
```
