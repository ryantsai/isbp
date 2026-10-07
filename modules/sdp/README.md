# ServiceDesk Plus module (`sdp`)

Connects a self-hosted **ManageEngine ServiceDesk Plus** server (on-premises) to the Integrations Hub (Phase 5,
`docs/architecture.md` §12.6). The module owns no tables, routes, pages or permissions. It contributes:

| What                                           | Where                                                                             |
| ---------------------------------------------- | --------------------------------------------------------------------------------- |
| Connector `sdp.server` (`manifest.connectors`) | `src/manifest.ts`, handler in `src/server/connector.ts`                           |
| Settings form of its connections (slot)        | `integrations.connector-config.sdp.server` → `src/web/slots/connector-config.tsx` |
| Object catalogue, values and versions (pure)   | `src/server/objects.ts`                                                           |
| Default field mappings (pure)                  | `src/server/mapping.ts`                                                           |
| Change-feed cursors and webhook parsing (pure) | `src/server/feed.ts`                                                              |
| API key, `input_data`, error mapping           | `src/server/client.ts`                                                            |

Admins create connections in **Administration → Integrations**; the hub opens the connector through
`ctx.connectors.open('sdp.server', …)`, which limits `conn.http` to the host `hosts(config)` returns (the server's,
which may be a private address: internal servers work), refuses plain HTTP unless the connection's **Allow insecure
HTTP** switch is on (422 `INSECURE_HTTP`, loopback excepted), and gives it a Redis cache scoped to the connection.

**Builds:** written for ServiceDesk Plus **16000** (2026-09-23, the latest; 15340 before it). **15100 or later is
required**: that build introduced the asset API the connector uses (the old `/api/v3/assets` API was supported until
April 2026). Problems, changes and assets need the Enterprise edition.

## Connection settings

| Setting           | Kind   | Notes                                                                                                                                                                                                |
| ----------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `baseUrl`         | config | The server as technicians open it, e.g. `https://sdp.contoso.local:8443` (a path is kept, for reverse proxies). The API is `<baseUrl>/api/v3/`. `http(s)://` only; no credentials, query or fragment |
| `portalId`?       | config | Digits. Only for installations with several service desk instances (ESM): sent as the `PORTALID` header. ManageEngine's on-premises examples don't send it, so it is sent only when set              |
| `assetEndpoints`? | config | Product type → API name used to **add** assets, over the defaults below (`""` removes a default). The form edits it as `Product type = api_name` lines                                               |
| `apiKey`          | secret | A technician's API key, sent as the `authtoken` header                                                                                                                                               |

- **HTTPS is recommended** (ServiceDesk Plus listens on 8443 for HTTPS; 443 behind a proxy). A plain-HTTP server
  (often port 8080) needs **Allow insecure HTTP** on the connection, which sends the API key unencrypted: keep that
  traffic inside a trusted network. The switch is the hub's (and the kernel's), not part of this module's settings.
- **Internal certificate authorities:** ISBP's API and worker use Node.js' trust store. Add the internal CA with
  `NODE_EXTRA_CA_CERTS=/path/to/ca.pem` in their environment (Helm: mount the PEM and set the variable).

### The technician and the API key

1. Create a dedicated technician (e.g. `svc-isbp`) whose roles may view and edit only the modules you sync:
   requests, problems, changes, assets, solutions (and view the setup lists). Every change ISBP makes is recorded in
   ServiceDesk Plus under this technician; notes ISBP adds show its name.
2. Sign in as that technician → profile menu → **Generate API Key** (**Generate Authtoken** in some builds), set an
   expiry date (non-admin roles must) and paste the key into the connection. Renew it before it expires: an expired
   or revoked key fails every call with 502 `REMOTE_AUTH_FAILED`, and the hub marks the connection failing.

## How it talks to ServiceDesk Plus

- **Base URL:** `<baseUrl>/api/v3/<entity>`.
- **Headers:** `authtoken: <API key>`, `Accept: application/vnd.manageengine.sdp.v3+json`, `Content-Type:
application/x-www-form-urlencoded` on writes, and `PORTALID: <id>` when `portalId` is set.
- **Input:** `input_data=<JSON>`: URL-encoded in the query string for `GET`, a form field for `POST`/`PUT`. Writes
  send `{ "<entity>": { … } }`; lookups as `{ "name": … }`, people as `{ "email_id": … }` (plus `name` for
  requesters, whom ServiceDesk Plus adds when unknown), times as `{ "value": "<epoch ms>" }`.
- **Lists:** `list_info` with `row_count` (≤ 100), `start_index` (1-based), `sort_field`, `sort_order`,
  `search_criteria` (`{ field, condition, value }`) and `get_total_count`; answers carry `list_info.has_more_rows` and
  `response_status.status_code` (2000 = success). Build 16000 deprecates `search_fields` (never used here) and refuses
  sorting by HTML and encrypted fields (the connector sorts only by update times, `id` and `name`).
- **Errors** (the connector contract in `@isbp/sdk` `ConnectorHandler`):

  | ServiceDesk Plus                                                                                                                                                              | Connector error                                                                                                             |
  | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
  | HTTP `401` or status code `4022` (wrong, expired or revoked API key)                                                                                                          | 502 `REMOTE_AUTH_FAILED` (the key is never echoed)                                                                          |
  | HTTP `429`, status code `4015`, or the throttle message ("…requests within N minutes was violated", "maximum access limit for the page is exceeded"), JSON or not, any status | 429 `REMOTE_RATE_LIMITED`; `retryAfterSeconds` from `Retry-After`, else the message's N minutes, else 60; `details.message` |
  | HTTP `404`, status code `4007`                                                                                                                                                | `get` → `null`; `update` → 404 `NOT_FOUND`; `test` → "no REST API v3 at …" / unknown portal                                 |
  | Other `4xx` (`4001`, `4002`, `4012`, `4014`, `4021`, …)                                                                                                                       | 422 `REMOTE_REJECTED`, `details.message` = ServiceDesk Plus' messages (`field: message`)                                    |
  | `5xx`, non-JSON (a login page, a proxy) or oversized answers                                                                                                                  | 502 `UPSTREAM_FAILED`                                                                                                       |
  | `conn.http`'s own errors (network, `TARGET_BLOCKED`, `INSECURE_HTTP`)                                                                                                         | passed through unchanged (also from `test()`)                                                                               |
  | Values the catalogue refuses (unknown, read-only, create-only on update)                                                                                                      | 422 `VALIDATION_FAILED` with `issues`, before any call                                                                      |

- **Throttling:** ServiceDesk Plus limits calls per URL and locks a URL for a period when the limit is exceeded. The
  hub pauses the run for `retryAfterSeconds`. Admins can raise or disable the limit on build 14500 or later.

## Objects

| Object     | API path                     | Reference              | Update time                | Web page (relative to `baseUrl`)                      | Capabilities                               |
| ---------- | ---------------------------- | ---------------------- | -------------------------- | ----------------------------------------------------- | ------------------------------------------ |
| `request`  | `/requests`                  | `#<display_id>`        | `last_updated_time`        | `WorkOrder.do?woMode=viewWO&woID=<id>`                | create, update, notes ↔ comments, webhooks |
| `problem`  | `/problems`                  | `display_id` (`PB-12`) | `updated_time`             | `ProblemDetails.cc?PROBLEMID=<id>`                    | create, update, webhooks                   |
| `change`   | `/changes`                   | `display_id` (`CH-3`)  | none documented → hash     | `ChangeDetails.cc?CHANGEID=<id>`                      | create, update, webhooks                   |
| `asset`    | `/asset_assets` (+ type API) | asset tag, else name   | `last_updated_time` if any | `AssetDetails.do?assetID=<id>`                        | create, update                             |
| `solution` | `/solutions`                 | `display_id` (`SOL-1`) | `last_updated_time` if any | `AddSolution.do?submitaction=viewsolution&solID=<id>` | create, update                             |

Web pages get `&PORTALID=<id>` when `portalId` is set. `RemoteRecord.values` holds the catalogue fields the record
carries, normalized: lookups as their **name**, people as `{ email, name, id }`, times as ISO 8601, dates as
`YYYY-MM-DD`, HTML as a string, keywords as a string list. A field the server did not return at all (the basic asset
view, a field a build lacks) is **left out**, never reported as empty. The catalogues (`fields()`) read picklist
choices from the server's setup lists (`/statuses`, `/priorities`, `/impacts`, `/urgencies`, `/categories`,
`/groups`, `/request_types`, `/change_types`, `/change_risks`, `/reasons_for_change`, `/topics`, `/product_types`;
cached 10 minutes per connection; a fresh installation's defaults when a list can't be read):

- **request:** `subject`*, `description` (html), `request_type`, `status`, `priority`, `impact`, `urgency`,
  `category`, `subcategory` (text), `group`, `technician` (user), `requester` (user), `resolution` (html,
  `resolution.content`), `due_by_time`, `created_time` (read-only).
- **problem:** `record_type` (read-only, always `Problem`), `title`*, `description`, `status`, `priority`, `impact`,
  `urgency`, `category`, `subcategory`, `group`, `technician`, `reported_by`, `is_known_error`, `symptoms`,
  `root_cause`, `workaround`, `resolution` (html, from the nested `*_description` objects), `due_by_time`,
  `reported_time` (read-only).
- **change:** `title`*, `description`, `change_type`, `risk`, `reason_for_change`, `stage`, `status`, `emergency`,
  `priority`, `impact`, `urgency`, `category`, `group`, `change_owner`, `change_manager`, `change_requester`,
  `scheduled_start_time`, `scheduled_end_time`, `roll_out_plan`, `back_out_plan` (html), `created_time` (read-only).
- **asset:** `name`*, `product` (create-only), `product_type` (create-only), `serial_number` (`org_serial_number`, the
  manufacturer's serial; read falls back to `serial_number`), `asset_tag`, `state`, `user`, `location`, `vendor`,
  `purchase_cost`, `acquisition_date`, `warranty_expiry`, `ip_address` (read-only).
- **solution:** `title`_, `description`_ (html), `topic`, `keywords` (tags ↔ comma-separated), `approval_status`,
  `visibility` (`Public` / `Technicians only` ↔ `is_public`), `review_date`, `expiry_date`, `created_by` (read-only).

### Assets (build 15100 API)

- **Read, list, update, delete:** `/api/v3/asset_assets` (every product type; body key `asset_asset`). It returns the
  basic fields (`name`, `asset_tag`, `org_serial_number`, `product`, `product_type`, `state`, `user`, `department`,
  …). When the asset's product type has an API name in the connection's map, `get` also reads
  `/api/v3/<API name>/<id>` for the full record (location, vendor, dates, cost) and merges it; an update that touches
  more than the basic fields goes through that API too.
- **Add:** `asset_assets` can't add. `create` posts to the product type's API (`{ "<singular>": { … } }`, e.g.
  `asset_computer`), picked from `product_type` through the map; an unmapped or missing product type is refused with
  422 `REMOTE_REJECTED`. Without a `product`, the type's first product (`/products` filtered by
  `product_type.name`) is used.
- **Default map** (`DEFAULT_ASSET_ENDPOINTS`; each product type's API name is shown in Setup → Customization → Asset
  Management → Product Type):

  | Product type        | API name              | Status         |
  | ------------------- | --------------------- | -------------- |
  | Workstation, Laptop | `asset_computers`     | documented     |
  | Server              | `asset_servers`       | documented     |
  | Access Point        | `asset_access_points` | documented     |
  | Firewall            | `asset_firewalls`     | documented     |
  | Switch              | `asset_switches`      | naming guessed |
  | Router              | `asset_routers`       | naming guessed |
  | Printer             | `asset_printers`      | naming guessed |
  | Smart Phone         | `asset_smart_phones`  | naming guessed |
  | Tablet              | `asset_tablets`       | naming guessed |

  Monitors, storage and custom product types (`custom_asset_laptop`, …) have no default: add them to the
  connection's map to create them from ISBP.

- Asset search criteria filter by `module.id` (was `product_type.id`); memory and disk values are `{ value, unit }`.
  Neither is needed for the mapped fields.

### Versions and the change feed

- **Version:** the record's update time in epoch ms when it carries one; otherwise `h:` and a SHA-256 of its
  normalized values (changes have no documented update time; any object a build returns without one). `update()`
  re-reads the record and compares versions of either kind (409 `REMOTE_CONFLICT` with `currentVersion`), then `PUT`s
  only the given fields. ServiceDesk Plus has no conditional update: a change between the read and the write is not
  detected (one round trip). Create-only fields sent unchanged are dropped; a different value is refused.
- **Time feed** (records with an update time): `sort_field=<update time>`, `sort_order=asc`, after the first page
  `search_criteria: { field, condition: "greater than", value: <cursor time − 1> }`, then each record is read in full
  (4 at a time; the list view leaves out descriptions, resolutions and most lookups). The cursor holds the last time
  handed out **and the ids already handed out at that time**, so records sharing a millisecond are neither skipped
  nor repeated, whatever order ties come back in.
- **Scan feed** (records without one): when the server refuses to sort or search by the update time (HTTP 400), or
  the records come without it, the connection remembers `feed:<object>` = `scan` in its Redis for a day and pages
  through every record sorted by `id`, reading each in full. The cursor is the last id and its position (re-reading
  10 rows before it, so deletions don't make it skip records); when a pass ends the cursor starts the next pass from
  the top, and the hub skips records whose (hash) version it already has. A pass reads every record of the object
  type, so it suits the smaller ones (changes).
- A record deleted between the list and the read comes back with `deleted: true`. An unreadable cursor starts over
  (the hub's snapshots make replays harmless).
- Since build 14101, a **requester's reply** to a request does not update its `last_updated_time`: such replies
  don't show up in the feed until something else changes the request (notes sync through `comments.list`).

### Notes ↔ comments (requests)

`GET/POST /requests/<id>/notes` (`request_note`). `show_to_requester: false` ↔ `internal: true`. Notes are HTML;
text or Markdown bodies the hub did not convert are escaped into `<p>` paragraphs. Adding a note moves the request's
`last_updated_time`, so the feed picks it up (the hub's comment links stop it from echoing).

## Default field mappings

Suggested by `defaultMapping(objectType, entity)`; admins edit them per sync profile. Value maps are listed
remote → local and use a fresh installation's names; pushing uses the first entry with that local value.

| Object → entity                  | Mappings (remote → local, direction)                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `request` → `itsm.ticket`        | `subject`→`title`, `description`→`description`, `request_type`→`type` (Incident→incident, Service Request→service_request), `status`→`status` (Open→new, In Progress/Assigned→in_progress, On Hold→on_hold, Resolved→resolved/fulfilled, Closed→closed, Canceled→cancelled), common ticket fields below; all `both`                                                                                                                                                                                          |
| `problem` → `itsm.ticket`        | `record_type`→`type` (Problem→problem, **pull**), `title`, `description`, `status` (Open→new, In Progress/On Hold→investigating, Resolved→resolved, Closed→closed), common ticket fields with `reported_by`→`requester`                                                                                                                                                                                                                                                                                      |
| common ticket fields             | `impact` (Affects Business→1, Affects Department/Group→2, Affects User→3), `urgency` (High, Urgent→1; Normal→2; Low→3), `priority` (High/Medium/Normal/Low → 1/2/3/4), `technician`→`assignee`, `resolution`→`resolutionNotes`                                                                                                                                                                                                                                                                               |
| `change` → `itsm.change`         | `title`, `description`, `change_type`→`changeType` (Standard→standard; Minor, Major, Significant→normal; Emergency→emergency), `risk` (Low/Medium/High, Very High→high), `scheduled_start_time`→`plannedStart`, `scheduled_end_time`→`plannedEnd`, `roll_out_plan`→`implementationPlan`, `back_out_plan`→`backoutPlan`, `change_owner`→`assignee`. **No status.**                                                                                                                                            |
| `asset` → `itam.asset`           | `name`, `product_type`→`category` (Laptop→laptop, Workstation→desktop, Monitor→monitor, Server→server, Switch/Router/Firewall/Access Point→network, Storage→storage, Printer→printer, Smart Phone→phone, Tablet→tablet), `serial_number`→`serialNumber`, `state`→`status` (In Use→deployed, In Store→in_stock, In Repair→in_repair, Expired→retired, Disposed→disposed), `user`→`assignedTo`, `location`, `acquisition_date`→`purchaseDate`, `purchase_cost`→`purchaseCost`, `warranty_expiry`→`warrantyEnd` |
| `solution` → `knowledge.article` | `title`, `description`→`body`, `keywords`→`tags`, `approval_status`→`status` (Approved→published, UnApproved/Rejected→draft, Approval Pending→in_review, Expired→retired), `visibility`→`audience` (Public→everyone, Technicians only→agents, **pull**)                                                                                                                                                                                                                                                      |

Choices:

- **Change status is not mapped.** ServiceDesk Plus ties a change's status to its stage (Submission → Planning →
  CAB Evaluation → Implementation → Review → Close) and to its own approvals, and ISBP refuses sync writes past CAB
  authorization (409 `INVALID_TRANSITION`: the approval happens in ISBP). Pulling the status would fail every time a
  change is approved in ServiceDesk Plus; pushing it would need ServiceDesk Plus stage moves its API runs through
  its own workflow. `stage` and `status` stay in the catalogue for admins who want a one-way mapping.
- **Assets "Disposed"** maps to `disposed`, which ISBP refuses unless its disposal approval ran: a remote disposal
  shows up as an item error instead of bypassing the approval.
- **Problems** carry a constant `record_type` so a created ticket gets type `problem`.
- **Categories, groups, vendors and topics are not mapped by default.** Their local choices are records of the
  installation (ids: ITSM categories, ISBP groups, asset vendors, Knowledge Base categories), which a static value
  map can't name. Add them in the profile editor, which lists both catalogues' choices (`category`→`category`,
  `group`→`assignmentGroup`, `vendor`→`vendor`, `topic`→`category`).
- Local values follow the adapters' choices: ticket impact/urgency as `"1"`–`"3"`, priority `"1"`–`"4"`. Servers with
  renamed picklist values (or asset states such as "In Stock") need their value maps edited.

## Webhooks

The ServiceDesk Plus server calls the hub from the internal network when a record changes (the hub's webhook URL
must be reachable from it):

1. **Admin › Developer Space › Webhooks → New** (SDAdmin): method `POST` (PUT/PATCH/GET/DELETE also exist), URL =
   the connection's webhook URL (`POST /api/v1/integrations/hooks/<connectionId>`), custom request header
   `X-ISBP-Webhook-Secret: <the connection's secret>`, JSON payload (form payloads work too):

   ```text
   { "module": "request", "id": ID }
   ```

   In place of `ID`, **type `$` and pick the record's ID field** (the editor inserts the variable; its literal syntax
   isn't documented, so don't type one by hand). One webhook per module: `request`, `problem` or `change`.

2. **Admin › Automation › Custom Triggers** (requests, problems and changes; also releases, projects, tasks and
   notes, which this connector doesn't use): a trigger on create/edit whose custom action is **Webhook** → the
   webhook above. Assets and solutions have no custom triggers, so they sync on the schedule.

`webhook()` accepts exactly `{ "module": "request" | "problem" | "change", "id": <id> }` (JSON or form payload; the id
a number or a numeric string) and ignores anything else (other modules, unfilled variables, arrays). The body only
says _which_ record changed: the hub re-reads it, and polling continues as the safety net.

## Stand-in mock (`tooling/integration-mocks/src/sdp`)

`pnpm dev:services` runs it on port 4100 (state in `.dev-data/integration-mocks.json`); tests start it in-process
with `createMockServer()`. Settings for a connection to it: `baseUrl: http://localhost:4100/sdp`, API key
`MOCK_CREDENTIALS.sdp.apiKey` (loopback, so no "Allow insecure HTTP" needed).

| Route                                                                                                                       | What                                                                                                                                                                                                                        |
| --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET/POST /sdp/api/v3/{requests,problems,changes,solutions}`, `GET/PUT …/<module>/<id>`                                     | Lists (`list_info`), creates, reads, updates. Every `/sdp/api/v3` route needs `authtoken` (401 + `4022` otherwise) and the v3 `Accept`; an optional `PORTALID` must be `1`. Changes carry **no** `last_updated_time`        |
| `GET/PUT /sdp/api/v3/asset_assets[/<id>]`                                                                                   | Every asset, basic fields only; `POST` refused; `PUT` of other fields → `EXTRA_KEY_FOUND_IN_JSON`                                                                                                                           |
| `GET/POST/PUT /sdp/api/v3/asset_{computers,servers,access_points,firewalls,switches,routers,printers,smart_phones,tablets}` | Full records of those product types, and adds. `GET /sdp/api/v3/assets` (the old API) → 404 / `4007`                                                                                                                        |
| `GET/POST /sdp/api/v3/requests/<id>/notes`                                                                                  | Notes                                                                                                                                                                                                                       |
| `GET /sdp/api/v3/portals`, `GET /sdp/api/v3/<setup list>`                                                                   | The one instance (`1`); statuses, priorities, impacts, urgencies, categories, subcategories, groups, request_types, modes, levels, change_types, change_risks, reasons_for_change, product_types, products, vendors, topics |
| `list_info` rules                                                                                                           | Sorting or searching by a field the module lacks, or an HTML field, → 400 / `4000`; ties come back newest id first                                                                                                          |
| `GET /sdp/WorkOrder.do`, `ProblemDetails.cc`, `ChangeDetails.cc`, `AssetDetails.do`, `AddSolution.do`                       | Bare pages standing in for the web UI                                                                                                                                                                                       |
| `GET /_mock/sdp/<module>[/<id>]`                                                                                            | Inspect raw records (a request includes its notes)                                                                                                                                                                          |
| `POST /_mock/sdp/<module>/<id>`                                                                                             | Edit "as a technician": plain names for lookups, e-mails for people, ISO or ms for times; `_at` (ms) sets the update time, `_silent` skips the webhook                                                                      |
| `POST /_mock/sdp/<module>`                                                                                                  | Create (same conventions, `_by` e-mail for the author)                                                                                                                                                                      |
| `DELETE /_mock/sdp/<module>/<id>`                                                                                           | Delete (orphan tests)                                                                                                                                                                                                       |
| `POST /_mock/sdp/requests/<id>/notes`                                                                                       | Add a note `{ description, show_to_requester?, _by? }`                                                                                                                                                                      |
| `GET/POST/DELETE /_mock/sdp/rate-limit`                                                                                     | `{ enabled, after, minutes, status }`: after `after` calls, answers `status` (429) with "URL configured to access 30 requests within `minutes` minutes was violated"                                                        |
| `GET /_mock/sdp/stats`                                                                                                      | API calls and refused keys                                                                                                                                                                                                  |

Edits and creates of requests, problems and changes through `/_mock` POST `{ "module": "<object>", "id": <number> }`
to the webhooks registered with `POST /_mock/webhooks` (writes through the API don't).

**Demo data (Contoso):** 25 requests (incidents and service requests across Network, Hardware, Software, Access,
Email and Security; groups Service Desk, Desktop Support, Network, Security, Database; every status; #1019–#1021
share one update millisecond), notes on 4 requests, 5 problems, 5 changes in different stages, 30 assets and 10
solutions. People: `admin@`, `helpdesk@`, `hr.partner@`, `auditor@isbp.example` (matched to ISBP users) and Kenji
Mori / Dana Whitfield `@contoso-msp.example` (no ISBP account: the hub leaves those fields empty and logs a
warning); API writes are made as "ISBP Integration" (`svc-isbp@isbp.example`). Nine assets carry the serial numbers
and names of ISBP's seeded infrastructure (`DLRS7601`–`DLRS7604`, `FOC2741X0A1`, `FOC2741X0A2`, `FG200FT923900131`,
`FG200FT923900188`, `2350SQRN71C2`), so a first sync links them; the 21 end-user devices exist only in ServiceDesk
Plus (monitors and the NAS have no product type API: basic fields only). Solutions "Connect to the VPN from home" and
"Clear a stuck print queue" have the titles of seeded Knowledge Base articles.

## Tests

`pnpm --filter @isbp/module-sdp test`: the manifest and catalogs, the default mappings against the local enums, and
the connector against the in-process mock (headers, refused keys, portals, throttling, field catalogue, time feed
paging with ties, scan feed and hash versions, reads, creates, updates and conflicts, the asset APIs, notes,
webhooks). `apps/api/test/integration/sdp.test.ts` opens it through the kernel (`ctx.connectors`), including the
`INSECURE_HTTP` guard and the scan decision in the connection's Redis.

## Confirmed and unconfirmed API details

Confirmed from ManageEngine's documentation (on-premises readme and REST API v3 pages, the asset API changes of
15100, the webhook and custom trigger help pages): the builds above; the `authtoken`, `Accept` and `Content-Type`
headers; `input_data` encoding; `list_info` and `response_status`; request times as `{ value, display_value }`;
`search_fields` deprecated and HTML/encrypted fields unsortable in 16000; requester replies not updating
`last_updated_time` since 14101; `asset_assets` (no add) and the `asset_computers`, `asset_servers`,
`asset_access_points` and `asset_firewalls` APIs; `module.id` in asset search criteria; webhooks with custom headers
and JSON or form payloads run from custom triggers for requests, problems and changes; variables inserted with `$`;
the throttle messages and the build 14500 switch.

Not confirmed (best guesses, mirrored by the mock):

- `PORTALID` as a header and its value (the instance id from `GET /api/v3/portals`);
- the asset field names beyond the basic ones in the new API (`location`, `vendor`, `purchase_cost`,
  `acquisition_date`, `warranty_expiry` are taken from the hosted edition's model), `org_serial_number` vs
  `serial_number` on product type APIs, the body key of `asset_assets` (`asset_asset`), updates through
  `asset_assets` being limited to basic fields, and the product type API names marked "naming guessed" above;
- whether problems, solutions and assets carry `last_updated_time` / `updated_time` on every build (the connector
  handles either), and the exact refusal when sorting by a missing field (any HTTP 400 switches to the scan);
- sorting by `id`, used by the scan feed;
- the setup-list endpoints for statuses, priorities, impacts, urgencies, categories, groups, request types and
  product types (the documented admin endpoints are `change_types`, `change_risks`, `reasons_for_change` and
  `topics`), and `/products` filtered by `product_type.name`; failures fall back to default choices;
- record page URLs other than `WorkOrder.do?woMode=viewWO&woID=`;
- the HTTP status (and any `Retry-After`) of a throttled answer: the message text decides;
- the literal syntax the webhook editor inserts for `$` variables (`${{request.id}}` in third-party guides).
