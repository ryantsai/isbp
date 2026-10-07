import { bindStatement, parameterNames } from '@isbp/sql';
import { describe, expect, it } from 'vitest';
import { MANAGED_ENGINES, type ManagedEngine } from '../src/model';
import {
  accountQuery,
  createAccountSteps,
  generatePassword,
  grantRoleSteps,
  inventoryQueries,
  membershipQuery,
  mssqlDatabaseInventory,
  PASSWORD_ALPHABET,
  revokeRoleSteps,
  setEnabledSteps,
  setPasswordSteps,
  type Step,
  validUntilSteps,
} from '../src/server/ddl';

/** Values that would break out of quoting if they were ever concatenated. */
const NASTY = {
  login: `evil"]; DROP TABLE x; --`,
  password: `p'w"]\\:x`,
  role: `r']); EXEC xp_cmdshell 'dir'--`,
  database: `db]; SHUTDOWN; --`,
};

function allSteps(engine: ManagedEngine): Step[] {
  const t = { login: NASTY.login, role: NASTY.role, database: engine === 'mssql' ? NASTY.database : '' };
  return [
    ...createAccountSteps(engine, {
      login: NASTY.login,
      mode: 'password',
      password: NASTY.password,
      validUntil: '2026-12-31T00:00:00.000Z',
    }),
    ...createAccountSteps(engine, {
      login: NASTY.login,
      mode: 'external',
      password: null,
      validUntil: 'infinity',
    }),
    ...(engine === 'mssql'
      ? createAccountSteps(engine, {
          login: NASTY.login,
          mode: 'windows',
          password: null,
          validUntil: 'infinity',
        })
      : []),
    ...setPasswordSteps(engine, NASTY.login, NASTY.password),
    ...setEnabledSteps(engine, NASTY.login, true),
    ...setEnabledSteps(engine, NASTY.login, false),
    ...grantRoleSteps(engine, t),
    ...grantRoleSteps(engine, { ...t, database: '' }),
    ...revokeRoleSteps(engine, t),
    ...revokeRoleSteps(engine, { ...t, database: '' }),
    ...(engine === 'postgres' ? validUntilSteps(NASTY.login, 'infinity') : []),
  ];
}

describe('statement builders', () => {
  for (const engine of MANAGED_ENGINES) {
    describe(engine, () => {
      const steps = allSteps(engine);
      const queries = [
        accountQuery(engine, NASTY.login),
        membershipQuery(engine, {
          login: NASTY.login,
          role: NASTY.role,
          database: engine === 'mssql' ? NASTY.database : '',
        }),
        membershipQuery(engine, { login: NASTY.login, role: NASTY.role, database: '' }),
      ];

      it('never put a value into the SQL text (placeholders only)', () => {
        for (const q of [...steps, ...queries]) {
          for (const value of Object.values(NASTY)) expect(q.sql).not.toContain(value);
          for (const value of Object.values(q.params))
            if (value.length > 3) expect(q.sql).not.toContain(value);
        }
      });

      it('use exactly the parameters they pass', () => {
        for (const q of [...steps, ...queries])
          expect(parameterNames(q.sql, engine).sort(), q.sql).toEqual(Object.keys(q.params).sort());
      });

      it('bind to driver placeholders', () => {
        for (const q of [...steps, ...queries]) {
          const bound = bindStatement(engine, q.sql, q.params);
          for (const value of Object.values(NASTY)) expect(bound.text).not.toContain(value);
        }
      });

      it('quote on the server', () => {
        const ddl = steps.map((s) => s.sql).join('\n');
        if (engine === 'postgres') {
          expect(ddl).toMatch(/format\('CREATE ROLE %I LOGIN PASSWORD %L VALID UNTIL %L'/);
          expect(steps.every((s) => s.generated)).toBe(true);
        }
        if (engine === 'mssql') {
          expect(ddl).toContain(`QUOTENAME(:login) + N' WITH PASSWORD = ' + QUOTENAME(:password, '''')`);
          expect(ddl).toContain(`QUOTENAME(:db) + N'.sys.sp_executesql'`);
          expect(ddl).toContain('FROM WINDOWS');
          expect(steps.some((s) => s.generated)).toBe(false);
        }
        if (engine === 'oracle') {
          expect(ddl).toContain('DBMS_ASSERT.ENQUOTE_NAME(:name, FALSE)');
          expect(ddl).toContain('GRANT CREATE SESSION TO');
          expect(ddl).toContain('ACCOUNT LOCK');
        }
      });
    });
  }

  it('SQL Server database roles create the database user first', () => {
    const steps = grantRoleSteps('mssql', { login: 'jdoe', role: 'db_datareader', database: 'HRIS' });
    expect(steps.map((s) => s.label)).toEqual(['create database user', 'add role member']);
    expect(grantRoleSteps('mssql', { login: 'jdoe', role: 'sysadmin', database: '' })[0]!.sql).toContain(
      'ALTER SERVER ROLE',
    );
  });

  it('inventory queries need no parameters, except the database on SQL Server', () => {
    for (const engine of MANAGED_ENGINES) {
      const q = inventoryQueries(engine);
      for (const x of [q.accounts, q.roles, q.memberships]) expect(parameterNames(x.sql, engine)).toEqual([]);
    }
    const db = mssqlDatabaseInventory(NASTY.database);
    expect(db.roles.sql).not.toContain(NASTY.database);
    expect(parameterNames(db.memberships.sql, 'mssql')).toEqual(['db']);
  });
});

describe('generated passwords', () => {
  it('use the safe alphabet with every character class', () => {
    for (let i = 0; i < 200; i++) {
      const p = generatePassword(24, 'postgres');
      expect(p).toHaveLength(24);
      expect([...p].every((c) => PASSWORD_ALPHABET.includes(c))).toBe(true);
      expect(p).toMatch(/[A-Z]/);
      expect(p).toMatch(/[a-z]/);
      expect(p).toMatch(/[2-9]/);
      expect(p).toMatch(/[-_.!#%*+=~]/);
      expect(p).toMatch(/^[A-Za-z]/);
      expect(p).not.toMatch(/['"\\:@$]/);
    }
  });

  it('respect the length policy and Oracle’s 30-byte limit', () => {
    expect(generatePassword(8, 'postgres')).toHaveLength(16);
    expect(generatePassword(100, 'mssql')).toHaveLength(64);
    expect(generatePassword(48, 'oracle')).toHaveLength(30);
  });
});
