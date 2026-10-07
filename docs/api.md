# API guide

Every action in the UI is backed by a documented REST endpoint. The OpenAPI 3.1 document is generated
from the same Zod schemas that validate requests, so it is always accurate.

- Interactive reference: `https://<host>/api/docs` (local: http://localhost:4000/api/docs)
- Raw document: `GET /api/openapi.json`
- Base path: `/api/v1` — core endpoints at the root (`/api/v1/users`), module endpoints under
  `/api/v1/<module-id>` (`/api/v1/announcements/posts`)

## Authentication

Browsers authenticate with a **server-side session**; external applications and scripts use
**API clients** (API keys or OAuth 2.0 client credentials — see [Machine clients](#machine-clients-api-keys-and-oauth)).

### Browser sessions

1. `POST /api/v1/auth/login` with `{ "username": "...", "password": "...", "provider": "<ldap-key>?" }`
   sets an `HttpOnly; SameSite=Lax` cookie `isbp_session` (`Secure` when `PUBLIC_URL` is https) and returns
   the session body, including a `csrfToken`.
2. Send the cookie on every request. **Unsafe methods** (POST/PUT/PATCH/DELETE) must also send
   `x-csrf-token: <csrfToken>`. `GET /api/v1/auth/session` returns the token again.
3. `POST /api/v1/auth/logout` revokes the session server-side.

SSO is browser-driven: `GET /api/v1/auth/sso/<provider-key>/start?next=/path` (OIDC redirect URI
`…/callback`, SAML ACS `…/acs`, SAML SP metadata `…/metadata`).

### Machine clients: API keys and OAuth

Create an API client in _Administration → API clients_. It is a **service principal**: it can query the
Role Query API for the applications you choose, and — only if you grant them — call other endpoints with
specific platform permissions (you can't give a client permissions you don't hold yourself). Every call is
rate-limited per client and audited like a person's.

- **API key:** `Authorization: Bearer isbp_sk_…`. The key is shown once; only its SHA-256 is stored. A
  client can hold several keys at once, so rotate by adding a new key, switching over, then revoking the old.
- **OAuth 2.0 client credentials** (RFC 6749 §4.4): exchange the client id and a key for a one-hour access
  token. Scopes: `role-query`, `api` (default: both). Errors follow the RFC (`{ "error": "invalid_client" }`).
- Bearer requests need no CSRF token (they carry no ambient cookie). Personal endpoints (`/me/*`) and
  endpoints the client has no permission for answer `403`. Optional per-client IP allow-lists (CIDRs).

```bash
curl -s -u "$CLIENT_ID:$API_KEY" -d grant_type=client_credentials -d scope=role-query \
  http://localhost:4000/api/v1/oauth/token
```

```bash
curl -s -H "Authorization: Bearer $API_KEY" \
  "http://localhost:4000/api/v1/role-query/users/hr.partner?application=finance-erp"
```

`pnpm db:seed` creates the client "Finance ERP role sync" and prints its key once.

## Role Query API

External applications ask "what roles and permissions does this person have in my application?". Their
roles and permissions are defined in _Administration → Applications_ and granted, requested, approved,
expired and audited like platform roles.

| Endpoint                                                 | Returns                                                                                                                                                                          |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /role-query/users/{user}?application={key}`         | `{ user, application, active, roles[], permissions[], scopedPermissions[], evaluatedAt }` — `user` is an id, email or username; wildcard grants are expanded against the catalog |
| `POST /role-query/check`                                 | `{ allowed, matchedRoles }` for `{ user, application, permission, departmentId?, recordType?, recordId? }` (department grants cover their subtree)                               |
| `GET /role-query/applications/{key}/members?role=&page=` | Everyone holding a role in the application (directly or through a group), for provisioning sync                                                                                  |

```json
{
  "user": {
    "id": "…",
    "username": "morris.rogahn",
    "email": "…",
    "displayName": "Morris Rogahn",
    "status": "active",
    "department": { "code": "FIN", "name": "Finance" }
  },
  "application": { "key": "finance-erp", "name": "Finance ERP" },
  "active": true,
  "roles": [
    {
      "key": "ap-approver",
      "name": "AP approver",
      "scope": { "type": "global" },
      "expiresAt": null,
      "source": "direct",
      "group": null
    },
    {
      "key": "ap-clerk",
      "name": "AP clerk",
      "scope": { "type": "global" },
      "expiresAt": null,
      "source": "group",
      "group": { "key": "finance-team", "name": "Finance Team" }
    }
  ],
  "permissions": ["invoices.approve", "invoices.create", "invoices.read", "reports.export"],
  "scopedPermissions": [],
  "evaluatedAt": "2026-10-06T09:35:46.512Z"
}
```

People who are suspended or offboarded hold nothing (`active: false`). Unknown applications and
applications the client may not query both answer `404`, so clients can't enumerate them. Answers are
cached per person and application until any access change (a global RBAC version bump).

```bash
curl -c jar -X POST http://localhost:4000/api/v1/auth/login \
  -H 'content-type: application/json' -d '{"username":"admin","password":"ChangeMe-2026!"}'
```

```bash
curl -b jar 'http://localhost:4000/api/v1/users?q=chen&status=active&sort=-lastLoginAt&pageSize=10'
```

## Conventions

| Topic                     | Convention                                                                                                                                                   |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Lists                     | `?page=1&pageSize=25` (max 200), `q` full-text-ish search, `sort=field` / `sort=-field`, plus endpoint filters. Response: `{ items, total, page, pageSize }` |
| IDs                       | UUIDv7 strings                                                                                                                                               |
| Dates                     | ISO-8601 with offset (`2026-10-06T08:00:00.000Z`) in requests and responses                                                                                  |
| Partial updates           | `PATCH` with only the fields to change                                                                                                                       |
| Booleans in query strings | `true` / `false` (also `1`/`0`, `yes`/`no`)                                                                                                                  |
| Rate limits               | 1200 requests/minute per user (or IP when anonymous); stricter limits on login, password change and search. `429 RATE_LIMITED` when exceeded                 |
| Request IDs               | Every response error carries `requestId`; send `x-request-id` to correlate with your own logs                                                                |

## Authorization

Each endpoint declares the permission it needs (shown in the OpenAPI summary/tags and enforced before
the handler runs). Some endpoints are _scoped_: a department-scoped grant lets you act only on people or
records inside that department subtree; lists are filtered to what you can see. Inspect what a person can
do with `GET /api/v1/users/{id}/permissions` (or `GET /api/v1/me/permissions` for yourself).

## Errors

All errors share one shape:

```json
{
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "Request validation failed",
    "details": { "issues": [{ "path": "email", "message": "Invalid email address" }] },
    "requestId": "01a1…"
  }
}
```

| Status | Code                                                                                                                                                                                                   | Meaning                                                             |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| 400    | `VALIDATION_FAILED`, `BAD_REQUEST`                                                                                                                                                                     | Body/query failed validation (see `details.issues`)                 |
| 401    | `UNAUTHENTICATED`, `INVALID_CREDENTIALS`                                                                                                                                                               | No/expired session; wrong username or password                      |
| 403    | `FORBIDDEN`, `CSRF_INVALID`, `ACCOUNT_INACTIVE`, `ACCOUNT_NOT_PROVISIONED`                                                                                                                             | Missing permission (denials are audited); bad CSRF token            |
| 403    | `PRIVILEGE_ESCALATION`                                                                                                                                                                                 | Granting permissions you don't hold (`details.missing`)             |
| 404    | `NOT_FOUND`, `MODULE_DISABLED`                                                                                                                                                                         | Unknown record/route; the module is disabled                        |
| 409    | `CONFLICT`                                                                                                                                                                                             | Unique constraint (`details.constraint`) or reference conflict      |
| 409    | `SELF_LOCKOUT`, `SYSTEM_ROLE_READONLY`, `SYSTEM_GROUP`, `SYSTEM_MODULE`, `MODULE_DEPENDENCY`, `PRINCIPAL_OFFBOARDED`, `HAS_CHILDREN`, `INVALID_PARENT`, `INVALID_STATE`, `PASSWORD_MANAGED_EXTERNALLY` | Business-rule conflicts with stable codes for clients               |
| 400    | `COMMENT_REQUIRED`, `WEBHOOK_TARGET_INVALID`                                                                                                                                                           | Rejections need a reason; webhook URL not HTTPS or private          |
| 409    | `WORKFLOW_NOT_CONFIGURED`, `WORKFLOW_INVALID`, `TASK_NOT_PENDING`, `DELEGATION_NOT_ALLOWED`, `INVALID_DELEGATE`, `IN_USE`                                                                              | Workflow and approval rules (`WORKFLOW_INVALID` → `details.issues`) |
| 409    | `NOT_REQUESTABLE`, `DUPLICATE_REQUEST`, `ALREADY_GRANTED`, `DURATION_TOO_LONG`, `EMAIL_NOT_CONFIGURED`                                                                                                 | Access-request and notification rules                               |
| 404    | `FORM_NOT_AVAILABLE`                                                                                                                                                                                   | The form is unpublished, paused or not offered to you               |
| 502    | `DELIVERY_FAILED`                                                                                                                                                                                      | A test email/webhook was refused (`details.reason`)                 |
| 423    | `ACCOUNT_LOCKED`                                                                                                                                                                                       | Too many failed sign-ins (temporary)                                |
| 429    | `RATE_LIMITED`                                                                                                                                                                                         | Slow down                                                           |
| 500    | `INTERNAL`                                                                                                                                                                                             | Logged with the `requestId`                                         |

Codes are stable and translated by the web app (`packages/i18n/messages/*/errors.json`); messages are
English and may change.

## Main resources

| Area          | Endpoints                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Auth & me     | `/auth/providers`, `/auth/login`, `/auth/logout`, `/auth/session`, `/auth/sso/*`, `/me`, `/me/password`, `/me/sessions`, `/me/permissions`                                                                                                                                                                                                                                                                                       |
| People        | `/users` (list/create), `/users/{id}` (get/patch), `/users/{id}/onboard`, `/offboard`, `/status`, `/password`, `/sessions`, `/permissions`                                                                                                                                                                                                                                                                                       |
| Organisation  | `/departments`, `/departments/{id}`, `/groups`, `/groups/{id}`, `/groups/{id}/members` (+ `/remove`)                                                                                                                                                                                                                                                                                                                             |
| Access        | `/permissions`, `/roles`, `/roles/{id}`, `/role-assignments`, `/role-assignments/{id}`                                                                                                                                                                                                                                                                                                                                           |
| Audit         | `/audit-logs`, `/audit-logs/{seq}`, `/audit-logs/{seq}/verify`                                                                                                                                                                                                                                                                                                                                                                   |
| Platform      | `/modules`, `/modules/{id}`, `/modules/{id}/toggle`, `/modules/{id}/settings`, `/identity-providers` (+ `/test`, `/sync`), `/platform/navigation`, `/platform/search`, `/platform/dashboard`, `/platform/ai-tools`                                                                                                                                                                                                               |
| Workflows     | `/workflow-triggers`, `/workflows` (+ `/{id}`, `/publish`, `/default`, `/archive`, `/restore`), `/workflow-instances` (+ `/{id}`, `/cancel`)                                                                                                                                                                                                                                                                                     |
| Approvals     | `/me/approvals`, `/approvals/{task}/approve`, `/reject`, `/delegate`, `/me/delegations` (out of office)                                                                                                                                                                                                                                                                                                                          |
| Requests      | `/requestable-roles`, `/access-requests` (+ `/preview`, `/{id}`, `/cancel`), `/me/requests`, `/requests/{REQ-number}`, `/forms/catalog`, `/forms/by-key/{key}` (+ `/submissions`), `/form-submissions/{id}`                                                                                                                                                                                                                      |
| Forms         | `/forms` (+ `/{id}`, `/publish`, `/archive`, `/restore`, `/submissions`), `/custom-fields` (+ `/entities`, `/{id}`, `/order`, `/archive`, `/restore`)                                                                                                                                                                                                                                                                            |
| Notifications | `/me/notifications` (+ `/read`, `/stream` — Server-Sent Events), `/me/badges`, `/me/notification-preferences`, `/notification-channels` (+ `/test`), `/notifications/email` (+ `/test`), `/notification-deliveries`                                                                                                                                                                                                              |
| Applications  | `/applications` (+ `/permissions`, `/roles`, `/roles/{id}/request-settings`, `/assignments`), `/roles/{id}/request-settings`, `/api-clients` (+ `/secrets`, `/revoke`), `/oauth/token`, `/role-query/*`                                                                                                                                                                                                                          |
| People        | `/people/lookup` — colleague search for pickers (any signed-in user, active people, minimal profile)                                                                                                                                                                                                                                                                                                                             |
| AI            | `/ai/status` (any signed-in user), `/ai/config` (get/put), `/ai/test`, `/ai/usage`, `/ai/index` (+ `/reindex`) — `core.ai.manage`                                                                                                                                                                                                                                                                                                |
| Portal        | `/portal/entries` (modules' "What do you need?" cards); `/me/requests` also lists module records (`kind: module`) and fulfilment progress                                                                                                                                                                                                                                                                                        |
| Records       | `/records/types`, `/records/search?q&types`, `/records/{type}/{id}` and `/links` (list, link, unlink): links between records of any modules, visible as the owning module decides; people only                                                                                                                                                                                                                                   |
| Files         | `/records/{type}/{id}/files` (list; `POST` multipart field `file`), `/files/{id}` (download; `?inline=1` for images; `DELETE`): attachments with size/type/malware checks                                                                                                                                                                                                                                                        |
| Databases     | `/databases` (list, `POST`), `/databases/{id}` (`GET`, `PATCH`, `DELETE`), `/databases/{id}/test`, `/databases/test` (unsaved settings), `/databases/{id}/catalog?refresh`: external database connections; passwords are write-only (`core.databases.*`)                                                                                                                                                                         |
| Integrations  | `/integrations/connectors`, `/integrations/connections` (CRUD, `/test`, `/webhook-secret`, `/{id}/scopes`, `/{id}/fields`), `/integrations/profiles` (CRUD, `/preview`, `/run`, `/export`, `/default-mapping`), `/integrations/runs`, `/integrations/links` (`/by-record`, `/resync`, `/relink`), `/integrations/conflicts` (`/resolve`, `/dismiss`): the Integrations Hub (`integrations.*`); connection secrets are write-only |
| Modules       | `/cmdb/*`, `/knowledge/*`, `/itsm/*`, `/helpdesk-ai/*`, `/itam/*`, `/projects/*`, `/alm/*`, `/etl/*`, `/scheduler/*`, `/dbaccess/*` (see each module's tag in the OpenAPI reference, `/api/docs`)                                                                                                                                                                                                                                |
| Probes        | `/healthz`, `/readyz` (and `/metrics` on the internal metrics port 9464)                                                                                                                                                                                                                                                                                                                                                         |

## Recording deployments from CI/CD (Application Lifecycle)

A pipeline reports deployments with an API client that holds the **`alm-pipeline`** role (Administration → API
clients). Production deployments must be covered by an approved ITSM change. Name it with `changeReference`, or
link it to the release in the UI. Otherwise the API answers `409 CHANGE_REQUIRED` with `details.reason`
(`no_change`, `change_not_approved` or `outside_window`).

```bash
curl -X POST "$ISBP_URL/api/v1/alm/deployments" \
  -H "Authorization: Bearer $ISBP_API_KEY" -H 'content-type: application/json' \
  -d '{ "application": "erp", "environment": "production", "version": "12.1.0", "status": "succeeded",
        "changeReference": "CHG-00012", "commitSha": "9f1c2ab", "pipelineUrl": "https://devops.example.com/…" }'
```

Report `"status": "in_progress"` when the deployment starts, then `PATCH /api/v1/alm/deployments/{id}` with
the final status.

## Integration webhooks

`POST /api/v1/integrations/hooks/{connectionId}` is called by ServiceDesk Plus (a custom trigger's webhook) or
Azure DevOps Server (a Web Hooks service hook). It needs the connection's webhook secret in the
`X-ISBP-Webhook-Secret` header (or as the HTTP Basic password), answers `202 Accepted` quickly and `401
WEBHOOK_INVALID` otherwise, and is rate limited per connection. The body only says which records changed: the
hub re-reads them through the connector. Rotate the secret on the connection's page.

## Calling a Data API (Data APIs & ETL)

Published Data APIs live at `/api/v1/etl/data/{slug}` (latest version) or `/api/v1/etl/data/{slug}/v{N}`
(pinned). The caller needs `etl.endpoints.invoke`. An API client must also be on the endpoint's allow-list.

```bash
curl -H "Authorization: Bearer $ISBP_API_KEY" \
  "$ISBP_URL/api/v1/etl/data/customers-by-region?region=north&limit=20"
curl -H "Authorization: Bearer $ISBP_API_KEY" -H 'accept: text/csv' \
  "$ISBP_URL/api/v1/etl/data/customers-by-region/v2?region=north"
```

- **Responses.** JSON is `{ "data": [...], "meta": { "rows", "truncated", "version", "durationMs", "cached" } }`.
  The response headers are `X-Cache: HIT|MISS` and `RateLimit-Limit/Remaining/Reset`, and deprecated versions
  add `Deprecation: true` plus a `Link` to the latest.
- **Errors:**
  - `400 VALIDATION_FAILED` (`details.issues` per parameter);
  - `403 FORBIDDEN` (not allowed);
  - `404 ENDPOINT_NOT_PUBLISHED`;
  - `410 ENDPOINT_RETIRED`;
  - `422 DATABASE_ERROR` (with a request id);
  - `429 RATE_LIMITED` (with `Retry-After`).
- **OpenAPI.** The document for the versions a client may call is at `/api/v1/etl/openapi.json`.
