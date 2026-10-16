import {
  createDepartmentSchema,
  createUserSchema,
  HR_DEPARTMENT_FIELDS,
  HR_EMPLOYEE_FIELDS,
  offboardUserSchema,
  updateDepartmentSchema,
  updateUserSchema,
} from '@isbp/contracts';
import { departments, users } from '@isbp/db/schema';
import {
  type AuthContext,
  type Db,
  ErrorCodes,
  HttpError,
  type ModuleContext,
  PermissionSet,
  type SyncAdapter,
  type SyncFieldDef,
  type SyncRecord,
  type SyncWriteOptions,
} from '@isbp/sdk/server';
import { and, eq, gt, inArray, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { bindToTransaction } from '../../kernel/customizations';
import { buildAuthContext } from '../../kernel/http/auth';
import { DirectoryService } from '../services/directory';
import { UserService } from '../services/users';

const invalid = (message: string) => new HttpError(422, ErrorCodes.VALIDATION_FAILED, message);
const conflict = (message: string) => new HttpError(409, ErrorCodes.CONFLICT, message);

/** A global sync grant delegates exactly the owning service operations, never passwords, groups or roles. */
function context(ctx: ModuleContext, opts: SyncWriteOptions, person: boolean) {
  opts.auth.require(person ? 'core.users.sync' : 'core.departments.sync');
  const permissions = person
    ? ['core.users.create', 'core.users.update', 'core.users.lifecycle']
    : ['core.departments.manage'];
  const auth = buildAuthContext(
    opts.auth.principal,
    opts.auth.user,
    opts.auth.sessionId,
    new PermissionSet(permissions.map((p) => ({ p, s: 'g' }))),
  );
  const bound = bindToTransaction(ctx, opts.tx, { principal: auth.principal });
  return {
    auth,
    ctx: {
      ...bound,
      audit: {
        ...bound.audit,
        record: (entry, options) =>
          bound.audit.record({ ...entry, metadata: { ...entry.metadata, source: opts.source } }, options),
      },
    } satisfies ModuleContext,
  };
}

const personFields = (): SyncFieldDef[] =>
  HR_EMPLOYEE_FIELDS.map((key) => ({
    key,
    label: `core.hrSync.fields.${key}`,
    type: key === 'managerId' ? 'parent' : key === 'status' ? 'choice' : 'string',
    ...(['employeeId', 'email', 'username', 'displayName'].includes(key) ? { required: true } : {}),
    ...(['employeeId', 'username'].includes(key) ? { createOnly: true } : {}),
    ...(key === 'status'
      ? {
          choices: ['pending', 'active', 'suspended', 'offboarded'].map((value) => ({
            value,
            label: `core.hrSync.status.${value}`,
          })),
        }
      : {}),
  }));

async function readPeople(ctx: ModuleContext, ids: string[]): Promise<SyncRecord[]> {
  if (!ids.length) return [];
  const rows = await ctx.db
    .select({ u: users, code: departments.code })
    .from(users)
    .leftJoin(departments, eq(users.departmentId, departments.id))
    .where(inArray(users.id, ids));
  const byId = new Map(rows.map((row) => [row.u.id, row]));
  return ids.flatMap((id) => {
    const row = byId.get(id);
    if (!row) return [];
    const { u, code } = row;
    return [
      {
        id: u.id,
        ref: u.employeeId,
        title: u.displayName,
        href: `/admin/users/${u.id}`,
        updatedAt: u.updatedAt.toISOString(),
        values: Object.fromEntries(
          HR_EMPLOYEE_FIELDS.map((key) => [key, key === 'departmentCode' ? code : u[key]]),
        ),
      },
    ];
  });
}

async function readDepartments(ctx: ModuleContext, ids: string[]): Promise<SyncRecord[]> {
  if (!ids.length) return [];
  const rows = await ctx.db.select().from(departments).where(inArray(departments.id, ids));
  const byId = new Map(rows.map((row) => [row.id, row]));
  return ids.flatMap((id) => {
    const d = byId.get(id);
    return d
      ? [
          {
            id: d.id,
            ref: d.code,
            title: d.name,
            href: '/admin/departments',
            updatedAt: d.updatedAt.toISOString(),
            values: Object.fromEntries(HR_DEPARTMENT_FIELDS.map((key) => [key, d[key]])),
          },
        ]
      : [];
  });
}

const cursorSchema = z.object({ at: z.iso.datetime(), id: z.uuid() });
async function page(
  ctx: ModuleContext,
  table: typeof users | typeof departments,
  opts: Parameters<SyncAdapter['list']>[0],
) {
  let cursor: z.infer<typeof cursorSchema> | null = null;
  if (opts.after) {
    try {
      cursor = cursorSchema.parse(JSON.parse(opts.after));
    } catch {
      throw invalid('Invalid directory sync cursor');
    }
  }
  if (opts.since && !z.iso.datetime().safeParse(opts.since).success) throw invalid('Invalid sync timestamp');
  const limit = Math.min(500, Math.max(1, opts.limit));
  const rows = await ctx.db
    .select({ id: table.id, at: table.updatedAt })
    .from(table)
    .where(
      and(
        opts.since ? gt(table.updatedAt, new Date(opts.since)) : undefined,
        cursor
          ? or(
              gt(table.updatedAt, new Date(cursor.at)),
              and(eq(table.updatedAt, new Date(cursor.at)), gt(table.id, cursor.id)),
            )
          : undefined,
      ),
    )
    .orderBy(table.updatedAt, table.id)
    .limit(limit + 1);
  const included = rows.slice(0, limit);
  const last = included.at(-1);
  return {
    ids: included.map((r) => r.id),
    next: rows.length > limit && last ? JSON.stringify({ at: last.at.toISOString(), id: last.id }) : null,
  };
}

async function departmentId(db: Db, code: unknown) {
  if (code === null) return null;
  if (typeof code !== 'string' || !code.trim()) throw invalid('Department code must be text or null');
  const [department] = await db
    .select({ id: departments.id })
    .from(departments)
    .where(eq(departments.code, code));
  if (!department) throw invalid('Department code not found. Run the department sync first.');
  return department.id;
}

async function checkManager(db: Db, userId: string | undefined, managerId: unknown) {
  if (managerId === null || managerId === undefined) return;
  if (!z.uuid().safeParse(managerId).success) throw invalid('Invalid manager');
  const result = await db.execute(sql`with recursive chain as (
    select id, manager_id, array[id] as path from core.users where id = ${managerId}
    union all select u.id, u.manager_id, c.path || u.id from core.users u join chain c on u.id = c.manager_id where not u.id = any(c.path)
  ) select id from chain`);
  if (!result.rows.length) throw invalid('Manager not found');
  if (userId && result.rows.some((r) => r.id === userId))
    throw invalid('A manager change would create a circular reporting line');
}

async function lifecycle(
  service: UserService,
  id: string,
  current: string,
  wanted: unknown,
  auth: AuthContext,
) {
  if (wanted === undefined || wanted === current) return;
  if (wanted === 'offboarded')
    await service.offboard(id, offboardUserSchema.parse({ reason: 'HR sync: explicit leaver status' }), auth);
  else if (wanted === 'active') {
    if (current === 'suspended') await service.setStatus(id, 'active', 'HR sync', auth);
    else await service.onboard(id, auth);
  } else if (wanted === 'suspended') await service.setStatus(id, 'suspended', 'HR sync', auth);
  else throw invalid('HR sync cannot move an existing account back to pending');
}

export const personSync: SyncAdapter = {
  fields: async () => personFields(),
  read: async (id, ctx) => (await readPeople(ctx, [id]))[0] ?? null,
  readMany: (ids, ctx) => readPeople(ctx, ids),
  list: async (opts, ctx) => {
    const p = await page(ctx, users, opts);
    return { items: await readPeople(ctx, p.ids), next: p.next };
  },
  matchKeys: ['employeeId'],
  findBy: async (_field, value, _opts, ctx) => {
    const rows = await ctx.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.employeeId, String(value)))
      .limit(2);
    if (rows.length > 1)
      throw conflict('More than one person has this employee ID. Resolve duplicates before syncing.');
    return rows.length ? (await readPeople(ctx, [rows[0]!.id]))[0]! : null;
  },
  write: async (input, opts, original) => {
    const { ctx, auth } = context(original, opts, true);
    const service = new UserService(ctx);
    const { departmentCode, status, ...profile } = input.values;
    const values: Record<string, unknown> = {
      ...profile,
      ...(departmentCode !== undefined ? { departmentId: await departmentId(ctx.db, departmentCode) } : {}),
    };
    await checkManager(ctx.db, input.id, values.managerId);
    if (input.id) {
      const [before] = await ctx.db.select().from(users).where(eq(users.id, input.id)).for('update');
      if (!before) throw new HttpError(404, ErrorCodes.NOT_FOUND, 'Person not found');
      await service.update(input.id, updateUserSchema.parse(values), auth);
      await lifecycle(service, input.id, before.status, status, auth);
      return { id: input.id };
    }
    if (typeof values.employeeId !== 'string' || !values.employeeId.trim())
      throw invalid('Employee ID is required');
    await ctx.db.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`hr-person:${values.employeeId}`}, 0))`,
    );
    const existing = await ctx.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.employeeId, values.employeeId))
      .limit(1);
    if (existing.length)
      throw conflict('Employee ID already exists. Set the profile match rule to employeeId.');
    const created = await service.create(
      createUserSchema.parse({ ...values, status: status === 'active' ? 'active' : 'pending' }),
      auth,
    );
    await lifecycle(service, created.id, created.status, status, auth);
    return { id: created.id };
  },
  idFromEvent: (event) => (event.payload as { userId?: string }).userId ?? null,
};

export const departmentSync: SyncAdapter = {
  fields: async () =>
    HR_DEPARTMENT_FIELDS.map((key) => ({
      key,
      label: `core.hrSync.fields.${key}`,
      type: key === 'parentId' ? 'parent' : 'string',
      required: key === 'code' || key === 'name',
      createOnly: key === 'code',
    })),
  read: async (id, ctx) => (await readDepartments(ctx, [id]))[0] ?? null,
  readMany: (ids, ctx) => readDepartments(ctx, ids),
  list: async (opts, ctx) => {
    const p = await page(ctx, departments, opts);
    return { items: await readDepartments(ctx, p.ids), next: p.next };
  },
  matchKeys: ['code'],
  findBy: async (_field, value, _opts, ctx) => {
    const [row] = await ctx.db
      .select({ id: departments.id })
      .from(departments)
      .where(eq(departments.code, String(value)));
    return row ? (await readDepartments(ctx, [row.id]))[0]! : null;
  },
  write: async (input, opts, original) => {
    const { ctx, auth } = context(original, opts, false);
    const service = new DirectoryService(ctx);
    const row = input.id
      ? await service.updateDepartment(input.id, updateDepartmentSchema.parse(input.values), auth)
      : await service.createDepartment(createDepartmentSchema.parse(input.values), auth);
    return { id: row.id };
  },
  idFromEvent: (event) => (event.payload as { departmentId?: string }).departmentId ?? null,
};
