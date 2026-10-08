# Data APIs & ETL module (`etl`)

REST endpoints ("Data APIs") built from parameterized SQL or stored procedures — typed parameters, drafts and
immutable versions, access rules, rate limits, caching, OpenAPI, a test console and execution logs — and ETL
pipelines that stream rows from one database connection into a table of another. Databases are reached only
through the kernel (`ctx.databases`); Scheduled Jobs runs pipelines through the `etl.pipeline` task type.

| File                        | What it does                                                                                       |
| --------------------------- | -------------------------------------------------------------------------------------------------- |
| `src/model.ts`              | Pure rules: request schemas from parameter definitions, CSV, transforms, watermarks, diff, OpenAPI |
| `src/contracts.ts`          | Zod DTOs and the API contract (see the header comment)                                             |
| `src/server/schema.ts`      | `etl.endpoints`, `endpoint_versions`, `calls`, `pipelines`, `pipeline_runs`                        |
| `src/server/endpoints.ts`   | Drafts, save/test/publish rules, version transitions, statistics                                   |
| `src/server/invoke.ts`      | `GET/POST /data/:slug[/vN]`: access, rate limit, validation, cache, JSON/CSV, execution log        |
| `src/server/pipelines.ts`   | Pipeline definitions (validated against the target catalog), runs, cancellation                    |
| `src/server/runner.ts`      | The runner shared by "Run now" (module job `run-pipeline`) and the `etl.pipeline` task type        |
| `src/server/records.ts`     | Record resolvers (`etl.endpoint`, `etl.pipeline`) and global search                                |
| `src/server/ai.ts`          | AI tools `etl.list_endpoints` and `etl.run_pipeline` (destructive)                                 |
| `src/server/seed.ts`        | Demo endpoints, versions, two weeks of calls and pipeline runs (never connects)                    |
| `src/web/*`                 | Data APIs, endpoint (overview, editor, test console, versions, docs), call log, pipelines, runs    |
| `src/web/slots/task-config` | The pipeline picker in Scheduled Jobs' job form (`scheduler.task-config.etl.pipeline`)             |

**Versions.** Editing changes the draft. A successful test stores the hash of the draft and its result columns;
publishing needs that hash to match (`409 TEST_REQUIRED`) and freezes version N. Deprecated versions answer
with `Deprecation: true` and a `Link` to the latest; retired ones answer `410 ENDPOINT_RETIRED`.

**OpenAPI.** `/api/v1/etl/openapi.json` (callers, `etl.endpoints.invoke`) lists the versions the caller may
call; `/api/v1/etl/endpoints/openapi.json` (`etl.endpoints.read`) lists every published endpoint for the docs.

**Customisation kinds (Phase 6).** `src/server/customizations.ts`: `etl.pipeline` (the pipeline form without
`enabled`; archive disables) and `etl.endpoint` (name, slug, description, draft definition, allowed callers, rate
limit). Applying an endpoint **saves the draft only**: a person tests and publishes it in Data APIs. The slug is
fixed once a version is published.

```bash
pnpm --filter @isbp/module-etl db:generate   # after changing src/server/schema.ts
pnpm --filter @isbp/module-etl test
```
