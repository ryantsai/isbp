# Information security (`isms`)

ISO 27001-style information security records on the platform: the **information asset register**, **stocktakes**,
**shared accounts** and **account reviews** (docs/architecture.md §15.8a). Navigation group "Information security";
settings under Administration.

## What it owns (schema `isms`)

| Table                                                  | What                                                                                                                                        |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `classes`, `subclasses`                                | Asset classes (code `PE`, `HW`, `SW`, `DA`, `SV` by default) with C/I/A scoring guidance for scores 1–4 per language, and their sub-classes |
| `sites`                                                | Sites whose code starts every asset number (`HQ01` by default)                                                                              |
| `labels`                                               | Classification labels (Strictly Confidential, Customer Confidential, Confidential, Internal Use Only by default)                            |
| `number_counters`                                      | The last sequence per `<site><class>` prefix                                                                                                |
| `assets`, `asset_events`                               | The register and each asset's history                                                                                                       |
| `stocktakes`, `stocktake_items`                        | Campaigns and the asset snapshots their managers record                                                                                     |
| `shared_accounts`, `account_members`, `account_events` | Shared accounts, the people allowed to use them, and their history (with dedupe keys for idempotent handlers)                               |
| `reviews`, `review_items`                              | Account reviews and the accounts under review                                                                                               |

A fresh install gets the default classes (texts from the catalogs, in three languages), labels and site the first time
anything reads the taxonomy. Classes, sites and labels are archived, never deleted.

## Rules

- **Numbers** are `<site code><class code><4-digit sequence>` (`HQ01HW0001`), one sequence per site and class, taken
  atomically from `number_counters`. A number never changes, even if the asset moves to another site or class. An
  import may give an unused number of the right series; the counter then moves past it.
- **Value** = max(confidentiality, integrity, availability), stored (and checked by a constraint) so lists filter and
  sort on it. The form shows the class's guidance next to each score.
- **Stocktakes** snapshot the in-scope assets (status in use or missing; scope by class, site, managers or managing
  groups) as items assigned to the asset's manager or managing group. Items are recorded as confirmed, changed (the
  corrections — name, location, users, brand, model, version, quantity — are applied to the asset at once, with the
  stocktake in its history), missing or disposed (with a note). Signing off (`isms.stocktakes.signoff`) needs every
  item recorded; missing and disposed assets then change status and the others get `lastVerifiedOn`. Quarterly or
  yearly campaigns schedule their successor at sign-off; the daily job opens it on its start date.
- **Shared accounts**: a member who is offboarded is taken off the list; a member who moves department
  (`core.user.transferred`) stays on it; either way, and whenever someone is taken off the list (by hand or in the
  yearly review), the password is **due**: the account shows it and the custodian is notified (mandatory
  notification; the security officers when the custodian left). The custodian records "Password changed" (audited,
  category `security`). The password itself is never stored here.
- **Account reviews**: items come from an imported CSV (headers in any language; people matched by username, e-mail
  or a unique display name), from the role holders of a core application (only for people who may read its role
  holders: `core.role-query.read` or `core.applications.read` on the application), or by hand. Completing needs every
  item decided, disable and delete with the date done; a security officer signs off (`isms.reviews.signoff`) or sends
  it back. Recurring reviews (quarterly, yearly) schedule the next one at sign-off; it starts with the accounts the
  last review didn't delete, or the application's current role holders.
- **Tickets**: disable and delete decisions can raise ITSM service requests through ITSM's own AI tool
  (`itsm.create_ticket`, `ctx.ai.tools.invoke`) as the person asking, after our own transaction; the ticket is recorded
  on the item.
- **Visibility** (`server/access.ts`): `isms.self.use` (granted to everyone) lets people see the stocktakes with items
  of theirs, the shared accounts they look after or use, and the reviews given to them; the `*.read` permissions see
  everything of their area.

## API (`/api/v1/isms`)

Taxonomy `GET /taxonomy`, `GET|POST|PATCH /config/{classes,sites,labels}` (+ `POST /config/classes/:id/archive|restore`).
Register `GET|POST /assets`, `GET|PATCH|DELETE /assets/:ref`, `GET /assets/:ref/events`, `GET /assets/export.csv`,
`POST /assets/import` (`dryRun`), `GET /sources`, `POST /assets/from-records`. Stocktakes `GET|POST /stocktakes`,
`GET /stocktakes/:ref`, `GET /stocktakes/:ref/items`, `POST /stocktakes/:ref/items/:itemId`,
`POST /stocktakes/:ref/sign-off|cancel`, `GET /stocktakes/:ref/export.csv`, `GET /stocktake-items/mine`. Shared
accounts `GET|POST /accounts`, `GET|PATCH /accounts/:ref`, `GET /accounts/:ref/events`,
`POST /accounts/:ref/password-changed|review`, `DELETE /accounts/:ref/members/:userId`. Account reviews
`GET|POST /reviews`, `GET /reviews/:ref`, `GET|POST /reviews/:ref/items`, `POST /reviews/:ref/import`,
`POST /reviews/:ref/items/:itemId/decision`, `POST /reviews/:ref/decisions`,
`POST /reviews/:ref/complete|reopen|sign-off|cancel|tickets`, `GET /reviews/:ref/export.csv`. Lookups
`GET /lookups/{groups,departments,applications}`; `GET /dashboard`.

CSV exports are UTF-8 with a BOM (Excel shows CJK correctly), CRLF lines, formula-hardened cells and headers in the
reader's language (`?locale=`); the register's columns follow the paper register (number … value), then
classification, site, status and notes. Imports accept the same headers in any of the three languages.

## Extension points

- Record types `isms.asset` (facts `classCode`, `subClass`, `confidentiality`, `integrity`, `availability`, `value`,
  `classification`, `managerId`, `managerGroup`, `siteCode`, `status`) and `isms.account`; custom fields on
  `isms.asset`; both pages host the core links and files panels.
- Process action `isms.register-shared-account`: registers the approved account (or adds the new members to the active
  account of that name on that system), with the custodian from the requester or a person field and the members from
  person fields or a person column of a table (`rows`) field. Idempotent on the run.
- Customisation kind `isms.asset-class` (create, update, archive).
- AI tool `isms.find_assets` (read-only).
- Events: `isms.asset.*`, `isms.taxonomy.changed`, `isms.stocktake.*`, `isms.account.*`, `isms.review.*`
  (see `docs/ai/reference.md`). Consumes `core.user.offboarded` and `core.user.transferred`.
- Dashboard card in `core.dashboard.work`; daily job `isms:daily` (08:00 Asia/Taipei) for scheduled campaigns,
  reminders, overdue notices and shared-account review reminders.

## Built-in package: ISMS process pack (`isms/isms-processes`)

`manifest.customizationPackages` + `server/packages/isms-processes/` (recipe 28, R55): an ISO 27001-style IS security
process set an administrator installs as one change set (Assistant → Change sets → **From a package**, or
`POST /api/v1/assistant/packages/isms/isms-processes/install`). It is configuration only and generic (no organisation,
site, address or person). One file per area (`access.ts`, `network.ts`, `operations.ts`, `assets.ts`,
`incidents.ts`, `foundation.ts`, `jobs.ts`) built with the helpers in `build.ts`. 59 items, in this order:

- 5 groups (`core.group`, created empty): `isms-authority` (ISMS approvers · 權責主管), `isms-it` (IS operations ·
  資訊部門), `isms-network` (Network administrators · 網路管理人員), `isms-server-room` (Server room administrators ·
  機房管理員), `isms-security-review` (Security reviewers · 資訊安全複審).
- 3 incident categories (`itsm.category`): `isms-resource-anomaly` (設備資源異常 → server room), `isms-threat-intel`
  (資安威脅情資 → network), `isms-security-report` (資安事件通報 → security reviewers).
- The `itsm.resolution` sign-off (made the trigger's default): an ISMS approver signs off resolving tickets of
  `isms-resource-anomaly`; other tickets resolve at once.
- The ticket custom field `defaultPasswordsChanged` (已變更預設密碼並關閉不必要帳號).
- 21 request forms, 20 with their approval workflow (names are `isms.packages.processes.workflows.*` catalog keys,
  shown translated on the admin pages): access (account request, account retention, shared account), network (firewall
  rule, network device check, visitor network), operations (server room and system/backup inspections, backup plan,
  restore test, maintenance, patch exception, device password), assets (asset change, device checkout and return,
  software installation, media and instant messaging exceptions), incidents (threat intelligence, security report).
  Process actions: reminders (`core.remind`), notifications to groups (`core.notify`), incidents and a licence request
  (`itsm.create-ticket`), a change for the CAB (`itsm.create-change`), approved software, device assignment and return
  (`itam.*`), shared account registration (`isms.register-shared-account`).
- 8 scheduled jobs (`core.assign-form`, Asia/Taipei): monthly server room and system/backup inspections, the quarterly
  network configuration backup, the yearly firewall rule review, the January/July device password change, the yearly
  backup plan review and restore test (due 30 days after the run) and the yearly maintenance (due in 90 days).

After applying: add the members of the five groups (approvals with nobody to ask are rejected); IS operations need
read access to Assets (they pick the device at the checkout step), and people picking CIs need read access to the
CMDB. What the kinds keep as plain text — group names and descriptions, job names and their assignments' titles and
notes, workflow descriptions, reminder, notification and ticket texts, item labels — is written in three languages
(`plain()` in `build.ts`) and installed in the installer's (`ismsProcesses(locale)`; English for API clients); rename
them on their pages. Rolling back archives the forms, workflows, categories and the field and
deletes the groups and jobs; archived ones keep their keys, so the package can't be installed again afterwards.

## Roles

`isms-participant` (everyone), `isms-viewer`, `isms-asset-manager`, `isms-security-officer`, `isms-admin`. The demo
grants them in `apps/api/src/seed-isms.ts`.

## Tests

Unit: `test/model.test.ts` (numbering, value, CSV, parsing, dates), `test/manifest.test.ts` (manifest, contracts,
catalogs), `test/packages.test.ts` (the process pack's schemas, texts and rules; the package format is also checked by
`apps/api/test/unit/packages.test.ts`). Integration: `apps/api/test/integration/isms.test.ts`,
`apps/api/test/integration/isms-pack.test.ts` (install, dry run, apply, the processes end to end, rollback). E2E:
`e2e/tests/isms.spec.ts`.
