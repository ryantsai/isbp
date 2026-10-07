import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createMockServer, MOCK_CREDENTIALS } from '../src/index';
import { seedSdp } from '../src/sdp/data';

const ACCEPT = 'application/vnd.manageengine.sdp.v3+json';
const API = '/sdp/api/v3';

let app: FastifyInstance;

type Json = Record<string, unknown>;

async function api(
  method: 'GET' | 'POST' | 'PUT',
  path: string,
  input?: unknown,
  headers: Record<string, string> = {},
) {
  const encoded = input === undefined ? '' : `input_data=${encodeURIComponent(JSON.stringify(input))}`;
  const res = await app.inject({
    method,
    url: method === 'GET' && encoded ? `${API}${path}?${encoded}` : `${API}${path}`,
    headers: {
      accept: ACCEPT,
      authtoken: MOCK_CREDENTIALS.sdp.apiKey,
      ...(method !== 'GET' ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
      ...headers,
    },
    ...(method !== 'GET' ? { payload: encoded } : {}),
  });
  return { status: res.statusCode, body: res.json<Json>(), headers: res.headers };
}

const list = <T = Json>(body: Json, key: string) => body[key] as T[];

beforeAll(async () => {
  app = await createMockServer();
  await app.ready();
});
afterAll(async () => {
  await app.close();
});
beforeEach(async () => {
  await app.inject({ method: 'POST', url: '/_mock/reset' });
  await app.inject({ method: 'DELETE', url: '/_mock/sdp/rate-limit' });
});

describe('seed', () => {
  it('is the Contoso demo data, deterministic apart from its clock', () => {
    const a = seedSdp(Date.UTC(2026, 9, 7, 12));
    const b = seedSdp(Date.UTC(2026, 9, 7, 12));
    expect(a).toEqual(b);
    expect([
      a.requests.length,
      a.problems.length,
      a.changes.length,
      a.assets.length,
      a.solutions.length,
    ]).toEqual([25, 5, 5, 30, 10]);
    // Serial numbers of ISBP's seeded servers and network gear, so a first sync links instead of duplicating.
    const serials = a.assets.map((x) => x.org_serial_number);
    for (const s of ['DLRS7601', 'DLRS7604', 'FOC2741X0A1', 'FG200FT923900188', '2350SQRN71C2'])
      expect(serials).toContain(s);
    const emails = new Set(a.users.map((u) => u.email_id));
    for (const e of [
      'admin@isbp.example',
      'helpdesk@isbp.example',
      'hr.partner@isbp.example',
      'auditor@isbp.example',
    ])
      expect(emails).toContain(e);
    expect([...emails].filter((e) => e.endsWith('@contoso-msp.example'))).toHaveLength(2);
    expect(Object.values(a.notes).flat()).toHaveLength(5);
  });
});

describe('API', () => {
  it('needs the technician API key, the v3 Accept header and, when given, the right portal', async () => {
    const noKey = await api('GET', '/requests', undefined, { authtoken: 'wrong' });
    expect(noKey.status).toBe(401);
    expect(noKey.body).toMatchObject({
      response_status: { status: 'failed', messages: [{ status_code: 4022 }] },
    });
    expect((await api('GET', '/requests', undefined, { accept: 'application/json' })).status).toBe(400);
    expect((await api('GET', '/requests', undefined, { portalid: '1' })).status).toBe(200);
    expect((await api('GET', '/requests', undefined, { portalid: '2' })).status).toBe(404);
    const portals = await api('GET', '/portals');
    expect(portals.body.portals).toEqual([{ id: '1', name: 'Contoso IT Help Desk', url_name: 'itdesk' }]);
  });

  it('pages, sorts and searches like list_info', async () => {
    const first = await api('GET', '/requests', {
      list_info: {
        row_count: 10,
        start_index: 1,
        sort_field: 'last_updated_time',
        sort_order: 'asc',
        get_total_count: true,
      },
    });
    expect(first.status).toBe(200);
    expect(first.body.response_status).toEqual([{ status_code: 2000, status: 'success' }]);
    expect(first.body.list_info).toMatchObject({
      has_more_rows: true,
      row_count: 10,
      start_index: 1,
      total_count: 25,
    });
    const items = list<Json & { last_updated_time: { value: string } }>(first.body, 'requests');
    const times = items.map((r) => Number(r.last_updated_time.value));
    expect(times).toEqual([...times].sort((a, b) => a - b));
    // The list view is a summary.
    expect(items[0]).not.toHaveProperty('description');

    const after = await api('GET', '/requests', {
      list_info: {
        row_count: 100,
        sort_field: 'last_updated_time',
        search_criteria: { field: 'last_updated_time', condition: 'greater than', value: String(times[9]) },
      },
    });
    const all = await api('GET', '/requests', {
      list_info: { row_count: 100, sort_field: 'last_updated_time' },
    });
    const allTimes = list<{ last_updated_time: { value: string } }>(all.body, 'requests').map((r) =>
      Number(r.last_updated_time.value),
    );
    expect(list(after.body, 'requests')).toHaveLength(allTimes.filter((t) => t > times[9]!).length);

    const open = await api('GET', '/requests', {
      list_info: {
        row_count: 100,
        search_criteria: [
          { field: 'status.name', condition: 'is', value: 'Open' },
          { field: 'group.name', condition: 'is', values: ['Network', 'Security'], logical_operator: 'AND' },
        ],
      },
    });
    expect(list<{ subject: string }>(open.body, 'requests').map((r) => r.subject)).toEqual([
      'Access to the ERP reporting module',
    ]);

    const capped = await api('GET', '/requests', { list_info: { row_count: 500 } });
    expect(list(capped.body, 'requests')).toHaveLength(25);
    expect(
      (
        await api('GET', '/requests', {
          list_info: { row_count: 5, search_criteria: { field: 'x', condition: 'like' } },
        })
      ).status,
    ).toBe(400);
  });

  it('creates, reads and updates records with ServiceDesk Plus status codes', async () => {
    const missing = await api('POST', '/requests', { request: { description: 'x' } });
    expect(missing.status).toBe(400);
    expect(missing.body).toMatchObject({
      response_status: { messages: [{ status_code: 4012, field: 'subject' }] },
    });
    const bad = await api('POST', '/requests', { request: { subject: 'x', priority: { name: 'Bogus' } } });
    expect(bad.body).toMatchObject({
      response_status: { messages: [{ status_code: 4001, field: 'priority' }] },
    });
    const extra = await api('POST', '/requests', { request: { subject: 'x', colour: 'red' } });
    expect(extra.body).toMatchObject({
      response_status: { messages: [{ message: 'EXTRA_KEY_FOUND_IN_JSON', field: 'colour' }] },
    });

    const created = await api('POST', '/requests', {
      request: {
        subject: 'New',
        priority: { name: 'High' },
        requester: { email_id: 'x@contoso.example', name: 'X' },
      },
    });
    expect(created.status).toBe(201);
    const rec = created.body.request as Json & { id: string; last_updated_time: { value: string } };
    expect(rec).toMatchObject({ display_id: '1026', status: { name: 'Open' }, requester: { name: 'X' } });

    const readOnly = await api('PUT', `/requests/${rec.id}`, { request: { display_id: '1' } });
    expect(readOnly.body).toMatchObject({ response_status: { messages: [{ status_code: 4014 }] } });
    const updated = await api('PUT', `/requests/${rec.id}`, {
      request: { status: { name: 'Resolved' }, resolution: { content: '<p>done</p>' } },
    });
    const u = updated.body.request as Json & { last_updated_time: { value: string } };
    expect(u).toMatchObject({ status: { name: 'Resolved' }, resolution: { content: '<p>done</p>' } });
    expect(Number(u.last_updated_time.value)).toBeGreaterThan(Number(rec.last_updated_time.value));

    const got = await api('GET', `/requests/${rec.id}`);
    expect(got.body.request).toMatchObject({ subject: 'New', resolution: { content: '<p>done</p>' } });
    expect((await api('GET', '/requests/1')).status).toBe(404);
  });

  it('keeps request notes', async () => {
    const [req] = list<{ id: string }>(
      (await api('GET', '/requests', { list_info: { row_count: 1 } })).body,
      'requests',
    );
    const added = await api('POST', `/requests/${req!.id}/notes`, {
      request_note: { description: '<p>hi</p>', show_to_requester: true },
    });
    expect(added.status).toBe(201);
    expect(added.body.request_note).toMatchObject({
      show_to_requester: true,
      created_by: { email_id: 'svc-isbp@isbp.example' },
    });
    const notes = await api('GET', `/requests/${req!.id}/notes`, { list_info: { row_count: 100 } });
    expect(list(notes.body, 'notes').length).toBeGreaterThanOrEqual(1);
  });

  it('serves the setup lists', async () => {
    const res = await api('GET', '/priorities', { list_info: { row_count: 100 } });
    expect(list<{ name: string }>(res.body, 'priorities').map((p) => p.name)).toEqual([
      'High',
      'Low',
      'Medium',
      'Normal',
    ]);
    const laptops = await api('GET', '/products', {
      list_info: {
        row_count: 100,
        search_criteria: { field: 'product_type.name', condition: 'is', value: 'Laptop' },
      },
    });
    expect(list(laptops.body, 'products').length).toBeGreaterThan(0);
    expect((await api('GET', '/secrets')).status).toBe(404);
  });

  it('throttles like ServiceDesk Plus: the URL is locked with a message naming the period', async () => {
    await app.inject({ method: 'POST', url: '/_mock/sdp/rate-limit', payload: { after: 1, minutes: 2 } });
    expect((await api('GET', '/requests')).status).toBe(200);
    const limited = await api('GET', '/requests');
    expect(limited.status).toBe(429);
    expect(limited.body).toMatchObject({
      response_status: {
        messages: [{ message: 'URL configured to access 30 requests within 2 minutes was violated' }],
      },
    });
    await app.inject({ method: 'POST', url: '/_mock/sdp/rate-limit', payload: { status: 400 } });
    expect((await api('GET', '/requests')).status).toBe(400);
  });

  it('serves assets the build 15100 way', async () => {
    // The old API is gone.
    expect((await api('GET', '/assets')).body).toMatchObject({
      response_status: { messages: [{ status_code: 4007 }] },
    });
    // asset_assets: every asset, basic fields only, no add.
    const all = await api('GET', '/asset_assets', { list_info: { row_count: 100 } });
    const assets = list<Json & { id: string; name: string }>(all.body, 'asset_assets');
    expect(assets).toHaveLength(30);
    const server = assets.find((a) => a.name === 'tpe-esx-01')!;
    expect(Object.keys(server).sort()).toEqual(
      [
        'id',
        'name',
        'asset_tag',
        'org_serial_number',
        'product',
        'product_type',
        'state',
        'user',
        'department',
        'created_time',
        'last_updated_time',
      ].sort(),
    );
    expect((await api('POST', '/asset_assets', { asset_asset: { name: 'x' } })).status).toBe(400);
    const extra = await api('PUT', `/asset_assets/${server.id}`, { asset_asset: { location: 'x' } });
    expect(extra.body).toMatchObject({
      response_status: { messages: [{ message: 'EXTRA_KEY_FOUND_IN_JSON' }] },
    });
    // The product type's API: full records of its types, and adds.
    const full = await api('GET', `/asset_servers/${server.id}`);
    expect(full.body.asset_server).toMatchObject({
      name: 'tpe-esx-01',
      location: 'Taipei HQ B1 Data Center, Rack A1',
    });
    expect((await api('GET', `/asset_computers/${server.id}`)).status).toBe(404);
    const added = await api('POST', '/asset_computers', {
      asset_computer: {
        name: 'CTS-LT-0200',
        product: { name: 'Dell Latitude 7450' },
        org_serial_number: 'X1',
      },
    });
    expect(added.status).toBe(201);
    // The product brings its product type.
    expect(added.body.asset_computer).toMatchObject({ product_type: { name: 'Laptop' } });
    const wrongType = await api('POST', '/asset_switches', {
      asset_switch: { name: 'x', product_type: { name: 'Server' } },
    });
    expect(wrongType.status).toBe(400);
  });

  it('refuses to sort or search by fields a module lacks, or by HTML fields', async () => {
    const changes = await api('GET', '/changes', { list_info: { sort_field: 'last_updated_time' } });
    expect(changes.status).toBe(400);
    const html = await api('GET', '/requests', { list_info: { sort_field: 'description' } });
    expect(html.status).toBe(400);
    const search = await api('GET', '/solutions', {
      list_info: { search_criteria: { field: 'description', condition: 'contains', value: 'vpn' } },
    });
    expect(search.status).toBe(400);
    expect((await api('GET', '/changes', { list_info: { sort_field: 'id' } })).status).toBe(200);
  });
});

describe('test controls', () => {
  it('edits a record as a technician: lenient values, a new update time, a webhook', async () => {
    const reqs = (await app.inject({ method: 'GET', url: '/_mock/sdp/requests' })).json<
      (Json & { id: string })[]
    >();
    const target = reqs[0]!;
    const res = await app.inject({
      method: 'POST',
      url: `/_mock/sdp/requests/${target.id}`,
      payload: {
        status: 'On Hold',
        technician: 'kenji.mori@contoso-msp.example',
        _at: 1_900_000_000_000,
        _silent: true,
      },
    });
    expect(res.json()).toMatchObject({
      status: { name: 'On Hold' },
      technician: { email_id: 'kenji.mori@contoso-msp.example' },
      last_updated_time: { value: '1900000000000' },
    });
    const refused = await app.inject({
      method: 'POST',
      url: `/_mock/sdp/requests/${target.id}`,
      payload: { status: 'Nope' },
    });
    expect(refused.statusCode).toBe(400);
    const detail = (await app.inject({ method: 'GET', url: `/_mock/sdp/request/${target.id}` })).json<Json>();
    expect(detail.notes).toBeInstanceOf(Array);
    const page = await app.inject({
      method: 'GET',
      url: `/sdp/WorkOrder.do?woMode=viewWO&woID=${target.id}`,
    });
    expect(page.headers['content-type']).toContain('text/html');
  });

  it('creates and deletes records', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/_mock/sdp/assets',
      payload: { name: 'CTS-TB-0601', product_type: 'Laptop', org_serial_number: 'SN1', _silent: true },
    });
    expect(created.statusCode).toBe(201);
    const id = created.json<{ id: string }>().id;
    expect((await app.inject({ method: 'DELETE', url: `/_mock/sdp/assets/${id}` })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: `/_mock/sdp/assets/${id}` })).statusCode).toBe(404);
  });
});
