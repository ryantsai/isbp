# Applications module (`alm`)

Application lifecycle management: the application inventory (ownership, lifecycle stage, criticality, TIME
disposition, CMDB link, repositories), environments, releases and deployment records — linked to ITSM
change management. Depends on `cmdb` and `itsm` and **reads** `cmdb.cis`, `itsm.tickets` and `itsm.changes`.

| File                       | What it does                                                                                    |
| -------------------------- | ----------------------------------------------------------------------------------------------- |
| `src/model.ts`             | Vocabulary and pure rules: the change policy, release readiness, DORA assembly, code suggestion |
| `src/contracts.ts`         | Zod DTOs and the API contract (see the header comment)                                          |
| `src/server/schema.ts`     | `alm.applications`, `repositories`, `environments`, `releases`, `deployments`                   |
| `src/server/access.ts`     | The ownership rule (owners and team members edit their own application)                         |
| `src/server/*.ts` services | `ApplicationService`, `ReleaseService`, `DeploymentService`, `MetricsService`                   |
| `src/server/changes.ts`    | Reading ITSM changes and the release ↔ change record links                                      |
| `src/server/records.ts`    | Record resolvers (`alm.application`, `alm.release`) and global search                           |
| `src/server/ai.ts`         | AI tools `alm.find_applications`, `get_application`, `release_readiness`, `record_deployment`   |
| `src/server/seed.ts`       | Demo portfolio (stable codes and versions; the cross-module seed links by them)                 |
| `src/web/*`                | Inventory, application, release and release-calendar pages; slots for CMDB, ITSM and home       |

**Change policy.** A deployment to a `production` environment is authorized when the named change, or a
change linked to the release, is `scheduled` or `implementing`. With `alm.policy.enforceWindow` it must
also be within the change's planned window (otherwise it is recorded with a warning). Refusals are
`409 CHANGE_REQUIRED` (`details.reason`: `no_change`, `change_not_approved`, `outside_window`); holders of
`alm.deployments.override` may record it anyway with a reason (audited, change managers notified).

**CI/CD.** Pipelines record deployments with an API key holding `alm.apps.read` + `alm.deployments.create`:

```bash
curl -X POST "$URL/api/v1/alm/deployments" -H "Authorization: Bearer $KEY" -H 'content-type: application/json' \
  -d '{"application":"erp","environment":"production","version":"12.1.0","changeReference":"CHG-00042"}'
```

```bash
pnpm --filter @isbp/module-alm db:generate   # after changing src/server/schema.ts
pnpm --filter @isbp/module-alm test
```
