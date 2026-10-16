import { hrDatabaseConfigSchema } from '@isbp/contracts';
import {
  auditLogs,
  dbConnections,
  departments,
  groupMembers,
  groups,
  outboxEvents,
  roleAssignments,
  roles,
  users,
} from '@isbp/db/schema';
import { services } from '@isbp/module-integrations/server';
import { profiles } from '@isbp/module-integrations/schema';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness, type Harness, type Session, PASSWORD } from './harness';

const API = '/api/v1/integrations';
const employeeQuery = 'select * from itest_hr.employees';
const departmentQuery = 'select * from itest_hr.departments';
let h: Harness;
let admin: Session;
let operator: Session;
let databaseId: string;
let connectionId: string;
let peopleProfile: string;
let departmentsProfile: string;
const exec = (statement: string) => h.kernel.db.execute(sql.raw(statement));
const hub = () => services(h.kernel.registry.context('integrations'));
const user = async (employeeId: string) =>
  (await h.kernel.db.select().from(users).where(eq(users.employeeId, employeeId)))[0]!;
const config = () => ({ databaseId, employeesQuery: employeeQuery, departmentsQuery: departmentQuery });

beforeAll(async () => {
  const before = process.env.ISBP_TEST_MODULES;
  process.env.ISBP_TEST_MODULES = 'integrations';
  try {
    h = await createHarness();
  } finally {
    if (before === undefined) delete process.env.ISBP_TEST_MODULES;
    else process.env.ISBP_TEST_MODULES = before;
  }
  admin = await h.login('admin');
  // An Integrations administrator can sync entities but may not change the authoritative HR source.
  const [role] = await h.kernel.db.select().from(roles).where(eq(roles.key, 'integrations-admin'));
  await h.kernel.db.insert(roleAssignments).values({ userId: h.ids.outsider, roleId: role!.id });
  await h.kernel.rbac.bump();
  operator = await h.login('outsider');
  await exec(`drop schema if exists itest_hr cascade; create schema itest_hr;
    create table itest_hr.employees ("employeeId" text, email text, username text, "displayName" text, "departmentCode" text, "managerId" text, status text);
    insert into itest_hr.employees values ('E01', 'staff@hr.test', 'hr.staff', 'HR Staff', 'HR-CHILD', 'E99', 'employed'), ('E99', 'boss@hr.test', 'hr.boss', 'HR Boss', 'HR-ROOT', null, 'active');
    create table itest_hr.departments (code text, name text, "parentId" text);
    insert into itest_hr.departments values ('HR-CHILD', 'HR child', 'HR-ROOT'), ('HR-ROOT', 'HR root', null);`);
  const url = new URL(process.env.DATABASE_URL!);
  const [db] = await h.kernel.db
    .insert(dbConnections)
    .values({
      key: 'hr-source',
      name: 'HR test source',
      engine: 'postgres',
      host: url.hostname,
      port: Number(url.port || 5432),
      database: url.pathname.slice(1),
      username: decodeURIComponent(url.username),
      passwordSealed: h.kernel.box.encrypt(decodeURIComponent(url.password)),
      options: { tls: 'off', ca: null, instanceName: null, domain: null },
      purposes: ['data'],
      readOnly: true,
      maxRows: 1000,
    })
    .returning();
  databaseId = db!.id;
}, 120_000);

afterAll(async () => {
  if (h) {
    await exec('drop schema if exists itest_hr cascade');
    await h.close();
  }
});

async function newProfile(type: 'employee' | 'department') {
  const entity = type === 'employee' ? 'core.person' : 'core.department';
  const match = type === 'employee' ? 'employeeId' : 'code';
  const mapping = await h.call(
    admin,
    'GET',
    `${API}/profiles/default-mapping?connectionId=${connectionId}&objectType=${type}&entity=${entity}`,
  );
  expect(mapping.status).toBe(200);
  const draft = {
    name: `HR ${type}`,
    connectionId,
    objectType: type,
    entity,
    matchRule: { local: match, remote: match },
    mappings: mapping.body.mappings,
    intervalMinutes: 0,
    conflictPolicy: 'remote',
  };
  const preview = await h.call(admin, 'POST', `${API}/profiles/preview`, draft);
  expect(preview.status, JSON.stringify(preview.body)).toBe(200);
  expect(await user('E01')).toBeUndefined();
  const created = await h.call(admin, 'POST', `${API}/profiles`, draft);
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  return created.body.id as string;
}

describe('configurable HR database sync', () => {
  it('enforces source configuration permissions and exposes the connector and adapters', async () => {
    const catalogue = await h.call(admin, 'GET', `${API}/connectors`);
    expect(catalogue.body.connectors.some((c: { type: string }) => c.type === 'core.hr-database')).toBe(true);
    expect(catalogue.body.entities.some((e: { entity: string }) => e.entity === 'core.person')).toBe(true);
    const draft = { name: 'HR test', type: 'core.hr-database', config: config() };
    expect((await h.call(operator, 'POST', `${API}/connections`, draft)).status).toBe(403);
    expect((await h.call(operator, 'POST', `${API}/connections/test`, draft)).status).toBe(403);
    const created = await h.call(admin, 'POST', `${API}/connections`, draft);
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    connectionId = created.body.id;
    expect(
      (await h.call(operator, 'PATCH', `${API}/connections/${connectionId}`, { config: config() })).status,
    ).toBe(403);
    const tested = await h.call(admin, 'POST', `${API}/connections/${connectionId}/test`);
    expect(tested.body.ok, JSON.stringify(tested.body)).toBe(true);
  });

  it('previews without writing and imports hierarchy, departments, active people and managers', async () => {
    departmentsProfile = await newProfile('department');
    peopleProfile = await newProfile('employee');
    expect((await hub().engine.runNow(departmentsProfile)).status).toBe('succeeded');
    const run = await hub().engine.runNow(peopleProfile);
    expect(run.status, JSON.stringify(run)).toBe('succeeded');
    const staff = await user('E01');
    const boss = await user('E99');
    expect(staff.status).toBe('active');
    expect(staff.managerId).toBe(boss.id);
    expect(staff.passwordHash).toBeNull();
    const [child] = await h.kernel.db.select().from(departments).where(eq(departments.code, 'HR-CHILD'));
    expect(staff.departmentId).toBe(child!.id);
    expect(child!.parentId).not.toBeNull();
    const audit = await h.kernel.db.select().from(auditLogs).where(eq(auditLogs.entityId, staff.id));
    expect(
      audit.some(
        (a) => (a.metadata as { source?: { connectionId?: string } }).source?.connectionId === connectionId,
      ),
    ).toBe(true);
    const repeat = await hub().engine.runNow(peopleProfile);
    expect(repeat.counts.created + repeat.counts.updated).toBe(0);
    expect(
      (await h.kernel.db.select().from(profiles).where(eq(profiles.id, peopleProfile)))[0]!.cursor,
    ).toBeNull();
  });

  it('keeps stable links across email changes and does not offboard missing rows', async () => {
    const before = await user('E01');
    await exec(
      `update itest_hr.employees set email = 'staff.new@hr.test', "displayName" = 'Renamed Staff' where "employeeId" = 'E01'`,
    );
    expect((await hub().engine.runNow(peopleProfile)).status).toBe('succeeded');
    expect((await user('E01')).id).toBe(before.id);
    expect((await user('E01')).email).toBe('staff.new@hr.test');
    await exec(`delete from itest_hr.employees where "employeeId" = 'E01'`);
    expect((await hub().engine.runNow(peopleProfile)).status).toBe('succeeded');
    expect((await user('E01')).status).toBe('active');
    await exec(
      `insert into itest_hr.employees values ('E01', 'staff.new@hr.test', 'hr.staff', 'Renamed Staff', 'HR-CHILD', 'E99', 'employed')`,
    );
  });

  it('offboards explicit leavers with session, group and role cleanup; supports rehire', async () => {
    const staff = await user('E01');
    expect(
      (
        await h.call(admin, 'POST', `/api/v1/users/${staff.id}/password`, {
          password: PASSWORD,
          mustChangePassword: false,
        })
      ).status,
    ).toBe(200);
    const session = await h.login('hr.staff');
    const [group] = await h.kernel.db
      .insert(groups)
      .values({ key: 'hr-test-group', name: 'HR test group' })
      .returning();
    const [role] = await h.kernel.db.select().from(roles).where(eq(roles.key, 'integrations-viewer'));
    await h.kernel.db.insert(groupMembers).values({ groupId: group!.id, userId: staff.id });
    await h.kernel.db.insert(roleAssignments).values({ userId: staff.id, roleId: role!.id });
    await exec(`update itest_hr.employees set status = 'terminated' where "employeeId" = 'E01'`);
    const run = await hub().engine.runNow(peopleProfile, 'schedule');
    expect(run.status, JSON.stringify(run)).toBe('succeeded');
    expect((await user('E01')).status).toBe('offboarded');
    expect((await h.call(session, 'GET', '/api/v1/me')).status).toBe(401);
    expect(
      await h.kernel.db.select().from(groupMembers).where(eq(groupMembers.userId, staff.id)),
    ).toHaveLength(0);
    expect(
      await h.kernel.db.select().from(roleAssignments).where(eq(roleAssignments.userId, staff.id)),
    ).toHaveLength(0);
    expect(
      (
        await h.kernel.db.select().from(outboxEvents).where(eq(outboxEvents.name, 'core.user.offboarded'))
      ).some((e) => (e.payload as { userId: string }).userId === staff.id),
    ).toBe(true);
    await exec(`update itest_hr.employees set status = 'employed' where "employeeId" = 'E01'`);
    expect((await hub().engine.runNow(peopleProfile)).status).toBe('succeeded');
    expect((await user('E01')).status).toBe('active');
    expect(
      await h.kernel.db.select().from(roleAssignments).where(eq(roleAssignments.userId, staff.id)),
    ).toHaveLength(0);
  });

  it('refuses truncated, duplicate and unknown-status snapshots before changing people', async () => {
    const original = await user('E01');
    await exec(
      `update itest_hr.employees set "displayName" = 'Must not apply', status = 'unknown' where "employeeId" = 'E01'`,
    );
    expect((await hub().engine.runNow(peopleProfile)).status).toBe('failed');
    expect((await user('E01')).displayName).toBe(original.displayName);
    await exec(
      `update itest_hr.employees set status = 'active', "displayName" = 'Renamed Staff' where "employeeId" = 'E01'; insert into itest_hr.employees select * from itest_hr.employees where "employeeId" = 'E01'`,
    );
    expect((await hub().engine.runNow(peopleProfile)).status).toBe('failed');
    await exec(
      `delete from itest_hr.employees where ctid not in (select min(ctid) from itest_hr.employees group by "employeeId")`,
    );
    const limited = await h.call(admin, 'POST', `${API}/connections/test`, {
      type: 'core.hr-database',
      config: { ...config(), maxRows: 1 },
    });
    expect(limited.status, JSON.stringify(limited)).toBe(422);
    expect(limited.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('only queries declared read-only Data connections and refuses SQL writes', async () => {
    const connector = h.kernel.registry.context('core').connectors.open('core.hr-database', {
      id: connectionId,
      config: hrDatabaseConfigSchema.parse({
        ...config(),
        employeesQuery: 'delete from itest_hr.employees returning *',
      }),
      secrets: {},
    });
    await expect(connector.test()).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    const updated = await h.call(admin, 'PATCH', `/api/v1/databases/${databaseId}`, { readOnly: false });
    expect(updated.status).toBe(200);
    const run = await hub().engine.runNow(peopleProfile);
    expect(run.status).toBe('failed');
    await h.call(admin, 'PATCH', `/api/v1/databases/${databaseId}`, { readOnly: true });
  });

  it('rolls back service writes, audit and events with the hub transaction', async () => {
    const ctx = h.kernel.registry.context('integrations');
    const auth = ctx.ai.agent();
    const staff = await user('E01');
    const before = await h.kernel.db.select().from(auditLogs).where(eq(auditLogs.entityId, staff.id));
    await expect(
      h.kernel.db.transaction(async (tx) => {
        await ctx.sync.write(
          'core.person',
          { id: staff.id, values: { displayName: 'Rollback', status: 'offboarded' } },
          {
            auth,
            tx: tx as unknown as typeof ctx.db,
            source: {
              connectionId,
              connectionName: 'HR test',
              connector: 'core.hr-database',
              remoteRef: 'E01',
            },
          },
        );
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    expect((await user('E01')).displayName).toBe(staff.displayName);
    expect((await user('E01')).status).toBe(staff.status);
    expect(await h.kernel.db.select().from(auditLogs).where(eq(auditLogs.entityId, staff.id))).toHaveLength(
      before.length,
    );
  });

  it('rejects ambiguous existing employee IDs instead of choosing an account', async () => {
    await h.kernel.db.insert(users).values({
      username: 'duplicate.one',
      email: 'duplicate.one@hr.test',
      displayName: 'One',
      employeeId: 'DUPLICATE',
    });
    await h.kernel.db.insert(users).values({
      username: 'duplicate.two',
      email: 'duplicate.two@hr.test',
      displayName: 'Two',
      employeeId: 'DUPLICATE',
    });
    await expect(
      h.kernel.registry.context('core').sync.findBy('core.person', 'employeeId', 'DUPLICATE'),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    await h.kernel.db.delete(users).where(and(eq(users.employeeId, 'DUPLICATE')));
  });

  it('fails a scheduled job on partial imports so dependent jobs cannot proceed', async () => {
    await exec(`update itest_hr.employees set "departmentCode" = 'MISSING' where "employeeId" = 'E01'`);
    try {
      await expect(
        h.kernel.registry.context('core').taskTypes.run(
          'integrations.sync',
          { profileId: peopleProfile },
          {
            runId: 'hr-job-run',
            jobId: 'hr-job',
            attempt: 1,
            scheduledFor: new Date(),
            lastSuccessAt: null,
            signal: new AbortController().signal,
            log: () => undefined,
          },
        ),
      ).rejects.toMatchObject({ code: 'INVALID_STATE' });
    } finally {
      await exec(`update itest_hr.employees set "departmentCode" = 'HR-CHILD' where "employeeId" = 'E01'`);
    }
    expect((await hub().engine.runNow(peopleProfile)).status).toBe('succeeded');
  });

  it('imports pending accounts and preserves existing lifecycle when status sync is off', async () => {
    const changed = await h.call(admin, 'PATCH', `${API}/connections/${connectionId}`, {
      config: { ...config(), syncStatus: false },
    });
    expect(changed.status).toBe(200);
    const mappings = await h.call(
      admin,
      'GET',
      `${API}/profiles/default-mapping?connectionId=${connectionId}&objectType=employee&entity=core.person`,
    );
    expect(mappings.body.mappings.some((m: { local: string }) => m.local === 'status')).toBe(false);
    expect(
      (await h.call(admin, 'PATCH', `${API}/profiles/${peopleProfile}`, { mappings: mappings.body.mappings }))
        .status,
    ).toBe(200);
    await exec(
      `update itest_hr.employees set status = 'terminated' where "employeeId" = 'E01'; insert into itest_hr.employees values ('E02', 'pending@hr.test', 'hr.pending', 'Pending employee', null, null, 'unmapped')`,
    );
    expect((await hub().engine.runNow(peopleProfile)).status).toBe('succeeded');
    expect((await user('E01')).status).toBe('active');
    expect((await user('E02')).status).toBe('pending');
  });
});
