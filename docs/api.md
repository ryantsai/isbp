# API guide

Every action in the UI is backed by a documented REST endpoint. The OpenAPI 3.1 document is generated
from the same Zod schemas that validate requests, so it is always accurate.

- Interactive reference: `https://<host>/api/docs` (local: http://localhost:4000/api/docs)
- Raw document: `GET /api/openapi.json`
- Base path: `/api/v1` — core endpoints at the root (`/api/v1/users`), module endpoints under
  `/api/v1/<module-id>` (`/api/v1/announcements/posts`)

## Authentication

Phase 0 authenticates browsers with a **server-side session**:

1. `POST /api/v1/auth/login` with `{ "username": "...", "password": "...", "provider": "<ldap-key>?" }`
   sets an `HttpOnly; SameSite=Lax` cookie `isbp_session` (`Secure` when `PUBLIC_URL` is https) and returns
   the session body, including a `csrfToken`.
2. Send the cookie on every request. **Unsafe methods** (POST/PUT/PATCH/DELETE) must also send
   `x-csrf-token: <csrfToken>`. `GET /api/v1/auth/session` returns the token again.
3. `POST /api/v1/auth/logout` revokes the session server-side.

SSO is browser-driven: `GET /api/v1/auth/sso/<provider-key>/start?next=/path` (OIDC redirect URI
`…/callback`, SAML ACS `…/acs`, SAML SP metadata `…/metadata`).

API keys and OAuth client credentials for machine clients arrive with the **Role Query API in Phase 1**.

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

| Status | Code                                                                                                                                                                                                   | Meaning                                                        |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| 400    | `VALIDATION_FAILED`, `BAD_REQUEST`                                                                                                                                                                     | Body/query failed validation (see `details.issues`)            |
| 401    | `UNAUTHENTICATED`, `INVALID_CREDENTIALS`                                                                                                                                                               | No/expired session; wrong username or password                 |
| 403    | `FORBIDDEN`, `CSRF_INVALID`, `ACCOUNT_INACTIVE`, `ACCOUNT_NOT_PROVISIONED`                                                                                                                             | Missing permission (denials are audited); bad CSRF token       |
| 403    | `PRIVILEGE_ESCALATION`                                                                                                                                                                                 | Granting permissions you don't hold (`details.missing`)        |
| 404    | `NOT_FOUND`, `MODULE_DISABLED`                                                                                                                                                                         | Unknown record/route; the module is disabled                   |
| 409    | `CONFLICT`                                                                                                                                                                                             | Unique constraint (`details.constraint`) or reference conflict |
| 409    | `SELF_LOCKOUT`, `SYSTEM_ROLE_READONLY`, `SYSTEM_GROUP`, `SYSTEM_MODULE`, `MODULE_DEPENDENCY`, `PRINCIPAL_OFFBOARDED`, `HAS_CHILDREN`, `INVALID_PARENT`, `INVALID_STATE`, `PASSWORD_MANAGED_EXTERNALLY` | Business-rule conflicts with stable codes for clients          |
| 423    | `ACCOUNT_LOCKED`                                                                                                                                                                                       | Too many failed sign-ins (temporary)                           |
| 429    | `RATE_LIMITED`                                                                                                                                                                                         | Slow down                                                      |
| 500    | `INTERNAL`                                                                                                                                                                                             | Logged with the `requestId`                                    |

Codes are stable and translated by the web app (`packages/i18n/messages/*/errors.json`); messages are
English and may change.

## Main resources (Phase 0)

| Area         | Endpoints                                                                                                                                                                                                          |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Auth & me    | `/auth/providers`, `/auth/login`, `/auth/logout`, `/auth/session`, `/auth/sso/*`, `/me`, `/me/password`, `/me/sessions`, `/me/permissions`                                                                         |
| People       | `/users` (list/create), `/users/{id}` (get/patch), `/users/{id}/onboard`, `/offboard`, `/status`, `/password`, `/sessions`, `/permissions`                                                                         |
| Organisation | `/departments`, `/departments/{id}`, `/groups`, `/groups/{id}`, `/groups/{id}/members` (+ `/remove`)                                                                                                               |
| Access       | `/permissions`, `/roles`, `/roles/{id}`, `/role-assignments`, `/role-assignments/{id}`                                                                                                                             |
| Audit        | `/audit-logs`, `/audit-logs/{seq}`, `/audit-logs/{seq}/verify`                                                                                                                                                     |
| Platform     | `/modules`, `/modules/{id}`, `/modules/{id}/toggle`, `/modules/{id}/settings`, `/identity-providers` (+ `/test`, `/sync`), `/platform/navigation`, `/platform/search`, `/platform/dashboard`, `/platform/ai-tools` |
| Probes       | `/healthz`, `/readyz` (and `/metrics` on the internal metrics port 9464)                                                                                                                                           |
