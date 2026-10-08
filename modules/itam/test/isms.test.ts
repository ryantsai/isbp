import { describe, expect, it } from 'vitest';
import {
  type ApprovalEntry,
  approvalEntryState,
  entryMatches,
  installApproval,
  type InstallFacts,
  versionMatches,
  wipeDueDate,
  wipeState,
} from '../src/model';
import { csvCell, csvLine } from '../src/server/approved-software';
import { licenseModelOf } from '../src/server/process-actions';

const DEPT_A = '00000000-0000-7000-8000-00000000000a';
const DEPT_B = '00000000-0000-7000-8000-00000000000b';
const today = '2026-10-08';

const entry = (e: Partial<ApprovalEntry> & { title: string }): ApprovalEntry => ({
  version: null,
  status: 'allowed',
  scope: 'company',
  departmentIds: [],
  validUntil: null,
  ...e,
});
const install = (i: Partial<InstallFacts> & { product: string }): InstallFacts => ({
  reportedAs: null,
  version: null,
  departmentIds: [DEPT_A, null],
  ...i,
});

describe('approved software', () => {
  it('matches versions exactly or more precisely, ignoring case; no version means any', () => {
    expect(versionMatches(null, '1.2')).toBe(true);
    expect(versionMatches('', null)).toBe(true);
    expect(versionMatches('23', '23.01')).toBe(true);
    expect(versionMatches('23', '23')).toBe(true);
    expect(versionMatches('23', '230.1')).toBe(false);
    expect(versionMatches('8.7', '8.7.1')).toBe(true);
    expect(versionMatches('RC1', 'rc1')).toBe(true);
    expect(versionMatches('3', null)).toBe(false);
  });

  it('matches the stored title, the reported title or the linked licence, for the scope', () => {
    expect(entryMatches(entry({ title: 'google chrome' }), install({ product: 'Google Chrome' }))).toBe(true);
    expect(
      entryMatches(
        entry({ title: 'Office 365 ProPlus' }),
        install({ product: 'Microsoft 365 E3', reportedAs: 'office 365 proplus' }),
      ),
    ).toBe(true);
    expect(
      entryMatches(
        entry({ title: 'Office', licenseProduct: 'Microsoft 365 E3' }),
        install({ product: 'Microsoft 365 E3' }),
      ),
    ).toBe(true);
    const deptB = entry({ title: 'Visio', scope: 'departments', departmentIds: [DEPT_B] });
    expect(entryMatches(deptB, install({ product: 'Visio' }))).toBe(false);
    expect(entryMatches(deptB, install({ product: 'Visio', departmentIds: [null, DEPT_B] }))).toBe(true);
  });

  it('flags blocked titles always, and unapproved ones once the allow list is in use', () => {
    const blocked = entry({ title: 'uTorrent', status: 'blocked' });
    expect(installApproval(install({ product: 'uTorrent' }), [blocked], today)).toBe('blocked');
    expect(installApproval(install({ product: '7-Zip' }), [blocked], today)).toBe('allowed');
    const list = [blocked, entry({ title: 'Google Chrome' })];
    expect(installApproval(install({ product: '7-Zip' }), list, today)).toBe('unapproved');
    expect(installApproval(install({ product: 'Google Chrome' }), list, today)).toBe('allowed');
    // Blocked wins over allowed.
    expect(
      installApproval(install({ product: 'uTorrent' }), [...list, entry({ title: 'uTorrent' })], today),
    ).toBe('blocked');
    // An allowed entry that has ended no longer covers it (the list stays in use).
    const ended = [entry({ title: '7-Zip', validUntil: '2026-10-07' })];
    expect(installApproval(install({ product: '7-Zip' }), ended, today)).toBe('unapproved');
    expect(
      installApproval(install({ product: '7-Zip' }), [entry({ title: '7-Zip', validUntil: today })], today),
    ).toBe('allowed');
  });

  it('says when an entry is ending', () => {
    expect(approvalEntryState(null, today)).toBe('active');
    expect(approvalEntryState('2026-12-31', today)).toBe('active');
    expect(approvalEntryState('2026-10-22', today)).toBe('expiring');
    expect(approvalEntryState('2026-10-07', today)).toBe('expired');
  });

  it('writes CSV cells that spreadsheets read as text', () => {
    expect(csvCell('7-Zip')).toBe('7-Zip');
    expect(csvCell('a, b')).toBe('"a, b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('-1')).toBe("'-1");
    expect(csvCell(null)).toBe('');
    expect(csvLine(['1', 'Visio', null, '部門 A; 部門 B'])).toBe('1,Visio,,部門 A; 部門 B');
  });

  it('reads licence types from answers written in common ways', () => {
    expect(licenseModelOf('paid')).toBe('paid');
    expect(licenseModelOf('Open Source')).toBe('open_source');
    expect(licenseModelOf('open-source')).toBe('open_source');
    expect(licenseModelOf('trial')).toBe('shareware');
    expect(licenseModelOf('Shareware / Trial')).toBe('shareware');
    expect(licenseModelOf('SaaS')).toBe('subscription');
    expect(licenseModelOf('something else')).toBeNull();
    expect(licenseModelOf(3)).toBeNull();
  });
});

describe('data wipes', () => {
  it('falls due the configured months after the retention date, else after the return', () => {
    expect(wipeDueDate('2026-11-30', today, 2)).toBe('2027-01-30');
    expect(wipeDueDate(null, today, 2)).toBe('2026-12-08');
    expect(wipeDueDate('2026-12-31', today, 2)).toBe('2027-02-28');
    expect(wipeDueDate('2026-07-01', today, 2)).toBe('2026-09-01');
    expect(wipeDueDate(null, today, 0)).toBe(today);
  });

  it('is scheduled, then due within the reminder window, then overdue', () => {
    expect(wipeState(null, today)).toBe('none');
    expect(wipeState('2026-12-08', today)).toBe('scheduled');
    expect(wipeState('2026-10-15', today)).toBe('due');
    expect(wipeState(today, today)).toBe('due');
    expect(wipeState('2026-10-07', today)).toBe('overdue');
    expect(wipeState('2026-10-20', today, 14)).toBe('due');
  });
});
