# Azure DevOps Server (on-premises) — module `azdo`

Connects the Integrations Hub (`integrations`) to a **self-hosted Azure DevOps Server** collection. The module
contributes one connector, `azdo.server`, and its settings form. It has no tables, pages, routes or permissions: the
hub owns connections, sync profiles, field mappings, links, runs and conflicts, and calls the connector through
`ctx.connectors.open('azdo.server', connection)` (see `docs/architecture.md` §12).

| Remote object | Scope        | Usual entity       | Capabilities                                                                  |
| ------------- | ------------ | ------------------ | ----------------------------------------------------------------------------- |
| `project`     | —            | `projects.project` | read (team projects, matched by name)                                         |
| `work-item`   | team project | `projects.task`    | read, create, update (`test /rev`), parent, comments, service hooks           |
| `repository`  | team project | `alm.repository`   | read (Git status: branches, last commit, active pull requests), service hooks |

## Supported servers

| Server                                         | `apiVersion` | Notes                                                                                                                                                                            |
| ---------------------------------------------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Azure DevOps Server** (25H2, 2025 and later) | `7.2`        | **Default.** Every call is sent as `7.2-preview` (most resources are previews at 7.2); comments `7.2-preview.4` with `format`. The API adds at most 1,000 comments per work item |
| Azure DevOps Server 2022.1 / 2022.2            | `7.1`        | Comments `7.1-preview.4` with `format` (Markdown comments are sent as Markdown)                                                                                                  |
| Azure DevOps Server 2022                       | `7.0`        | Comments `7.0-preview.3`                                                                                                                                                         |
| Azure DevOps Server 2020                       | `6.0`        | Comments `6.0-preview.3`; work item type states are a preview (retried)                                                                                                          |
| Azure DevOps Server 2019 Update 1              | `5.1`        | Comments `5.1-preview.3`                                                                                                                                                         |
| Azure DevOps Server 2019 (minimum)             | `5.0`        | Comments: the read-only discussion API (`5.0-preview.2`); new comments are written as `System.History`                                                                           |

Azure DevOps Server upgrades in place from 2022, 2020 and 2019, so the older versions stay supported: pick the one the
server runs. A server refuses an `api-version` newer than its own (400 `VssVersionOutOfRangeException`, shown as
`REMOTE_REJECTED`; its message names the newest version the server supports). Below 7.2, a resource that is still a
preview there (400 `VssInvalidPreviewVersionException`) is retried once as `<version>-preview`; at 7.2 a preview
request is accepted for every resource, so it's sent as one from the start.

## Settings

| Setting         | Kind   | What                                                                                                                                                                                                        |
| --------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `collectionUrl` | config | The project collection, as in the browser: `https://ado.contoso.local/tfs/DefaultCollection` or `https://ado.contoso.local:8443/DefaultCollection` (with or without the `/tfs` virtual directory, any port) |
| `apiVersion`    | config | `7.2` (default), `7.1`, `7.0`, `6.0`, `5.1` or `5.0`, matching the server                                                                                                                                   |
| `pat`           | secret | Personal access token. Sealed by the hub, never returned                                                                                                                                                    |

`hosts(config)` is the collection URL's host name: the connection's `conn.http` may call only that host (private
addresses allowed, link-local and metadata never).

### Authentication and transport

- **Personal access tokens only**, sent as Basic authentication with an empty user name on every call, plus
  `X-TFS-FedAuthRedirect: Suppress` so a refused token answers 401 instead of a sign-in redirect. Windows sign-in
  (NTLM, Kerberos) is **not supported**. The server must accept PATs: IIS Basic authentication stays turned off
  (the server's own requirement). Create the token for a service account (e.g. `svc-isbp`) with the scopes
  **Work Items (Read & write)**, **Code (Read)** and **Project and Team (Read)**.
- **Use HTTPS.** Microsoft documents personal access tokens as working only on a server configured with HTTPS. Both
  `http://` and `https://` collection URLs are accepted by the settings schema, but the platform refuses plain HTTP
  (422 `INSECURE_HTTP`) unless the connection has **Allow insecure HTTP** switched on, which sends the token
  unencrypted (and the server may still refuse it). `localhost` (the stand-in) is always allowed. The connector
  doesn't special-case `INSECURE_HTTP`: it propagates.
- **Internal certificate authorities.** On-premises servers often use certificates from a company CA. Node.js
  doesn't read the Windows or macOS trust store: point `NODE_EXTRA_CA_CERTS` at a PEM bundle with the CA (in the
  API and worker containers, e.g. a Helm `extraEnv` plus a mounted secret) and restart. A certificate the platform
  can't verify fails the call with 502 `UPSTREAM_FAILED` (`details.reason: network`).
- **Network.** The platform must reach the server's host and port. For service hooks, the server (inside your
  network) must reach the hub's webhook URL.

## API usage

All calls go through `conn.http`, to `{collectionUrl}/…?api-version=<apiVersion>`.

| Purpose          | Request                                                                                                                                                                                                                                                   |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Test             | `GET _apis/projects` (count) and `GET _apis/connectionData` (who the token belongs to, best effort)                                                                                                                                                       |
| Scopes, projects | `GET _apis/projects?stateFilter=wellFormed&$top=500` (paged by `x-ms-continuationtoken`); cached 5 min                                                                                                                                                    |
| Types and states | `GET {project}/_apis/wit/workitemtypes` (states and fields per type; when absent, `…/{type}/states`, a preview before 7.0, then the type's `transitions`); cached 10 min                                                                                  |
| Custom fields    | `GET _apis/wit/fields` (names and types of non-system fields the project's types use); cached 1 h                                                                                                                                                         |
| Change feed      | `POST {project}/_apis/wit/wiql?timePrecision=true&$top=<limit>` then `POST _apis/wit/workitemsbatch` (`$expand: Relations`, `errorPolicy: Omit`, ≤ 200 ids)                                                                                               |
| Read one         | `GET _apis/wit/workitems/{id}?$expand=Relations` (404 → `null`)                                                                                                                                                                                           |
| Create           | `POST {project}/_apis/wit/workitems/${type}?$expand=Relations`, `application/json-patch+json`                                                                                                                                                             |
| Update           | `GET` the item, then `PATCH _apis/wit/workitems/{id}?$expand=Relations` with `{ op: 'test', path: '/rev' }` first                                                                                                                                         |
| Comments         | `GET/POST {project}/_apis/wit/workItems/{id}/comments` (preview versions above; 2019: `GET` + `System.History`)                                                                                                                                           |
| People           | `GET _apis/identities?identityIds=…` (`Mail` of AD accounts) and `?searchFilter=MailAddress                                                                                                                                                               | AccountName&filterValue=…`; cached 1 day |
| Git              | `GET {project}/_apis/git/repositories`, `…/refs?filter=heads/`, `…/commits?searchCriteria.itemVersion.version=<default>&searchCriteria.$top=1`, `…/stats/branches?baseVersionDescriptor.version=<default>`, `…/pullrequests?searchCriteria.status=active` |

### Change feed and cursor

WIQL selects `[System.TeamProject] = @project` (the project in the URL, so no name is quoted into the text) changed
after the cursor, `ORDER BY [System.ChangedDate] ASC, [System.Id] ASC`, with
`([System.ChangedDate] > 'T' OR ([System.ChangedDate] = 'T' AND [System.Id] > id))`. The cursor is
`<ChangedDate ISO>|<id>` of the last record, so items sharing a change time (bulk edits, imports) neither skip nor
repeat. `$top` keeps queries under the server's result cap (VS402337, 20 000 by default).

Items are read after the query; one edited in between comes back with its new values and again in a later page, and
only records changed up to the query's `asOf` move the cursor, so nothing in between is skipped. Records at or
before the cursor are dropped client-side as well, so a server that compared times at a coarser precision would only
cause harmless repeats. A page where every item changed again meanwhile ends the run (`hasMore: false`); the next
run resumes from the same cursor.

Deleted work items (recycle bin) leave WIQL results: the `workitem.deleted` service hook names them and `get`
returns `null`, so the hub marks the link orphaned. Items moved to another team project are returned with
`deleted: true` when read for the old scope.

Projects are few: each call lists them and pages by `<lastUpdateTime>|<id>`. Repositories have no feed: every run
lists the project's repositories (offset cursor within a run, `null` at the end, so the next run starts over) and
the hub skips those whose version didn't change.

### Values

| Remote key                                                                                | Type                 | Notes                                                                                                                                                                              |
| ----------------------------------------------------------------------------------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `System.Title`                                                                            | string               | required                                                                                                                                                                           |
| `System.WorkItemType`                                                                     | choice               | required, create-only; the project's types (test, code review and feedback types left out)                                                                                         |
| `System.State`                                                                            | choice               | union of the states of the project's types; a state the item's type lacks is refused by the server (`REMOTE_REJECTED`)                                                             |
| `System.AssignedTo`, `System.CreatedBy`                                                   | user                 | `{ email, name, id: 'CONTOSO\\alias' }`; AD accounts' emails come from the Identities API                                                                                          |
| `System.Description`, `…TCM.ReproSteps`, `…Common.AcceptanceCriteria`                     | html                 | HTML as stored (the hub converts)                                                                                                                                                  |
| `Microsoft.VSTS.Common.Priority`                                                          | choice               | `'1'`–`'4'` (an integer in Azure DevOps)                                                                                                                                           |
| `System.Tags`                                                                             | tags                 | `"a; b"` ↔ `['a', 'b']`                                                                                                                                                            |
| `…Scheduling.OriginalEstimate`, `RemainingWork`, `CompletedWork`, `StoryPoints`, `Effort` | number               |                                                                                                                                                                                    |
| `…Scheduling.StartDate`, `TargetDate`, `FinishDate`, `DueDate`                            | date                 | Stored as midnight in the editor's time zone; read as the nearest UTC midnight (right within ±12 h), written as `YYYY-MM-DDT00:00:00Z`                                             |
| `System.IterationPath`, `System.AreaPath`, `Microsoft.VSTS.Common.Activity`               | string               |                                                                                                                                                                                    |
| `parent`                                                                                  | parent               | the `System.LinkTypes.Hierarchy-Reverse` relation (also `RemoteRecord.parentId`); writing it removes the old relation and adds the new one (`values.parent`, else `opts.parentId`) |
| `System.CreatedDate`, `System.ChangedDate`                                                | datetime             | read-only                                                                                                                                                                          |
| custom fields (`Custom.*`, not `System.*`/`Microsoft.*`)                                  | per field definition | string, text, html, number, datetime, boolean or user                                                                                                                              |

Only fields of the project's types are listed. On write, fields the target type doesn't have (a Target Date on an
Agile Task) are left out; the record `create`/`update` return shows what Azure DevOps kept, so the hub's snapshot
stays true. `ref` is `"<Type> <id>"`, `url` is `{collectionUrl}/{project}/_workitems/edit/{id}`, `version` is `rev`.

Identity writes: an email is looked up (`searchFilter=MailAddress`) and written as `Display Name <DOMAIN\alias>`,
which on-premises servers resolve reliably; an email the server doesn't know is written as is and refused
(`REMOTE_REJECTED`, "unknown identity"). Older servers that send identities as text (`Name <DOMAIN\alias>`) are read
too.

Repository values (all read-only, keys and JSON shapes equal to `alm.repository`'s, so ALM's `gitStatusSchema` accepts them unchanged): `name`, `url` (`webUrl`), `provider`
(`azure_devops`), `defaultBranch`, `lastCommitSha`/`At`/`Message`/`Author` (head of the default branch),
`branches` (`[{ name, commitSha, committedAt?, ahead?, behind? }]`, default first without ahead/behind, then most
recent, 20 at most) and `pullRequests` (`[{ id (string), title, author, sourceBranch, targetBranch, url, createdAt,
draft }]`, active only, 20 at most). A repository with no commits and no pull requests reports its `creationDate`
(7.2) as `updatedAt`. The `version` is a hash of the default branch, every branch head and every active pull request; the
values behind it are cached per version, so an unchanged repository costs two requests (refs and pull requests).

### Errors

| Remote                                                                                                                       | Thrown                                                         |
| ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| 401, 403, 203 or an HTML page, a redirect to the sign-in page                                                                | 502 `REMOTE_AUTH_FAILED`                                       |
| 429, or 503 with `Retry-After`                                                                                               | 429 `REMOTE_RATE_LIMITED` (`details.retryAfterSeconds`, ≤ 1 h) |
| 412 `TestPatchOperationFailedException` (`VS403351`, stale `test /rev`), 409                                                 | 409 `REMOTE_CONFLICT`                                          |
| other 4xx (`TF401320` rule errors, unknown identity, `TF201036` second parent, missing project, the 1,000-comment API limit) | 422 `REMOTE_REJECTED` (`details.message`, `typeKey`)           |
| 5xx, other redirects, truncated bodies                                                                                       | 502 `UPSTREAM_FAILED`                                          |

`update` reads the item first: an `expectedVersion` that already differs is a `REMOTE_CONFLICT` without a write, and
the `test /rev` covers a change between the read and the write. Updating a missing item is 404 `NOT_FOUND`; values
that can't be converted (priority 5, a type change, a read-only field) are 422 `VALIDATION_FAILED` before any call.
Internal comments are 409 `NOT_SUPPORTED` (Azure DevOps has none). Since Azure DevOps Server (2025), the REST API adds at
most 1,000 comments per work item (people can still add more in the web portal): the refusal is `REMOTE_REJECTED`
with the server's message, and the hub records it on the item.

## Service hooks

In each team project: **Project settings → Service hooks → Create subscription → Web Hooks**, one subscription per
event: work item created, updated, deleted, restored and commented on, code pushed, pull request created, updated and
merge attempted. URL: the connection's webhook URL from the hub; **HTTP headers**: `X-ISBP-Webhook-Secret: <secret>`;
resource details to send: **Minimal** is enough.

`webhook()` reads only ids from the body (checked: positive integers, GUIDs), never data: `workitem.*` →
`work-item` (`resource.workItemId`, `resource.revision.id`, or `resource.id` except for updates, whose `id` is the
update number), `git.push` and `git.pullrequest.created|updated|merged` → `repository` (`resource.repository.id`;
`git.pullrequest.merge.attempted`, the id some Server 2019 documentation uses, too). The scope is
`resourceContainers.project.id`. Anything else yields `[]`.

## Default mappings

`defaultMapping(objectType, entity)`:

- `project` → `projects.project`: `name`, `description` (pull).
- `repository` → `alm.repository`: every repository key to the same key (pull).
- `work-item` → `projects.task` (both ways): `System.WorkItemType` ↔ `type`, `System.Title` ↔ `title`,
  `System.Description` ↔ `description`, `System.State` ↔ `status`, `Microsoft.VSTS.Common.Priority` ↔ `priority`,
  `System.AssignedTo` ↔ `assignee`, `parent` ↔ `parent`, `System.Tags` ↔ `labels`, `OriginalEstimate` ↔
  `estimateHours`, `RemainingWork` ↔ `remainingHours`, `StartDate` ↔ `startDate`, `TargetDate` ↔ `dueDate`.
  Iterations aren't mapped to milestones by default (the value map is per project).

| Remote type                                                     | Task type                           |
| --------------------------------------------------------------- | ----------------------------------- |
| Epic / Feature / User Story / Task / Bug                        | epic / feature / story / task / bug |
| Product Backlog Item (Scrum), Issue (Basic), Requirement (CMMI) | story                               |

| Remote state                          | Task status |
| ------------------------------------- | ----------- |
| New, Approved, To Do, Open            | todo        |
| Active, Committed, In Progress, Doing | in_progress |
| Resolved                              | in_review   |
| Closed, Done                          | done        |
| Removed                               | cancelled   |
| Proposed (CMMI)                       | backlog     |

Priorities 1–4 ↔ urgent, high, medium, low. Every remote value appears once, so pulling is unambiguous. Pushing picks
the **first** remote value for a local one, which is the Agile process's (`story` → User Story, `todo` → New,
`done` → Closed): for a Scrum or Basic project, edit the profile's value maps (e.g. `story` → Product Backlog Item or
Issue, `todo` → To Do, `done` → Done). A local `backlog` has no Agile state: map it to `New` for Agile projects.

## Stand-in server

`tooling/integration-mocks/src/ado` implements the same paths under `/ado/DefaultCollection/…`, behaving like the latest
Azure DevOps Server (7.2 as previews, the comment limit) and answering the older versions too (port 4100 with
`pnpm dev:services`; token `MOCK_CREDENTIALS.ado.pat`). Demo data: team projects **ERP** (Agile; the work of ISBP's
"ERP upgrade to v12", repositories `erp-core` and `erp-reports`), **Network** (Basic; "Network refresh 2026",
`vpn-config`, `net-automation`) and **Zero Trust rollout** (Scrum; same name as the ISBP project), 42 work items with
an Epic → Feature → Story → Task hierarchy, comments and a bulk-imported group sharing one change time. Repository web
URLs use `ADO_MOCK_PUBLIC_URL` (default `https://devops.example.com`, the host of the ALM demo repositories), so
`url` matches link them. Controls: `GET /_mock/ado/workitems[/:id]`, `POST /_mock/ado/workitems/:id`
(`{ fields?, as?, comment?, parent? }`, fires `workitem.updated`), `DELETE /_mock/ado/workitems/:id`,
`POST /_mock/ado/workitems/:id/restore`, `GET /_mock/ado/repos`, `POST /_mock/ado/repos/:id/push`,
`POST /_mock/ado/repos/:id/pullrequests`, `POST /_mock/ado/pullrequests/:id`, `POST /_mock/ado/rate-limit`,
`GET /_mock/ado/identities`.

## Limitations

- PAT only; no Windows (NTLM/Kerberos) authentication. TFS 2018 and older aren't supported.
- Not verified against live 2019 and 2020 servers (the stand-in follows the documented shapes): 2019's comment list
  is read as `comments` or `value`, a failed `test /rev` is a conflict whether it comes back as 412 or 400, and the
  Identities API may be unavailable there (people then sync without emails, as unmatched).
- Deletes are seen through service hooks and `get`, not the change feed (the recycle bin isn't polled).
- Throttling: on-premises servers don't document 429s; the connector honours 429 and 503 with `Retry-After` anyway.
- Area and iteration paths sync as text; the server refuses paths that don't exist in the project.
- Work item type changes aren't synced (`System.WorkItemType` is create-only).
- Comment edits and deletions aren't synced (the hub's comment sync is append-only).
- Unconfirmed against a live server: the exact message and type key of the 1,000-comment refusal (the stand-in's are
  made up; any 4xx maps to `REMOTE_REJECTED`).

## Tests

`pnpm --filter @isbp/module-azdo test`: the manifest and catalogs, pure conversions, and the connector against the
stand-in started in-process (auth, scopes, fields per process, change feed and cursor with equal timestamps,
hierarchy, create and update, `test /rev` conflicts, comments on 7.x and 2019, repositories and version stability,
every service hook, throttling, default mappings against the catalogues and ISBP's vocabularies).
