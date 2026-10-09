import { describe, expect, it } from 'vitest';
import { apiPath, type ApiResponse } from '../src/client';
import { runScope } from '../src/context';
import { createContext, expect as check, FlowError } from '../src/flow';
import { createForms } from '../src/forms';
import { Rand } from '../src/rand';
import { excerpt, percentiles, Recorder, routeTemplate } from '../src/recorder';
import { failureSignature, normalizeMessage } from '../src/signature';
import { createApprovals } from '../src/workflows';

const res = (status: number, body: unknown = {}): ApiResponse => ({
  status,
  body,
  ms: 1,
  method: 'POST',
  path: '/api/v1/x',
  requestId: null,
});

function context(rand = new Rand(1, 'tok-1-abc')) {
  return createContext({
    flow: 'demo',
    iteration: 1,
    runToken: 'tok',
    rand,
    recorder: new Recorder(),
    resolve: (p) => p,
    client: () => {
      throw new Error('no API in unit tests');
    },
    info: (p) => ({ name: p, username: p, id: p, displayName: p }),
    personaOf: () => null,
    tags: new Set(),
    approvals: createApprovals,
    forms: createForms,
  });
}

describe('rand', () => {
  it('is reproducible per seed and makes unique suffixes', () => {
    const a = new Rand(42, 'run-1-xyz');
    const b = new Rand(42, 'run-1-xyz');
    expect(Array.from({ length: 5 }, () => a.int(1, 1000))).toEqual(
      Array.from({ length: 5 }, () => b.int(1, 1000)),
    );
    expect(new Rand(42).fork('x').next()).toBe(new Rand(42).fork('x').next());
    const suffixes = new Set(Array.from({ length: 100 }, () => a.suffix()));
    expect(suffixes.size).toBe(100);
    for (const s of suffixes) expect(s).toMatch(/^[a-z0-9-]+$/);
  });

  it('keeps ranges, samples and date ranges valid', () => {
    const r = new Rand(7);
    for (let i = 0; i < 200; i++) {
      const n = r.int(-3, 3);
      expect(n).toBeGreaterThanOrEqual(-3);
      expect(n).toBeLessThanOrEqual(3);
      const { start, end } = r.dateRange({ startIn: [1, 10], length: [0, 3] });
      expect(end >= start).toBe(true);
      expect(new Set(r.sample([1, 2, 3, 4], 2, 3)).size).toBeGreaterThanOrEqual(2);
    }
  });
});

describe('recorder', () => {
  it('turns paths into route templates', () => {
    expect(routeTemplate('/api/v1/itsm/tickets/INC-00042/comments?x=1')).toBe(
      '/api/v1/itsm/tickets/:ref/comments',
    );
    expect(routeTemplate('/api/v1/approvals/01a11e0c-cd29-70c2-a7d4-dfdbdcfa9086/approve')).toBe(
      '/api/v1/approvals/:id/approve',
    );
    expect(routeTemplate('/api/v1/records/cmdb.ci/01a11e0c-cd29-70c2-a7d4-dfdbdcfa9086')).toBe(
      '/api/v1/records/cmdb.ci/:id',
    );
    expect(routeTemplate('/api/v1/audit-logs/1234')).toBe('/api/v1/audit-logs/:n');
  });

  it('redacts secrets from excerpts and computes percentiles', () => {
    const text = excerpt({ csrfToken: 'abc', user: { password: 'x', name: 'n' }, apiKey: 'k' });
    expect(text).not.toContain('abc');
    expect(text).not.toContain('"x"');
    expect(text).toContain('"name":"n"');
    expect(percentiles([5, 1, 3, 2, 4])).toEqual({ p50: 3, p95: 5, p99: 5, max: 5 });
  });

  it('records 5xx, slow requests and transport errors', () => {
    const r = new Recorder(100);
    r.record({
      method: 'GET',
      path: '/a',
      status: 200,
      ms: 5,
      persona: 'p',
      flow: null,
      iteration: null,
      step: null,
    });
    r.record({
      method: 'GET',
      path: '/a',
      status: 503,
      ms: 150,
      persona: 'p',
      flow: 'f',
      iteration: 1,
      step: 's',
    });
    r.record({
      method: 'GET',
      path: '/b',
      status: 0,
      ms: 1,
      persona: 'p',
      flow: 'f',
      iteration: 1,
      step: 's',
    });
    expect([r.requestCount, r.serverErrorCount, r.slowCount, r.transportErrorCount]).toEqual([3, 1, 1, 1]);
    expect(r.routeSummary().find((x) => x.route === 'GET /a')?.statuses).toEqual({ '200': 1, '503': 1 });
  });
});

describe('signatures', () => {
  it('ignores what differs per run', () => {
    const a = normalizeMessage(
      'REQ-01042 for 01a11e0c-cd29-70c2-a7d4-dfdbdcfa9086 took 3120 ms (tmm6i5-1-nkv0)',
      'tmm6i5',
    );
    const b = normalizeMessage(
      'REQ-00007 for 01a11e0c-ffff-70c2-a7d4-dfdbdcfa9086 took 12 ms (tmm6i5-9-zz1)',
      'tmm6i5',
    );
    expect(a).toBe(b);
    expect(failureSignature('f', 'step 2', 'got 409')).toBe('f › step <n> › got <n>');
  });
});

describe('client paths', () => {
  it('prefixes /api/v1 and encodes queries', () => {
    expect(apiPath('/roles', { q: 'a b', ids: ['1', '2'], skip: undefined })).toBe(
      '/api/v1/roles?q=a+b&ids=1&ids=2',
    );
    expect(apiPath('/api/v1/x')).toBe('/api/v1/x');
  });
});

describe('expect', () => {
  it('throws FlowErrors with the step and the response', async () => {
    const ctx = context();
    const scope = { flow: 'demo', iteration: 1, steps: [], trail: [], progress: { lastStep: null } };
    const err = await runScope
      .run(scope, () =>
        ctx.step('outer', () => ctx.step('inner', async () => check.ok(res(409, { error: { code: 'X' } })))),
      )
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FlowError);
    expect((err as FlowError).step).toBe('outer › inner');
    expect((err as FlowError).request?.status).toBe(409);
    expect(() => check.code(res(409, { error: { code: 'DUPLICATE' } }), 'DUPLICATE', 409)).not.toThrow();
    expect(() => check.find([1, 2], (x) => x === 3, 'three')).toThrow(FlowError);
  });

  it('wants exactly one success among simultaneous requests', () => {
    expect(check.oneOk([res(201), res(409)], 'one', [409]).status).toBe(201);
    expect(() => check.oneOk([res(200), res(200)], 'one')).toThrow(/got 200, 200/);
    expect(() => check.oneOk([res(200), res(500)], 'one')).toThrow(FlowError);
  });

  it('eventually returns the accepted value or times out', async () => {
    const ctx = context();
    let n = 0;
    expect(
      await ctx.eventually(
        async () => ++n,
        (v) => v >= 3,
        { intervalMs: 1 },
      ),
    ).toBe(3);
    await expect(
      ctx.eventually(
        async () => 0,
        (v) => v > 0,
        { timeoutMs: 20, intervalMs: 5 },
      ),
    ).rejects.toThrow(/timed out/);
  });
});

describe('forms', () => {
  it('answers what the schema asks, with overrides', () => {
    const ctx = context();
    const data = ctx.forms.answers(
      {
        elements: [
          { id: 'p', type: 'paragraph' },
          { id: 't', key: 't', type: 'text', required: true, validation: { maxLength: 10 } },
          { id: 's', key: 's', type: 'select', required: true, options: [{ value: 'a' }, { value: 'b' }] },
          { id: 'd', key: 'd', type: 'date', required: true },
          { id: 'r', key: 'r', type: 'record', required: true },
        ],
      },
      { r: ['cmdb.ci:1'] },
    );
    expect(String(data.t).length).toBeLessThanOrEqual(10);
    expect(['a', 'b']).toContain(data.s);
    expect(data.d).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(data.r).toEqual(['cmdb.ci:1']);
    expect(() => ctx.forms.answers({ elements: [{ key: 'u', type: 'user', required: true }] })).toThrow(
      FlowError,
    );
  });
});
