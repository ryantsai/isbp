import { describe, expect, it } from 'vitest';
import {
  addDays,
  addMonths,
  assetValue,
  CSV_BOM,
  csvCell,
  csvRecords,
  daysBetween,
  formatAssetNumber,
  formatRef,
  itemDecided,
  matchColumns,
  normalizeHeader,
  parseAccountState,
  parseLevel,
  parseLooseDate,
  parsePrivilege,
  parseRef,
  privilegeOfRoles,
  readCsvTable,
  recurrenceMonths,
  reviewProgress,
  sequenceOf,
  statusAfterStocktake,
  stocktakeProgress,
  toCsv,
} from '../src/model';

describe('asset numbers and value', () => {
  it('numbers assets <site><class><4-digit sequence>', () => {
    expect(formatAssetNumber('HQ01', 'HW', 1)).toBe('HQ01HW0001');
    expect(formatAssetNumber('DC01', 'DA', 42)).toBe('DC01DA0042');
    expect(formatAssetNumber('BR', 'SV', 12345)).toBe('BRSV12345');
  });

  it('reads the sequence of a number in its own series only', () => {
    expect(sequenceOf('HQ01HW0007', 'HQ01HW')).toBe(7);
    expect(sequenceOf('HQ01HW0007', 'HQ01SW')).toBeNull();
    expect(sequenceOf('HQ01HWX007', 'HQ01HW')).toBeNull();
    expect(sequenceOf('HQ01HW07', 'HQ01HW')).toBeNull();
  });

  it('takes the highest of C, I and A as the value', () => {
    expect(assetValue(1, 1, 1)).toBe(1);
    expect(assetValue(4, 1, 1)).toBe(4);
    expect(assetValue(2, 3, 1)).toBe(3);
    expect(assetValue(1, 1, 4)).toBe(4);
  });

  it('reads scores and references', () => {
    expect(parseLevel(' 3 ')).toBe(3);
    expect(parseLevel('3.0')).toBe(3);
    for (const bad of ['0', '5', '2.5', 'x', '', undefined]) expect(parseLevel(bad), String(bad)).toBeNull();
    expect(formatRef('stocktake', 7)).toBe('STK-00007');
    expect(parseRef('stocktake', 'stk-7')).toBe(7);
    expect(parseRef('review', 'ACR-00012')).toBe(12);
    expect(parseRef('account', 'ACR-00012')).toBeNull();
  });
});

describe('stocktakes and reviews', () => {
  it('counts progress and the outcome of each result', () => {
    expect(stocktakeProgress(['confirmed', null, 'missing', 'changed'])).toEqual({
      total: 4,
      done: 3,
      percent: 75,
      byResult: { confirmed: 1, changed: 1, missing: 1, disposed: 0 },
    });
    expect(stocktakeProgress([]).percent).toBe(100);
    expect(statusAfterStocktake('missing')).toBe('missing');
    expect(statusAfterStocktake('disposed')).toBe('disposed');
    expect(statusAfterStocktake('confirmed')).toBe('active');
  });

  it('needs the date for disable and delete before an item counts as decided', () => {
    expect(itemDecided({ decision: 'keep', doneOn: null })).toBe(true);
    expect(itemDecided({ decision: 'disable', doneOn: null })).toBe(false);
    expect(itemDecided({ decision: 'delete', doneOn: '2026-10-01' })).toBe(true);
    expect(itemDecided({ decision: null, doneOn: null })).toBe(false);
    expect(
      reviewProgress([
        { decision: 'keep', doneOn: null },
        { decision: 'disable', doneOn: null },
        { decision: null, doneOn: null },
      ]),
    ).toEqual({ total: 3, decided: 1, percent: 33, byDecision: { keep: 1, disable: 1, delete: 0 } });
  });

  it('reads privileges and states as exports write them, in three languages', () => {
    for (const v of ['Administrator', 'admin', 'Domain Admins', 'root', '管理者', '系統管理員'])
      expect(parsePrivilege(v), v).toBe('admin');
    for (const v of ['User', 'standard', '使用者', 'ユーザー']) expect(parsePrivilege(v), v).toBe('user');
    expect(parsePrivilege('guest')).toBeNull();
    for (const v of ['Enabled', 'active', '啟用', '有効', 'TRUE'])
      expect(parseAccountState(v), v).toBe('enabled');
    for (const v of ['Disabled', 'locked', '停用', '無効', '0'])
      expect(parseAccountState(v), v).toBe('disabled');
    expect(parseAccountState('maybe')).toBeNull();
    expect(privilegeOfRoles([{ key: 'editor', name: 'Editor', riskLevel: 'low' }])).toBe('user');
    expect(privilegeOfRoles([{ key: 'app-admin', name: 'Admin', riskLevel: 'low' }])).toBe('admin');
    expect(privilegeOfRoles([{ key: 'approver', name: 'Approver', riskLevel: 'high' }])).toBe('admin');
  });

  it('repeats quarterly and yearly', () => {
    expect(recurrenceMonths('none')).toBe(0);
    expect(recurrenceMonths('quarterly')).toBe(3);
    expect(recurrenceMonths('yearly')).toBe(12);
  });
});

describe('calendar dates', () => {
  it('adds days and months and counts days', () => {
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2026-11-15', 3)).toBe('2027-02-15');
    expect(daysBetween('2026-10-01', '2026-10-08')).toBe(7);
    expect(daysBetween('2026-10-08', '2026-10-01')).toBe(-7);
  });

  it('reads dates as spreadsheets write them', () => {
    expect(parseLooseDate('2026/10/8')).toBe('2026-10-08');
    expect(parseLooseDate('2026-10-08')).toBe('2026-10-08');
    expect(parseLooseDate('2026.02.30')).toBeNull();
    expect(parseLooseDate('10/08/2026')).toBeNull();
  });
});

describe('CSV', () => {
  it('writes UTF-8 with a BOM, CRLF lines, quoted cells and formula hardening', () => {
    const csv = toCsv([
      ['資產編號', 'Name'],
      ['HQ01HW0001', 'Core, "edge" firewall'],
      ['=1+1', null],
    ]);
    expect(csv.startsWith(CSV_BOM)).toBe(true);
    expect(csv.slice(1)).toBe('資產編號,Name\r\nHQ01HW0001,"Core, ""edge"" firewall"\r\n\'=1+1,\r\n');
    expect(csvCell(3)).toBe('3');
    expect(csvCell(' padded ')).toBe('" padded "');
    expect(csvCell('-5')).toBe("'-5");
  });

  it('parses quoted fields with separators and newlines, any separator, with or without a BOM', () => {
    expect(csvRecords(`${CSV_BOM}a,b\r\n"x, y","multi\nline"\n\n3,4`)).toEqual([
      { line: 1, cells: ['a', 'b'] },
      { line: 2, cells: ['x, y', 'multi\nline'] },
      { line: 5, cells: ['3', '4'] },
    ]);
    expect(csvRecords('a;b\n1;2').map((r) => r.cells)).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
    expect(csvRecords('a\tb\n1\t2')[1]!.cells).toEqual(['1', '2']);
  });

  it('finds columns by key or label in any language, ignoring case and spacing', () => {
    const aliases = {
      number: ['number', 'Asset number', '資產編號', '資産番号'],
      name: ['name', 'Asset name', '資產名稱'],
    };
    expect(normalizeHeader(' Asset_Number* ')).toBe('assetnumber');
    expect([...matchColumns(['資產名稱', 'ASSET NUMBER', 'other'], aliases)]).toEqual([
      ['name', 0],
      ['number', 1],
    ]);
  });

  it('reads a table, skipping a title line above the header and undoing formula hardening', () => {
    const aliases = { number: ['number', '資產編號'], name: ['name', '資產名稱'], notes: ['notes'] } as const;
    const text = ['資訊資產清單', '資產編號,資產名稱,notes', "HQ01HW0001,Firewall,'=x", ',Printer,'].join(
      '\n',
    );
    const res = readCsvTable(text, aliases, ['name'], 10);
    expect(res).toEqual({
      ok: true,
      rows: [
        { line: 3, values: { number: 'HQ01HW0001', name: 'Firewall', notes: '=x' } },
        { line: 4, values: { name: 'Printer' } },
      ],
    });
    expect(readCsvTable('number\nX', aliases, ['name'], 10)).toEqual({
      ok: false,
      error: 'missingColumns',
      missing: ['name'],
    });
    expect(readCsvTable('name\n', aliases, ['name'], 10)).toEqual({ ok: false, error: 'empty' });
    expect(readCsvTable('name\na\nb\nc', aliases, ['name'], 2)).toEqual({ ok: false, error: 'tooManyRows' });
  });
});
