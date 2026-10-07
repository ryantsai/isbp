import { describe, expect, it } from 'vitest';
import {
  accountNameFor,
  addMonths,
  checkDuration,
  closeOutcome,
  defaultDateFor,
  durationPolicyProblem,
  endOfDayIn,
  grantExpiry,
  isValidAccountName,
  isValidRoleName,
  loginNameFor,
  maxDateFor,
  nextCampaignDates,
  patternProblem,
  personIndex,
  retryDelaySeconds,
  reviewerFor,
  reviewTotals,
  toCsv,
  unmanagedMemberships,
  viewStatus,
} from '../src/model';

const person = (username: string, email: string | null = `${username}@contoso.example`) => ({
  username,
  email,
});

describe('account naming', () => {
  it('applies the pattern, lower-cases and sanitises to [a-z0-9_]', () => {
    expect(accountNameFor('{username}', person('Jane.Doe'), 'postgres')).toBe('jane_doe');
    expect(accountNameFor('demo_u_{username}', person('hr.partner'), 'postgres')).toBe('demo_u_hr_partner');
    expect(accountNameFor('{email_local}_ro', person('jd', 'Jane.Doe+db@contoso.example'), 'mssql')).toBe(
      'jane_doe_db_ro',
    );
    expect(accountNameFor('{username}', person("o'brien--x"), 'postgres')).toBe('o_brien_x');
    // Never starts with a digit, never empty.
    expect(accountNameFor('{username}', person('007'), 'postgres')).toBe('u007');
    expect(accountNameFor('{username}', person('...'), 'postgres')).toBeNull();
  });

  it('upper-cases Oracle names and keeps them within 30 characters', () => {
    const name = accountNameFor('{username}', person('a.very.long.username.from.the.directory'), 'oracle');
    expect(name).toBe('A_VERY_LONG_USERNAME_FROM_THE');
    expect(name!.length).toBeLessThanOrEqual(30);
    expect(isValidAccountName(name!, 'oracle')).toBe(true);
    expect(accountNameFor('{username}', person('x'.repeat(100)), 'postgres')!.length).toBe(63);
  });

  it('falls back to the username when there is no e-mail', () => {
    expect(accountNameFor('{email_local}', person('kai', null), 'postgres')).toBe('kai');
  });

  it('validates patterns', () => {
    expect(patternProblem('{username}')).toBeNull();
    expect(patternProblem('demo_u_{username}')).toBeNull();
    expect(patternProblem('')).toBe('empty');
    expect(patternProblem('static_name')).toBe('no_token');
    expect(patternProblem('{username}; drop table x')).toBe('invalid');
    expect(patternProblem('{password}')).toBe('invalid');
    expect(accountNameFor('{username};', person('x'), 'postgres')).toBeNull();
  });

  it('accepts only strict identifiers', () => {
    expect(isValidAccountName('jane_doe', 'postgres')).toBe(true);
    expect(isValidAccountName('Jane_Doe', 'postgres')).toBe(false);
    expect(isValidAccountName('jane"; drop', 'postgres')).toBe(false);
    expect(isValidAccountName('JANE_DOE', 'oracle')).toBe(true);
    expect(isValidAccountName('jane_doe', 'oracle')).toBe(false);
    expect(isValidRoleName('db_datareader', 'mssql')).toBe(true);
    expect(isValidRoleName('FIN$POSTING#1', 'oracle')).toBe(true);
    expect(isValidRoleName("x'; --", 'postgres')).toBe(false);
    expect(isValidRoleName('has space', 'mssql')).toBe(false);
    expect(isValidRoleName('a'.repeat(64), 'postgres')).toBe(false);
  });

  it('builds Windows logins on SQL Server only', () => {
    expect(loginNameFor('jdoe', 'mssql', 'windows', 'contoso')).toBe('CONTOSO\\jdoe');
    expect(loginNameFor('jdoe', 'mssql', 'password', 'contoso')).toBe('jdoe');
    expect(loginNameFor('jdoe', 'postgres', 'windows', 'contoso')).toBe('jdoe');
  });
});

describe('durations', () => {
  const timeBound = { defaultDays: 30, maxDays: 90, allowPermanent: false };
  const permanent = { defaultDays: null, maxDays: null, allowPermanent: true };
  const today = '2026-10-07';

  it('limits the end date to the role maximum', () => {
    expect(maxDateFor(timeBound, today)).toBe('2027-01-05');
    expect(checkDuration(timeBound, '2026-11-06', today)).toBe('ok');
    expect(checkDuration(timeBound, '2027-01-05', today)).toBe('ok');
    expect(checkDuration(timeBound, '2027-01-06', today)).toBe('too_long');
    expect(checkDuration(timeBound, today, today)).toBe('past');
    expect(checkDuration(timeBound, null, today)).toBe('permanent_not_allowed');
  });

  it('allows permanent access only when the role does', () => {
    expect(checkDuration(permanent, null, today)).toBe('ok');
    expect(checkDuration(permanent, '2099-01-01', today)).toBe('ok');
    expect(defaultDateFor(permanent, today)).toBeNull();
    expect(defaultDateFor(timeBound, today)).toBe('2026-11-06');
    expect(defaultDateFor({ defaultDays: 200, maxDays: 90, allowPermanent: false }, today)).toBe(
      '2027-01-05',
    );
  });

  it('checks the DBA settings', () => {
    expect(durationPolicyProblem(timeBound)).toBeNull();
    expect(durationPolicyProblem(permanent)).toBeNull();
    expect(durationPolicyProblem({ defaultDays: 30, maxDays: null, allowPermanent: false })).toBe(
      'max_required',
    );
    expect(durationPolicyProblem({ defaultDays: 100, maxDays: 90, allowPermanent: false })).toBe(
      'default_over_max',
    );
  });

  it('ends access at the end of the requested day in the requester’s zone', () => {
    expect(endOfDayIn('2026-10-31', 'Asia/Taipei').toISOString()).toBe('2026-10-31T15:59:59.000Z');
    expect(endOfDayIn('2026-10-31', 'UTC').toISOString()).toBe('2026-10-31T23:59:59.000Z');
    // Across a DST change (Europe/London leaves summer time on 25 Oct 2026).
    expect(endOfDayIn('2026-10-25', 'Europe/London').toISOString()).toBe('2026-10-25T23:59:59.000Z');
    expect(endOfDayIn('2026-07-01', 'Europe/London').toISOString()).toBe('2026-07-01T22:59:59.000Z');
  });

  it('keeps an approved grant at least a day and never beyond the maximum', () => {
    const now = new Date('2026-10-07T03:00:00Z');
    expect(grantExpiry('2026-10-20', timeBound, 'Asia/Taipei', now)?.toISOString()).toBe(
      '2026-10-20T15:59:59.000Z',
    );
    // The request sat too long: still a day of access.
    expect(grantExpiry('2026-10-01', timeBound, 'UTC', now)?.toISOString()).toBe('2026-10-08T03:00:00.000Z');
    expect(grantExpiry('2027-12-31', timeBound, 'UTC', now)?.toISOString()).toBe('2027-01-05T03:00:00.000Z');
    expect(grantExpiry(null, permanent, 'UTC', now)).toBeNull();
  });
});

describe('grant states', () => {
  const now = new Date('2026-10-07T00:00:00Z');
  it('derives "expiring" for active grants ending within three days', () => {
    expect(viewStatus('active', new Date('2026-10-09T00:00:00Z'), now)).toBe('expiring');
    expect(viewStatus('active', new Date('2026-10-12T00:00:00Z'), now)).toBe('active');
    expect(viewStatus('active', null, now)).toBe('active');
    expect(viewStatus('revoking', new Date('2026-10-08T00:00:00Z'), now)).toBe('revoking');
  });

  it('backs off between attempts', () => {
    expect([1, 2, 3].map((n) => retryDelaySeconds(30, n))).toEqual([30, 120, 480]);
  });
});

describe('drift', () => {
  const roles = [
    { id: 'r1', database: '', roleName: 'demo_reporting' },
    { id: 'r2', database: 'HRIS', roleName: 'db_datareader' },
  ];

  it('finds memberships of requestable roles that no live grant explains', () => {
    const memberships = [
      { database: '', roleName: 'demo_reporting', memberName: 'demo_u_admin' },
      { database: '', roleName: 'demo_reporting', memberName: 'demo_u_legacy_report' },
      { database: '', roleName: 'demo_reporting', memberName: 'demo_u_old' },
      { database: '', roleName: 'not_requestable', memberName: 'someone' },
    ];
    const grants = [
      { roleId: 'r1', accountName: 'demo_u_admin', status: 'active' as const },
      { roleId: 'r1', accountName: 'demo_u_old', status: 'expired' as const },
    ];
    expect(unmanagedMemberships('postgres', memberships, roles, grants).map((u) => u.memberName)).toEqual([
      'demo_u_legacy_report',
      'demo_u_old',
    ]);
  });

  it('compares names case-insensitively on SQL Server and Oracle, exactly on PostgreSQL', () => {
    const m = [{ database: 'hris', roleName: 'DB_DATAREADER', memberName: 'contoso\\JDOE' }];
    const g = [{ roleId: 'r2', accountName: 'CONTOSO\\jdoe', status: 'provisioning' as const }];
    expect(unmanagedMemberships('mssql', m, roles, g)).toEqual([]);
    expect(
      unmanagedMemberships(
        'postgres',
        [{ database: '', roleName: 'DEMO_REPORTING', memberName: 'x' }],
        roles,
        [],
      ),
    ).toEqual([]);
  });

  it('matches accounts to people by the pattern (platform records win); inactive people make orphans', () => {
    const people = [
      { id: 'u1', username: 'jane.doe', email: 'jane.doe@x', active: true },
      { id: 'u2', username: 'left.person', email: null, active: false },
    ];
    const index = personIndex('postgres', 'demo_u_{username}', people, [
      { accountName: 'legacy_jane', userId: 'u1' },
    ]);
    expect(index.get('demo_u_jane_doe')).toEqual({ userId: 'u1', active: true });
    expect(index.get('demo_u_left_person')).toEqual({ userId: 'u2', active: false });
    expect(index.get('legacy_jane')).toEqual({ userId: 'u1', active: true });
    expect(index.get('nobody')).toBeUndefined();
  });
});

describe('access reviews', () => {
  const owned = { ownerUserId: 'owner', ownerGroupId: null, granteeId: 'g', granteeManagerId: 'mgr' };

  it('assigns the role owner or the grantee’s manager, never the grantee', () => {
    expect(reviewerFor('owner', owned)).toEqual({ kind: 'user', id: 'owner' });
    expect(reviewerFor('manager', owned)).toEqual({ kind: 'user', id: 'mgr' });
    expect(reviewerFor('owner', { ...owned, ownerUserId: null, ownerGroupId: 'grp' })).toEqual({
      kind: 'group',
      id: 'grp',
    });
    expect(reviewerFor('owner', { ...owned, ownerUserId: 'g' })).toEqual({ kind: 'user', id: 'mgr' });
    expect(reviewerFor('manager', { ...owned, granteeManagerId: null })).toEqual({
      kind: 'user',
      id: 'owner',
    });
    expect(
      reviewerFor('owner', { ownerUserId: 'g', ownerGroupId: null, granteeId: 'g', granteeManagerId: null }),
    ).toBeNull();
  });

  it('applies the policy to undecided items when the campaign closes', () => {
    const items = [
      { id: 'i1', grantId: 'g1', decision: 'keep' as const },
      { id: 'i2', grantId: 'g2', decision: 'revoke' as const },
      { id: 'i3', grantId: 'g3', decision: null },
    ];
    expect(closeOutcome(items, 'revoke')).toEqual({ revoke: ['g2', 'g3'], keep: ['g1'], defaulted: ['i3'] });
    expect(closeOutcome(items, 'keep')).toEqual({ revoke: ['g2'], keep: ['g1', 'g3'], defaulted: ['i3'] });
    expect(reviewTotals(items)).toEqual({ items: 3, kept: 1, revoked: 1, pending: 1 });
  });

  it('recurs quarterly', () => {
    expect(nextCampaignDates('2026-10-02', '2026-10-17')).toEqual({
      startOn: '2027-01-02',
      dueOn: '2027-01-17',
    });
    expect(addMonths('2026-11-30', 3)).toBe('2027-02-28');
  });

  it('exports CSV safely', () => {
    expect(toCsv([['a', 'b,c', 'say "hi"', '=cmd()', null, 3]])).toBe('a,"b,c","say ""hi""",\'=cmd(),,3\r\n');
  });
});
