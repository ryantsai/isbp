import { notifications, roles, users } from '@isbp/db/schema';
import { and, eq, isNull } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashPassword } from '../../src/kernel/passwords';
import { createHarness, type Harness, type LooseJson, PASSWORD, type Session } from './harness';

/*
 * The shell's personal side: the sidebar a person gets (participant pages out, the Administration hub for the people
 * who administer), My work (every module's `manifest.work` for the caller only) and approvals that open directly.
 */

let h: Harness;
let admin: Session;
let worker: Session;
let lead: Session;
let ids: { worker: string; lead: string; owner: string };

const roleId = async (key: string) =>
  (await h.kernel.db.select({ id: roles.id }).from(roles).where(eq(roles.key, key)))[0]!.id;

async function mkUser(username: string, managerId: string | null = null) {
  const [u] = await h.kernel.db
    .insert(users)
    .values({
      email: `${username}@test.example`,
      username,
      displayName: username,
      passwordHash: await hashPassword(PASSWORD),
      managerId,
    })
    .returning();
  return u!.id;
}

type Item = { id: string; label: string; href: string; children?: Item[]; tabs?: Item[]; area?: string };
const flat = (items: Item[]): Item[] =>
  items.flatMap((i) => [i, ...flat(i.children ?? []), ...flat(i.tabs ?? [])]);

beforeAll(async () => {
  h = await createHarness();
  admin = await h.login('admin');
  const leadId = await mkUser('lead', h.ids.admin);
  const workerId = await mkUser('worker', leadId);
  const owner = await mkUser('owner');
  ids = { worker: workerId, lead: leadId, owner };
  worker = await h.login('worker');
  lead = await h.login('lead');
});
afterAll(async () => h?.close());

describe('navigation', () => {
  it('gives a person without staff roles their own pages only', async () => {
    const nav = (await h.call(worker, 'GET', '/api/v1/platform/navigation')).body as {
      items: Item[];
      admin: Item[];
    };
    const hrefs = nav.items.map((i) => i.href);
    expect(hrefs.slice(0, 3)).toEqual(['/', '/my-work', '/requests']);
    expect(hrefs).toEqual(expect.arrayContaining(['/itam/mine', '/knowledge']));
    // Participant pages (they hold the self-service permissions by default) aren't in the sidebar…
    const all = flat(nav.items).map((i) => i.href);
    for (const href of [
      '/isms/stocktakes',
      '/isms/accounts',
      '/dbaccess/reviews',
      '/projects',
      '/admin/departments',
    ])
      expect(all, href).not.toContain(href);
    // …and nothing to administer means no Administration row.
    expect(nav.admin).toEqual([]);
    expect(hrefs).not.toContain('/admin');
  });

  it('puts administration behind one row, with the hub entries by area', async () => {
    const nav = (await h.call(admin, 'GET', '/api/v1/platform/navigation')).body as {
      items: Item[];
      admin: Item[];
    };
    expect(nav.items.at(-1)).toMatchObject({ id: 'core.admin', href: '/admin' });
    expect(nav.items.some((i) => i.href.startsWith('/admin/'))).toBe(false);
    const areas = Object.fromEntries(nav.admin.map((a) => [a.href.split('?')[0], a.area]));
    expect(areas).toMatchObject({
      '/admin/users': 'people',
      '/admin/workflows': 'automation',
      '/itsm/settings': 'modules',
      '/integrations': 'integrations',
      '/admin/audit': 'platform',
    });
    // Areas are groups of their pages; other modules join them (configuration items in the service desk).
    const desk = nav.items.find((i) => i.id === 'itsm.service-desk')!;
    expect(desk.children!.map((c) => c.href)).toEqual(
      expect.arrayContaining(['/itsm', '/itsm/problems', '/cmdb']),
    );
  });

  it('shows Projects only to members (or the people who run projects)', async () => {
    const before = flat((await h.call(worker, 'GET', '/api/v1/platform/navigation')).body.items as Item[]);
    expect(before.map((i) => i.href)).not.toContain('/projects');
    const created = await h.call(admin, 'POST', '/api/v1/projects/projects', {
      key: 'NAVT',
      name: 'Navigation test',
    });
    expect(created.status).toBe(201);
    const added = await h.call(admin, 'POST', '/api/v1/projects/projects/NAVT/members', {
      userId: ids.worker,
      role: 'member',
    });
    expect(added.status).toBeLessThan(300);
    const after = flat((await h.call(worker, 'GET', '/api/v1/platform/navigation')).body.items as Item[]);
    expect(after.map((i) => i.href)).toContain('/projects');
  });
});

describe('My work', () => {
  let instanceId: string;

  it('lists the approval waiting for the manager, linked to the decision, and counts it in the badge', async () => {
    const editor = await roleId('announcements-editor');
    await h.call(admin, 'PUT', `/api/v1/roles/${editor}/request-settings`, {
      requestable: true,
      riskLevel: 'low',
      ownerId: ids.owner,
      maxDurationDays: 30,
      requestWorkflowId: null,
    });
    const created = await h.call(worker, 'POST', '/api/v1/access-requests', {
      roleId: editor,
      durationDays: 14,
      justification: 'I publish maintenance notices for my team.',
    });
    expect(created.status).toBe(201);
    instanceId = created.body.workflow.id;

    const work = (await h.call(lead, 'GET', '/api/v1/me/work')).body as LooseJson;
    const approvals = work.sections.find((s: LooseJson) => s.source === 'core.approvals');
    expect(approvals).toMatchObject({ kind: 'approval', count: 1, error: false, href: '/approvals' });
    expect(approvals.items[0].href).toMatch(/^\/approvals\?task=[0-9a-f-]{36}$/);
    expect(work.total).toBeGreaterThanOrEqual(1);
    expect((await h.call(lead, 'GET', '/api/v1/me/badges')).body.work).toBe(work.total);
    expect((await h.call(lead, 'GET', '/api/v1/me/work/counts')).body.byKind.approval).toBe(1);

    // Nobody else sees it: the requester has nothing to decide.
    const mine = (await h.call(worker, 'GET', '/api/v1/me/work')).body as LooseJson;
    expect(mine.sections.find((s: LooseJson) => s.source === 'core.approvals')).toBeUndefined();

    // The notification opens the same decision.
    const [note] = await h.kernel.db
      .select()
      .from(notifications)
      .where(and(eq(notifications.userId, ids.lead), eq(notifications.type, 'core.approval.assigned')));
    expect(note!.href).toBe(approvals.items[0].href);
  });

  it('opens one task by id, and marks its notifications read once it is decided', async () => {
    const task = (await h.call(lead, 'GET', '/api/v1/me/work')).body.sections.find(
      (s: LooseJson) => s.source === 'core.approvals',
    ).items[0];
    const one = await h.call(lead, 'GET', `/api/v1/me/approvals?task=${task.id}`);
    expect(one.body.items).toHaveLength(1);
    expect(one.body.items[0].instance.id).toBe(instanceId);
    // Someone else's task id finds nothing.
    expect((await h.call(worker, 'GET', `/api/v1/me/approvals?task=${task.id}`)).body.items).toHaveLength(0);

    const decided = await h.call(lead, 'POST', `/api/v1/approvals/${task.id}/approve`, {});
    expect(decided.status).toBe(200);
    // Still findable (decided) for the "already decided" view.
    const after = await h.call(lead, 'GET', `/api/v1/me/approvals?task=${task.id}`);
    expect(after.body.items[0].task.status).toBe('approved');
    const unread = await h.kernel.db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, ids.lead),
          eq(notifications.type, 'core.approval.assigned'),
          isNull(notifications.readAt),
        ),
      );
    expect(unread).toHaveLength(0);
    const work = (await h.call(lead, 'GET', '/api/v1/me/work')).body as LooseJson;
    expect(work.sections.find((s: LooseJson) => s.source === 'core.approvals')).toBeUndefined();
  });

  it('shows project tasks without counting them in the badge', async () => {
    const task = await h.call(admin, 'POST', '/api/v1/projects/projects/NAVT/tasks', {
      title: 'Check the navigation',
      assigneeId: ids.worker,
    });
    expect(task.status).toBe(201);
    const work = (await h.call(worker, 'GET', '/api/v1/me/work')).body as LooseJson;
    const tasks = work.sections.find((s: LooseJson) => s.source === 'projects.tasks');
    expect(tasks).toMatchObject({ kind: 'task', count: 1 });
    expect(tasks.items[0].href).toMatch(/^\/projects\/tasks\/NAVT-\d+$/);
    expect(work.tasks).toBe(1);
    expect((await h.call(worker, 'GET', '/api/v1/me/badges')).body.work).toBe(work.total);
  });
});

describe('search', () => {
  it('finds a request by its number for the people who may read it', async () => {
    const reqs = (await h.call(worker, 'GET', '/api/v1/me/requests?pageSize=1')).body as LooseJson;
    const reference = reqs.items[0]?.reference as string | undefined;
    if (!reference?.startsWith('REQ-')) return;
    const hits = (await h.call(worker, 'GET', `/api/v1/platform/search?q=${reference}`)).body
      .hits as LooseJson[];
    expect(hits.find((x) => x.type === 'request')).toMatchObject({
      exact: true,
      href: `/requests/${reference}`,
    });
    const outsider = await h.login('outsider');
    const none = (await h.call(outsider, 'GET', `/api/v1/platform/search?q=${reference}`)).body
      .hits as LooseJson[];
    expect(none.find((x) => x.type === 'request')).toBeUndefined();
  });
});
