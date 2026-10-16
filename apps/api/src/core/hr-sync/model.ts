import { createHash } from 'node:crypto';
import {
  createDepartmentSchema,
  createUserSchema,
  HR_DEPARTMENT_FIELDS,
  HR_EMPLOYEE_FIELDS,
  type HrDatabaseConfig,
} from '@isbp/contracts';
import { ErrorCodes, HttpError, type RemoteRecord, type SqlResult } from '@isbp/sdk/server';

const invalid = (message: string) => new HttpError(422, ErrorCodes.VALIDATION_FAILED, message);

/** Validate the whole bounded snapshot before the hub can change any person. No absence-based offboarding. */
export function hrSnapshot(result: SqlResult, objectType: string, config: HrDatabaseConfig): RemoteRecord[] {
  if (result.truncated)
    throw invalid(
      'HR query exceeded the row limit. Narrow the source or increase both row limits; nothing was imported.',
    );
  const employee = objectType === 'employee';
  const keys = employee ? HR_EMPLOYEE_FIELDS : HR_DEPARTMENT_FIELDS;
  const columns = new Set(result.columns.map((c) => c.name));
  const required = employee
    ? ['employeeId', 'email', 'username', 'displayName', ...(config.syncStatus ? ['status'] : [])]
    : ['code', 'name'];
  for (const key of required) if (!columns.has(key)) throw invalid(`HR query must return the ${key} alias`);
  const seen = new Map<string, Set<string>>();
  const active = new Set(config.activeValues.map((v) => v.toLowerCase()));
  const leavers = new Set(config.leaverValues.map((v) => v.toLowerCase()));
  const records = result.rows.map((row, index): RemoteRecord => {
    const values: Record<string, string | null> = {};
    for (const key of keys) {
      if (!columns.has(key) || (key === 'status' && !config.syncStatus)) continue;
      const value = row[key];
      if (
        value != null &&
        typeof value !== 'string' &&
        typeof value !== 'number' &&
        typeof value !== 'bigint'
      )
        throw invalid(`HR row ${index + 1}: ${key} must be text or a number`);
      if (typeof value === 'number' && !Number.isSafeInteger(value))
        throw invalid(`HR row ${index + 1}: ${key} must be returned as text`);
      values[key] = value == null || String(value).trim() === '' ? null : String(value).trim();
    }
    const id = values[employee ? 'employeeId' : 'code'];
    if (!id) throw invalid(`HR row ${index + 1}: missing stable identifier`);
    for (const key of employee ? ['employeeId', 'email', 'username'] : ['code']) {
      const value = values[key];
      if (!value) throw invalid(`HR row ${index + 1}: ${key} is required`);
      const normalized = ['email', 'username'].includes(key) ? value.toLowerCase() : value;
      const used = seen.get(key) ?? new Set<string>();
      if (used.has(normalized)) throw invalid(`HR snapshot has duplicate ${key} values`);
      used.add(normalized);
      seen.set(key, used);
    }
    if (employee && config.syncStatus) {
      const status = values.status?.toLowerCase();
      if (!status || (!active.has(status) && !leavers.has(status)))
        throw invalid(
          `HR row ${index + 1}: unrecognized employment status; configure active and leaver values`,
        );
      values.status = active.has(status) ? 'active' : 'offboarded';
    }
    const parsed = employee
      ? createUserSchema.safeParse({ ...values, managerId: undefined, status: 'pending' })
      : createDepartmentSchema.safeParse({ ...values, parentId: undefined });
    if (!parsed.success)
      throw invalid(
        `HR row ${index + 1}: invalid ${parsed.error.issues.map((i) => i.path.join('.')).join(', ')}`,
      );
    const parentId = values[employee ? 'managerId' : 'parentId'] ?? null;
    return {
      id,
      ref: id,
      title: values[employee ? 'displayName' : 'name']!,
      url: null,
      // The same content has the same version across full scans; timestamps are not required in the HR view.
      version: createHash('sha256').update(JSON.stringify(values)).digest('hex'),
      updatedAt: new Date(0).toISOString(),
      parentId,
      values,
    };
  });
  const byId = new Map(records.map((r) => [r.id, r]));
  for (const record of records) {
    if (record.parentId && !byId.has(record.parentId))
      throw invalid(
        'HR snapshot has a manager or parent department outside the source. Include all referenced parents in the query.',
      );
  }
  const done = new Set<string>();
  for (const record of records) {
    const path = new Set<string>();
    let current: RemoteRecord | undefined = record;
    while (current && !done.has(current.id)) {
      if (path.has(current.id))
        throw invalid('HR snapshot contains a circular manager or department hierarchy');
      path.add(current.id);
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
    for (const id of path) done.add(id);
  }
  return records.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
