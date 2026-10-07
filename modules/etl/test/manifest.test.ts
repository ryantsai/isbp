import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { ModuleManifest } from '@isbp/sdk';
import { describe, expect, it } from 'vitest';
import en from '../messages/en.json';
import ja from '../messages/ja-JP.json';
import zh from '../messages/zh-TW.json';
import {
  CALL_PERIODS,
  CAST_TYPES,
  createEndpointSchema,
  ENDPOINT_KINDS,
  ENDPOINT_STATUSES,
  endpointDefinitionSchema,
  PARAM_TYPES,
  paramDefSchema,
  pipelineInputSchema,
  pipelineUpdateSchema,
  RESPONSE_SHAPES,
  RUN_STATUSES,
  RUN_TRIGGERS,
  TRANSFORM_KINDS,
  updateEndpointSchema,
  VERSION_STATUSES,
  WRITE_MODES,
} from '../src/contracts';
import { manifest as typed } from '../src/manifest';

/** Widened to the SDK types (the manifest itself is a const literal). */
const manifest: ModuleManifest = typed;

type Catalog = Record<string, unknown>;

const flat = (o: Catalog, p = ''): [string, string][] =>
  Object.entries(o).flatMap(([k, v]) =>
    typeof v === 'object' && v
      ? flat(v as Catalog, `${p}${k}.`)
      : [[`${p}${k}`, String(v)] as [string, string]],
  );

/** ICU arguments (`{name}`, `{count, plural, …}`); branch text never matches (it has spaces, `#` or CJK). */
const args = (message: string) => [...message.matchAll(/\{\s*([A-Za-z]\w*)\s*[,}]/g)].map((m) => m[1]).sort();

const get = (catalog: Catalog, path: string) =>
  path.split('.').reduce<unknown>((o, k) => (o as Catalog | undefined)?.[k], catalog);

describe('etl manifest', () => {
  it('only declares permissions, events, tools and notifications in its own namespace', () => {
    for (const p of manifest.permissions ?? []) expect(p.key.startsWith('etl.')).toBe(true);
    for (const e of manifest.events?.emits ?? []) expect(e.name.startsWith('etl.')).toBe(true);
    for (const tool of manifest.ai?.tools ?? []) expect(tool.name.startsWith('etl.')).toBe(true);
    for (const n of manifest.notifications ?? []) expect(n.type.startsWith('etl.')).toBe(true);
  });

  it('declares the exact permissions and roles the platform seed grants', () => {
    expect(manifest.permissions?.map((p) => [p.key, p.scopes ?? ['global']])).toEqual([
      ['etl.endpoints.read', ['global']],
      ['etl.endpoints.manage', ['global']],
      ['etl.endpoints.invoke', ['global', 'record']],
      ['etl.pipelines.read', ['global']],
      ['etl.pipelines.manage', ['global']],
      ['etl.pipelines.run', ['global']],
    ]);
    expect(Object.fromEntries((manifest.roles ?? []).map((r) => [r.key, r.permissions]))).toEqual({
      'etl-viewer': ['etl.endpoints.read', 'etl.pipelines.read'],
      'etl-developer': ['etl.*'],
      'etl-consumer': ['etl.endpoints.invoke'],
    });
    expect(manifest.roles?.some((r) => r.grantByDefault)).toBe(false);
  });

  it('puts three entries in the Data APIs & ETL group', () => {
    expect(manifest.navigation?.map((n) => [n.href, n.icon, n.order, n.group, n.section])).toEqual([
      ['/etl', 'database-zap', 56, 'etl.nav.group', 'main'],
      ['/etl/pipelines', 'workflow', 57, 'etl.nav.group', 'main'],
      ['/etl/logs', 'scroll-text', 58, 'etl.nav.group', 'main'],
    ]);
  });

  it('declares records, the pipeline task type, settings, tools and events', () => {
    expect(manifest.records?.types.map((t) => [t.type, t.permission])).toEqual([
      ['endpoint', 'etl.endpoints.read'],
      ['pipeline', 'etl.pipelines.read'],
    ]);
    const task = manifest.taskTypes?.[0];
    expect([task?.type, task?.permission]).toEqual(['pipeline', 'etl.pipelines.run']);
    expect(task?.config.safeParse({ pipelineId: '0190a1b2-0000-7000-8000-000000000000' }).success).toBe(true);
    expect(task?.config.safeParse({}).success).toBe(false);
    expect(manifest.settings?.map((s) => [s.key, s.type, s.default])).toEqual([
      ['logRetentionDays', 'number', 30],
      ['defaultRateLimitPerMinute', 'number', 120],
    ]);
    expect(manifest.ai?.tools?.map((t) => [t.name, t.permission, Boolean(t.destructive)])).toEqual([
      ['etl.list_endpoints', 'etl.endpoints.read', false],
      ['etl.run_pipeline', 'etl.pipelines.run', true],
    ]);
    for (const e of manifest.events?.emits ?? []) expect(e.schema, e.name).toBeDefined();
    expect(manifest.events?.emits?.map((e) => e.name)).toEqual(
      expect.arrayContaining(['etl.endpoint.published', 'etl.endpoint.retired', 'etl.pipeline.run_failed']),
    );
    expect(manifest.events?.consumes).toEqual(['core.db-connection.deleted']);
  });
});

describe('contracts', () => {
  const connectionId = '0190a1b2-0000-7000-8000-000000000001';

  it('fills defaults on create but never on update', () => {
    expect(createEndpointSchema.parse({ name: ' X ', slug: 'x-1', connectionId })).toEqual({
      name: 'X',
      slug: 'x-1',
      description: null,
      method: 'GET',
      connectionId,
      kind: 'query',
    });
    expect(updateEndpointSchema.parse({ name: 'x' })).toEqual({ name: 'x' });
    expect(pipelineUpdateSchema.parse({ name: 'x' })).toEqual({ name: 'x' });
  });

  it('validates slugs, parameter names, patterns and duplicate parameters', () => {
    for (const slug of ['customers', 'customers-by-region', 'v2-api'])
      expect(createEndpointSchema.safeParse({ name: 'x', slug, connectionId }).success, slug).toBe(true);
    for (const slug of ['Customers', '1x', 'a--b', 'a-', 'x', 'snake_case'])
      expect(createEndpointSchema.safeParse({ name: 'x', slug, connectionId }).success, slug).toBe(false);
    expect(paramDefSchema.safeParse({ name: 'region' }).success).toBe(true);
    expect(paramDefSchema.safeParse({ name: 'bad name' }).success).toBe(false);
    expect(paramDefSchema.safeParse({ name: 'p', pattern: '([' }).success).toBe(false);
    expect(paramDefSchema.safeParse({ name: 'p', min: 5, max: 1 }).success).toBe(false);
    expect(
      endpointDefinitionSchema.safeParse({ connectionId, params: [{ name: 'a' }, { name: 'a' }] }).success,
    ).toBe(false);
  });

  it('checks procedure arguments and pipeline transforms', () => {
    const procedure = {
      schema: 'erp',
      name: 'f',
      kind: 'function',
      returns: null,
      parameters: [{ name: 'from_date', type: 'date', direction: 'in' }],
    };
    expect(
      endpointDefinitionSchema.safeParse({
        connectionId,
        kind: 'procedure',
        procedure,
        params: [{ name: 'from', target: 'from_date' }],
      }).success,
    ).toBe(true);
    expect(
      endpointDefinitionSchema.safeParse({
        connectionId,
        kind: 'procedure',
        procedure,
        params: [{ name: 'to' }],
      }).success,
    ).toBe(false);
    const pipeline = {
      name: 'p',
      source: { connectionId, sql: 'select 1' },
      target: { connectionId, table: 't' },
      mappings: [{ source: 'a', target: 'b', transform: 'cast:integer' }],
    };
    expect(pipelineInputSchema.safeParse(pipeline).success).toBe(true);
    expect(
      pipelineInputSchema.safeParse({
        ...pipeline,
        mappings: [{ source: 'a', target: 'b', transform: 'eval:x' }],
      }).success,
    ).toBe(false);
  });
});

/** Literal `t('key')` calls in the pages, resolved against the namespace of the closest `useTranslations`. */
function usedKeys(): { file: string; key: string; prefix: boolean }[] {
  const root = join(__dirname, '../src/web');
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.tsx?$/.test(f)) files.push(p);
    }
  };
  walk(root);
  const out: { file: string; key: string; prefix: boolean }[] = [];
  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    const decl = /const (\w+) = useTranslations\('([^']+)'\)/g;
    const scopes: { at: number; name: string; ns: string }[] = [];
    for (const m of src.matchAll(decl)) scopes.push({ at: m.index!, name: m[1]!, ns: m[2]! });
    const call = /\b(\w+)\(\s*(?:'([^']+)'|`([^`$]*)\$\{)/g;
    for (const m of src.matchAll(call)) {
      const scope = [...scopes].reverse().find((s) => s.name === m[1] && s.at < m.index!);
      if (!scope || !scope.ns.startsWith('etl')) continue;
      const ns = scope.ns.replace(/^etl\.?/, '');
      if (m[2]) out.push({ file, key: ns ? `${ns}.${m[2]}` : m[2], prefix: false });
      else if (m[3] !== undefined)
        out.push({ file, key: (ns ? `${ns}.${m[3]}` : m[3]).replace(/\.$/, ''), prefix: true });
    }
  }
  return out;
}

describe('catalogs', () => {
  it('ship the same keys and ICU arguments in every locale', () => {
    const base = new Map(flat(en));
    for (const [label, catalog] of [
      ['zh-TW', zh],
      ['ja-JP', ja],
    ] as const) {
      const other = new Map(flat(catalog));
      expect([...other.keys()].sort(), label).toEqual([...base.keys()].sort());
      for (const [key, value] of base) expect(args(other.get(key)!), `${label} ${key}`).toEqual(args(value));
    }
  });

  it('never use characters ICU treats specially', () => {
    for (const catalog of [en, zh, ja])
      for (const [key, value] of flat(catalog)) {
        expect(value, key).not.toMatch(/[<>]/);
        expect(value, key).not.toContain("'");
      }
  });

  it('have every key the pages use', () => {
    const keys = usedKeys();
    expect(keys.length).toBeGreaterThan(200);
    for (const { file, key, prefix } of keys) {
      const value = get(en, key);
      if (prefix) expect(typeof value, `${file}: ${key}…`).toBe('object');
      else expect(typeof value, `${file}: ${key}`).toBe('string');
    }
  });

  it('label every enum value, manifest string, audit action and notification', () => {
    const enums: [string, readonly string[]][] = [
      ['endpointStatus', ENDPOINT_STATUSES],
      ['versionStatus', VERSION_STATUSES],
      ['runStatus', RUN_STATUSES],
      ['runTrigger', RUN_TRIGGERS],
      ['kind', ENDPOINT_KINDS],
      ['shape', RESPONSE_SHAPES],
      ['writeMode', WRITE_MODES],
      ['params.types', PARAM_TYPES],
      ['mapping.transforms', TRANSFORM_KINDS],
      ['mapping.castTypes', CAST_TYPES],
      ['logs.periods', CALL_PERIODS],
      ['engine', ['mssql', 'postgres', 'mysql', 'oracle']],
    ];
    for (const catalog of [en, zh, ja]) {
      for (const [prefix, values] of enums)
        for (const v of values) expect(get(catalog, `${prefix}.${v}`), `${prefix}.${v}`).toBeTruthy();
      const keys = [
        manifest.name,
        manifest.description!,
        ...(manifest.navigation ?? []).flatMap((n) => [n.label, n.group!]),
        ...(manifest.permissions ?? []).map((p) => p.description),
        ...(manifest.settings ?? []).flatMap((s) => [s.label, s.description!]),
        ...(manifest.records?.types ?? []).map((r) => r.name),
        ...(manifest.taskTypes ?? []).flatMap((t) => [t.name, t.description!]),
      ];
      for (const key of keys) expect(get(catalog, key.replace(/^etl\./, '')), key).toBeTruthy();
      for (const action of [
        'endpoint.created',
        'endpoint.updated',
        'endpoint.deleted',
        'endpoint.tested',
        'endpoint.published',
        'endpoint.deprecated',
        'endpoint.retired',
        'endpoint.restored',
        'endpoint.draft_loaded',
        'endpoint.access_denied',
        'endpoint.connection_missing',
        'pipeline.created',
        'pipeline.updated',
        'pipeline.deleted',
        'pipeline.run_requested',
        'pipeline.run_cancelled',
        'pipeline.run_succeeded',
        'pipeline.run_failed',
        'pipeline.connection_missing',
      ])
        expect(get(catalog, `audit.${action.replace('.', '_')}`), action).toBeTruthy();
      for (const n of manifest.notifications ?? []) {
        const key = `notifications.${n.type.replace(/^etl\./, '').replace(/[.-]/g, '_')}`;
        for (const part of ['label', 'title', 'body'])
          expect(get(catalog, `${key}.${part}`), `${key}.${part}`).toBeTruthy();
      }
    }
  });
});
