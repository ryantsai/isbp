/**
 * Per-engine statements for account administration. Every name and password is a bound `:parameter`; the
 * TARGET server quotes it (SQL Server `QUOTENAME` + `sp_executesql`, PostgreSQL `format('%I', '%L')`, Oracle
 * `DBMS_ASSERT.ENQUOTE_NAME` in PL/SQL). The SQL text below is constant: no value is ever concatenated into
 * it. Pure functions, unit-tested (placeholders only).
 */
import { randomInt } from 'node:crypto';
import { type ManagedEngine, ORACLE_PASSWORD_MAX, PASSWORD_LENGTH } from '../model';

export interface Step {
  /** Constant SQL with `:name` placeholders. */
  sql: string;
  params: Record<string, string>;
  /**
   * PostgreSQL: the statement returns one row whose `stmt` column is the DDL the server built with
   * `format()`; run it next.
   */
  generated?: boolean;
  /** What the step does, for logs (never values). */
  label: string;
}

export interface Query {
  sql: string;
  params: Record<string, string>;
}

/* ───────────────────────────── passwords ───────────────────────────── */

const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const LOWER = 'abcdefghijkmnopqrstuvwxyz';
const DIGITS = '23456789';
/** No quotes, backslashes, `@`, `:` or `$`: safe in every client and connection string. */
const SYMBOLS = '-_.!#%*+=~';
export const PASSWORD_ALPHABET = UPPER + LOWER + DIGITS + SYMBOLS;

/**
 * A random password from a safe alphabet with every character class (SQL Server `CHECK_POLICY`), starting
 * with a letter (Oracle quoted passwords and some tools dislike a leading symbol).
 */
export function generatePassword(length: number, engine: ManagedEngine): string {
  let n = Math.max(PASSWORD_LENGTH.min, Math.min(PASSWORD_LENGTH.max, Math.floor(length)));
  if (engine === 'oracle') n = Math.min(n, ORACLE_PASSWORD_MAX);
  const pick = (set: string) => set[randomInt(set.length)]!;
  const chars = [pick(UPPER), pick(LOWER), pick(DIGITS), pick(SYMBOLS)];
  while (chars.length < n) chars.push(pick(PASSWORD_ALPHABET));
  // Fisher–Yates, then make sure the first character is a letter.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j]!, chars[i]!];
  }
  const firstLetter = chars.findIndex((c) => /[A-Za-z]/.test(c));
  [chars[0], chars[firstLetter]] = [chars[firstLetter]!, chars[0]!];
  return chars.join('');
}

/* ───────────────────────────── PostgreSQL ───────────────────────────── */

/** `SELECT format('<template>', :a::text, …) AS stmt`: the server quotes every argument. */
function pgFormat(template: string, args: [string, string][], label: string): Step {
  return {
    sql: `SELECT format('${template}', ${args.map(([k]) => `:${k}::text`).join(', ')}) AS stmt`,
    params: Object.fromEntries(args),
    generated: true,
    label,
  };
}

/* ───────────────────────────── SQL Server ───────────────────────────── */

/** Builds `@s` from `QUOTENAME(:x)` pieces and runs it with `sp_executesql` (server level). */
const mssqlServer = (expr: string, params: Record<string, string>, label: string): Step => ({
  sql: `DECLARE @s nvarchar(max) = ${expr};\nEXEC sp_executesql @s;`,
  params,
  label,
});

/** The same, inside a database: `EXEC [db].sys.sp_executesql @s`. */
const mssqlDatabase = (expr: string, params: Record<string, string>, label: string): Step => ({
  sql: `DECLARE @proc nvarchar(300) = QUOTENAME(:db) + N'.sys.sp_executesql';\nDECLARE @s nvarchar(max) = ${expr};\nEXEC @proc @s;`,
  params,
  label,
});

/* ───────────────────────────── Oracle ───────────────────────────── */

const oracleBlock = (body: string, params: Record<string, string>, label: string): Step => ({
  sql: `BEGIN\n  ${body}\nEND;`,
  params,
  label,
});
const q = (bind: string) => `DBMS_ASSERT.ENQUOTE_NAME(:${bind}, FALSE)`;

/* ───────────────────────────── builders ───────────────────────────── */

export interface CreateAccountInput {
  /** Account (PostgreSQL role, Oracle user) or SQL Server login, e.g. `CONTOSO\jdoe`. */
  login: string;
  mode: 'password' | 'windows' | 'external';
  password: string | null;
  /** PostgreSQL `VALID UNTIL` (ISO instant or `infinity`). */
  validUntil: string;
}

export function createAccountSteps(engine: ManagedEngine, a: CreateAccountInput): Step[] {
  const needsPassword = a.mode === 'password';
  if (needsPassword && !a.password) throw new Error('A password is required');
  switch (engine) {
    case 'postgres':
      return [
        needsPassword
          ? pgFormat(
              'CREATE ROLE %I LOGIN PASSWORD %L VALID UNTIL %L',
              [
                ['name', a.login],
                ['password', a.password!],
                ['until', a.validUntil],
              ],
              'create role',
            )
          : pgFormat(
              'CREATE ROLE %I LOGIN VALID UNTIL %L',
              [
                ['name', a.login],
                ['until', a.validUntil],
              ],
              'create role',
            ),
      ];
    case 'mssql':
      if (a.mode === 'password')
        return [
          mssqlServer(
            `N'CREATE LOGIN ' + QUOTENAME(:login) + N' WITH PASSWORD = ' + QUOTENAME(:password, '''') + N', CHECK_POLICY = ON'`,
            { login: a.login, password: a.password! },
            'create login',
          ),
        ];
      return [
        mssqlServer(
          a.mode === 'windows'
            ? `N'CREATE LOGIN ' + QUOTENAME(:login) + N' FROM WINDOWS'`
            : `N'CREATE LOGIN ' + QUOTENAME(:login) + N' FROM EXTERNAL PROVIDER'`,
          { login: a.login },
          'create login',
        ),
      ];
    case 'oracle':
      return [
        oracleBlock(
          needsPassword
            ? `EXECUTE IMMEDIATE 'CREATE USER ' || ${q('name')} || ' IDENTIFIED BY ' || ${q('password')};\n  EXECUTE IMMEDIATE 'GRANT CREATE SESSION TO ' || ${q('name')};`
            : `EXECUTE IMMEDIATE 'CREATE USER ' || ${q('name')} || ' IDENTIFIED EXTERNALLY';\n  EXECUTE IMMEDIATE 'GRANT CREATE SESSION TO ' || ${q('name')};`,
          needsPassword ? { name: a.login, password: a.password! } : { name: a.login },
          'create user',
        ),
      ];
  }
}

/** Sets a new password (re-enabling an account the platform created). */
export function setPasswordSteps(engine: ManagedEngine, login: string, password: string): Step[] {
  switch (engine) {
    case 'postgres':
      return [
        pgFormat(
          'ALTER ROLE %I PASSWORD %L',
          [
            ['name', login],
            ['password', password],
          ],
          'set password',
        ),
      ];
    case 'mssql':
      return [
        mssqlServer(
          `N'ALTER LOGIN ' + QUOTENAME(:login) + N' WITH PASSWORD = ' + QUOTENAME(:password, '''')`,
          { login, password },
          'set password',
        ),
      ];
    case 'oracle':
      return [
        oracleBlock(
          `EXECUTE IMMEDIATE 'ALTER USER ' || ${q('name')} || ' IDENTIFIED BY ' || ${q('password')};`,
          { name: login, password },
          'set password',
        ),
      ];
  }
}

export function setEnabledSteps(engine: ManagedEngine, login: string, enabled: boolean): Step[] {
  switch (engine) {
    case 'postgres':
      return [
        pgFormat(
          enabled ? 'ALTER ROLE %I LOGIN' : 'ALTER ROLE %I NOLOGIN',
          [['name', login]],
          enabled ? 'enable login' : 'disable login',
        ),
      ];
    case 'mssql':
      return [
        mssqlServer(
          enabled
            ? `N'ALTER LOGIN ' + QUOTENAME(:login) + N' ENABLE'`
            : `N'ALTER LOGIN ' + QUOTENAME(:login) + N' DISABLE'`,
          { login },
          enabled ? 'enable login' : 'disable login',
        ),
      ];
    case 'oracle':
      return [
        oracleBlock(
          enabled
            ? `EXECUTE IMMEDIATE 'ALTER USER ' || ${q('name')} || ' ACCOUNT UNLOCK';`
            : `EXECUTE IMMEDIATE 'ALTER USER ' || ${q('name')} || ' ACCOUNT LOCK';`,
          { name: login },
          enabled ? 'unlock user' : 'lock user',
        ),
      ];
  }
}

/** PostgreSQL only: password validity follows the latest grant (`infinity` when one is permanent). */
export function validUntilSteps(login: string, validUntil: string): Step[] {
  return [
    pgFormat(
      'ALTER ROLE %I VALID UNTIL %L',
      [
        ['name', login],
        ['until', validUntil],
      ],
      'set valid until',
    ),
  ];
}

export interface RoleTarget {
  login: string;
  role: string;
  /** SQL Server database of a database role; `''` for server roles and other engines. */
  database: string;
}

export function grantRoleSteps(engine: ManagedEngine, t: RoleTarget): Step[] {
  switch (engine) {
    case 'postgres':
      return [
        pgFormat(
          'GRANT %I TO %I',
          [
            ['role', t.role],
            ['name', t.login],
          ],
          'grant role',
        ),
      ];
    case 'mssql':
      if (!t.database)
        return [
          mssqlServer(
            `N'ALTER SERVER ROLE ' + QUOTENAME(:role) + N' ADD MEMBER ' + QUOTENAME(:login)`,
            { role: t.role, login: t.login },
            'add server role member',
          ),
        ];
      return [
        mssqlDatabase(
          `N'IF DATABASE_PRINCIPAL_ID(' + QUOTENAME(:login, '''') + N') IS NULL CREATE USER ' + QUOTENAME(:login) + N' FOR LOGIN ' + QUOTENAME(:login)`,
          { db: t.database, login: t.login },
          'create database user',
        ),
        mssqlDatabase(
          `N'ALTER ROLE ' + QUOTENAME(:role) + N' ADD MEMBER ' + QUOTENAME(:login)`,
          { db: t.database, role: t.role, login: t.login },
          'add role member',
        ),
      ];
    case 'oracle':
      return [
        oracleBlock(
          `EXECUTE IMMEDIATE 'GRANT ' || ${q('role')} || ' TO ' || ${q('name')};`,
          { role: t.role, name: t.login },
          'grant role',
        ),
      ];
  }
}

export function revokeRoleSteps(engine: ManagedEngine, t: RoleTarget): Step[] {
  switch (engine) {
    case 'postgres':
      return [
        pgFormat(
          'REVOKE %I FROM %I',
          [
            ['role', t.role],
            ['name', t.login],
          ],
          'revoke role',
        ),
      ];
    case 'mssql':
      if (!t.database)
        return [
          mssqlServer(
            `N'ALTER SERVER ROLE ' + QUOTENAME(:role) + N' DROP MEMBER ' + QUOTENAME(:login)`,
            { role: t.role, login: t.login },
            'drop server role member',
          ),
        ];
      return [
        mssqlDatabase(
          `N'ALTER ROLE ' + QUOTENAME(:role) + N' DROP MEMBER ' + QUOTENAME(:login)`,
          { db: t.database, role: t.role, login: t.login },
          'drop role member',
        ),
      ];
    case 'oracle':
      return [
        oracleBlock(
          `EXECUTE IMMEDIATE 'REVOKE ' || ${q('role')} || ' FROM ' || ${q('name')};`,
          { role: t.role, name: t.login },
          'revoke role',
        ),
      ];
  }
}

/* ───────────────────────────── read-backs ───────────────────────────── */

/** One row (`name`, `enabled` 1/0/true/false) when the account exists. */
export function accountQuery(engine: ManagedEngine, login: string): Query {
  switch (engine) {
    case 'postgres':
      return {
        sql: 'SELECT rolname AS name, rolcanlogin AS enabled FROM pg_roles WHERE rolname = :name',
        params: { name: login },
      };
    case 'mssql':
      return {
        sql: `SELECT name, CASE WHEN is_disabled = 1 THEN 0 ELSE 1 END AS enabled FROM sys.server_principals WHERE name = :login AND type IN ('S', 'U', 'G', 'E', 'X')`,
        params: { login },
      };
    case 'oracle':
      return {
        sql: `SELECT username AS name, CASE WHEN account_status = 'OPEN' THEN 1 ELSE 0 END AS enabled FROM DBA_USERS WHERE username = :name`,
        params: { name: login },
      };
  }
}

/** Rows when `login` is a member of the role (verification after GRANT / REVOKE). */
export function membershipQuery(engine: ManagedEngine, t: RoleTarget): Query {
  switch (engine) {
    case 'postgres':
      return {
        sql: 'SELECT u.rolname AS member FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.roleid JOIN pg_roles u ON u.oid = m.member WHERE r.rolname = :role AND u.rolname = :name',
        params: { role: t.role, name: t.login },
      };
    case 'mssql':
      if (!t.database)
        return {
          sql: 'SELECT m.name AS member FROM sys.server_role_members rm JOIN sys.server_principals r ON r.principal_id = rm.role_principal_id JOIN sys.server_principals m ON m.principal_id = rm.member_principal_id WHERE r.name = :role AND m.name = :login',
          params: { role: t.role, login: t.login },
        };
      return {
        sql: `DECLARE @proc nvarchar(300) = QUOTENAME(:db) + N'.sys.sp_executesql';\nEXEC @proc N'SELECT m.name AS member FROM sys.database_role_members rm JOIN sys.database_principals r ON r.principal_id = rm.role_principal_id JOIN sys.database_principals m ON m.principal_id = rm.member_principal_id WHERE r.name = @role AND m.name = @member', N'@role sysname, @member sysname', @role = :role, @member = :login;`,
        params: { db: t.database, role: t.role, login: t.login },
      };
    case 'oracle':
      return {
        sql: 'SELECT grantee AS member FROM DBA_ROLE_PRIVS WHERE granted_role = :role AND grantee = :name',
        params: { role: t.role, name: t.login },
      };
  }
}

/** PostgreSQL: the roles that granted a membership (`grantor`). */
export function grantorQuery(t: RoleTarget): Query {
  return {
    sql: 'SELECT g.rolname AS grantor FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.roleid JOIN pg_roles u ON u.oid = m.member JOIN pg_roles g ON g.oid = m.grantor WHERE r.rolname = :role AND u.rolname = :name',
    params: { role: t.role, name: t.login },
  };
}

/* ───────────────────────────── inventory ───────────────────────────── */

export interface InventoryQueries {
  /** `name`, `kind`, `enabled`, `created_at`, `last_login_at`, `valid_until` (whatever the engine knows). */
  accounts: Query;
  /** `name` (+ `can_login` on PostgreSQL, where roles and accounts are one thing). */
  roles: Query;
  /** `role_name`, `member_name`. */
  memberships: Query;
  /** Fallbacks for a login without the DBA views (Oracle). */
  fallback?: { accounts: Query; roles: Query };
}

export function inventoryQueries(engine: ManagedEngine): InventoryQueries {
  switch (engine) {
    case 'postgres':
      return {
        accounts: {
          sql: `SELECT rolname AS name, CASE WHEN rolsuper THEN 'superuser' WHEN rolcanlogin THEN 'login' ELSE 'role' END AS kind, rolcanlogin AS enabled, rolcanlogin AS can_login, rolvaliduntil AS valid_until FROM pg_roles WHERE rolname !~ '^pg_' ORDER BY rolname`,
          params: {},
        },
        roles: {
          sql: `SELECT rolname AS name FROM pg_roles WHERE rolname !~ '^pg_' AND NOT rolcanlogin ORDER BY rolname`,
          params: {},
        },
        memberships: {
          sql: `SELECT r.rolname AS role_name, u.rolname AS member_name FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.roleid JOIN pg_roles u ON u.oid = m.member WHERE r.rolname !~ '^pg_' AND u.rolname !~ '^pg_'`,
          params: {},
        },
      };
    case 'mssql':
      return {
        accounts: {
          sql: `SELECT name, type_desc AS kind, CASE WHEN is_disabled = 1 THEN 0 ELSE 1 END AS enabled, create_date AS created_at FROM sys.server_principals WHERE type IN ('S', 'U', 'G', 'E', 'X') AND name NOT LIKE '##%' ORDER BY name`,
          params: {},
        },
        roles: {
          sql: `SELECT name FROM sys.server_principals WHERE type = 'R' AND name <> 'public' ORDER BY name`,
          params: {},
        },
        memberships: {
          sql: 'SELECT r.name AS role_name, m.name AS member_name FROM sys.server_role_members rm JOIN sys.server_principals r ON r.principal_id = rm.role_principal_id JOIN sys.server_principals m ON m.principal_id = rm.member_principal_id',
          params: {},
        },
      };
    case 'oracle':
      return {
        accounts: {
          sql: `SELECT username AS name, account_status AS kind, CASE WHEN account_status = 'OPEN' THEN 1 ELSE 0 END AS enabled, created AS created_at, last_login AS last_login_at FROM DBA_USERS WHERE oracle_maintained = 'N' ORDER BY username`,
          params: {},
        },
        roles: {
          sql: `SELECT role AS name FROM DBA_ROLES WHERE oracle_maintained = 'N' ORDER BY role`,
          params: {},
        },
        memberships: {
          sql: `SELECT granted_role AS role_name, grantee AS member_name FROM DBA_ROLE_PRIVS WHERE grantee IN (SELECT username FROM DBA_USERS WHERE oracle_maintained = 'N')`,
          params: {},
        },
        fallback: {
          accounts: {
            sql: 'SELECT username AS name, created AS created_at FROM ALL_USERS ORDER BY username',
            params: {},
          },
          roles: {
            sql: 'SELECT granted_role AS name FROM USER_ROLE_PRIVS ORDER BY granted_role',
            params: {},
          },
        },
      };
  }
}

/** SQL Server: roles and memberships inside one database. */
export function mssqlDatabaseInventory(database: string): { roles: Query; memberships: Query } {
  return {
    roles: {
      sql: `DECLARE @proc nvarchar(300) = QUOTENAME(:db) + N'.sys.sp_executesql';\nEXEC @proc N'SELECT name FROM sys.database_principals WHERE type = ''R'' AND name <> ''public'' ORDER BY name';`,
      params: { db: database },
    },
    memberships: {
      sql: `DECLARE @proc nvarchar(300) = QUOTENAME(:db) + N'.sys.sp_executesql';\nEXEC @proc N'SELECT r.name AS role_name, m.name AS member_name FROM sys.database_role_members rm JOIN sys.database_principals r ON r.principal_id = rm.role_principal_id JOIN sys.database_principals m ON m.principal_id = rm.member_principal_id';`,
      params: { db: database },
    },
  };
}
