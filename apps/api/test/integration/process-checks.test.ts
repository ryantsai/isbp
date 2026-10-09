/**
 * Building a process in the form builder: "Before you publish" (`POST /forms/checks` — can the audience see the records
 * a record field offers, do the approval's groups and roles hold anybody), "Who will approve this?" for the unsaved
 * questions and approval (`POST /forms/:id/preview`, as a chosen person), and a live form only switching to an
 * approval that can run.
 */
import { groupMembers, groups, roleAssignments, roles, users } from '@isbp/db/schema';
import type { WorkflowGraph } from '@isbp/sdk/server';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashPassword } from '../../src/kernel/passwords';
import { createHarness, type Harness, PASSWORD, type Session } from './harness';

let h: Harness;
let admin: Session;
const ids: Record<string, string> = {};

async function mkUser(username: string, managerId?: string) {
  const [u] = await h.kernel.db
    .insert(users)
    .values({
      email: `${username}@test.example`,
      username,
      displayName: username,
      passwordHash: await hashPassword(PASSWORD),
      managerId: managerId ?? null,
    })
    .returning();
  return u!.id;
}

async function mkGroup(key: string, members: string[]) {
  const [g] = await h.kernel.db
    .insert(groups)
    .values({ key, name: `${key} team` })
    .returning();
  for (const userId of members) await h.kernel.db.insert(groupMembers).values({ groupId: g!.id, userId });
  return g!.id;
}

const roleId = async (key: string) =>
  (await h.kernel.db.select({ id: roles.id }).from(roles).where(eq(roles.key, key)))[0]!.id;

const managerStep: WorkflowGraph = {
  steps: [
    {
      id: 'mgr',
      type: 'approval',
      name: { en: 'Manager approval' },
      approvers: [{ type: 'manager' }],
      mode: 'any',
    },
  ],
};

beforeAll(async () => {
  h = await createHarness();
  admin = await h.login('admin');
  ids.boss = await mkUser('pc-boss');
  ids.worker = await mkUser('pc-worker', ids.boss);
  ids.loner = await mkUser('pc-loner');
  ids.ops = await mkGroup('pc-ops', [ids.worker]);
  ids.empty = await mkGroup('pc-empty', []);
});
afterAll(() => h?.close());

describe('before you publish', () => {
  it('says who can pick a record type, by audience', async () => {
    const everyone = await h.call(admin, 'POST', '/api/v1/forms/checks', {
      audience: { type: 'everyone' },
      recordTypes: ['cmdb.ci', 'nope.thing'],
    });
    expect(everyone.status).toBe(200);
    expect(everyone.body.records).toHaveLength(1);
    const ci = everyone.body.records[0];
    expect(ci).toMatchObject({ type: 'cmdb.ci', reach: 'some', groupsWithout: [] });
    // The roles that would help are named (the CMDB viewer among them).
    expect(ci.roles.map((r: { key: string }) => r.key)).toEqual(expect.arrayContaining(['cmdb-viewer']));

    const byGroup = await h.call(admin, 'POST', '/api/v1/forms/checks', {
      audience: { type: 'groups', groupKeys: ['pc-ops'] },
      recordTypes: ['cmdb.ci'],
    });
    expect(byGroup.body.records[0]).toMatchObject({ reach: 'some', groupsWithout: [{ key: 'pc-ops' }] });

    // The group gets the viewer role: everyone in the audience can pick CIs.
    await h.kernel.db
      .insert(roleAssignments)
      .values({ roleId: await roleId('cmdb-viewer'), groupId: ids.ops });
    const covered = await h.call(admin, 'POST', '/api/v1/forms/checks', {
      audience: { type: 'groups', groupKeys: ['pc-ops'] },
      recordTypes: ['cmdb.ci'],
    });
    expect(covered.body.records[0]).toMatchObject({ reach: 'all', groupsWithout: [] });
  });

  it('counts the members of approver groups and the holders of approver roles', async () => {
    const res = await h.call(admin, 'POST', '/api/v1/forms/checks', {
      audience: { type: 'everyone' },
      groupKeys: ['pc-ops', 'pc-empty'],
      roleKeys: ['cmdb-viewer', 'platform-admin'],
    });
    expect(res.status).toBe(200);
    const group = (key: string) => res.body.groups.find((g: { key: string }) => g.key === key);
    expect(group('pc-ops').members).toBe(1);
    expect(group('pc-empty').members).toBe(0);
    const role = (key: string) => res.body.roles.find((r: { key: string }) => r.key === key);
    // cmdb-viewer is held through pc-ops (one member); the admin holds platform-admin directly.
    expect(role('cmdb-viewer').holders).toBe(1);
    expect(role('platform-admin').holders).toBeGreaterThanOrEqual(1);
  });

  it('needs the forms permission', async () => {
    const worker = await h.login('pc-worker');
    const res = await h.call(worker, 'POST', '/api/v1/forms/checks', { audience: { type: 'everyone' } });
    expect(res.status).toBe(403);
  });
});

describe('building a process', () => {
  let formId = '';
  const draft = {
    elements: [{ id: 'why', key: 'why', type: 'text', label: { en: 'Why' }, required: true }],
  };

  beforeAll(async () => {
    const form = await h.call(admin, 'POST', '/api/v1/forms', {
      key: 'pc-purchase',
      name: { en: 'Purchase' },
    });
    formId = form.body.id;
    await h.call(admin, 'PATCH', `/api/v1/forms/${formId}`, { draft });
  });

  it('previews the unsaved approval as a chosen person', async () => {
    const asWorker = await h.call(admin, 'POST', `/api/v1/forms/${formId}/preview`, {
      data: { why: 'A new licence' },
      draft,
      graph: managerStep,
      asUserId: ids.worker,
    });
    expect(asWorker.status).toBe(200);
    expect(asWorker.body.steps).toEqual([
      expect.objectContaining({
        id: 'mgr',
        outcome: 'ask',
        people: [expect.objectContaining({ id: ids.boss })],
      }),
    ]);

    const asLoner = await h.call(admin, 'POST', `/api/v1/forms/${formId}/preview`, {
      data: {},
      draft,
      graph: managerStep,
      asUserId: ids.loner,
    });
    expect(asLoner.body.steps[0]).toMatchObject({ outcome: 'reject', people: [] });

    const none = await h.call(admin, 'POST', `/api/v1/forms/${formId}/preview`, {
      data: {},
      draft,
      graph: null,
    });
    expect(none.body.steps).toEqual([]);
  });

  it('a live form only switches to an approval that is published', async () => {
    expect((await h.call(admin, 'POST', `/api/v1/forms/${formId}/publish`)).status).toBe(200);
    const wf = await h.call(admin, 'POST', '/api/v1/workflows', {
      name: 'Purchase approval',
      triggerKey: 'core.form-submission',
    });
    await h.call(admin, 'PATCH', `/api/v1/workflows/${wf.body.id}`, { draft: managerStep });

    const early = await h.call(admin, 'PATCH', `/api/v1/forms/${formId}`, {
      workflowDefinitionId: wf.body.id,
    });
    expect(early.status).toBe(409);
    expect(early.body.error.code).toBe('WORKFLOW_NOT_CONFIGURED');

    expect((await h.call(admin, 'POST', `/api/v1/workflows/${wf.body.id}/publish`)).status).toBe(200);
    const linked = await h.call(admin, 'PATCH', `/api/v1/forms/${formId}`, {
      workflowDefinitionId: wf.body.id,
    });
    expect(linked.status).toBe(200);
    expect(linked.body.workflow).toMatchObject({ id: wf.body.id });
  });
});
