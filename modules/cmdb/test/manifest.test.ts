import { describe, expect, it } from 'vitest';
import en from '../messages/en.json';
import ja from '../messages/ja-JP.json';
import zh from '../messages/zh-TW.json';
import {
  CI_CRITICALITIES,
  CI_ENVIRONMENTS,
  CI_STATUSES,
  createCiSchema,
  createClassSchema,
  RELATIONSHIP_TYPES,
  updateCiSchema,
} from '../src/contracts';
import type { ModuleManifest } from '@isbp/sdk';
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

/** ICU arguments (`{name}`, `{count, plural, …}`); plural branch text never matches (it has spaces or `#`). */
const args = (message: string) => [...message.matchAll(/\{\s*([A-Za-z]\w*)\s*[,}]/g)].map((m) => m[1]).sort();

const get = (catalog: Catalog, path: string) =>
  path.split('.').reduce<unknown>((o, k) => (o as Catalog | undefined)?.[k], catalog);

describe('cmdb manifest', () => {
  it('only declares permissions, events and tools in its own namespace', () => {
    for (const p of manifest.permissions ?? []) expect(p.key.startsWith('cmdb.')).toBe(true);
    for (const e of manifest.events?.emits ?? []) expect(e.name.startsWith('cmdb.')).toBe(true);
    for (const tool of manifest.ai?.tools ?? []) expect(tool.name.startsWith('cmdb.')).toBe(true);
  });

  it('grants the minimal business-service list to everyone, and nothing else', () => {
    const everyone = manifest.roles?.filter((r) => r.grantByDefault) ?? [];
    expect(everyone.map((r) => r.key)).toEqual(['cmdb-service-reader']);
    expect(everyone[0]!.permissions).toEqual(['cmdb.services.read']);
    expect(manifest.roles?.find((r) => r.key === 'cmdb-manager')?.permissions).toEqual(['cmdb.*']);
  });

  it('exposes read-only AI tools that need cmdb.cis.read and say when to use them', () => {
    const tools = manifest.ai?.tools ?? [];
    expect(tools.map((t) => t.name).sort()).toEqual(['cmdb.find_cis', 'cmdb.get_ci', 'cmdb.get_impact']);
    for (const tool of tools) {
      expect(tool.permission).toBe('cmdb.cis.read');
      expect(tool.destructive).toBeFalsy();
      expect(tool.description.length).toBeGreaterThan(60);
    }
    const find = tools.find((t) => t.name === 'cmdb.find_cis')!.input;
    expect(find.parse({ query: 'erp' })).toEqual({ query: 'erp', limit: 10 });
    expect(find.safeParse({ query: 'erp', limit: 26 }).success).toBe(false);
    const get = tools.find((t) => t.name === 'cmdb.get_ci')!.input;
    expect(get.safeParse({}).success).toBe(false);
    expect(get.safeParse({ number: 'CI-00042' }).success).toBe(true);
    const impact = tools.find((t) => t.name === 'cmdb.get_impact')!.input;
    expect(impact.parse({ ciId: '0190a1b2-0000-7000-8000-000000000000' })).toMatchObject({ depth: 3 });
    expect(impact.safeParse({ ciId: '0190a1b2-0000-7000-8000-000000000000', depth: 6 }).success).toBe(false);
  });

  it('lets admins extend CIs with custom fields', () => {
    expect(manifest.customFields?.entities).toEqual([{ type: 'ci', name: 'cmdb.entities.ci' }]);
  });
});

describe('contracts', () => {
  it('fills defaults on create but never on update (a PATCH only changes what it names)', () => {
    expect(createCiSchema.parse({ name: ' tpe-app-09 ', classKey: 'server' })).toEqual({
      name: 'tpe-app-09',
      classKey: 'server',
      status: 'in_use',
      criticality: 'medium',
      tags: [],
    });
    expect(updateCiSchema.parse({ name: 'x' })).toEqual({ name: 'x' });
    expect(updateCiSchema.safeParse({ tags: ['a,b'] }).success).toBe(false);
  });

  it('validates class keys and icons', () => {
    expect(createClassSchema.safeParse({ key: 'iot-device', name: { en: 'IoT' } }).success).toBe(true);
    expect(createClassSchema.safeParse({ key: 'IoT', name: { en: 'IoT' } }).success).toBe(false);
    expect(createClassSchema.safeParse({ key: 'iot', name: {} }).success).toBe(false);
    expect(createClassSchema.safeParse({ key: 'iot', name: { en: 'x' }, icon: '<svg>' }).success).toBe(false);
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

  it('label every enum value, relationship direction, manifest string and audit action', () => {
    for (const catalog of [en, zh, ja]) {
      for (const s of CI_STATUSES) expect(get(catalog, `status.${s}`)).toBeTruthy();
      for (const e of CI_ENVIRONMENTS) expect(get(catalog, `environment.${e}`)).toBeTruthy();
      for (const c of CI_CRITICALITIES) expect(get(catalog, `criticality.${c}`)).toBeTruthy();
      for (const t of RELATIONSHIP_TYPES) {
        expect(get(catalog, `relationships.${t}.forward`)).toBeTruthy();
        expect(get(catalog, `relationships.${t}.reverse`)).toBeTruthy();
      }
      const keys = [
        manifest.name,
        manifest.description!,
        ...(manifest.navigation ?? []).map((n) => n.label),
        ...(manifest.permissions ?? []).map((p) => p.description),
        ...(manifest.customFields?.entities ?? []).map((e) => e.name),
      ];
      for (const key of keys) expect(get(catalog, key.replace(/^cmdb\./, '')), key).toBeTruthy();
      for (const action of [
        'ci.created',
        'ci.updated',
        'ci.retired',
        'ci.deleted',
        'ci.owner_released',
        'relationship.created',
        'relationship.deleted',
        'class.created',
        'class.updated',
        'class.deleted',
      ])
        expect(get(catalog, `audit.${action.replace('.', '_')}`), action).toBeTruthy();
    }
  });
});
