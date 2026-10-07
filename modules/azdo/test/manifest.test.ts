import { type ModuleManifest, serializeManifest } from '@isbp/sdk';
import { describe, expect, it } from 'vitest';
import en from '../messages/en.json';
import ja from '../messages/ja-JP.json';
import zh from '../messages/zh-TW.json';
import { API_VERSIONS, collectionUrlIssue } from '../src/contracts';
import { manifest as typed } from '../src/manifest';
import server from '../src/server';

/** Widened to the SDK types (the manifest itself is a const literal). */
const manifest: ModuleManifest = typed;

type Catalog = Record<string, unknown>;

const flat = (o: Catalog, p = ''): [string, string][] =>
  Object.entries(o).flatMap(([k, v]) =>
    typeof v === 'object' && v
      ? flat(v as Catalog, `${p}${k}.`)
      : [[`${p}${k}`, String(v)] as [string, string]],
  );

/** ICU arguments (`{name}`, `{count, plural, …}`). */
const args = (message: string) => [...message.matchAll(/\{\s*([A-Za-z]\w*)\s*[,}]/g)].map((m) => m[1]).sort();

const get = (catalog: Catalog, path: string) =>
  path.split('.').reduce<unknown>((o, k) => (o as Catalog | undefined)?.[k], catalog);

describe('azdo manifest', () => {
  it('declares only the azdo.server connector: no pages, tables or permissions', () => {
    expect(manifest.navigation ?? []).toEqual([]);
    expect(manifest.permissions ?? []).toEqual([]);
    expect(manifest.events?.emits ?? []).toEqual([]);
    expect(manifest.connectors?.map((c) => c.type)).toEqual(['server']);
    expect(server.connectors?.server).toBeDefined();
    expect(server.migrations ?? []).toEqual([]);
  });

  it('describes the three remote objects and what they can do', () => {
    const objects = manifest.connectors![0]!.objects;
    expect(objects.map((o) => [o.type, o.entities, o.scoped ?? false])).toEqual([
      ['project', ['projects.project'], false],
      ['work-item', ['projects.task'], true],
      ['repository', ['alm.repository'], true],
    ]);
    expect(objects[0]!.capabilities).toEqual({});
    expect(objects[1]!.capabilities).toEqual({
      create: true,
      update: true,
      comments: true,
      webhooks: true,
      hierarchy: true,
    });
    expect(objects[2]!.capabilities).toEqual({ webhooks: true });
  });

  it('keeps the token secret and validates the settings', () => {
    const def = manifest.connectors![0]!;
    expect(def.secrets.safeParse({ pat: 'x' }).success).toBe(true);
    expect(def.secrets.safeParse({}).success).toBe(false);
    expect(
      def.config.safeParse({ collectionUrl: 'https://ado.contoso.local/tfs/DefaultCollection' }).success,
    ).toBe(true);
    expect(API_VERSIONS).toEqual(['7.2', '7.1', '7.0', '6.0', '5.1', '5.0']);
    expect(collectionUrlIssue('https://u:p@ado.contoso.local/tfs')).toBe('credentials');
    // JSON Schemas for the hub's generic form.
    const serialized = serializeManifest(manifest).connectors![0]!;
    expect(serialized.secrets).toMatchObject({ properties: { pat: { type: 'string' } }, required: ['pat'] });
    expect(serialized.config).toMatchObject({
      properties: { collectionUrl: { type: 'string' }, apiVersion: { default: '7.2' } },
    });
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

  it('label the manifest, every object and API version, on-premises only', () => {
    const def = manifest.connectors![0]!;
    for (const catalog of [en, zh, ja]) {
      for (const key of [
        manifest.name,
        manifest.description!,
        def.name,
        def.description!,
        ...def.objects.map((o) => o.name),
      ])
        expect(get(catalog, key.replace(/^azdo\./, '')), key).toBeTruthy();
      for (const v of API_VERSIONS)
        expect(get(catalog, `config.versions.${v.replace('.', '_')}`), v).toBeTruthy();
      for (const [key, value] of flat(catalog)) {
        expect(value, key).not.toMatch(/Azure DevOps Services|dev\.azure\.com|visualstudio\.com/i);
      }
    }
    expect(en.connector.name).toBe('Azure DevOps Server (on-premises)');
  });
});
