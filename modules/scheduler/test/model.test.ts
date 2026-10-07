import { describe, expect, it } from 'vitest';
import {
  afterSatisfied,
  BUILTIN_TYPES,
  describeCron,
  findCycle,
  LOG_LIMITS,
  LogBuffer,
  maskSecrets,
  mergeSecrets,
  openConfig,
  parseExpectedStatus,
  redactConfig,
  retryDelaySeconds,
  sealConfig,
  statusMatches,
  TRUNCATED_MARKER,
  truncateLine,
} from '../src/model';

describe('retry backoff', () => {
  it('waits the base delay every time with fixed backoff', () => {
    expect([1, 2, 3, 9].map((a) => retryDelaySeconds(a, 'fixed', 30))).toEqual([30, 30, 30, 30]);
  });

  it('doubles per attempt with exponential backoff, capped at an hour', () => {
    expect([1, 2, 3, 4].map((a) => retryDelaySeconds(a, 'exponential', 60))).toEqual([60, 120, 240, 480]);
    expect(retryDelaySeconds(8, 'exponential', 60)).toBe(3_600);
    expect(retryDelaySeconds(10, 'exponential', 1_800)).toBe(3_600);
    expect(retryDelaySeconds(1, 'exponential', 0)).toBe(1);
  });
});

describe('expected HTTP status', () => {
  it('parses ranges, lists and classes', () => {
    expect(parseExpectedStatus('200-299')).toEqual([[200, 299]]);
    expect(parseExpectedStatus('200, 201 ,204')).toEqual([
      [200, 200],
      [201, 201],
      [204, 204],
    ]);
    expect(parseExpectedStatus('2xx,304')).toEqual([
      [200, 299],
      [304, 304],
    ]);
  });

  it('refuses nonsense', () => {
    for (const bad of ['', 'ok', '299-200', '700', '20', '2xx-3xx', '100-600'])
      expect(parseExpectedStatus(bad), bad).toBeNull();
  });

  it('matches statuses', () => {
    expect(statusMatches('200-299', 204)).toBe(true);
    expect(statusMatches('200-299', 302)).toBe(false);
    expect(statusMatches('200,404', 404)).toBe(true);
    expect(statusMatches('2xx', 500)).toBe(false);
    // An invalid spec falls back to 2xx.
    expect(statusMatches('nope', 200)).toBe(true);
  });
});

describe('dependency cycles', () => {
  const graph = (edges: Record<string, string[]>) => new Map(Object.entries(edges));

  it('finds a cycle through upstream edges', () => {
    // c runs after b, b after a; making a run after c closes the loop.
    expect(findCycle(graph({ a: ['c'], b: ['a'], c: ['b'] }), 'a')).toEqual(['a', 'c', 'b', 'a']);
    expect(findCycle(graph({ a: ['a'] }), 'a')).toEqual(['a', 'a']);
  });

  it('accepts diamonds and chains', () => {
    expect(findCycle(graph({ d: ['b', 'c'], b: ['a'], c: ['a'], a: [] }), 'd')).toBeNull();
    expect(findCycle(graph({ c: ['b'], b: ['a'] }), 'c')).toBeNull();
    // A cycle elsewhere does not involve the job being saved.
    expect(findCycle(graph({ x: ['a'], a: ['b'], b: ['a'] }), 'x')).toBeNull();
  });
});

describe('after triggers (all / any)', () => {
  const t = (h: number) => new Date(Date.UTC(2026, 9, 7, h));

  it('any: one upstream succeeded since the job was last queued', () => {
    expect(afterSatisfied('any', [t(5), null], t(4))).toBe(true);
    expect(afterSatisfied('any', [t(3), null], t(4))).toBe(false);
    expect(afterSatisfied('any', [t(3)], null)).toBe(true);
  });

  it('all: every upstream succeeded since the job was last queued', () => {
    expect(afterSatisfied('all', [t(5), t(6)], t(4))).toBe(true);
    expect(afterSatisfied('all', [t(5), t(3)], t(4))).toBe(false);
    expect(afterSatisfied('all', [t(5), null], null)).toBe(false);
    expect(afterSatisfied('all', [t(5), t(6)], null)).toBe(true);
    // Equal timestamps are not "since".
    expect(afterSatisfied('all', [t(4)], t(4))).toBe(false);
    expect(afterSatisfied('all', [], null)).toBe(false);
  });
});

describe('log buffering', () => {
  it('splits lines, numbers them and drains in batches', () => {
    const buf = new LogBuffer(10, 2);
    buf.push('first\nsecond');
    buf.push('oops', 'error');
    expect(buf.size).toBe(3);
    const lines = buf.take();
    expect(lines.map((l) => [l.seq, l.level, l.attempt, l.message])).toEqual([
      [11, 'info', 2, 'first'],
      [12, 'info', 2, 'second'],
      [13, 'error', 2, 'oops'],
    ]);
    expect(buf.size).toBe(0);
    expect(buf.total).toBe(13);
  });

  it('caps a run at 5,000 lines with a truncation marker', () => {
    const buf = new LogBuffer(LOG_LIMITS.lines - 3, 1);
    for (let i = 0; i < 10; i++) buf.push(`line ${i}`);
    const lines = buf.take();
    expect(lines).toHaveLength(3);
    expect(lines.at(-1)).toMatchObject({ seq: LOG_LIMITS.lines, level: 'warn', message: TRUNCATED_MARKER });
    expect(buf.truncated).toBe(true);
    buf.push('more');
    expect(buf.size).toBe(0);
    expect(new LogBuffer(LOG_LIMITS.lines, 3).truncated).toBe(true);
  });

  it('cuts lines at 4 KB on a character boundary', () => {
    const long = '界'.repeat(3_000); // 9,000 bytes
    const cut = truncateLine(long);
    expect(new TextEncoder().encode(cut).length).toBeLessThanOrEqual(LOG_LIMITS.lineBytes);
    expect(cut.endsWith('…')).toBe(true);
    expect(truncateLine('short')).toBe('short');
    const buf = new LogBuffer(0, 1);
    buf.push('x'.repeat(10_000));
    expect(buf.take()[0]!.message.length).toBeLessThanOrEqual(LOG_LIMITS.lineBytes);
  });

  it('masks secret values', () => {
    expect(maskSecrets('token=abcd1234 ok', ['abcd1234', 'ab'])).toBe('token=•••••• ok');
    const buf = new LogBuffer(0, 1, ['s3cr3t-value']);
    buf.push('Authorization: Bearer s3cr3t-value');
    expect(buf.take()[0]!.message).toBe('Authorization: Bearer ••••••');
  });
});

describe('cron descriptions', () => {
  it('describes the common shapes', () => {
    expect(describeCron('* * * * *')).toEqual({ kind: 'everyMinute' });
    expect(describeCron('*/15 * * * *')).toEqual({ kind: 'everyMinutes', n: 15 });
    expect(describeCron('5 * * * *')).toEqual({ kind: 'hourly', minute: 5 });
    expect(describeCron('0 */6 * * *')).toEqual({ kind: 'everyHours', n: 6, minute: 0 });
    expect(describeCron('0 7 * * *')).toEqual({ kind: 'daily', time: '07:00' });
    expect(describeCron('30 8 * * 1-5')).toEqual({ kind: 'weekdays', time: '08:30' });
    expect(describeCron('0 3 * * 0')).toEqual({ kind: 'weekly', days: [0], time: '03:00' });
    expect(describeCron('0 3 * * SUN,wed')).toEqual({ kind: 'weekly', days: [0, 3], time: '03:00' });
    expect(describeCron('0 3 * * 7')).toEqual({ kind: 'weekly', days: [0], time: '03:00' });
    expect(describeCron('15 2 1 * *')).toEqual({ kind: 'monthly', day: 1, time: '02:15' });
  });

  it('falls back to custom', () => {
    for (const expr of ['0 0 1 1 *', '0 9-17 * * *', '0 3 1 * 1', 'bad', '0 0 * * * *'])
      expect(describeCron(expr), expr).toEqual({ kind: 'custom' });
  });
});

describe('secrets in task configs', () => {
  const seal = (s: string) => `sealed(${s})`;
  const open = (s: string) => s.replace(/^sealed\((.*)\)$/, '$1');
  const http = BUILTIN_TYPES.http;
  const input = {
    method: 'POST',
    url: 'https://example.test/hook',
    headers: [
      { name: 'X-Api-Key', value: 'k-123456', secret: true },
      { name: 'Accept', value: 'application/json', secret: false },
    ],
    auth: { type: 'basic', username: 'svc', password: 'p@ssw0rd' },
  };

  it('seals secret slots and never returns them', () => {
    const stored = sealConfig(http, input, seal);
    expect(stored.headers).toEqual([
      { name: 'X-Api-Key', value: { sealed: 'sealed(k-123456)' }, secret: true },
      { name: 'Accept', value: 'application/json', secret: false },
    ]);
    expect(stored.auth).toEqual({ type: 'basic', username: 'svc', password: { sealed: 'sealed(p@ssw0rd)' } });
    const view = redactConfig(http, stored);
    expect(JSON.stringify(view)).not.toContain('sealed');
    expect(view.headers).toEqual([
      { name: 'X-Api-Key', value: { secret: true, set: true }, secret: true },
      { name: 'Accept', value: 'application/json', secret: false },
    ]);
    expect(view.auth).toEqual({ type: 'basic', username: 'svc', password: { secret: true, set: true } });
  });

  it('keeps stored values when the placeholder comes back, and replaces them when retyped', () => {
    const stored = sealConfig(http, input, seal);
    const edited = {
      ...redactConfig(http, stored),
      headers: [
        { name: 'x-api-key', value: { secret: true, set: true }, secret: true },
        { name: 'X-Trace', value: { secret: true, set: false }, secret: true },
      ],
      auth: { type: 'basic', username: 'svc', password: 'n3w-password' },
    };
    const merged = mergeSecrets(http, edited, stored);
    expect(merged.missing).toEqual(['headers.1.value']);
    expect(merged.forged).toEqual([]);
    expect((merged.config.headers as { value: unknown }[])[0]!.value).toEqual({ sealed: 'sealed(k-123456)' });
    const resealed = sealConfig(http, merged.config, seal);
    expect((resealed.auth as { password: unknown }).password).toEqual({ sealed: 'sealed(n3w-password)' });
  });

  it('refuses sealed values sent by a client', () => {
    const merged = mergeSecrets(
      http,
      { ...input, auth: { type: 'bearer', token: { sealed: 'stolen' } } },
      null,
    );
    expect(merged.forged).toEqual(['auth.token']);
  });

  it('opens secrets at run time and lists them for log masking', () => {
    const script = BUILTIN_TYPES.script;
    const stored = sealConfig(
      script,
      {
        language: 'node',
        env: [
          { name: 'TOKEN', value: 'tok-998877', secret: true },
          { name: 'REGION', value: 'tw', secret: false },
        ],
      },
      seal,
    );
    const { config, secrets } = openConfig(script, stored, open);
    expect(config.env).toEqual([
      { name: 'TOKEN', value: 'tok-998877', secret: true },
      { name: 'REGION', value: 'tw', secret: false },
    ]);
    expect(secrets).toEqual(['tok-998877']);
  });

  it('leaves module task types alone', () => {
    const cfg = { pipelineId: 'x', password: 'not ours' };
    expect(redactConfig('etl.pipeline', cfg)).toEqual(cfg);
    expect(sealConfig('etl.pipeline', cfg, seal)).toEqual(cfg);
  });
});

describe('editor helpers', () => {
  it('keeps one parameter definition per :name, defaulting built-ins', async () => {
    const { syncParams } = await import('../src/model');
    expect(
      syncParams(
        ['region', 'scheduled_for', 'run_id'],
        [
          { name: 'region', source: 'static', type: 'string', value: 'north' },
          { name: 'gone', source: 'static', type: 'string', value: 'x' },
        ],
      ),
    ).toEqual([
      { name: 'region', source: 'static', type: 'string', value: 'north' },
      { name: 'scheduled_for', source: 'scheduled_for', type: 'datetime', value: null },
      { name: 'run_id', source: 'run_id', type: 'uuid', value: null },
    ]);
  });

  it('checks a module config against its JSON Schema', async () => {
    const { jsonSchemaProblems } = await import('../src/model');
    const schema = {
      type: 'object',
      properties: {
        pipelineId: { type: 'string' },
        mode: { type: 'string', enum: ['full', 'incremental'] },
        batch: { type: 'integer', default: 500 },
      },
      required: ['pipelineId', 'batch'],
    };
    expect(jsonSchemaProblems({ pipelineId: 'p1' }, schema)).toEqual([]);
    expect(jsonSchemaProblems({ mode: 'x', batch: 1.5 }, schema)).toEqual([
      { path: 'pipelineId', problem: 'required' },
      { path: 'mode', problem: 'enum', expected: 'full, incremental' },
      { path: 'batch', problem: 'type', expected: 'integer' },
    ]);
    expect(jsonSchemaProblems([], schema)).toEqual([{ path: '', problem: 'type', expected: 'object' }]);
  });
});
