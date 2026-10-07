import { ErrorCodes, HttpError, type RemoteRecord, type RemoteUser } from '@isbp/sdk/server';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { sdpConfigSchema } from '../src/contracts';
import { sdpConnector as c } from '../src/server/connector';
import { compareIds, decodeCursor } from '../src/server/feed';
import { errorOf, type MockSdp, startMock } from './helpers';

let mock: MockSdp;

beforeAll(async () => {
  mock = await startMock();
});
afterAll(async () => {
  await mock.close();
});
afterEach(async () => {
  await mock.control('DELETE', '/_mock/sdp/rate-limit');
});

interface Stats {
  apiCalls: number;
  authFailures: number;
}
const stats = () => mock.control<Stats>('GET', '/_mock/sdp/stats');

type MockRec = Record<string, unknown> & { id: string };
const mockList = (module: string) => mock.control<MockRec[]>('GET', `/_mock/sdp/${module}`);
const byDisplayId = async (n: number) =>
  (await mockList('requests')).find((r) => r.display_id === String(n))!;

/** Reads the whole change feed from `cursor`, page by page. */
async function drain(objectType: string, limit: number, cursor: string | null = null, conn = mock.conn()) {
  const items: RemoteRecord[] = [];
  for (let i = 0; i < 100; i++) {
    const page = await c.changes(conn, objectType, { cursor, limit });
    items.push(...page.items);
    expect(page.items.length).toBeLessThanOrEqual(limit);
    if (page.cursor) cursor = page.cursor;
    if (!page.hasMore) return { items, cursor };
  }
  throw new Error('the feed never ended');
}

describe('connection settings', () => {
  it('calls only the host of its base URL', () => {
    expect(c.hosts(sdpConfigSchema.parse({ baseUrl: 'https://sdp.contoso.local:8443' }))).toEqual([
      'sdp.contoso.local',
    ]);
    expect(c.hosts(sdpConfigSchema.parse({ baseUrl: 'http://10.20.0.15:8080/' }))).toEqual(['10.20.0.15']);
    expect(c.hosts(sdpConfigSchema.parse({ baseUrl: 'https://[fd00::15]:8443' }))).toEqual(['fd00::15']);
    expect(c.hosts(mock.config)).toEqual(['localhost']);
  });

  it('accepts http and https server URLs (the kernel decides about plain HTTP), nothing else', () => {
    const ok = (baseUrl: string) => sdpConfigSchema.safeParse({ baseUrl }).success;
    expect(ok('https://sdp.contoso.local:8443')).toBe(true);
    expect(ok('http://sdp.contoso.local:8080')).toBe(true);
    expect(ok('https://intranet.contoso.local/servicedesk')).toBe(true);
    expect(ok('https://user:pw@sdp.contoso.local')).toBe(false);
    expect(ok('https://sdp.contoso.local/?x=1')).toBe(false);
    expect(ok('ftp://sdp.contoso.local')).toBe(false);
    expect(ok('sdp.contoso.local')).toBe(false);
    expect(sdpConfigSchema.safeParse({ baseUrl: 'https://sdp', portalId: '3' }).success).toBe(true);
    expect(sdpConfigSchema.safeParse({ baseUrl: 'https://sdp', portalId: 'itdesk' }).success).toBe(false);
  });

  it('only calls its own hosts', async () => {
    const conn = mock.conn();
    const err = await errorOf(conn.http.request('https://example.com/'));
    expect(err.code).toBe(ErrorCodes.TARGET_BLOCKED);
  });

  it('sends the API key, the v3 Accept header and the portal id', async () => {
    const seen: Record<string, string>[] = [];
    const conn = mock.conn({ config: { portalId: '1' } });
    const http = conn.http;
    conn.http = {
      request: (url, opts) => {
        seen.push(opts?.headers ?? {});
        return http.request(url, opts);
      },
    };
    await c.test(conn);
    const [first] = (await c.changes(conn, 'request', { cursor: null, limit: 1 })).items;
    expect(first!.url).toMatch(/WorkOrder\.do\?woMode=viewWO&woID=\d+&PORTALID=1$/);
    expect(seen[0]).toMatchObject({
      authtoken: mock.secrets.apiKey,
      accept: 'application/vnd.manageengine.sdp.v3+json',
      portalid: '1',
    });
  });
});

describe('API key', () => {
  it('tests the connection and names the server', async () => {
    const port = new URL(mock.base).port;
    expect(await c.test(mock.conn())).toEqual({ ok: true, account: `ServiceDesk Plus on localhost:${port}` });
    expect(await c.test(mock.conn({ config: { portalId: '1' } }))).toEqual({
      ok: true,
      account: `ServiceDesk Plus on localhost:${port} (portal 1)`,
    });
  });

  it('reports a refused key as REMOTE_AUTH_FAILED, without echoing it', async () => {
    const wrong = mock.conn({ secrets: { apiKey: 'EXPIRED-KEY-0000' } });
    const err = await errorOf(c.get(wrong, 'request', '1'));
    expect(err.statusCode).toBe(502);
    expect(err.code).toBe(ErrorCodes.REMOTE_AUTH_FAILED);
    expect(err.message).toContain('Invalid API key');
    expect(JSON.stringify([err.message, err.details])).not.toContain('EXPIRED-KEY');

    const changes = await errorOf(c.changes(wrong, 'asset', { cursor: null, limit: 5 }));
    expect(changes.code).toBe(ErrorCodes.REMOTE_AUTH_FAILED);
    const test = await c.test(wrong);
    expect(test.ok).toBe(false);
    expect(test.message).toContain('Invalid API key');
  });

  it('reports an unknown portal or a wrong base URL on test', async () => {
    expect(await c.test(mock.conn({ config: { portalId: '7' } }))).toEqual({
      ok: false,
      message: `No service desk instance with portal ID 7 on localhost:${new URL(mock.base).port}`,
    });
    const wrongBase = mock.conn({ config: { baseUrl: `${mock.base}/nothing-here` } });
    expect(await c.test(wrongBase)).toEqual({
      ok: false,
      message: `No REST API v3 at ${mock.base}/nothing-here/api/v3 (check the server URL)`,
    });
  });

  it('lets the kernel’s guards propagate from test()', async () => {
    const conn = mock.conn();
    conn.http = {
      request: async () => {
        throw new HttpError(422, 'INSECURE_HTTP', 'Plain HTTP is not allowed for this connection');
      },
    };
    expect((await errorOf(c.test(conn))).code).toBe('INSECURE_HTTP');
  });
});

describe('throttling', () => {
  it('turns a 429 into REMOTE_RATE_LIMITED, waiting the minutes the message names', async () => {
    const conn = mock.conn();
    const id = (await mockList('requests'))[0]!.id;
    await mock.control('POST', '/_mock/sdp/rate-limit', { after: 1 });
    await c.get(conn, 'request', id); // the one call still allowed
    const err = await errorOf(c.changes(conn, 'request', { cursor: null, limit: 5 }));
    expect(err.statusCode).toBe(429);
    expect(err.code).toBe(ErrorCodes.REMOTE_RATE_LIMITED);
    expect(err.details).toEqual({
      retryAfterSeconds: 60,
      message: 'URL configured to access 30 requests within 1 minutes was violated',
    });
  });

  it('recognises the throttle message whatever the status code', async () => {
    await mock.control('POST', '/_mock/sdp/rate-limit', { after: 0, minutes: 3, status: 400 });
    const err = await errorOf(c.get(mock.conn(), 'request', '1'));
    expect(err.code).toBe(ErrorCodes.REMOTE_RATE_LIMITED);
    expect(err.details).toMatchObject({ retryAfterSeconds: 180 });
  });

  it('reads the message from a plain page too, and prefers Retry-After', async () => {
    const answer = (body: string, headers: Record<string, string> = {}) => {
      const conn = mock.conn();
      conn.http = {
        request: async () => ({
          status: 403,
          headers,
          body: Buffer.from(body),
          truncated: false,
          durationMs: 1,
        }),
      };
      return errorOf(c.get(conn, 'request', '1'));
    };
    const page = await answer(
      '<html><body><p>The maximum access limit for the page is exceeded.</p></body></html>',
    );
    expect(page.code).toBe(ErrorCodes.REMOTE_RATE_LIMITED);
    expect(page.details).toMatchObject({ retryAfterSeconds: 60 });
    const header = await answer('URL configured to access 5 requests within 10 minutes was violated', {
      'retry-after': '42',
    });
    expect(header.details).toMatchObject({ retryAfterSeconds: 42 });
    // Other refusals stay refusals.
    const other = await answer(
      '{"response_status":{"status_code":4000,"messages":[{"status_code":4002,"message":"Forbidden"}]}}',
    );
    expect(other.code).toBe(ErrorCodes.REMOTE_REJECTED);
  });
});

describe('field catalogue', () => {
  it('reads picklist choices from the server, and falls back to defaults', async () => {
    const fields = await c.fields(mock.conn(), 'request');
    const byKey = Object.fromEntries(fields.map((f) => [f.key, f]));
    expect(Object.keys(byKey)).toEqual(
      expect.arrayContaining([
        'subject',
        'description',
        'status',
        'priority',
        'impact',
        'urgency',
        'category',
        'subcategory',
        'group',
        'technician',
        'requester',
        'request_type',
        'resolution',
        'due_by_time',
      ]),
    );
    expect(byKey.subject).toMatchObject({ type: 'string', required: true });
    expect(byKey.description!.type).toBe('html');
    expect(byKey.technician!.type).toBe('user');
    expect(byKey.due_by_time!.type).toBe('datetime');
    expect(byKey.created_time).toMatchObject({ readOnly: true });
    expect(byKey.status!.choices?.map((x) => x.value)).toEqual([
      'Assigned',
      'Canceled',
      'Closed',
      'In Progress',
      'On Hold',
      'Open',
      'Resolved',
    ]);
    expect(byKey.group!.choices?.map((x) => x.value)).toContain('Desktop Support');

    // Problem statuses have no setup endpoint: the defaults.
    const problem = await c.fields(mock.conn(), 'problem');
    expect(problem.find((f) => f.key === 'status')!.choices?.map((x) => x.value)).toEqual([
      'Open',
      'In Progress',
      'On Hold',
      'Resolved',
      'Closed',
    ]);
    expect(problem.find((f) => f.key === 'record_type')).toMatchObject({ readOnly: true });
  });

  it('caches picklists per connection', async () => {
    const conn = mock.conn();
    await c.fields(conn, 'request');
    const before = (await stats()).apiCalls;
    await c.fields(conn, 'request');
    expect((await stats()).apiCalls).toBe(before);
  });

  it('refuses unknown object types', async () => {
    expect((await errorOf(c.fields(mock.conn(), 'contract'))).statusCode).toBe(404);
  });
});

describe('change feed', () => {
  it('pages through every record once, oldest first, including records sharing a millisecond', async () => {
    const { items } = await drain('request', 4);
    const all = await mockList('requests');
    expect(items.map((i) => i.id).sort()).toEqual(all.map((r) => r.id).sort());
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
    const versions = items.map((i) => Number(i.version));
    expect(versions).toEqual([...versions].sort((a, b) => a - b));
    // #1019–#1021 share their last-updated time in the seed.
    const tied = items.filter((i) => ['#1019', '#1020', '#1021'].includes(i.ref));
    expect(new Set(tied.map((i) => i.version)).size).toBe(1);
  });

  it('never skips or repeats records when more of them share a millisecond than fit on a page', async () => {
    const assets = (await mockList('assets')).slice(0, 7);
    const at = Date.now() + 60_000;
    for (const a of assets)
      await mock.control('POST', `/_mock/sdp/assets/${a.id}`, { _at: at, _silent: true });
    const { cursor } = await drain('asset', 3);
    const decoded = decodeCursor(cursor);
    expect(decoded?.m === 'time' && decoded.t).toBe(at);
    expect(decoded?.m === 'time' && decoded.ids.sort()).toEqual(assets.map((a) => a.id).sort());

    // Start again just before them: page size 2 with 7 ties.
    const { items } = await drain('asset', 2, null);
    const tail = items.filter((i) => Number(i.version) === at);
    expect(tail.map((i) => i.id).sort()).toEqual(assets.map((a) => a.id).sort());
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length);

    // Caught up: nothing new.
    const again = await c.changes(mock.conn(), 'asset', { cursor, limit: 5 });
    expect(again).toMatchObject({ items: [], hasMore: false });
  });

  it('returns only what changed since the cursor', async () => {
    const { cursor } = await drain('request', 50);
    const target = await byDisplayId(1004);
    await mock.control('POST', `/_mock/sdp/requests/${target.id}`, { status: 'Closed', _silent: true });
    const page = await c.changes(mock.conn(), 'request', { cursor, limit: 10 });
    expect(page.items.map((i) => i.ref)).toEqual(['#1004']);
    expect(page.items[0]!.values.status).toBe('Closed');
    expect(page.hasMore).toBe(false);
    const after = await c.changes(mock.conn(), 'request', { cursor: page.cursor, limit: 10 });
    expect(after.items).toEqual([]);
  });

  it('reads each record in full (the list view has no descriptions)', async () => {
    const page = await c.changes(mock.conn(), 'change', { cursor: null, limit: 2 });
    expect(page.items).toHaveLength(2);
    for (const item of page.items) {
      expect(typeof item.values.description).toBe('string');
      expect(item.values.description).not.toBe('');
      expect(typeof item.values.roll_out_plan).toBe('string');
    }
    expect(page.hasMore).toBe(true);
  });

  it('marks a record deleted between the list and the read', async () => {
    const solutions = await mockList('solutions');
    const { cursor } = await drain('solution', 20);
    const victim = solutions[solutions.length - 1]!;
    await mock.control('POST', `/_mock/sdp/solutions/${victim.id}`, { keywords: 'gone', _silent: true });
    // Delete it in the mock between list and detail by wrapping the client.
    const conn = mock.conn();
    const http = conn.http;
    conn.http = {
      request: async (url, opts) => {
        if (url.includes(`/solutions/${victim.id}`))
          await mock.control('DELETE', `/_mock/sdp/solutions/${victim.id}`);
        return http.request(url, opts);
      },
    };
    const page = await c.changes(conn, 'solution', { cursor, limit: 5 });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({ id: victim.id, deleted: true });
  });

  it('uses the problem object’s own update-time field', async () => {
    const { items } = await drain('problem', 2);
    expect(items).toHaveLength(5);
    expect(items.every((i) => i.values.record_type === 'Problem')).toBe(true);
    expect(items[0]!.ref).toMatch(/^PB-\d+$/);
  });

  it('starts over on an unreadable cursor', async () => {
    const page = await c.changes(mock.conn(), 'change', { cursor: 'garbage', limit: 10 });
    expect(page.items).toHaveLength(5);
  });

  it('scans objects without an update time by id, versioned by a hash of their values', async () => {
    const log: { method: string; url: string }[] = [];
    const conn = mock.conn({ log });
    const ids = (await mockList('changes')).map((r) => r.id).sort(compareIds);
    const first = await c.changes(conn, 'change', { cursor: null, limit: 2 });
    // The server refused to sort changes by last_updated_time: the connection remembers to scan.
    expect(await conn.cache.get('feed:change')).toBe('scan');
    expect(first.items.map((i) => i.id)).toEqual(ids.slice(0, 2));
    expect(first.items.every((i) => /^h:[0-9a-f]{32}$/.test(i.version))).toBe(true);
    const rest = await drain('change', 2, first.cursor, conn);
    const pass = [...first.items, ...rest.items];
    expect(pass.map((i) => i.id)).toEqual(ids);
    // A finished pass starts the next one from the top, with the same versions while nothing changed.
    expect(decodeCursor(rest.cursor)).toEqual({ m: 'scan', after: null, index: 1 });
    const again = await drain('change', 10, rest.cursor, conn);
    expect(again.items.map((i) => [i.id, i.version])).toEqual(pass.map((i) => [i.id, i.version]));
    log.length = 0;
    await c.changes(conn, 'change', { cursor: null, limit: 1 });
    expect(log.some((l) => decodeURIComponent(l.url).includes('last_updated_time'))).toBe(false);
  });

  it('scans when the records come without an update time', async () => {
    const conn = mock.conn();
    const http = conn.http;
    // A build whose problems carry no update time.
    conn.http = {
      request: async (url, opts) => {
        const res = await http.request(url, opts);
        if (!url.includes('/api/v3/problems')) return res;
        const body = JSON.parse(res.body.toString('utf8')) as Record<string, unknown>;
        for (const p of [...((body.problems as Record<string, unknown>[]) ?? []), body.problem])
          if (p && typeof p === 'object') delete (p as Record<string, unknown>).updated_time;
        return { ...res, body: Buffer.from(JSON.stringify(body)) };
      },
    };
    const { items } = await drain('problem', 2, null, conn);
    expect(await conn.cache.get('feed:problem')).toBe('scan');
    expect(items.map((i) => i.id).sort(compareIds)).toEqual(
      (await mockList('problems')).map((r) => r.id).sort(compareIds),
    );
    expect(items.every((i) => i.version.startsWith('h:'))).toBe(true);
  });
});

describe('records', () => {
  it('normalizes a request', async () => {
    const raw = await byDisplayId(1001);
    const rec = (await c.get(mock.conn(), 'request', raw.id))!;
    expect(rec).toMatchObject({
      id: raw.id,
      ref: '#1001',
      title: 'VPN disconnects every few minutes when working from home',
      url: `${mock.base}/sdp/WorkOrder.do?woMode=viewWO&woID=${raw.id}`,
    });
    expect(Number(rec.version)).toBe(Number((raw.last_updated_time as { value: string }).value));
    expect(rec.updatedAt).toBe(new Date(Number(rec.version)).toISOString());
    expect(rec.values).toMatchObject({
      subject: 'VPN disconnects every few minutes when working from home',
      status: 'In Progress',
      priority: 'High',
      impact: 'Affects Department',
      urgency: 'High',
      category: 'Network',
      subcategory: 'VPN',
      group: 'Network',
      request_type: 'Incident',
      resolution: null,
    });
    expect(rec.values.description).toContain('<b>5–10 minutes</b>');
    expect(rec.values.requester).toEqual<RemoteUser>({
      email: 'hr.partner@isbp.example',
      name: '佐藤 美咲',
      id: expect.any(String) as string,
    });
    expect(rec.values.due_by_time).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    // The web UI page exists in the mock.
    const page = await fetch(rec.url!);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('VPN disconnects');
  });

  it('normalizes assets, solutions and changes', async () => {
    const conn = mock.conn();
    const asset = (await mockList('assets')).find((a) => a.org_serial_number === 'DLRS7601')!;
    const a = (await c.get(conn, 'asset', asset.id))!;
    expect(a.ref).toBe('CTS-SRV-001');
    expect(a.values).toMatchObject({
      name: 'tpe-esx-01',
      product: 'Dell PowerEdge R760',
      product_type: 'Server',
      state: 'In Use',
      vendor: 'Dell Technologies',
      purchase_cost: 480000,
      user: null,
      serial_number: 'DLRS7601',
      location: 'Taipei HQ B1 Data Center, Rack A1',
    });
    expect(a.values.acquisition_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(
      new Date(Number((asset.acquisition_date as { value: string }).value)).toISOString().slice(0, 10),
    ).toBe(a.values.acquisition_date);

    const sol = (await mockList('solutions')).find((s) => s.title === 'Connect to the VPN from home')!;
    const s = (await c.get(conn, 'solution', sol.id))!;
    expect(s.ref).toBe('SOL-1');
    expect(s.values).toMatchObject({
      topic: 'Network & VPN',
      keywords: ['vpn', 'remote', 'home'],
      approval_status: 'Approved',
      visibility: 'Public',
    });

    const ch = (await mockList('changes'))[1]!;
    const change = (await c.get(conn, 'change', ch.id))!;
    expect(change.ref).toBe('CH-2');
    expect(change.values).toMatchObject({
      stage: 'CAB Evaluation',
      status: 'Pending Approval',
      risk: 'High',
    });
    expect(change.values.change_owner).toMatchObject({ email: 'kenji.mori@contoso-msp.example' });
  });

  it('returns null for records that do not exist', async () => {
    expect(await c.get(mock.conn(), 'request', '999999999999')).toBeNull();
    expect(await c.get(mock.conn(), 'request', '../../admin')).toBeNull();
  });

  it('creates a request, adding an unknown requester by name and e-mail', async () => {
    const created = await c.create!(
      mock.conn(),
      'request',
      {
        subject: 'Keyboard missing keys',
        description: '<p>The <b>E</b> key fell off.</p>',
        request_type: 'Service Request',
        status: 'Open',
        priority: 'Low',
        technician: { email: 'helpdesk@isbp.example', name: '林雅婷', id: null },
        requester: { email: 'new.person@contoso.example', name: 'New Person', id: null },
        due_by_time: '2026-10-09T08:00:00.000Z',
      },
      {},
    );
    expect(created.ref).toMatch(/^#\d+$/);
    expect(created.values).toMatchObject({
      subject: 'Keyboard missing keys',
      request_type: 'Service Request',
      priority: 'Low',
      due_by_time: '2026-10-09T08:00:00.000Z',
    });
    expect(created.values.requester).toMatchObject({
      email: 'new.person@contoso.example',
      name: 'New Person',
    });
    const raw = await mock.control<MockRec>('GET', `/_mock/sdp/requests/${created.id}`);
    expect(raw.is_service_request).toBe(true);
  });

  it('refuses invalid values before calling, and relays ServiceDesk Plus refusals', async () => {
    const local = await errorOf(c.create!(mock.conn(), 'request', { description: 'x', ref: 'y' }, {}));
    expect(local.code).toBe(ErrorCodes.VALIDATION_FAILED);
    expect((local.details as { issues: { path: string }[] }).issues.map((i) => i.path).sort()).toEqual([
      'ref',
      'subject',
    ]);

    const remote = await errorOf(c.create!(mock.conn(), 'request', { subject: 'x', priority: 'Bogus' }, {}));
    expect(remote.statusCode).toBe(422);
    expect(remote.code).toBe(ErrorCodes.REMOTE_REJECTED);
    expect((remote.details as { message: string }).message).toContain('priority');

    const notTech = await errorOf(
      c.create!(
        mock.conn(),
        'request',
        { subject: 'x', technician: { email: 'auditor@isbp.example', name: 'O' } },
        {},
      ),
    );
    expect(notTech.code).toBe(ErrorCodes.REMOTE_REJECTED);
  });

  it('updates with optimistic concurrency', async () => {
    const conn = mock.conn();
    const raw = await byDisplayId(1002);
    const current = (await c.get(conn, 'request', raw.id))!;
    const updated = await c.update!(
      conn,
      'request',
      raw.id,
      { status: 'In Progress', technician: { email: 'helpdesk@isbp.example', name: '' }, resolution: null },
      { expectedVersion: current.version },
    );
    expect(updated.values).toMatchObject({ status: 'In Progress', resolution: '' });
    expect(updated.values.technician).toMatchObject({ email: 'helpdesk@isbp.example' });
    expect(Number(updated.version)).toBeGreaterThan(Number(current.version));

    // Someone edits it in ServiceDesk Plus meanwhile: the stale version is refused.
    await mock.control('POST', `/_mock/sdp/requests/${raw.id}`, { priority: 'High', _silent: true });
    const conflict = await errorOf(
      c.update!(conn, 'request', raw.id, { status: 'On Hold' }, { expectedVersion: updated.version }),
    );
    expect(conflict.statusCode).toBe(409);
    expect(conflict.code).toBe(ErrorCodes.REMOTE_CONFLICT);
    expect(conflict.details).toMatchObject({ expectedVersion: updated.version });
    const after = (await c.get(conn, 'request', raw.id))!;
    expect(after.values.status).toBe('In Progress');
    expect(after.values.priority).toBe('High');

    const readOnly = await errorOf(
      c.update!(conn, 'request', raw.id, { created_time: new Date().toISOString() }, {}),
    );
    expect(readOnly.code).toBe(ErrorCodes.VALIDATION_FAILED);
    const missing = await errorOf(c.update!(conn, 'request', '999999999999', { subject: 'x' }, {}));
    expect(missing.statusCode).toBe(404);
  });

  it('detects conflicts on hash-versioned records by re-reading them', async () => {
    const conn = mock.conn();
    const ch = (await mockList('changes'))[3]!;
    const before = (await c.get(conn, 'change', ch.id))!;
    expect(before.version).toMatch(/^h:/);
    expect((await c.get(conn, 'change', ch.id))!.version).toBe(before.version);
    const updated = await c.update!(
      conn,
      'change',
      ch.id,
      { risk: 'Medium' },
      { expectedVersion: before.version },
    );
    expect(updated.version).not.toBe(before.version);
    await mock.control('POST', `/_mock/sdp/changes/${ch.id}`, {
      title: 'Edited in ServiceDesk Plus',
      _silent: true,
    });
    const err = await errorOf(
      c.update!(conn, 'change', ch.id, { risk: 'Low' }, { expectedVersion: updated.version }),
    );
    expect(err.code).toBe(ErrorCodes.REMOTE_CONFLICT);
    expect(err.details).toMatchObject({
      expectedVersion: updated.version,
      currentVersion: expect.stringMatching(/^h:/),
    });
  });

  it('writes nested HTML fields, dates and keywords', async () => {
    const conn = mock.conn();
    const ch = (await mockList('changes'))[0]!;
    const c1 = await c.update!(
      conn,
      'change',
      ch.id,
      { roll_out_plan: '<p>New plan</p>', scheduled_start_time: '2026-11-01T01:00:00.000Z' },
      {},
    );
    expect(c1.values).toMatchObject({
      roll_out_plan: '<p>New plan</p>',
      scheduled_start_time: '2026-11-01T01:00:00.000Z',
    });

    const asset = (await mockList('assets')).find((a) => a.name === 'CTS-LT-0106')!;
    const a1 = await c.update!(
      conn,
      'asset',
      asset.id,
      {
        warranty_expiry: '2029-03-31',
        state: 'In Use',
        user: { email: 'auditor@isbp.example', name: 'Olivia Bennett' },
        // Create-only, but unchanged: accepted (a full push sends it).
        product_type: 'Laptop',
      },
      {},
    );
    expect(a1.values).toMatchObject({ warranty_expiry: '2029-03-31', state: 'In Use' });
    const changed = await errorOf(c.update!(conn, 'asset', asset.id, { product_type: 'Tablet' }, {}));
    expect(changed.code).toBe(ErrorCodes.VALIDATION_FAILED);

    const sol = (await mockList('solutions'))[2]!;
    const s1 = await c.update!(conn, 'solution', sol.id, { keywords: ['outlook', 'mfa, sso'] }, {});
    expect(s1.values.keywords).toEqual(['outlook', 'mfa  sso']);
  });

  it('creates an asset from a product type, picking that type’s first product', async () => {
    const a = await c.create!(
      mock.conn(),
      'asset',
      {
        name: 'CTS-LT-0999',
        product_type: 'Laptop',
        serial_number: 'SN-NEW-1',
        acquisition_date: '2026-10-01',
      },
      {},
    );
    expect(a.values).toMatchObject({
      product_type: 'Laptop',
      serial_number: 'SN-NEW-1',
      acquisition_date: '2026-10-01',
    });
    expect(typeof a.values.product).toBe('string');
    const none = await errorOf(c.create!(mock.conn(), 'asset', { name: 'x', product_type: 'Tablet' }, {}));
    expect(none.code).toBe(ErrorCodes.REMOTE_REJECTED);
  });

  it('adds assets through their product type’s API, as the connection maps it', async () => {
    const log: { method: string; url: string }[] = [];
    const server = await c.create!(
      mock.conn({ log }),
      'asset',
      { name: 'tpe-esx-09', product_type: 'Server', serial_number: 'DLRS7609', location: 'Rack A3' },
      {},
    );
    expect(log.find((l) => l.method === 'POST')!.url).toMatch(/\/sdp\/api\/v3\/asset_servers$/);
    expect(server.values).toMatchObject({
      product_type: 'Server',
      serial_number: 'DLRS7609',
      location: 'Rack A3',
    });

    const unmapped = await errorOf(
      c.create!(mock.conn(), 'asset', { name: 'x', product_type: 'Monitor' }, {}),
    );
    expect(unmapped.code).toBe(ErrorCodes.REMOTE_REJECTED);
    expect((unmapped.details as { message: string }).message).toContain('"Monitor"');
    const noType = await errorOf(c.create!(mock.conn(), 'asset', { name: 'x' }, {}));
    expect(noType.code).toBe(ErrorCodes.REMOTE_REJECTED);
    // A connection can remove (or redirect) a product type.
    const removed = await errorOf(
      c.create!(
        mock.conn({ config: { assetEndpoints: { Laptop: '' } } }),
        'asset',
        { name: 'x', product_type: 'Laptop' },
        {},
      ),
    );
    expect(removed.code).toBe(ErrorCodes.REMOTE_REJECTED);
  });

  it('reads and updates assets through asset_assets, and the product type’s API for the rest', async () => {
    const assets = await mockList('assets');
    const monitor = assets.find((a) => a.name === 'CTS-MN-0304')!;
    // No product type API for monitors: only the basic fields, and nothing pretends the others are empty.
    const m = (await c.get(mock.conn(), 'asset', monitor.id))!;
    expect(m.values).toMatchObject({
      name: 'CTS-MN-0304',
      product_type: 'Monitor',
      serial_number: 'CN0K2V7D1004',
    });
    expect('location' in m.values).toBe(false);
    expect('warranty_expiry' in m.values).toBe(false);
    const basic = await c.update!(mock.conn(), 'asset', monitor.id, { state: 'In Use' }, {});
    expect(basic.values.state).toBe('In Use');
    const extended = await errorOf(
      c.update!(mock.conn(), 'asset', monitor.id, { location: 'Taipei HQ 9F' }, {}),
    );
    expect(extended.code).toBe(ErrorCodes.REMOTE_REJECTED);

    const log: { method: string; url: string }[] = [];
    const laptop = assets.find((a) => a.name === 'CTS-LT-0107')!;
    await c.update!(mock.conn({ log }), 'asset', laptop.id, { state: 'In Use' }, {});
    expect(log.find((l) => l.method === 'PUT')!.url).toContain(`/asset_assets/${laptop.id}`);
    log.length = 0;
    const l = await c.update!(mock.conn({ log }), 'asset', laptop.id, { location: 'Taipei HQ 11F' }, {});
    expect(log.find((x) => x.method === 'PUT')!.url).toContain(`/asset_computers/${laptop.id}`);
    expect(l.values.location).toBe('Taipei HQ 11F');
  });

  it('creates problems, changes and solutions', async () => {
    const conn = mock.conn();
    const p = await c.create!(conn, 'problem', { title: 'Disk alerts on nas-01', priority: 'Medium' }, {});
    expect(p.ref).toMatch(/^PB-\d+$/);
    expect(p.values).toMatchObject({ status: 'Open', record_type: 'Problem' });
    const ch = await c.create!(
      conn,
      'change',
      { title: 'Expand nas-01', change_type: 'Standard', risk: 'Low', back_out_plan: '<p>Shrink</p>' },
      {},
    );
    expect(ch.values).toMatchObject({
      stage: 'Submission',
      status: 'Requested',
      back_out_plan: '<p>Shrink</p>',
    });
    const s = await c.create!(
      conn,
      'solution',
      { title: 'Free up space on your laptop', description: '<p>Run Storage Sense.</p>', keywords: ['disk'] },
      {},
    );
    expect(s.values).toMatchObject({
      approval_status: 'UnApproved',
      visibility: 'Technicians only',
      keywords: ['disk'],
    });
    // Only approved solutions may be public: ServiceDesk Plus refuses, the connector relays it.
    const pub = await errorOf(
      c.create!(conn, 'solution', { title: 'x', description: '<p>y</p>', visibility: 'Public' }, {}),
    );
    expect(pub.code).toBe(ErrorCodes.REMOTE_REJECTED);
    expect((pub.details as { message: string }).message).toContain('is_public');
  });
});

describe('notes', () => {
  it('lists notes as comments, internal unless shown to the requester', async () => {
    const raw = await byDisplayId(1001);
    const notes = await c.comments!.list(mock.conn(), 'request', raw.id);
    expect(notes).toHaveLength(2);
    expect(notes.map((n) => n.internal)).toEqual([false, true]);
    expect(notes[0]).toMatchObject({
      format: 'html',
      author: { email: 'helpdesk@isbp.example', name: '林雅婷' },
    });
    expect(notes[0]!.createdAt < notes[1]!.createdAt).toBe(true);
  });

  it('adds notes (text is escaped into HTML)', async () => {
    const conn = mock.conn();
    const raw = await byDisplayId(1013);
    const before = (await c.get(conn, 'request', raw.id))!;
    const added = await c.comments!.add(conn, 'request', raw.id, {
      body: 'Checked <script>alert(1)</script>\n\nNext: reinstall',
      format: 'text',
      internal: false,
    });
    expect(added).toMatchObject({
      internal: false,
      format: 'html',
      author: { email: 'svc-isbp@isbp.example' },
    });
    expect(added.body).toBe('<p>Checked &lt;script&gt;alert(1)&lt;/script&gt;</p><p>Next: reinstall</p>');
    const internal = await c.comments!.add(conn, 'request', raw.id, {
      body: '<p>Agents only</p>',
      format: 'html',
      internal: true,
    });
    expect(internal.internal).toBe(true);
    const list = await c.comments!.list(conn, 'request', raw.id);
    expect(list.map((n) => n.id)).toEqual(expect.arrayContaining([added.id, internal.id]));
    // A note changes the request (the feed picks it up).
    expect(Number((await c.get(conn, 'request', raw.id))!.version)).toBeGreaterThan(Number(before.version));
  });

  it('has no notes on other objects', async () => {
    const err = await errorOf(c.comments!.list(mock.conn(), 'asset', '1'));
    expect(err.code).toBe(ErrorCodes.NOT_SUPPORTED);
  });
});

describe('webhooks', () => {
  const parse = (body: unknown) => c.webhook!(mock.conn(), { headers: {}, body });

  it('reads { module, id } for requests, problems and changes, as JSON or a form payload', async () => {
    expect(await parse({ module: 'request', id: '100000000000123' })).toEqual([
      { objectType: 'request', id: '100000000000123' },
    ]);
    expect(await parse({ module: 'Problem', id: 7 })).toEqual([{ objectType: 'problem', id: '7' }]);
    expect(await parse('{"module":"change","id":42}')).toEqual([{ objectType: 'change', id: '42' }]);
    expect(await parse('module=request&id=9')).toEqual([{ objectType: 'request', id: '9' }]);
  });

  it('ignores anything else', async () => {
    for (const body of [
      { module: 'request', id: '${{request.id}}' },
      { module: 'request', id: '$id' },
      { module: 'asset', id: '1' },
      { module: 'solution', id: '1' },
      { module: 'requests', id: '1' },
      { request: { id: '9' } },
      [{ module: 'request', id: '1' }],
      { module: 'request', id: '1; drop table' },
      { module: 'request', id: -1 },
      { module: 'request', id: 1.5 },
      'not json',
      null,
    ])
      expect(await parse(body), JSON.stringify(body)).toEqual([]);
  });

  it('is what the mock sends when a technician edits a record', async () => {
    const hooks: unknown[] = [];
    const sink = await import('node:http').then(({ createServer }) =>
      createServer((req, res) => {
        let body = '';
        req.on('data', (d: Buffer) => (body += d.toString()));
        req.on('end', () => {
          hooks.push(JSON.parse(body));
          res.end();
        });
      }),
    );
    await new Promise<void>((r) => sink.listen(0, '127.0.0.1', r));
    const port = (sink.address() as { port: number }).port;
    try {
      await mock.control('POST', '/_mock/webhooks', { system: 'sdp', url: `http://127.0.0.1:${port}/hook` });
      const raw = await byDisplayId(1006);
      await mock.control('POST', `/_mock/sdp/requests/${raw.id}`, { status: 'In Progress' });
      await expect.poll(() => hooks.length).toBe(1);
      expect(await parse(hooks[0])).toEqual([{ objectType: 'request', id: raw.id }]);
    } finally {
      await mock.control('DELETE', '/_mock/webhooks');
      await new Promise((r) => sink.close(r));
    }
  });
});
