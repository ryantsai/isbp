# CMDB module

Configuration items (CIs) of typed classes, directional relationships between them and impact analysis.
ITSM depends on it and **reads** its tables.

| File                    | What it does                                                                                     |
| ----------------------- | ------------------------------------------------------------------------------------------------ |
| `src/model.ts`          | Vocabulary and pure rules: statuses, relationship types and labels, validation, impact traversal |
| `src/contracts.ts`      | Zod DTOs, plus the `CiRelatedSlotProps` slot contract                                            |
| `src/server/schema.ts`  | `cmdb.ci_classes`, `cmdb.cis`, `cmdb.ci_relationships` (exported as `@isbp/module-cmdb/schema`)  |
| `src/server/service.ts` | CIs, relationships, recursive-CTE impact analysis, business services                             |
| `src/server/routes.ts`  | REST API under `/api/v1/cmdb`                                                                    |
| `src/server/ai.ts`      | AI tools `cmdb.find_cis`, `cmdb.get_ci`, `cmdb.get_impact`                                       |
| `src/server/seed.ts`    | Demo estate (stable names; ITSM's seed looks CIs up by name)                                     |
| `src/web/*`             | List, CI detail (overview, relationships, impact graph) and class admin pages                    |

Impact analysis: an outage of X impacts every CI that (transitively) `depends_on` X, `runs_on` X or is
contained in X. `connects_to` and `backs_up` are informational.

Other modules can add to the CI page's "Related work" card through the `cmdb.ci.related` slot
(props: `CiRelatedSlotProps`).

```bash
pnpm --filter @isbp/module-cmdb db:generate   # after changing src/server/schema.ts
pnpm --filter @isbp/module-cmdb test
```
