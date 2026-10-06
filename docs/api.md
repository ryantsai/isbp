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

| Area          | Endpoints                                                                                                                                                                                                           |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Auth & me     | `/auth/providers`, `/auth/login`, `/auth/logout`, `/auth/session`, `/auth/sso/*`, `/me`, `/me/password`, `/me/sessions`, `/me/permissions`                                                                          |
| People        | `/users` (list/create), `/users/{id}` (get/patch), `/users/{id}/onboard`, `/offboard`, `/status`, `/password`, `/sessions`, `/permissions`                                                                          |
| Organisation  | `/departments`, `/departments/{id}`, `/groups`, `/groups/{id}`, `/groups/{id}/members` (+ `/remove`)                                                                                                                |
| Access        | `/permissions`, `/roles`, `/roles/{id}`, `/role-assignments`, `/role-assignments/{id}`                                                                                                                              |
| Audit         | `/audit-logs`, `/audit-logs/{seq}`, `/audit-logs/{seq}/verify`                                                                                                                                                      |
| Platform      | `/modules`, `/modules/{id}`, `/modules/{id}/toggle`, `/modules/{id}/settings`, `/identity-providers` (+ `/test`, `/sync`), `/platform/navigation`, `/platform/search`, `/platform/dashboard`, `/platform/ai-tools`  |
| Workflows     | `/workflow-triggers`, `/workflows` (+ `/{id}`, `/publish`, `/default`, `/archive`, `/restore`), `/workflow-instances` (+ `/{id}`, `/cancel`)                                                                        |
| Approvals     | `/me/approvals`, `/approvals/{task}/approve`, `/reject`, `/delegate`, `/me/delegations` (out of office)                                                                                                             |
| Requests      | `/requestable-roles`, `/access-requests` (+ `/preview`, `/{id}`, `/cancel`), `/me/requests`, `/requests/{REQ-number}`, `/forms/catalog`, `/forms/by-key/{key}` (+ `/submissions`), `/form-submissions/{id}`         |
| Forms         | `/forms` (+ `/{id}`, `/publish`, `/archive`, `/restore`, `/submissions`), `/custom-fields` (+ `/entities`, `/{id}`, `/order`, `/archive`, `/restore`)                                                               |
| Notifications | `/me/notifications` (+ `/read`, `/stream` — Server-Sent Events), `/me/badges`, `/me/notification-preferences`, `/notification-channels` (+ `/test`), `/notifications/email` (+ `/test`), `/notification-deliveries` |
| Applications  | `/applications` (+ `/permissions`, `/roles`, `/roles/{id}/request-settings`, `/assignments`), `/roles/{id}/request-settings`, `/api-clients` (+ `/secrets`, `/revoke`), `/oauth/token`, `/role-query/*`             |
| People        | `/people/lookup` — colleague search for pickers (any signed-in user, active people, minimal profile)                                                                                                                |
| Probes        | `/healthz`, `/readyz` (and `/metrics` on the internal metrics port 9464)                                                                                                                                            |
