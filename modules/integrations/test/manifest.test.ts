import type { ModuleManifest } from '@isbp/sdk';
import { describe, expect, it } from 'vitest';
import en from '../messages/en.json';
import ja from '../messages/ja-JP.json';
import zh from '../messages/zh-TW.json';
import {
  CONFLICT_POLICIES,
  CONFLICT_STATUSES,
  COUNT_KEYS,
  createConnectionSchema,
  createProfileSchema,
  DIRECTIONS,
  FIELD_TYPES,
  FILTER_OPS,
  HEALTHS,
  LINK_STATES,
  RUN_KINDS,
  RUN_STATUSES,
  RUN_TRIGGERS,
  updateConnectionSchema,
  updateProfileSchema,
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
const args = (message: string) =>
  [...new Set([...message.matchAll(/\{\s*([A-Za-z]\w*)\s*[,}]/g)].map((m) => m[1]))].sort();

const get = (catalog: Catalog, path: string) =>
  path.split('.').reduce<unknown>((o, k) => (o as Catalog | undefined)?.[k], catalog);

describe('integrations manifest', () => {
  it('only declares names in its own namespace', () => {
    for (const p of manifest.permissions ?? []) expect(p.key.startsWith('integrations.')).toBe(true);
    for (const e of manifest.events?.emits ?? []) expect(e.name.startsWith('integrations.')).toBe(true);
    for (const n of manifest.notifications ?? []) expect(n.type.startsWith('integrations.')).toBe(true);
  });

  it('declares the permissions, roles and agent the platform seed relies on', () => {
    expect(manifest.permissions?.map((p) => p.key)).toEqual([
      'integrations.connections.read',
      'integrations.connections.manage',
      'integrations.conflicts.resolve',
    ]);
    expect(Object.fromEntries((manifest.roles ?? []).map((r) => [r.key, r.permissions]))).toEqual({
      'integrations-viewer': ['integrations.connections.read'],
      'integrations-admin': ['integrations.*', '*.*.sync'],
    });
    expect(manifest.roles?.some((r) => r.grantByDefault)).toBe(false);
    // The hub writes as its agent, which holds every entity's sync permission and nothing else.
    expect(manifest.ai?.agent).toEqual({ name: 'Integrations Hub', permissions: ['*.*.sync'] });
    expect(manifest.ai?.tools ?? []).toEqual([]);
  });

  it('emits the documented events, each with a schema', () => {
    expect(manifest.events?.emits?.map((e) => e.name).sort()).toEqual(
      [
        'integrations.connection.created',
        'integrations.connection.updated',
        'integrations.connection.deleted',
        'integrations.profile.created',
        'integrations.profile.updated',
        'integrations.profile.deleted',
        'integrations.run.finished',
        'integrations.conflict.created',
        'integrations.conflict.resolved',
      ].sort(),
    );
    for (const e of manifest.events?.emits ?? []) expect(e.schema, e.name).toBeDefined();
    expect(manifest.events?.consumes ?? []).toEqual([]);
  });

  it('offers a task type for Scheduled Jobs and lives in Administration', () => {
    expect(manifest.taskTypes?.map((t) => [t.type, t.permission])).toEqual([
      ['sync', 'integrations.connections.manage'],
    ]);
    expect(manifest.taskTypes![0]!.config.safeParse({ profileId: 'nope' }).success).toBe(false);
    expect(manifest.navigation?.map((n) => [n.href, n.section, n.group])).toEqual([
      ['/integrations', 'admin', 'integrations.nav.group'],
      ['/integrations/conflicts', 'admin', 'integrations.nav.group'],
    ]);
  });
});

describe('contracts', () => {
  it('fill defaults on create but never on update (R26)', () => {
    const p = createProfileSchema.parse({
      connectionId: '01900000-0000-7000-8000-000000000001',
      name: 'x',
      objectType: 'request',
      entity: 'itsm.ticket',
    });
    expect(p).toMatchObject({
      direction: 'pull',
      createLocal: true,
      conflictPolicy: 'manual',
      intervalMinutes: 15,
    });
    expect(updateProfileSchema.parse({ name: 'y' })).toEqual({ name: 'y' });
    expect(updateConnectionSchema.parse({ name: 'z' })).toEqual({ name: 'z' });
    expect(createConnectionSchema.parse({ name: 'c', type: 'sdp.cloud' })).toMatchObject({
      enabled: true,
      allowInsecureHttp: false,
      secrets: {},
    });
  });

  it('refuse malformed names and limits', () => {
    expect(createConnectionSchema.safeParse({ name: 'c', type: 'sdp' }).success).toBe(false);
    expect(
      createProfileSchema.safeParse({
        connectionId: '01900000-0000-7000-8000-000000000001',
        name: 'x',
        objectType: 'request',
        entity: 'itsm.ticket',
        intervalMinutes: 5_000,
      }).success,
    ).toBe(false);
  });
});

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

  it('label every enum value, manifest string, audit action and notification', () => {
    const enums: [string, readonly string[]][] = [
      ['health', HEALTHS],
      ['runStatus', RUN_STATUSES],
      ['runTrigger', RUN_TRIGGERS],
      ['runKind', RUN_KINDS],
      ['linkState', LINK_STATES],
      ['conflictStatus', CONFLICT_STATUSES],
      ['direction', DIRECTIONS],
      ['policy', CONFLICT_POLICIES],
      ['counts', COUNT_KEYS],
      ['fieldType', FIELD_TYPES],
      ['filter.ops', FILTER_OPS],
      ['mapping.dir', ['both', 'pull', 'push']],
      [
        'issues',
        [
          'unknown_local',
          'unknown_remote',
          'duplicate_local',
          'duplicate_remote',
          'incompatible',
          'no_direction',
          'unknown_local_choice',
          'unknown_remote_choice',
          'duplicate_value',
          'duplicate_local_value',
          'match_unsupported',
          'required_unmapped',
          'remote_required_unmapped',
          'create_local_needs_pull',
          'create_remote_needs_push',
          'create_unsupported',
          'comments_unsupported',
          'too_many',
        ],
      ],
    ];
    for (const catalog of [en, zh, ja]) {
      for (const [prefix, values] of enums)
        for (const v of values) expect(get(catalog, `${prefix}.${v}`), `${prefix}.${v}`).toBeTruthy();
      for (const d of DIRECTIONS) expect(get(catalog, `direction.${d}Hint`), d).toBeTruthy();
      for (const p of CONFLICT_POLICIES) expect(get(catalog, `policy.${p}Hint`), p).toBeTruthy();
      const keys = [
        manifest.name,
        manifest.description!,
        ...(manifest.navigation ?? []).flatMap((n) => [n.label, n.group!]),
        ...(manifest.permissions ?? []).map((p) => p.description),
        ...(manifest.taskTypes ?? []).flatMap((t) => [t.name, t.description!]),
      ];
      for (const key of keys) expect(get(catalog, key.replace(/^integrations\./, '')), key).toBeTruthy();
      for (const action of [
        'connection.created',
        'connection.updated',
        'connection.deleted',
        'connection.secret_rotated',
        'connection.insecure_http_changed',
        'profile.created',
        'profile.updated',
        'profile.deleted',
        'run.requested',
        'conflict.created',
        'conflict.resolved',
        'conflict.dismissed',
        'link.relinked',
        'link.unlinked',
        'webhook.rejected',
      ])
        expect(get(catalog, `audit.${action.replace('.', '_')}`), action).toBeTruthy();
      for (const n of manifest.notifications ?? []) {
        const key = `notifications.${n.type.replace(/^integrations\./, '').replace(/[.-]/g, '_')}`;
        for (const part of ['label', 'title', 'body'])
          expect(get(catalog, `${key}.${part}`), `${key}.${part}`).toBeTruthy();
      }
    }
  });
});
