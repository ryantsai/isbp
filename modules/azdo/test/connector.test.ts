import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { gitStatusSchema } from '@isbp/module-alm/contracts';
import { REPO_PROVIDERS } from '@isbp/module-alm/model';
import { TASK_PRIORITIES, TASK_STATUSES, TASK_TYPES } from '@isbp/module-projects/model';
import { ErrorCodes, type HttpError, type RemoteRecord } from '@isbp/sdk/server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { azdoConfigSchema } from '../src/contracts';
import { defaultMapping, PROCESSES, workItemCatalog } from '../src/model';
import { serverConnector as c } from '../src/server/connector';
import { again, connFor, eventually, type Mock, startMock } from './helpers';

let mock: Mock;
let ids: { erp: string; network: string; zta: string };

const REPO_KEYS = [
  'name',
  'url',
  'provider',
  'defaultBranch',
  'lastCommitSha',
  'lastCommitAt',
  'lastCommitMessage',
  'lastCommitAuthor',
  'branches',
  'pullRequests',
];
/** Field keys of the ISBP sync adapters (docs/architecture.md §12.8). */
const TASK_KEYS = [
  'type',
  'title',
  'description',
  'status',
  'priority',
  'assignee',
  'parent',
  'milestone',
  'startDate',
  'dueDate',
  'estimateHours',
  'remainingHours',
  'labels',
];
const PROJECT_KEYS = ['name', 'description', 'startDate', 'targetDate', 'status'];

async function rejects(p: Promise<unknown>): Promise<HttpError> {
  try {
    await p;
  } catch (err) {
    return err as HttpError;
  }
  throw new Error('expected a rejection');
}

beforeAll(async () => {
  mock = await startMock();
  const scopes = await c.scopes!(connFor(mock), 'work-item');
  const byName = Object.fromEntries(scopes.map((s) => [s.name, s.id]));
  ids = { erp: byName.ERP!, network: byName.Network!, zta: byName['Zero Trust rollout']! };
});

afterAll(async () => {
  await mock?.close();
});

describe('connection', () => {
  it('accepts http and https collection URLs, with or without /tfs and a port', () => {
    for (const url of [
      'https://ado.contoso.local/tfs/DefaultCollection',
      'https://ado.contoso.local:8443/DefaultCollection',
      'http://ado.contoso.local:8080/tfs/DefaultCollection',
      'http://localhost:4100/ado/DefaultCollection',
    ])
      expect(azdoConfigSchema.safeParse({ collectionUrl: url }).success, url).toBe(true);
    for (const url of [
      'ado.contoso.local/tfs',
      'ftp://ado.contoso.local/tfs',
      'https://svc:secret@ado.contoso.local/tfs/DefaultCollection',
      'https://ado.contoso.local/tfs/DefaultCollection?x=1',
    ])
      expect(azdoConfigSchema.safeParse({ collectionUrl: url }).success, url).toBe(false);
    expect(azdoConfigSchema.parse({ collectionUrl: 'https://a.example/tfs/C' }).apiVersion).toBe('7.2');
    expect(
      azdoConfigSchema.safeParse({ collectionUrl: 'https://a.example/C', apiVersion: '5.0' }).success,
    ).toBe(true);
    expect(
      azdoConfigSchema.safeParse({ collectionUrl: 'https://a.example/C', apiVersion: '7.3' }).success,
    ).toBe(false);
  });

  it('calls only the collection host', () => {
    const config = azdoConfigSchema.parse({
      collectionUrl: 'https://ado.contoso.local:8443/tfs/DefaultCollection/',
    });
    expect(c.hosts(config)).toEqual(['ado.contoso.local']);
  });

  it('signs in with the token and says where and as whom', async () => {
    const conn = connFor(mock);
    const result = await c.test(conn);
    expect(result.ok).toBe(true);
    expect(result.account).toContain('DefaultCollection');
    expect(result.account).toContain('ISBP Integration');
    expect(result.account).toContain('3 team projects');
    const auth = conn.calls[0]!;
    // Azure DevOps Server (2025+) serves 7.2 as previews: asked as one, without a failed first try.
    expect(auth.url).toContain('api-version=7.2-preview');
    expect(conn.calls.filter((x) => x.url.includes('_apis/projects'))).toHaveLength(1);
  });

  it('maps a refused token to REMOTE_AUTH_FAILED', async () => {
    const err = await rejects(c.test(connFor(mock, { pat: 'wrong-token' })));
    expect(err.statusCode).toBe(502);
    expect(err.code).toBe(ErrorCodes.REMOTE_AUTH_FAILED);
    expect(JSON.stringify(err.details)).not.toContain('wrong-token');
  });

  it('maps throttling to REMOTE_RATE_LIMITED with the Retry-After seconds', async () => {
    await mock.control('POST', '/ado/rate-limit', { requests: 1, retryAfter: 17 });
    const err = await rejects(c.scopes!(connFor(mock), 'work-item'));
    expect(err.statusCode).toBe(429);
    expect(err.code).toBe(ErrorCodes.REMOTE_RATE_LIMITED);
    expect((err.details as { retryAfterSeconds: number }).retryAfterSeconds).toBe(17);
    // The toggle refused one request; the next goes through.
    expect(await c.scopes!(connFor(mock), 'work-item')).toHaveLength(3);
  });

  it('lists team projects as scopes', async () => {
    const scopes = await c.scopes!(connFor(mock), 'repository');
    expect(scopes.map((s) => s.name)).toEqual(['ERP', 'Network', 'Zero Trust rollout']);
    expect(await c.scopes!(connFor(mock), 'project')).toEqual([]);
  });

  it('refuses unknown objects and unknown team projects', async () => {
    expect((await rejects(c.fields(connFor(mock), 'pipeline'))).statusCode).toBe(404);
    const err = await rejects(
      c.changes(connFor(mock), 'work-item', { scope: 'Nope', cursor: null, limit: 10 }),
    );
    expect(err.code).toBe(ErrorCodes.REMOTE_REJECTED);
    expect(
      (await rejects(c.changes(connFor(mock), 'work-item', { scope: null, cursor: null, limit: 10 }))).code,
    ).toBe(ErrorCodes.VALIDATION_FAILED);
  });
});

describe('fields', () => {
  const keys = (f: { key: string }[]) => f.map((x) => x.key);
  const choices = (f: { key: string; choices?: { value: string }[] }[], key: string) =>
    f.find((x) => x.key === key)?.choices?.map((x) => x.value);

  it('reads the Agile project’s types, states and custom fields', async () => {
    const fields = await c.fields(connFor(mock), 'work-item', ids.erp);
    expect(choices(fields, 'System.WorkItemType')).toEqual([
      'Epic',
      'Feature',
      'User Story',
      'Task',
      'Bug',
      'Issue',
    ]);
    expect(choices(fields, 'System.State')).toEqual(['New', 'Active', 'Resolved', 'Closed', 'Removed']);
    expect(choices(fields, 'Microsoft.VSTS.Common.Priority')).toEqual(['1', '2', '3', '4']);
    expect(keys(fields)).toEqual(
      expect.arrayContaining([
        'System.Title',
        'System.Description',
        'System.AssignedTo',
        'System.Tags',
        'Microsoft.VSTS.Scheduling.OriginalEstimate',
        'Microsoft.VSTS.Scheduling.RemainingWork',
        'Microsoft.VSTS.Scheduling.StoryPoints',
        'Microsoft.VSTS.Scheduling.TargetDate',
        'Microsoft.VSTS.TCM.ReproSteps',
        'System.IterationPath',
        'parent',
      ]),
    );
    expect(fields.find((f) => f.key === 'Custom.CostCenter')).toEqual({
      key: 'Custom.CostCenter',
      label: 'Cost Center',
      type: 'string',
    });
    expect(fields.find((f) => f.key === 'System.WorkItemType')).toMatchObject({
      required: true,
      createOnly: true,
    });
    expect(fields.find((f) => f.key === 'parent')).toMatchObject({ type: 'parent' });
    expect(fields.find((f) => f.key === 'System.CreatedDate')).toMatchObject({ readOnly: true });
  });

  it('reads the Basic and Scrum projects’ own types and states', async () => {
    const basic = await c.fields(connFor(mock), 'work-item', ids.network);
    expect(choices(basic, 'System.WorkItemType')).toEqual(['Epic', 'Issue', 'Task']);
    expect(choices(basic, 'System.State')).toEqual(['To Do', 'Doing', 'Done']);
    expect(keys(basic)).not.toContain('Microsoft.VSTS.Scheduling.OriginalEstimate');
    expect(keys(basic)).not.toContain('Custom.CostCenter');
    const scrum = await c.fields(connFor(mock), 'work-item', 'Zero Trust rollout');
    expect(choices(scrum, 'System.WorkItemType')).toContain('Product Backlog Item');
    expect(choices(scrum, 'System.State')).toEqual([
      'New',
      'In Progress',
      'Done',
      'Removed',
      'Approved',
      'Committed',
      'To Do',
      'Open',
      'Closed',
    ]);
  });

  it('describes the system processes without a scope, and projects and repositories', async () => {
    const generic = await c.fields(connFor(mock), 'work-item');
    expect(choices(generic, 'System.WorkItemType')).toEqual(
      expect.arrayContaining(['User Story', 'Product Backlog Item', 'Requirement']),
    );
    expect(choices(generic, 'System.WorkItemType')).not.toContain('Test Case');
    expect(keys(await c.fields(connFor(mock), 'repository'))).toEqual(REPO_KEYS);
    expect(keys(await c.fields(connFor(mock), 'project'))).toEqual([
      'name',
      'description',
      'state',
      'visibility',
      'lastUpdateTime',
    ]);
  });

  it('caches types per connection', async () => {
    const conn = connFor(mock);
    await c.fields(conn, 'work-item', ids.erp);
    const before = conn.calls.length;
    await c.fields(again(conn), 'work-item', ids.erp);
    expect(conn.calls.length).toBe(before);
  });
});

describe('team projects', () => {
  it('pages through projects by last update', async () => {
    const conn = connFor(mock);
    const first = await c.changes(conn, 'project', { cursor: null, limit: 2 });
    expect(first.items.map((r) => r.title)).toEqual(['ERP', 'Network']);
    expect(first.hasMore).toBe(true);
    const second = await c.changes(again(conn), 'project', { cursor: first.cursor, limit: 2 });
    expect(second.items.map((r) => r.title)).toEqual(['Zero Trust rollout']);
    expect(second.hasMore).toBe(false);
    const third = await c.changes(again(conn), 'project', { cursor: second.cursor, limit: 2 });
    expect(third).toEqual({ items: [], cursor: second.cursor, hasMore: false });
    const erp = first.items[0]!;
    expect(erp).toMatchObject({ id: ids.erp, ref: 'ERP', url: `${mock.collectionUrl}/ERP` });
    expect(erp.values).toMatchObject({ name: 'ERP', state: 'wellFormed', visibility: 'private' });
    expect(await c.get(conn, 'project', ids.zta)).toMatchObject({ title: 'Zero Trust rollout' });
    expect(await c.get(conn, 'project', '00000000-0000-4000-a000-000000000000')).toBeNull();
  });
});

describe('work items', () => {
  beforeEach(async () => {
    await mock.control('POST', '/reset');
  });

  async function feed(scope: string, limit: number, cursor: string | null = null) {
    const conn = connFor(mock);
    const seen: RemoteRecord[] = [];
    for (let i = 0; i < 100; i++) {
      const page = await c.changes(again(conn), 'work-item', { scope, cursor, limit });
      seen.push(...page.items);
      cursor = page.cursor;
      if (!page.hasMore) break;
    }
    return { seen, cursor };
  }

  it('feeds every work item of the project once, oldest first, across pages', async () => {
    const { seen } = await feed(ids.erp, 3);
    const got = seen.map((r) => Number(r.id));
    expect(new Set(got).size).toBe(got.length);
    expect(got.sort((a, b) => a - b)).toEqual(Array.from({ length: 26 }, (_, i) => 101 + i));
    for (let i = 1; i < seen.length; i++) {
      const [a, b] = [seen[i - 1]!, seen[i]!];
      expect(a.updatedAt < b.updatedAt || (a.updatedAt === b.updatedAt && Number(a.id) < Number(b.id))).toBe(
        true,
      );
    }
    expect(seen.every((r) => r.scope === ids.erp)).toBe(true);
  });

  it('continues equal change times by id, without skipping or repeating', async () => {
    // 114–117 were imported together: same change time to the millisecond.
    const conn = connFor(mock);
    const batch = await Promise.all(
      [114, 115, 116, 117].map((id) => c.get(again(conn), 'work-item', String(id))),
    );
    const at = batch[0]!.updatedAt;
    expect(batch.every((r) => r!.updatedAt === at)).toBe(true);
    const cursor = `${at}|114`;
    const page1 = await c.changes(conn, 'work-item', { scope: ids.erp, cursor, limit: 2 });
    expect(page1.items.map((r) => r.id)).toEqual(['115', '116']);
    expect(page1.cursor).toBe(`${at}|116`);
    const page2 = await c.changes(again(conn), 'work-item', {
      scope: ids.erp,
      cursor: page1.cursor,
      limit: 2,
    });
    expect(page2.items[0]!.id).toBe('117');
    expect(page2.items[1]!.updatedAt > at).toBe(true);
  });

  it('returns only what changed since the cursor, with the new version', async () => {
    const { cursor } = await feed(ids.network, 50);
    expect(
      (await c.changes(connFor(mock), 'work-item', { scope: ids.network, cursor, limit: 50 })).items,
    ).toEqual([]);
    await mock.control('POST', '/ado/workitems/130', {
      fields: { 'System.State': 'Doing' },
      as: 'helpdesk@isbp.example',
    });
    const page = await c.changes(connFor(mock), 'work-item', { scope: ids.network, cursor, limit: 50 });
    expect(page.items.map((r) => [r.id, r.values['System.State']])).toEqual([['130', 'Doing']]);
    expect(Number(page.items[0]!.version)).toBeGreaterThan(1);
    expect(
      (
        await rejects(
          c.changes(connFor(mock), 'work-item', { scope: ids.network, cursor: 'garbage', limit: 5 }),
        )
      ).code,
    ).toBe(ErrorCodes.VALIDATION_FAILED);
  });

  it('reads values in the hub’s shapes', async () => {
    const bug = (await c.get(connFor(mock), 'work-item', '111'))!;
    expect(bug).toMatchObject({
      id: '111',
      ref: 'Bug 111',
      title: 'Fix intercompany posting rule found in cycle 2',
      url: `${mock.collectionUrl}/ERP/_workitems/edit/111`,
      parentId: '106',
      scope: ids.erp,
    });
    expect(bug.values).toMatchObject({
      'System.WorkItemType': 'Bug',
      'System.State': 'Active',
      'Microsoft.VSTS.Common.Priority': '1',
      'System.AssignedTo': { email: 'helpdesk@isbp.example', name: '林雅婷', id: 'CONTOSO\\helpdesk' },
      'System.Tags': ['data-migration'],
      'Microsoft.VSTS.Scheduling.RemainingWork': 10,
      'System.IterationPath': 'ERP\\Sprint 42',
      parent: '106',
    });
    expect(String(bug.values['Microsoft.VSTS.TCM.ReproSteps'])).toContain('1450');
    // An engineer ISBP doesn't know keeps the email, so the hub can say who is unmatched.
    const swift = (await c.get(connFor(mock), 'work-item', '119'))!;
    expect(swift.values['System.AssignedTo']).toMatchObject({ email: 'daniel.wu@fabrikam.example' });
    expect((await c.get(connFor(mock), 'work-item', '135'))!.values['System.AssignedTo']).toBeNull();
    // Custom fields come through as they are.
    expect((await c.get(connFor(mock), 'work-item', '101'))!.values['Custom.CostCenter']).toBe('FIN-4100');
  });

  it('turns date-only fields into the day someone picked, whatever their time zone', async () => {
    const raw = await mock.control<{ item: { fields: Record<string, string> } }>('GET', '/ado/workitems/101');
    const stored = raw.item.fields['Microsoft.VSTS.Scheduling.TargetDate']!;
    expect(stored).toMatch(/T16:00:00\.000Z$/); // midnight in Taipei
    const epic = (await c.get(connFor(mock), 'work-item', '101'))!;
    const nextDay = new Date(Date.parse(stored) + 8 * 3_600_000).toISOString().slice(0, 10);
    expect(epic.values['Microsoft.VSTS.Scheduling.TargetDate']).toBe(nextDay);
  });

  it('caches identity lookups', async () => {
    const conn = connFor(mock);
    await c.get(conn, 'work-item', '111');
    const lookups = () => conn.calls.filter((x) => x.url.includes('_apis/identities')).length;
    expect(lookups()).toBe(1);
    // Same people (helpdesk created and works on 116 as well): answered from the cache.
    await c.get(again(conn), 'work-item', '116');
    await c.get(again(conn), 'work-item', '111');
    expect(lookups()).toBe(1);
  });

  it('reports missing, deleted and moved work items', async () => {
    expect(await c.get(connFor(mock), 'work-item', '9999')).toBeNull();
    expect(await c.get(connFor(mock), 'work-item', 'not-an-id')).toBeNull();
    await mock.control('DELETE', '/ado/workitems/126');
    expect(await c.get(connFor(mock), 'work-item', '126')).toBeNull();
    const moved = await c.get(connFor(mock), 'work-item', '111', { scope: ids.network });
    expect(moved?.deleted).toBe(true);
  });

  it('creates work items with their parent, skipping fields the type lacks', async () => {
    const created = await c.create!(
      connFor(mock),
      'work-item',
      {
        'System.WorkItemType': 'Task',
        'System.Title': 'Reconcile intercompany accounts',
        'System.Description': '<p>From ISBP</p>',
        'System.State': 'Active',
        'System.AssignedTo': { email: 'auditor@isbp.example', name: 'Olivia Bennett' },
        'System.Tags': ['finance', 'sync'],
        'Microsoft.VSTS.Common.Priority': '2',
        'Microsoft.VSTS.Scheduling.RemainingWork': 5,
        'Microsoft.VSTS.Scheduling.TargetDate': '2026-11-30',
      },
      { scope: ids.erp, parentId: '106' },
    );
    expect(created).toMatchObject({
      version: '1',
      parentId: '106',
      scope: ids.erp,
      ref: `Task ${created.id}`,
    });
    expect(created.values).toMatchObject({
      'System.State': 'Active',
      'System.AssignedTo': { email: 'auditor@isbp.example', id: 'CONTOSO\\auditor' },
      'System.Tags': ['finance', 'sync'],
      'Microsoft.VSTS.Common.Priority': '2',
      'Microsoft.VSTS.Scheduling.RemainingWork': 5,
      'Microsoft.VSTS.Scheduling.TargetDate': null,
    });
    const parent = await mock.control<{ item: { relations: { rel: string; url: string }[] } }>(
      'GET',
      '/ado/workitems/106',
    );
    expect(
      parent.item.relations.some(
        (r) => r.rel === 'System.LinkTypes.Hierarchy-Forward' && r.url.endsWith(`/${created.id}`),
      ),
    ).toBe(true);
  });

  it('refuses creates the server or the catalogue rejects', async () => {
    const conn = connFor(mock);
    expect(
      (await rejects(c.create!(conn, 'work-item', { 'System.Title': 'x' }, { scope: ids.erp }))).code,
    ).toBe(ErrorCodes.VALIDATION_FAILED);
    const state = await rejects(
      c.create!(
        conn,
        'work-item',
        { 'System.WorkItemType': 'Task', 'System.Title': 'x', 'System.State': 'Doing' },
        { scope: ids.erp },
      ),
    );
    expect(state.statusCode).toBe(422);
    expect(state.code).toBe(ErrorCodes.REMOTE_REJECTED);
    expect((state.details as { message: string }).message).toContain('TF401320');
    const who = await rejects(
      c.create!(
        conn,
        'work-item',
        {
          'System.WorkItemType': 'Task',
          'System.Title': 'x',
          'System.AssignedTo': { email: 'nobody@isbp.example', name: 'Nobody' },
        },
        { scope: ids.erp },
      ),
    );
    expect(who.code).toBe(ErrorCodes.REMOTE_REJECTED);
    expect((who.details as { message: string }).message).toContain('unknown identity');
    expect((await rejects(c.create!(conn, 'repository', {}, { scope: ids.erp }))).code).toBe(
      ErrorCodes.NOT_SUPPORTED,
    );
  });

  it('updates with optimistic concurrency', async () => {
    const conn = connFor(mock);
    const before = (await c.get(conn, 'work-item', '113'))!;
    const updated = await c.update!(
      again(conn),
      'work-item',
      '113',
      { 'System.State': 'Active', 'Microsoft.VSTS.Scheduling.RemainingWork': 30, 'System.Tags': [] },
      { expectedVersion: before.version },
    );
    expect(Number(updated.version)).toBe(Number(before.version) + 1);
    expect(updated.values).toMatchObject({
      'System.State': 'Active',
      'Microsoft.VSTS.Scheduling.RemainingWork': 30,
      'System.Tags': [],
    });
    // Unchanged values write nothing.
    const same = await c.update!(
      again(conn),
      'work-item',
      '113',
      { 'System.State': 'Active' },
      { expectedVersion: updated.version },
    );
    expect(same.version).toBe(updated.version);
    // A stale version is a conflict.
    const stale = await rejects(
      c.update!(
        again(conn),
        'work-item',
        '113',
        { 'System.State': 'Closed' },
        { expectedVersion: before.version },
      ),
    );
    expect(stale.statusCode).toBe(409);
    expect(stale.code).toBe(ErrorCodes.REMOTE_CONFLICT);
    // Type changes are refused, missing items are 404.
    expect(
      (await rejects(c.update!(again(conn), 'work-item', '113', { 'System.WorkItemType': 'Bug' }, {}))).code,
    ).toBe(ErrorCodes.VALIDATION_FAILED);
    expect(
      (await rejects(c.update!(again(conn), 'work-item', '9999', { 'System.Title': 'x' }, {}))).statusCode,
    ).toBe(404);
  });

  it('maps a change made between read and write (failed test /rev, 412) to REMOTE_CONFLICT', async () => {
    let edited = false;
    const conn = connFor(mock, {
      before: async (_url, opts) => {
        if (opts.method === 'PATCH' && !edited) {
          edited = true;
          await mock.control('POST', '/ado/workitems/112', {
            fields: { 'System.Title': 'Edited in Azure DevOps' },
            as: 'admin@isbp.example',
          });
        }
      },
    });
    const version = (await c.get(conn, 'work-item', '112'))!.version;
    const err = await rejects(
      c.update!(again(conn), 'work-item', '112', { 'System.State': 'Closed' }, { expectedVersion: version }),
    );
    expect(err.code).toBe(ErrorCodes.REMOTE_CONFLICT);
    expect((err.details as { status: number; typeKey: string }).status).toBe(412);
    expect((err.details as { typeKey: string }).typeKey).toBe('TestPatchOperationFailedException');
    expect((await c.get(again(conn), 'work-item', '112'))!.values['System.State']).toBe('Active');
  });

  it('moves, removes and refuses parents', async () => {
    const conn = connFor(mock);
    const moved = await c.update!(conn, 'work-item', '113', { parent: '118' }, {});
    expect(moved.parentId).toBe('118');
    const old = await mock.control<{ item: { relations?: { rel: string; url: string }[] } }>(
      'GET',
      '/ado/workitems/106',
    );
    expect(old.item.relations?.some((r) => r.url.endsWith('/113'))).toBe(false);
    const removed = await c.update!(again(conn), 'work-item', '113', {}, { parentId: null });
    expect(removed.parentId).toBeNull();
    expect(removed.values.parent).toBeNull();
    // A cycle is refused by the server.
    const cycle = await rejects(c.update!(again(conn), 'work-item', '101', { parent: '106' }, {}));
    expect(cycle.code).toBe(ErrorCodes.REMOTE_REJECTED);
    expect((cycle.details as { message: string }).message).toContain('circular');
  });

  it('reads and adds comments', async () => {
    const conn = connFor(mock);
    const list = await c.comments!.list(conn, 'work-item', '110', { scope: ids.erp });
    expect(list.map((x) => [x.author.email, x.format])).toEqual([
      ['auditor@isbp.example', 'html'],
      ['admin@isbp.example', 'html'],
    ]);
    expect(list[0]!.body).toContain('97% of GL balances');
    const added = await c.comments!.add(again(conn), 'work-item', '110', {
      body: 'Cycle 3 <ready>\nTomorrow',
      format: 'text',
    });
    expect(added.body).toBe('<p>Cycle 3 &lt;ready&gt;<br>Tomorrow</p>');
    expect(added.author.name).toBe('ISBP Integration');
    const html = await c.comments!.add(
      again(conn),
      'work-item',
      '110',
      { body: '<p>Done</p>', format: 'html' },
      { scope: ids.erp },
    );
    const after = await c.comments!.list(again(conn), 'work-item', '110');
    expect(after.map((x) => x.id)).toEqual([...list.map((x) => x.id), added.id, html.id]);
    expect(
      (
        await rejects(
          c.comments!.add(again(conn), 'work-item', '110', { body: 'x', format: 'text', internal: true }),
        )
      ).code,
    ).toBe(ErrorCodes.NOT_SUPPORTED);
    expect(await c.comments!.list(again(conn), 'work-item', '9999')).toEqual([]);
  });

  it('uses the Comments API on 2019 Update 1 (api-version 5.1)', async () => {
    const conn = connFor(mock, { apiVersion: '5.1' });
    const added = await c.comments!.add(conn, 'work-item', '110', { body: 'From 2019.1', format: 'text' });
    expect(added.body).toBe('<p>From 2019.1</p>');
    expect(conn.calls.find((x) => x.method === 'POST')!.url).toContain('api-version=5.1-preview.3');
    const list = await c.comments!.list(again(conn), 'work-item', '110');
    expect(list.at(-1)).toMatchObject({ id: added.id, author: { name: 'ISBP Integration' } });
  });

  it('names the comment format on 7.2 and stops at the 1,000-comment API limit', async () => {
    const conn = connFor(mock);
    await c.comments!.add(conn, 'work-item', '110', { body: 'Hello', format: 'text' });
    const post = conn.calls.find((x) => x.method === 'POST' && x.url.includes('/comments'))!;
    expect(post.url).toContain('format=html');
    expect(post.url).toContain('api-version=7.2-preview.4');
    await mock.control('POST', '/ado/workitems/110', { bulkComments: 1000 });
    const err = await rejects(
      c.comments!.add(again(conn), 'work-item', '110', { body: 'One more', format: 'text' }),
    );
    expect(err.code).toBe(ErrorCodes.REMOTE_REJECTED);
    expect((err.details as { message: string }).message).toContain('1000 comments');
    // Server 2022 (7.0) has no limit and no format parameter.
    const v70 = connFor(mock, { apiVersion: '7.0' });
    await c.comments!.add(v70, 'work-item', '110', { body: 'From 2022', format: 'text' });
    const post70 = v70.calls.find((x) => x.method === 'POST' && x.url.includes('/comments'))!;
    expect(post70.url).toContain('api-version=7.0-preview.3');
    expect(post70.url).not.toContain('format=');
  });

  it('adds Markdown comments as Markdown on 7.1', async () => {
    const conn = connFor(mock, { apiVersion: '7.1' });
    const added = await c.comments!.add(conn, 'work-item', '110', { body: '**Done**', format: 'markdown' });
    expect(added.format).toBe('markdown');
    expect(added.body).toBe('**Done**');
    const post = conn.calls.find((x) => x.method === 'POST' && x.url.includes('/comments'))!;
    expect(post.url).toContain('format=markdown');
    expect(post.url).toContain('api-version=7.1-preview.4');
  });

  it('works against Azure DevOps Server 2019 (api-version 5.0)', async () => {
    const conn = connFor(mock, { apiVersion: '5.0' });
    // Types come without states there; the states resource is a preview, asked again as one.
    const fields = await c.fields(conn, 'work-item', ids.network);
    expect(fields.find((f) => f.key === 'System.State')?.choices?.map((x) => x.value)).toEqual([
      'To Do',
      'Doing',
      'Done',
    ]);
    expect(conn.calls.some((x) => x.url.includes('/states?api-version=5.0-preview'))).toBe(true);
    const page = await c.changes(conn, 'work-item', { scope: ids.zta, cursor: null, limit: 50 });
    expect(page.items).toHaveLength(7);
    const list = await c.comments!.list(again(conn), 'work-item', '110');
    expect(list.map((x) => x.author.email)).toEqual(['auditor@isbp.example', 'admin@isbp.example']);
    // 2019 adds discussion entries by writing System.History; the entry's id is its revision.
    const added = await c.comments!.add(again(conn), 'work-item', '110', {
      body: 'From 2019',
      format: 'text',
    });
    expect(added.body).toBe('<p>From 2019</p>');
    const after = await c.comments!.list(again(conn), 'work-item', '110');
    expect(after.at(-1)).toMatchObject({ id: added.id, body: '<p>From 2019</p>' });
  });
});

describe('repositories', () => {
  beforeEach(async () => {
    await mock.control('POST', '/reset');
  });

  it('reads Git status with a version that only changes when the repository does', async () => {
    const conn = connFor(mock);
    const page = await c.changes(conn, 'repository', { scope: ids.erp, cursor: null, limit: 50 });
    expect(page).toMatchObject({ cursor: null, hasMore: false });
    expect(page.items.map((r) => r.title)).toEqual(['erp-core', 'erp-reports']);
    const core = page.items[0]!;
    // The web URL is the one the ALM demo seed records for this repository.
    expect(core.url).toBe('https://devops.example.com/DefaultCollection/ERP/_git/erp-core');
    expect(core.values).toMatchObject({
      name: 'erp-core',
      url: core.url,
      provider: 'azure_devops',
      defaultBranch: 'main',
      lastCommitMessage: 'Merge v12 ledger migration scripts',
      lastCommitAuthor: 'Platform Admin',
    });
    expect(core.values.lastCommitSha).toMatch(/^[0-9a-f]{40}$/);
    const branches = core.values.branches as {
      name: string;
      commitSha: string;
      committedAt?: string;
      ahead?: number;
      behind?: number;
    }[];
    expect(branches[0]).toEqual({
      name: 'main',
      commitSha: core.values.lastCommitSha,
      committedAt: core.values.lastCommitAt,
    });
    expect(branches.find((b) => b.name === 'feature/intercompany-fix')).toMatchObject({
      ahead: 2,
      behind: 1,
    });
    expect(branches.find((b) => b.name === 'release/12.0')).toMatchObject({ ahead: 0, behind: 2 });
    const prs = core.values.pullRequests as {
      id: string;
      draft: boolean;
      url: string;
      author: string;
      sourceBranch: string;
    }[];
    expect(prs.map((p) => [p.id, p.draft])).toEqual([
      ['2', false],
      ['3', true],
    ]);
    expect(prs[0]).toMatchObject({
      url: `${core.url}/pullrequest/2`,
      author: '林雅婷',
      sourceBranch: 'feature/intercompany-fix',
    });
    // The values pass ALM's own schemas unchanged, so the hub's snapshot round-trips.
    const status = gitStatusSchema.parse({ branches, pullRequests: prs });
    expect(status).toEqual({ branches, pullRequests: prs });

    // Unchanged: same version, and the commit and branch reads come from the cache.
    const before = conn.calls.length;
    const again1 = await c.changes(again(conn), 'repository', { scope: ids.erp, cursor: null, limit: 50 });
    expect(again1.items.map((r) => r.version)).toEqual(page.items.map((r) => r.version));
    const repeat = conn.calls.slice(before);
    expect(repeat.some((x) => x.url.includes('/commits') || x.url.includes('/stats/branches'))).toBe(false);

    // A push changes the version and the last commit.
    await mock.control('POST', `/ado/repos/${core.id}/push`, {
      message: 'Hotfix: intercompany rounding',
      as: 'helpdesk@isbp.example',
    });
    const pushed = (await c.get(again(conn), 'repository', core.id, { scope: ids.erp }))!;
    expect(pushed.version).not.toBe(core.version);
    expect(pushed.values).toMatchObject({
      lastCommitMessage: 'Hotfix: intercompany rounding',
      lastCommitAuthor: '林雅婷',
    });
    expect(page.items[1]!.version).toBe(
      (await c.changes(again(conn), 'repository', { scope: ids.erp, cursor: null, limit: 50 })).items[1]!
        .version,
    );
  });

  it('pages repositories and reports missing ones', async () => {
    const conn = connFor(mock);
    const first = await c.changes(conn, 'repository', { scope: ids.network, cursor: null, limit: 1 });
    expect(first).toMatchObject({ cursor: 'offset:1', hasMore: true });
    const second = await c.changes(again(conn), 'repository', {
      scope: ids.network,
      cursor: first.cursor,
      limit: 1,
    });
    expect(second).toMatchObject({ cursor: null, hasMore: false });
    expect([...first.items, ...second.items].map((r) => r.title)).toEqual(['net-automation', 'vpn-config']);
    expect(await c.get(conn, 'repository', '00000000-0000-4000-a000-000000000000')).toBeNull();
    expect((await rejects(c.update!(conn, 'repository', 'x', {}, {}))).code).toBe(ErrorCodes.NOT_SUPPORTED);
  });
});

describe('service hooks', () => {
  let hookServer: Server;
  const received: unknown[] = [];

  beforeAll(async () => {
    hookServer = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk: Buffer) => (body += chunk.toString()));
      req.on('end', () => {
        received.push(JSON.parse(body));
        res.end('ok');
      });
    });
    await new Promise<void>((r) => hookServer.listen(0, '127.0.0.1', r));
  });
  afterAll(() => new Promise<void>((r) => hookServer.close(() => r())));

  beforeEach(async () => {
    await mock.control('POST', '/reset');
    received.length = 0;
    await mock.control('POST', '/webhooks', {
      system: 'ado',
      url: `http://127.0.0.1:${(hookServer.address() as AddressInfo).port}/hook`,
      headers: { 'x-isbp-webhook-secret': 's3cret' },
    });
  });

  async function next(eventType: string) {
    const hook = await eventually(() =>
      received.find((b) => (b as { eventType: string }).eventType === eventType),
    );
    expect(hook, eventType).toBeTruthy();
    return c.webhook!(connFor(mock), { headers: {}, body: hook });
  }

  it('says which work item each work item event is about', async () => {
    const conn = connFor(mock);
    await mock.control('POST', '/ado/workitems/130', {
      fields: { 'System.State': 'Doing' },
      as: 'helpdesk@isbp.example',
    });
    expect(await next('workitem.updated')).toEqual([
      { objectType: 'work-item', id: '130', scope: ids.network },
    ]);
    const created = await c.create!(
      conn,
      'work-item',
      { 'System.WorkItemType': 'Task', 'System.Title': 'Hooked' },
      { scope: ids.zta },
    );
    expect(await next('workitem.created')).toEqual([
      { objectType: 'work-item', id: created.id, scope: ids.zta },
    ]);
    await c.comments!.add(again(conn), 'work-item', created.id, { body: 'Hi', format: 'text' });
    expect(await next('workitem.commented')).toEqual([
      { objectType: 'work-item', id: created.id, scope: ids.zta },
    ]);
    await mock.control('DELETE', `/ado/workitems/${created.id}`);
    expect(await next('workitem.deleted')).toEqual([
      { objectType: 'work-item', id: created.id, scope: ids.zta },
    ]);
    await mock.control('POST', `/ado/workitems/${created.id}/restore`);
    expect(await next('workitem.restored')).toEqual([
      { objectType: 'work-item', id: created.id, scope: ids.zta },
    ]);
  });

  it('says which repository each Git event is about', async () => {
    const repos = await mock.control<{ id: string; name: string }[]>('GET', '/ado/repos');
    const vpn = repos.find((r) => r.name === 'vpn-config')!;
    await mock.control('POST', `/ado/repos/${vpn.id}/push`, { message: 'Tokyo tunnel' });
    expect(await next('git.push')).toEqual([{ objectType: 'repository', id: vpn.id, scope: ids.network }]);
    const pr = await mock.control<{ id: number }>('POST', `/ado/repos/${vpn.id}/pullrequests`, {
      title: 'Tokyo',
      sourceBranch: 'feature/tokyo-site',
    });
    expect(await next('git.pullrequest.created')).toEqual([
      { objectType: 'repository', id: vpn.id, scope: ids.network },
    ]);
    await mock.control('POST', `/ado/pullrequests/${pr.id}`, { title: 'Tokyo office tunnel' });
    expect(await next('git.pullrequest.updated')).toEqual([
      { objectType: 'repository', id: vpn.id, scope: ids.network },
    ]);
    await mock.control('POST', `/ado/pullrequests/${pr.id}`, { status: 'completed' });
    expect(await next('git.pullrequest.merged')).toEqual([
      { objectType: 'repository', id: vpn.id, scope: ids.network },
    ]);
  });

  it('ignores anything it doesn’t recognise', async () => {
    const hook = (body: unknown) => c.webhook!(connFor(mock), { headers: {}, body });
    for (const body of [
      null,
      'text',
      [],
      { eventType: 'build.complete', resource: { id: 1 } },
      { eventType: 'workitem.updated', resource: { id: 5 } },
      { eventType: 'workitem.created', resource: { id: 'DROP TABLE' } },
      { eventType: 'workitem.created', resource: { id: -3 } },
      { eventType: 'git.push', resource: { repository: { id: '../../etc' } } },
    ])
      expect(await hook(body), JSON.stringify(body)).toEqual([]);
    expect(await hook({ eventType: 'workitem.updated', resource: { id: 5, workItemId: 42 } })).toEqual([
      { objectType: 'work-item', id: '42', scope: null },
    ]);
    // The event id some Server 2019 documentation gives "pull request merge attempted".
    const repo = '257ff4ff-c945-4e59-ae21-456703465c3d';
    expect(
      await hook({
        eventType: 'git.pullrequest.merge.attempted',
        resource: { repository: { id: repo, project: { id: ids.erp } } },
      }),
    ).toEqual([{ objectType: 'repository', id: repo, scope: ids.erp }]);
  });
});

describe('default mappings', () => {
  const local = (m: { local: string }[]) => m.map((x) => x.local);

  it('map work items to tasks with value maps in ISBP’s vocabularies', () => {
    const m = defaultMapping('work-item', 'projects.task');
    for (const key of local(m)) expect(TASK_KEYS, key).toContain(key);
    const remote = new Set(workItemCatalog(null).map((f) => f.key));
    for (const row of m) expect(remote.has(row.remote), row.remote).toBe(true);
    const values = (key: string) => m.find((x) => x.local === key)!.values!;
    for (const v of values('type')) expect(TASK_TYPES).toContain(v.local);
    for (const v of values('status')) expect(TASK_STATUSES).toContain(v.local);
    for (const v of values('priority')) expect(TASK_PRIORITIES).toContain(v.local);
    // Every state of every process pulls to a status; each remote value appears once.
    const states = new Set(
      Object.values(PROCESSES).flatMap((types) =>
        Object.entries(types)
          .filter(([t]) => t !== 'Review')
          .flatMap(([, s]) => s),
      ),
    );
    for (const s of states)
      expect(
        values('status').map((v) => v.remote),
        s,
      ).toContain(s);
    for (const key of ['type', 'status', 'priority']) {
      const r = values(key).map((v) => v.remote);
      expect(new Set(r).size, key).toBe(r.length);
    }
    // Pushing picks the first remote value per local one: Agile's.
    expect(values('type').find((v) => v.local === 'story')!.remote).toBe('User Story');
    expect(values('status').find((v) => v.local === 'todo')!.remote).toBe('New');
    expect(values('status').find((v) => v.local === 'done')!.remote).toBe('Closed');
  });

  it('match each project’s own catalogue where its types have the fields', async () => {
    const m = defaultMapping('work-item', 'projects.task');
    const agile = new Set((await c.fields(connFor(mock), 'work-item', ids.erp)).map((f) => f.key));
    for (const row of m) expect(agile.has(row.remote), row.remote).toBe(true);
  });

  it('map team projects and repositories (pull only)', () => {
    const projects = defaultMapping('project', 'projects.project');
    expect(projects.every((x) => x.direction === 'pull')).toBe(true);
    for (const key of local(projects)) expect(PROJECT_KEYS).toContain(key);
    const repos = defaultMapping('repository', 'alm.repository');
    expect(local(repos)).toEqual(REPO_KEYS);
    expect(repos.every((x) => x.direction === 'pull' && x.local === x.remote)).toBe(true);
    expect(REPO_PROVIDERS).toContain('azure_devops');
    expect(defaultMapping('work-item', 'itsm.ticket')).toEqual([]);
  });
});
