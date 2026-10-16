# HR database sync

Core contributes the `core.hr-database` connector and the `core.person` / `core.department` sync adapters.
The Integrations module owns connections, profiles, field mappings, remote identifiers, schedules, links,
conflicts and run history. There is no second importer or credential store.

The connector reads an enabled, read-only **Data** connection through its scoped `conn.databases` facade.
SQL aliases define the source fields; examples and the configuration schema are in
`packages/contracts/src/hr-sync.ts`. SQL Server uses the existing MSSQL driver and a SELECT-only login.
Each opened connector reads one complete, bounded snapshot per object, kept only in memory. Truncation,
duplicate identifiers/email/usernames, invalid people, unknown employment values, missing parents and
hierarchy cycles fail before rows reach the hub. Completed scans reset their cursor; content hashes make
unchanged rows cheap. Maximum 20,000 rows per object, also subject to the database connection limit.

Configure a department profile before a person profile. Match departments on `code`, people on
`employeeId`; duplicate existing employee IDs are refused. The hub retains remote-to-local links, so
email changes do not create another account. The source must include referenced managers/parent
departments. Optional fields absent from the query remain unmanaged; mapped nulls clear fields.

The source's default status mapping activates employed staff and offboards explicit leavers. Disabling
status sync creates pending accounts and leaves existing lifecycle states alone. Missing rows never
disable or delete people. People writes use `UserService`; departments use `DirectoryService`. All writes,
audit and events join the hub transaction, with source metadata. Offboarding revokes sessions and removes
group memberships and role assignments; rehire does not restore those grants. Lifecycle/departments
events invalidate RBAC again after commit. Passwords, credentials, groups and role assignments cannot be
mapped. Configure SSO separately; the imported email must match the identity provider's email.

Additional permissions: `core.hr-sync.manage` configures/tests the source, `core.users.sync` provisions
people and their lifecycle, `core.departments.sync` provisions departments. They are global and privileged.
The existing `integrations.profile` customization kind manages HR profiles as change sets. Source
connections stay in the existing, explicitly human-managed connection settings flow.

API: existing `/api/v1/integrations/connections`, `/profiles`, `/runs`, `/links` and `/conflicts` endpoints.
Use the existing `integrations.sync` scheduled task for ordered department → people jobs; partial runs fail
the scheduled job so dependants do not proceed as though every record succeeded.

Tests: `apps/api/test/unit/hr-sync.test.ts`, `apps/api/test/integration/hr-sync.test.ts`,
`e2e/tests/hr-sync.spec.ts`. Integration tests use a real local PostgreSQL source; a production SQL Server
connection must be tested against the actual HR views before enabling its schedule.
