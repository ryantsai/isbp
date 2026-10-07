import { describe, expect, it } from 'vitest';
import {
  applyTransform,
  buildOpenApi,
  canonicalJson,
  compareWatermark,
  csvCell,
  type EndpointDefinition,
  endpointStatusOf,
  jsonSchemaFor,
  latestCallable,
  lineDiff,
  mappingIssues,
  maskParams,
  maxWatermark,
  newParam,
  type ParamDef,
  paramDrift,
  paramTypeFor,
  parseParams,
  parseTransform,
  toCsv,
  transformRow,
} from '../src/model';

const p = (over: Partial<ParamDef> & { name: string }): ParamDef => ({ ...newParam(over.name), ...over });

describe('request schema', () => {
  const params = [
    p({ name: 'region', enum: ['north', 'south'] }),
    p({ name: 'segment', required: false }),
    p({ name: 'limit', type: 'integer', required: false, default: '50', min: 1, max: 500 }),
    p({ name: 'ids', type: 'integer', list: true, required: false }),
    p({ name: 'active', type: 'boolean', required: false }),
    p({ name: 'price', type: 'decimal', required: false, min: 0 }),
    p({ name: 'day', type: 'date', required: false }),
  ];

  it('coerces query-string values, fills defaults and nulls', () => {
    const r = parseParams(params, { region: 'north', ids: ['1', '2,3'], active: 'true', price: '12.50' });
    expect(r).toEqual({
      success: true,
      data: {
        region: 'north',
        segment: null,
        limit: 50,
        ids: [1, 2, 3],
        active: true,
        price: '12.50',
        day: null,
      },
    });
  });

  it('accepts typed JSON values (POST bodies)', () => {
    const r = parseParams(params, { region: 'south', limit: 10, ids: [4], active: false, price: 3 });
    expect(r.success && r.data).toMatchObject({ limit: 10, ids: [4], active: false, price: '3' });
  });

  it('reports every invalid field, unknown parameters and missing required ones', () => {
    const r = parseParams(params, { limit: '0', active: 'maybe', day: '2026-02-30', regoin: 'north' });
    expect(r.success).toBe(false);
    const paths = !r.success ? r.issues.map((i) => i.path).sort() : [];
    expect(paths).toEqual(['active', 'day', 'limit', 'region', 'regoin']);
    const region = !r.success ? r.issues.find((i) => i.path === 'region') : null;
    expect(region?.message).toBe('Required');
  });

  it('enforces enums, patterns and lengths', () => {
    const code = [p({ name: 'code', pattern: '^C\\d{5}$', maxLength: 6 })];
    expect(parseParams(code, { code: 'C00042' }).success).toBe(true);
    expect(parseParams(code, { code: 'C42' }).success).toBe(false);
    expect(parseParams(params, { region: 'west' }).success).toBe(false);
    expect(parseParams([p({ name: 's' })], { s: 'x'.repeat(4_001) }).success).toBe(false);
  });

  it('rejects lists that are too long and single values given twice', () => {
    const many = Array.from({ length: 1_001 }, (_, i) => String(i));
    expect(parseParams(params, { region: 'north', ids: many }).success).toBe(false);
    expect(parseParams(params, { region: ['north', 'south'] }).success).toBe(false);
  });

  it('keeps integers within the safe range', () => {
    expect(parseParams([p({ name: 'n', type: 'integer' })], { n: '9999999999999999' }).success).toBe(false);
    expect(parseParams([p({ name: 'n', type: 'integer' })], { n: '1.5' }).success).toBe(false);
  });
});

describe('logs, cache keys and CSV', () => {
  it('masks sensitive parameters', () => {
    const defs = [p({ name: 'token', sensitive: true }), p({ name: 'q' })];
    expect(maskParams({ token: 'secret', q: 'x' }, defs)).toEqual({ token: '•••', q: 'x' });
    expect(maskParams({ token: null }, defs)).toEqual({ token: null });
  });

  it('serializes canonically (sorted keys) for cache keys and hashes', () => {
    expect(canonicalJson({ b: 1, a: { d: [2, 1], c: null } })).toBe(
      canonicalJson({ a: { c: null, d: [2, 1] }, b: 1 }),
    );
    expect(canonicalJson({ a: undefined, b: 1 })).toBe('{"b":1}');
  });

  it('quotes per RFC 4180 and guards against formulas', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('two\nlines')).toBe('"two\nlines"');
    expect(csvCell('=SUM(A1:A2)')).toBe("'=SUM(A1:A2)");
    expect(csvCell('+1')).toBe("'+1");
    expect(csvCell('@cmd')).toBe("'@cmd");
    expect(csvCell('-12.50')).toBe('-12.50');
    expect(csvCell(-3)).toBe('-3');
    expect(csvCell(null)).toBe('');
    expect(csvCell({ a: 1 })).toBe('"{""a"":1}"');
    expect(toCsv(['a', 'b'], [{ a: 1, b: 'x' }])).toBe('a,b\r\n1,x\r\n');
  });
});

describe('types and diffs', () => {
  it('maps catalog types to parameter and JSON types', () => {
    expect(paramTypeFor('character varying')).toBe('string');
    expect(paramTypeFor('int4')).toBe('integer');
    expect(paramTypeFor('numeric')).toBe('decimal');
    expect(paramTypeFor('date')).toBe('date');
    expect(paramTypeFor('timestamp with time zone')).toBe('datetime');
    expect(paramTypeFor('uniqueidentifier')).toBe('uuid');
    expect(jsonSchemaFor('int8')).toEqual({ type: 'string', format: 'int64' });
    expect(jsonSchemaFor('timestamptz')).toEqual({ type: 'string', format: 'date-time' });
    expect(jsonSchemaFor('bool')).toEqual({ type: 'boolean' });
    expect(jsonSchemaFor('numeric')).toEqual({ type: 'string', format: 'decimal' });
  });

  it('finds parameters missing from or unused by the SQL', () => {
    expect(paramDrift(['a', 'b'], ['b', 'c'])).toEqual({ missing: ['c'], unused: ['a'] });
  });

  it('diffs lines', () => {
    expect(lineDiff('a\nb\nc', 'a\nc\nd')).toEqual([
      { kind: 'same', text: 'a' },
      { kind: 'remove', text: 'b' },
      { kind: 'same', text: 'c' },
      { kind: 'add', text: 'd' },
    ]);
  });

  it('derives the endpoint status and the version /data/<slug> serves', () => {
    expect(endpointStatusOf([])).toBe('draft');
    expect(endpointStatusOf(['deprecated', 'published'])).toBe('published');
    expect(endpointStatusOf(['deprecated', 'retired'])).toBe('deprecated');
    expect(endpointStatusOf(['retired'])).toBe('retired');
    const v = (version: number, status: 'published' | 'deprecated' | 'retired') => ({ version, status });
    expect(latestCallable([v(1, 'published'), v(2, 'published')])?.version).toBe(2);
    expect(latestCallable([v(1, 'published'), v(2, 'retired')])?.version).toBe(1);
    expect(latestCallable([v(1, 'deprecated'), v(2, 'retired')])?.version).toBe(1);
    expect(latestCallable([v(1, 'retired')])).toBeNull();
  });
});

describe('pipeline transforms', () => {
  it('parses transform strings', () => {
    expect(parseTransform('cast:integer')).toEqual({ kind: 'cast', arg: 'integer' });
    expect(parseTransform('default:n/a')).toEqual({ kind: 'default', arg: 'n/a' });
    expect(parseTransform('constant:a:b')).toEqual({ kind: 'constant', arg: 'a:b' });
    expect(parseTransform('trim')).toEqual({ kind: 'trim', arg: null });
  });

  it('applies the fixed operations', () => {
    expect(applyTransform('  x ', 'trim')).toEqual({ ok: true, value: 'x' });
    expect(applyTransform('ab', 'upper')).toEqual({ ok: true, value: 'AB' });
    expect(applyTransform('AB', 'lower')).toEqual({ ok: true, value: 'ab' });
    expect(applyTransform(5, 'trim')).toEqual({ ok: true, value: 5 });
    expect(applyTransform(null, 'default:smb')).toEqual({ ok: true, value: 'smb' });
    expect(applyTransform('', 'default:smb')).toEqual({ ok: true, value: 'smb' });
    expect(applyTransform('ent', 'default:smb')).toEqual({ ok: true, value: 'ent' });
    expect(applyTransform('anything', 'constant:TW')).toEqual({ ok: true, value: 'TW' });
    expect(applyTransform(undefined, 'none')).toEqual({ ok: true, value: null });
  });

  it('casts values or rejects them', () => {
    expect(applyTransform('42', 'cast:integer')).toEqual({ ok: true, value: 42 });
    expect(applyTransform('42.0', 'cast:integer')).toEqual({ ok: true, value: 42 });
    expect(applyTransform('4.2', 'cast:integer').ok).toBe(false);
    expect(applyTransform('', 'cast:integer').ok).toBe(false);
    expect(applyTransform(12.5, 'cast:decimal')).toEqual({ ok: true, value: '12.5' });
    expect(applyTransform('1e3', 'cast:decimal').ok).toBe(false);
    expect(applyTransform('Y', 'cast:boolean')).toEqual({ ok: true, value: true });
    expect(applyTransform('0', 'cast:boolean')).toEqual({ ok: true, value: false });
    expect(applyTransform('maybe', 'cast:boolean').ok).toBe(false);
    expect(applyTransform('2026-10-07T12:00:00Z', 'cast:date')).toEqual({ ok: true, value: '2026-10-07' });
    expect(applyTransform('2026-02-30', 'cast:date').ok).toBe(false);
    expect(applyTransform('2026-10-07 08:00:00+08', 'cast:datetime')).toEqual({
      ok: true,
      value: '2026-10-07T00:00:00.000Z',
    });
    expect(applyTransform({ a: 1 }, 'cast:string')).toEqual({ ok: true, value: '{"a":1}' });
    expect(applyTransform(null, 'cast:integer')).toEqual({ ok: true, value: null });
  });

  it('maps rows and rejects empty keys', () => {
    const mappings = [
      { source: 'code', target: 'customer_code', transform: 'upper' },
      { source: 'name', target: 'name', transform: 'trim' },
    ];
    expect(transformRow({ code: 'c1', name: ' A ' }, mappings, ['customer_code'])).toEqual({
      ok: true,
      row: { customer_code: 'C1', name: 'A' },
    });
    expect(transformRow({ code: null, name: 'A' }, mappings, ['customer_code'])).toMatchObject({
      ok: false,
      column: 'customer_code',
    });
    expect(transformRow({ n: 'x' }, [{ source: 'n', target: 'n', transform: 'cast:integer' }])).toMatchObject(
      {
        ok: false,
        column: 'n',
      },
    );
  });

  it('checks mappings against the target table', () => {
    const columns = ['customer_code', 'name', 'loaded_at'];
    const ok = mappingIssues(
      {
        mode: 'upsert',
        keys: ['customer_code'],
        mappings: [{ source: 'code', target: 'customer_code', transform: 'none' }],
      },
      columns,
    );
    expect(ok).toEqual([]);
    expect(mappingIssues({ mode: 'insert', keys: [], mappings: [] }, null)[0]!.path).toBe('target.table');
    const bad = mappingIssues(
      {
        mode: 'upsert',
        keys: ['region'],
        mappings: [
          { source: 'a', target: 'nope', transform: 'none' },
          { source: 'b', target: 'name', transform: 'shout' },
          { source: 'c', target: 'name', transform: 'none' },
        ],
      },
      columns,
    ).map((i) => i.path);
    expect(bad).toEqual(['mappings.0.target', 'mappings.1.transform', 'mappings.2.target', 'target.keys.0']);
    expect(
      mappingIssues(
        { mode: 'upsert', keys: [], mappings: [{ source: 'a', target: 'name', transform: 'none' }] },
        columns,
      ),
    ).toEqual([{ path: 'target.keys', message: 'Upsert needs key columns' }]);
  });

  it('orders watermarks by number, time or text', () => {
    expect(compareWatermark('10', '9')).toBeGreaterThan(0);
    expect(compareWatermark('2026-10-07T10:00:00.000Z', '2026-10-07T09:00:00.000Z')).toBeGreaterThan(0);
    expect(compareWatermark('2026-10-07 10:00:00', '2026-10-08 01:00:00')).toBeLessThan(0);
    expect(compareWatermark('b', 'a')).toBeGreaterThan(0);
    expect(maxWatermark(null, '5')).toBe('5');
    expect(maxWatermark('5', null)).toBe('5');
    expect(maxWatermark('5', 12)).toBe('12');
    expect(maxWatermark('2026-01-02T00:00:00.000Z', '2026-01-01T00:00:00.000Z')).toBe(
      '2026-01-02T00:00:00.000Z',
    );
  });
});

describe('OpenAPI', () => {
  const definition: EndpointDefinition = {
    method: 'GET',
    connectionId: '00000000-0000-4000-8000-000000000001',
    kind: 'query',
    sql: 'SELECT code FROM t WHERE region = :region',
    procedure: null,
    params: [
      p({ name: 'region', enum: ['north', 'south'], example: 'north', description: 'Region' }),
      p({ name: 'limit', type: 'integer', required: false, default: '50', min: 1, max: 500 }),
      p({ name: 'ids', type: 'integer', list: true, required: false }),
    ],
    allowsWrites: false,
    responseShape: 'rows',
    maxRows: 100,
    timeoutMs: 30_000,
    cacheTtlSeconds: 0,
  };

  it('documents published versions with typed parameters, responses and security', () => {
    const doc = buildOpenApi(
      [
        {
          slug: 'customers',
          name: 'Customers',
          description: null,
          versions: [
            { version: 1, status: 'deprecated', definition, columns: [{ name: 'code', type: 'varchar' }] },
            {
              version: 2,
              status: 'published',
              definition,
              columns: [
                { name: 'code', type: 'varchar' },
                { name: 'n', type: 'int4' },
              ],
            },
            { version: 3, status: 'retired', definition, columns: [] },
          ],
        },
        {
          slug: 'gone',
          name: 'Gone',
          description: null,
          versions: [{ version: 1, status: 'retired', definition, columns: [] }],
        },
      ],
      { title: 'Data APIs', version: '1' },
    );
    expect(doc.openapi).toBe('3.1.0');
    expect(Object.keys(doc.paths).sort()).toEqual([
      '/api/v1/etl/data/customers',
      '/api/v1/etl/data/customers/v1',
      '/api/v1/etl/data/customers/v2',
    ]);
    const latest = doc.paths['/api/v1/etl/data/customers']!.get as Record<string, unknown>;
    const parameters = latest.parameters as Record<string, unknown>[];
    expect(parameters[0]).toMatchObject({
      name: 'region',
      in: 'query',
      required: true,
      schema: { type: 'string', enum: ['north', 'south'] },
    });
    expect(parameters[1]).toMatchObject({
      name: 'limit',
      required: false,
      schema: { type: 'integer', minimum: 1, maximum: 500, default: 50 },
    });
    expect(parameters[2]).toMatchObject({
      name: 'ids',
      schema: { type: 'array', items: { type: 'integer' } },
      explode: true,
    });
    const responses = latest.responses as Record<string, Record<string, unknown>>;
    const json = (
      responses[200]!.content as Record<
        string,
        { schema: { properties: { data: { items: { properties: Record<string, unknown> } } } } }
      >
    )['application/json']!;
    expect(json.schema.properties.data.items.properties).toEqual({
      code: { type: ['string', 'null'] },
      n: { type: ['integer', 'null'] },
    });
    expect((doc.paths['/api/v1/etl/data/customers/v1']!.get as Record<string, unknown>).deprecated).toBe(
      true,
    );
    expect(doc.components.securitySchemes.bearerAuth).toMatchObject({ type: 'http', scheme: 'bearer' });
    expect(doc.components.securitySchemes.oauth2.flows.clientCredentials.tokenUrl).toBe(
      '/api/v1/oauth/token',
    );
  });

  it('documents POST bodies', () => {
    const doc = buildOpenApi(
      [
        {
          slug: 'x',
          name: 'X',
          description: null,
          versions: [
            { version: 1, status: 'published', definition: { ...definition, method: 'POST' }, columns: [] },
          ],
        },
      ],
      { title: 't', version: '1' },
    );
    const op = doc.paths['/api/v1/etl/data/x']!.post as {
      requestBody: { content: Record<string, { schema: { required: string[] } }> };
    };
    expect(op.requestBody.content['application/json']!.schema.required).toEqual(['region']);
  });
});
