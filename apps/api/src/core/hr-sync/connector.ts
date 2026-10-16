import { HR_DEPARTMENT_FIELDS, HR_EMPLOYEE_FIELDS, type HrDatabaseConfig } from '@isbp/contracts';
import {
  type ConnectorContext,
  type ConnectorHandler,
  ErrorCodes,
  HttpError,
  type RemoteRecord,
  type RemoteFieldDef,
} from '@isbp/sdk/server';
import { statementCount, writeKeywords } from '@isbp/sql/params';
import { hrSnapshot } from './model';

type Connection = ConnectorContext<HrDatabaseConfig>;
/** In-memory only, scoped to one opened connector/run: no HR rows persisted in Redis. */
const snapshots = new WeakMap<
  Connection,
  Map<string, Promise<{ records: RemoteRecord[]; byId: Map<string, RemoteRecord>; fields: RemoteFieldDef[] }>>
>();

function snapshot(conn: Connection, type: string) {
  let cache = snapshots.get(conn);
  if (!cache) {
    cache = new Map();
    snapshots.set(conn, cache);
  }
  let pending = cache.get(type);
  if (!pending) {
    pending = (async () => {
      const query = type === 'employee' ? conn.config.employeesQuery : conn.config.departmentsQuery;
      if (!query)
        throw new HttpError(
          422,
          ErrorCodes.VALIDATION_FAILED,
          'Configure the departments query before using this object',
        );
      const database = await conn.databases.get(conn.config.databaseId);
      if (!database) throw new HttpError(404, ErrorCodes.NOT_FOUND, 'Database connection not found');
      if (statementCount(query, database.engine) !== 1 || writeKeywords(query, database.engine).length)
        throw new HttpError(422, ErrorCodes.VALIDATION_FAILED, 'HR sync requires one read-only SELECT query');
      const result = await conn.databases.query(conn.config.databaseId, query, {
        purpose: 'data',
        readOnly: true,
        maxRows: conn.config.maxRows,
        signal: conn.signal,
      });
      const records = hrSnapshot(result, type, conn.config);
      const keys: readonly string[] = type === 'employee' ? HR_EMPLOYEE_FIELDS : HR_DEPARTMENT_FIELDS;
      const fields = result.columns
        .filter((c) => keys.includes(c.name) && (c.name !== 'status' || conn.config.syncStatus))
        .map((c): RemoteFieldDef => ({
          key: c.name,
          label: c.name,
          type:
            c.name === 'parentId' || c.name === 'managerId'
              ? 'parent'
              : c.name === 'status'
                ? 'choice'
                : 'string',
          ...(c.name === 'status'
            ? {
                choices: [
                  { value: 'active', label: 'Active' },
                  { value: 'offboarded', label: 'Offboarded' },
                ],
              }
            : {}),
        }));
      return { records, byId: new Map(records.map((record) => [record.id, record])), fields };
    })();
    cache.set(type, pending);
  }
  return pending;
}

export const hrDatabaseConnector: ConnectorHandler<HrDatabaseConfig> = {
  hosts: () => [],
  databaseConnections: (config) => [config.databaseId],
  test: async (conn) => {
    await snapshot(conn, 'employee');
    if (conn.config.departmentsQuery) await snapshot(conn, 'department');
    return { ok: true };
  },
  fields: async (conn, type) => (await snapshot(conn, type)).fields,
  changes: async (conn, type, opts) => {
    const { records } = await snapshot(conn, type);
    const start = opts.cursor ? records.findIndex((r) => r.id > opts.cursor!) : 0;
    const items = start < 0 ? [] : records.slice(start, start + opts.limit);
    const hasMore = start >= 0 && start + items.length < records.length;
    // Completing a snapshot resets the cursor so the next scheduled run also sees changes to older ids.
    return { items, hasMore, cursor: hasMore ? items.at(-1)!.id : null };
  },
  get: async (conn, type, id) => (await snapshot(conn, type)).byId.get(id) ?? null,
  defaultMapping: (type, entity) => {
    if (entity !== (type === 'employee' ? 'core.person' : 'core.department')) return [];
    return (type === 'employee' ? HR_EMPLOYEE_FIELDS : HR_DEPARTMENT_FIELDS).map((key) => ({
      local: key,
      remote: key,
      direction: 'pull',
    }));
  },
};
