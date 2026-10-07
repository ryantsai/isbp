# Assets (`itam`)

IT asset management: hardware through its lifecycle, software licences (entitlement against usage and
compliance), contracts with renewal reminders, vendors and the hardware model catalogue. The module id is
`itam` because `assets` is a reserved URL; people see **Assets** (資產, 資産). It depends on `cmdb` and reads
`cmdb.cis` to link hardware to its configuration item.

| File                                                                 | What it does                                                                                                                                                                    |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/model.ts`                                                       | Pure rules: lifecycle `TRANSITIONS`, straight-line depreciation, licence compliance, renewal-reminder dates, disposal facts, references (`AST-00042`, `LIC-00012`, `CTR-00007`) |
| `src/contracts.ts`                                                   | Zod DTOs and inputs of `/api/v1/itam` (re-exports the model)                                                                                                                    |
| `src/manifest.ts`                                                    | Permissions, roles, events, notifications, the `itam.disposal` workflow, records, AI tools, settings                                                                            |
| `src/server/schema.ts`                                               | Tables in the `itam` schema                                                                                                                                                     |
| `src/server/{assets,licenses,contract-service,catalog,dashboard}.ts` | Service classes shared by routes, AI tools, record resolvers, jobs, the seed and future sync adapters                                                                           |
| `src/server/routes.ts`                                               | REST API                                                                                                                                                                        |
| `src/web/pages/*`                                                    | Overview, hardware, software, contracts, vendors, My devices, settings                                                                                                          |
| `src/web/slots/*`                                                    | `cmdb.ci.related`, `core.user.overview`, `core.dashboard.work`                                                                                                                  |

## Rules worth knowing

- **Lifecycle.** `ordered → in_stock | lost`, `in_stock → deployed | in_repair | retired | lost`,
  `deployed → in_stock | in_repair | lost`, `in_repair → in_stock | deployed | retired`,
  `retired → disposed | in_stock`, `lost → in_stock`. Assigning deploys; returning goes to stock (or repair).
  An asset keeps its assignee only while deployed, in repair or lost.
- **Disposal** of a retired asset always goes through the `itam.disposal` approval: an asset manager, then
  information security when the device is data-bearing and still has book value or is under five years old.
- **Compliance** is stored per licence and recomputed in the same transaction as every seat or quantity
  change, and nightly (`compliance-recompute`). Per-device licences count devices running the product
  without a seat as in use. Entering `over_deployed` or `expired` notifies the asset managers.
- **Discovery** (`POST /discovery/software`) takes a device's _complete_ software list: reported products are
  upserted with `last_seen_at`; products from an earlier report that are missing now were uninstalled and are
  deleted. Installs recorded manually (`source: manual`) are kept.
- **Contracts.** The daily `renewal-reminders` job (08:00 Asia/Taipei) rolls auto-renewing contracts over,
  moves the rest to `expiring` / `expired`, reminds the owner and contract managers once the notice period
  starts (`last_reminder_for`) and again a week before the end, and sends the warranty-expiry digest.
- **Leavers** (`core.user.offboarded`): seats are reclaimed (each audited), every device they still hold gets a
  `return_requested` entry and the asset managers are told. Devices stay deployed until returned.

## Phase 5 sync (`itam.asset`)

`src/server/sync.ts` is the Integrations Hub's adapter for hardware (`ctx.sync`, permission `itam.assets.sync`,
which no role template grants). It matches existing assets on serial number (case-insensitive) and writes through
`AssetService` as the hub's agent, in the hub's transaction: handing an asset to someone deploys it, clearing the
assignee returns it, status moves step by step along the lifecycle, and `disposed` is refused (409
`INVALID_TRANSITION`, `details.reason: 'approval_required'`): only the disposal approval disposes. History entries
a sync makes name the agent and the source (`asset_events.via`, "via ServiceDesk Plus #1234"); audit rows carry
`metadata.source`. Events: `itam.asset.created`, `updated`, `status_changed`, `assigned`, `returned`, `disposed`.

```bash
pnpm --filter @isbp/module-itam db:generate   # after changing src/server/schema.ts
pnpm --filter @isbp/module-itam test
```
