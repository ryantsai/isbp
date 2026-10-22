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
| `src/server/discovery.ts`, `src/server/approved-software.ts`         | Software reports and title rules; the approved-software list (allow / block) and the compliance of installs against it                                                          |
| `src/server/process-actions.ts`                                      | Process actions `itam.approve-software`, `itam.assign-asset`, `itam.return-asset`                                                                                               |
| `src/server/routes.ts`                                               | REST API                                                                                                                                                                        |
| `src/web/pages/*`                                                    | Overview, hardware, software, contracts, vendors, My devices, settings                                                                                                          |
| `src/web/slots/*`                                                    | `cmdb.ci.related`, `core.user.overview`, `core.dashboard.work`                                                                                                                  |

## Rules worth knowing

- **Lifecycle.** (`lost` reads "Lost or stolen".) `ordered → in_stock | lost`, `in_stock → deployed | in_repair | retired | lost`,
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
- **Approved software** (`/approved-software`, the software whitelist): entries allow or block a title (case-insensitive;
  a version covers itself and more precise ones, `23` → `23.01`; none = any version) for the whole company or some
  departments, optionally until a date. An install on a device in use is `blocked` when a blocked entry covers it;
  once there is at least one allowed entry, it is `unapproved` ("Not on the approved list") unless an allowed entry
  that hasn't ended covers it for the device's department or its assignee's. Title rules tie in: entries match the
  title the tool reported as well as the licence product it counts as, and an entry linked to a licence covers
  installs of that licence's product. Shown on Discovery → Not approved, on the asset's Software tab and as an
  attention count; `GET /approved-software/export` writes the list as CSV (UTF-8 with BOM) in the whitelist layout.
  The daily job reminds asset managers of allowed entries ending within 14 days (once per end date).
- **Data wipes.** Returning a data-bearing device (laptop, desktop, server, storage, phone, tablet) sets
  `data_retain_until` (optional) and `wipe_due` = retention date (else the return day) + `wipe.months` (default 2).
  "Record data wipe" (`POST /assets/:ref/wipe`: when, who, method, note; audited) clears it. The daily
  `wipe-reminders` job tells asset managers once when a wipe comes due (within `wipe.remindDays`) and once when it
  is overdue; the hardware list filters `wipe=pending|due|overdue`; `wipeDue` is a record fact of `itam.asset`.
- **Process actions.** `itam.approve-software` adds the requested title to the list (or extends the entry that
  covers it: a later end date, another department, company-wide) for the requester's department or the company, until
  a date from an answer or a step field; repeating it changes nothing. `itam.assign-asset` hands the device picked in
  an asset field (of the form, or a step field IS fills in) to the requester or a person field, and
  `itam.return-asset` takes it back (condition, in stock / in repair, data retention date from an answer or step
  field, wipe due). Both record the request on the asset's history (`asset_events.request`, attributed to the
  approver) and make their steps once per run.
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
