import { hrDatabaseConfigSchema } from '@isbp/contracts';
import type { SqlResult } from '@isbp/sdk/server';
import { describe, expect, it } from 'vitest';
import { hrSnapshot } from '../../src/core/hr-sync/model';

const config = hrDatabaseConfigSchema.parse({
  databaseId: '00000000-0000-4000-8000-000000000001',
  employeesQuery: 'SELECT * FROM employees',
});
const employee = {
  employeeId: 'E01',
  username: 'employee.one',
  email: 'one@example.test',
  displayName: 'Employee One',
  status: 'employed',
};
function result(rows: Record<string, unknown>[], truncated = false): SqlResult {
  return {
    columns: Object.keys(rows[0] ?? employee).map((name) => ({ name, type: 'text' })),
    rows,
    truncated,
    affected: null,
    durationMs: 1,
  };
}
describe('HR snapshots', () => {
  it('normalizes configured employment values and uses stable content versions', () => {
    const rows = result([{ ...employee, status: ' EmPlOyEd ' }]);
    const first = hrSnapshot(rows, 'employee', config)[0]!;
    expect(first.values.status).toBe('active');
    expect(hrSnapshot(rows, 'employee', config)[0]!.version).toBe(first.version);
    expect(
      hrSnapshot(result([{ ...employee, status: 'terminated' }]), 'employee', config)[0]!.values.status,
    ).toBe('offboarded');
  });
  it('omits status when lifecycle sync is disabled', () => {
    const { status: _status, ...row } = employee;
    expect(
      hrSnapshot(result([row]), 'employee', { ...config, syncStatus: false })[0]!.values,
    ).not.toHaveProperty('status');
  });
  it('rejects overlapping configured status values', () => {
    expect(
      hrDatabaseConfigSchema.safeParse({ ...config, activeValues: ['ACTIVE'], leaverValues: ['active'] })
        .success,
    ).toBe(false);
  });
  it.each(['employeeId', 'email', 'username'])('rejects duplicate %s before returning any rows', (key) => {
    const other = {
      ...employee,
      employeeId: 'E02',
      email: 'two@example.test',
      username: 'two',
      [key]: employee[key as keyof typeof employee],
    };
    expect(() => hrSnapshot(result([employee, other]), 'employee', config)).toThrow(`duplicate ${key}`);
  });
  it('rejects incomplete results, missing aliases, malformed people and unknown status', () => {
    expect(() => hrSnapshot(result([employee], true), 'employee', config)).toThrow('row limit');
    expect(() => hrSnapshot({ ...result([employee]), columns: [] }, 'employee', config)).toThrow('alias');
    expect(() => hrSnapshot(result([{ ...employee, email: 'invalid' }]), 'employee', config)).toThrow(
      'email',
    );
    expect(() =>
      hrSnapshot(result([{ ...employee, status: 'leave-of-absence' }]), 'employee', config),
    ).toThrow('unrecognized');
  });
  it('rejects cycles and preserves source manager identifiers for hub resolution', () => {
    const one = { ...employee, managerId: 'E02' };
    const two = {
      ...employee,
      employeeId: 'E02',
      email: 'two@example.test',
      username: 'two',
      managerId: 'E01',
    };
    expect(() => hrSnapshot(result([one, two]), 'employee', config)).toThrow('circular');
    expect(() => hrSnapshot(result([one]), 'employee', config)).toThrow('outside the source');
    expect(hrSnapshot(result([one, { ...two, managerId: null }]), 'employee', config)[0]!.parentId).toBe(
      'E02',
    );
    expect(() =>
      hrSnapshot(result([{ code: 'AA', name: 'A', parentId: 'AA' }]), 'department', config),
    ).toThrow('circular');
  });
  it('accepts an empty complete snapshot without inventing leavers', () => {
    expect(hrSnapshot(result([]), 'employee', config)).toEqual([]);
  });
});
