import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { seedAdo } from '../src/ado';
import { createMockServer, MOCK_CREDENTIALS } from '../src/index';

let app: FastifyInstance;
let base: string;
const auth = `Basic ${Buffer.from(`:${MOCK_CREDENTIALS.ado.pat}`).toString('base64')}`;

async function call<T = Record<string, unknown>>(
  method: string,
  path: string,
  body?: unknown,
  opts: { auth?: string | null; contentType?: string } = {},
): Promise<{ status: number; body: T; headers: Headers }> {
  const headers: Record<string, string> = {};
  if (opts.auth !== null) headers.authorization = opts.auth ?? auth;
  if (body !== undefined) headers['content-type'] = opts.contentType ?? 'application/json';
  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : null) as T, headers: res.headers };
}

const ado = (path: string) => `/ado/DefaultCollection/${path}`;
const wiql = (query: string, params = 'api-version=7.0&timePrecision=true') =>
  call<{ workItems: { id: number }[]; asOf: string; message?: string; typeKey?: string }>(
    'POST',
    ado(`ERP/_apis/wit/wiql?${params}`),
    { query },
  );

beforeAll(async () => {
  app = await createMockServer();
  await app.listen({ port: 0, host: '127.0.0.1' });
  base = `http://localhost:${(app.server.address() as AddressInfo).port}`;
});
afterAll(() => app.close());
beforeEach(async () => {
  await call('POST', '/_mock/reset');
});

describe('Azure DevOps Server stand-in', () => {
  it('seeds the same collection every time', () => {
    const a = seedAdo(Date.parse('2026-10-07T00:00:00Z'));
    const b = seedAdo(Date.parse('2026-10-07T00:00:00Z'));
    expect(a).toEqual(b);
    expect(a.projects.map((p) => [p.name, p.process])).toEqual([
      ['ERP', 'Agile'],
      ['Network', 'Basic'],
      ['Zero Trust rollout', 'Scrum'],
    ]);
    expect(Object.keys(a.workItems)).toHaveLength(42);
    expect(a.repos.map((r) => r.name)).toEqual([
      'erp-core',
      'erp-reports',
      'vpn-config',
      'net-automation',
      'conditional-access-policies',
    ]);
    expect(a.identities.map((i) => i.mail)).toEqual([
      'admin@isbp.example',
      'helpdesk@isbp.example',
      'hr.partner@isbp.example',
      'auditor@isbp.example',
      'daniel.wu@fabrikam.example',
      null,
    ]);
  });

  it('needs the token, the collection and an api-version', async () => {
    expect((await call('GET', ado('_apis/projects?api-version=7.0'), undefined, { auth: null })).status).toBe(
      401,
    );
    expect(
      (await call('GET', ado('_apis/projects?api-version=7.0'), undefined, { auth: 'Basic eDp5' })).status,
    ).toBe(401);
    expect((await call('GET', '/ado/Other/_apis/projects?api-version=7.0')).status).toBe(404);
    const missing = await call('GET', ado('_apis/projects'));
    expect([missing.status, missing.body.typeKey]).toEqual([400, 'VssVersionNotSpecifiedException']);
    const newer = await call('GET', ado('_apis/projects?api-version=7.3'));
    expect([newer.status, newer.body.typeKey]).toEqual([400, 'VssVersionOutOfRangeException']);
    expect(newer.body.message).toContain('The latest REST API version this server supports is 7.2.');
    // Azure DevOps Server (2025+) serves 7.2 as previews.
    const released = await call('GET', ado('_apis/projects?api-version=7.2'));
    expect([released.status, released.body.typeKey]).toEqual([400, 'VssInvalidPreviewVersionException']);
    expect((await call('GET', ado('_apis/projects?api-version=7.2-preview.4'))).status).toBe(200);
    const preview = await call('GET', ado('ERP/_apis/wit/workItems/110/comments?api-version=7.0'));
    expect([preview.status, preview.body.typeKey]).toEqual([400, 'VssInvalidPreviewVersionException']);
    expect((await call('GET', ado('_apis/projects?api-version=5.0'))).status).toBe(200);
  });

  it('answers the WIQL subset it understands and refuses the rest', async () => {
    const all = await wiql(
      'SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project ORDER BY [System.Id]',
    );
    expect(all.body.workItems).toHaveLength(26);
    const after = (
      await call<{ fields: Record<string, string> }>('GET', ado('_apis/wit/workitems/120?api-version=7.0'))
    ).body.fields['System.ChangedDate']!;
    const later = await wiql(
      `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project AND [System.ChangedDate] > '${after}' ORDER BY [System.ChangedDate] ASC`,
    );
    expect(later.body.workItems.length).toBeGreaterThan(0);
    expect(later.body.workItems.map((w) => w.id)).not.toContain(120);
    const top = await wiql(
      "SELECT [System.Id] FROM WorkItems WHERE [System.State] IN ('Active', 'Resolved')",
      'api-version=7.0&$top=2',
    );
    expect(top.body.workItems).toHaveLength(2);
    const datePrecision = await wiql(
      `SELECT [System.Id] FROM WorkItems WHERE [System.ChangedDate] > '${after}'`,
      'api-version=7.0',
    );
    expect([datePrecision.status, datePrecision.body.typeKey]).toEqual([
      400,
      'VssPropertyValidationException',
    ]);
    expect((await wiql('SELECT [System.Id] FROM WorkItemLinks')).status).toBe(400);
    expect((await wiql('SELECT [System.Id] FROM WorkItems WHERE [Nope.Field] = 1')).status).toBe(400);
  });

  it('applies JSON Patch with a revision test, links and rules', async () => {
    const patch = (id: number, ops: unknown) =>
      call<{ rev: number; fields: Record<string, unknown>; typeKey?: string; message?: string }>(
        'PATCH',
        ado(`_apis/wit/workitems/${id}?api-version=7.0`),
        ops,
        { contentType: 'application/json-patch+json' },
      );
    const before = (
      await call<{ rev: number; fields: Record<string, string> }>(
        'GET',
        ado('_apis/wit/workitems/113?api-version=7.0'),
      )
    ).body;
    const ok = await patch(113, [
      { op: 'test', path: '/rev', value: before.rev },
      { op: 'add', path: '/fields/System.State', value: 'Active' },
      { op: 'add', path: '/fields/System.AssignedTo', value: 'helpdesk@isbp.example' },
    ]);
    expect(ok.status).toBe(200);
    expect(ok.body.rev).toBe(before.rev + 1);
    expect(ok.body.fields['System.AssignedTo']).toMatchObject({ uniqueName: 'CONTOSO\\helpdesk' });
    expect(Date.parse(ok.body.fields['System.ChangedDate'] as string)).toBeGreaterThan(
      Date.parse(before.fields['System.ChangedDate']!),
    );
    const stale = await patch(113, [
      { op: 'test', path: '/rev', value: before.rev },
      { op: 'add', path: '/fields/System.Title', value: 'x' },
    ]);
    expect([stale.status, stale.body.typeKey]).toEqual([412, 'TestPatchOperationFailedException']);
    expect(stale.body.message).toMatch(/^VS403351/);
    const secondParent = await patch(113, [
      {
        op: 'add',
        path: '/relations/-',
        value: {
          rel: 'System.LinkTypes.Hierarchy-Reverse',
          url: `${base}/ado/DefaultCollection/_apis/wit/workItems/101`,
        },
      },
    ]);
    expect([secondParent.status, secondParent.body.message]).toEqual([
      400,
      expect.stringContaining('TF201036'),
    ]);
    const badState = await patch(113, [{ op: 'add', path: '/fields/System.State', value: 'Doing' }]);
    expect([badState.status, badState.body.typeKey]).toEqual([400, 'RuleValidationException']);
    const missing = await call('GET', ado('_apis/wit/workitems/9999?api-version=7.0'));
    expect([missing.status, missing.body.typeKey, missing.body.eventId]).toEqual([
      404,
      'WorkItemUnauthorizedAccessException',
      3200,
    ]);
  });

  it('reads batches with omitted ids and refuses fields with $expand', async () => {
    const batch = await call<{ value: (null | { id: number; relations?: unknown[] })[] }>(
      'POST',
      ado('_apis/wit/workitemsbatch?api-version=7.0'),
      {
        ids: [111, 9999],
        $expand: 'Relations',
        errorPolicy: 'Omit',
      },
    );
    expect(batch.body.value[0]!.relations).toHaveLength(1);
    expect(batch.body.value[1]).toBeNull();
    const conflict = await call(
      'GET',
      ado('_apis/wit/workitems?ids=111&fields=System.Title&$expand=relations&api-version=7.0'),
    );
    expect(conflict.status).toBe(400);
  });

  it('serves Git refs, commits, branch statistics and pull requests', async () => {
    const repos = await call<{
      value: { id: string; name: string; webUrl: string; defaultBranch: string }[];
    }>('GET', ado('ERP/_apis/git/repositories?api-version=7.0'));
    const core = repos.body.value[0]!;
    expect(core).toMatchObject({
      name: 'erp-core',
      defaultBranch: 'refs/heads/main',
      webUrl: 'https://devops.example.com/DefaultCollection/ERP/_git/erp-core',
    });
    const refs = await call<{ value: { name: string }[] }>(
      'GET',
      ado(`ERP/_apis/git/repositories/${core.id}/refs?filter=heads/&api-version=7.0`),
    );
    expect(refs.body.value.map((r) => r.name)).toContain('refs/heads/feature/swift-v12');
    const commits = await call<{ value: { comment: string }[] }>(
      'GET',
      ado(
        `ERP/_apis/git/repositories/${core.id}/commits?searchCriteria.itemVersion.version=main&searchCriteria.$top=1&api-version=7.0`,
      ),
    );
    expect(commits.body.value.map((c) => c.comment)).toEqual(['Merge v12 ledger migration scripts']);
    const stats = await call<{ value: { name: string; aheadCount: number; behindCount: number }[] }>(
      'GET',
      ado(
        `ERP/_apis/git/repositories/${core.id}/stats/branches?baseVersionDescriptor.version=main&api-version=7.0`,
      ),
    );
    expect(stats.body.value.find((s) => s.name === 'feature/swift-v12')).toMatchObject({
      aheadCount: 3,
      behindCount: 0,
    });
    const prs = await call<{ value: { pullRequestId: number }[] }>(
      'GET',
      ado(`ERP/_apis/git/repositories/${core.id}/pullrequests?searchCriteria.status=active&api-version=7.0`),
    );
    expect(prs.body.value.map((p) => p.pullRequestId).sort()).toEqual([2, 3]);
  });

  it('shows a read-only page for work item links', async () => {
    const res = await fetch(`${base}${ado('ERP/_workitems/edit/111')}`);
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(html).toContain('Bug 111: Fix intercompany posting rule found in cycle 2');
    expect(html).not.toContain('<div>');
  });

  it('adds at most 1,000 comments per work item through the API (7.2) and wants the format named', async () => {
    const add = (v: string, format?: string) =>
      call(
        'POST',
        ado(`ERP/_apis/wit/workItems/110/comments?api-version=${v}${format ? `&format=${format}` : ''}`),
        { text: 'x' },
      );
    expect((await add('7.2-preview.4')).status).toBe(400);
    expect((await add('7.2-preview.4', 'html')).status).toBe(200);
    expect((await add('7.0-preview.3')).status).toBe(200);
    await call('POST', '/_mock/ado/workitems/110', { bulkComments: 1000 });
    const refused = await add('7.2-preview.4', 'html');
    expect(refused.status).toBe(400);
    expect(refused.body.message).toContain('1000 comments');
  });

  it('throttles on request', async () => {
    await call('POST', '/_mock/ado/rate-limit', { requests: 2, retryAfter: 9 });
    const first = await call('GET', ado('_apis/projects?api-version=7.0'));
    expect([first.status, first.headers.get('retry-after')]).toEqual([429, '9']);
    expect((await call('GET', ado('_apis/projects?api-version=7.0'))).status).toBe(429);
    expect((await call('GET', ado('_apis/projects?api-version=7.0'))).status).toBe(200);
  });

  describe('test controls', () => {
    let hook: Server;
    const received: {
      eventType: string;
      resource: Record<string, unknown>;
      resourceContainers: { project: { id: string } };
    }[] = [];
    beforeAll(async () => {
      hook = createServer((req, res) => {
        let body = '';
        req.on('data', (c: Buffer) => (body += c.toString()));
        req.on('end', () => {
          received.push(JSON.parse(body));
          res.end();
        });
      });
      await new Promise<void>((r) => hook.listen(0, '127.0.0.1', r));
    });
    afterAll(() => new Promise<void>((r) => hook.close(() => r())));

    it('edit a work item as someone in Azure DevOps and send the service hook', async () => {
      received.length = 0;
      await call('POST', '/_mock/webhooks', {
        system: 'ado',
        url: `http://127.0.0.1:${(hook.address() as AddressInfo).port}/`,
      });
      const edited = await call<{ rev: number; state: string; assignedTo: string }>(
        'POST',
        '/_mock/ado/workitems/130',
        {
          fields: { 'System.State': 'Doing', 'System.AssignedTo': 'auditor@isbp.example' },
          as: 'helpdesk@isbp.example',
          comment: 'Starting <now>',
        },
      );
      expect(edited.body).toMatchObject({ state: 'Doing', assignedTo: 'CONTOSO\\auditor' });
      const until = Date.now() + 3000;
      while (received.length < 2 && Date.now() < until) await new Promise((r) => setTimeout(r, 20));
      const updated = received.find((r) => r.eventType === 'workitem.updated')!;
      expect(updated.resource).toMatchObject({
        workItemId: 130,
        fields: { 'System.State': { oldValue: 'To Do', newValue: 'Doing' } },
      });
      expect(updated.resourceContainers.project.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(received.some((r) => r.eventType === 'workitem.commented')).toBe(true);
      const detail = await call<{ comments: { text: string }[] }>('GET', '/_mock/ado/workitems/130');
      expect(detail.body.comments.at(-1)!.text).toBe('<div>Starting &lt;now&gt;</div>');
    });

    it('push a commit to a repository', async () => {
      const repos = await call<{ id: string; name: string; head: string }[]>('GET', '/_mock/ado/repos');
      const vpn = repos.body.find((r) => r.name === 'vpn-config')!;
      const pushed = await call<{ commitId: string }>('POST', `/_mock/ado/repos/${vpn.id}/push`, {
        message: 'Tokyo tunnel',
      });
      const after = await call<{ id: string; head: string }[]>('GET', '/_mock/ado/repos');
      expect(after.body.find((r) => r.id === vpn.id)!.head).toBe(pushed.body.commitId);
    });
  });
});
