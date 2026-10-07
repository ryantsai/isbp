import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ModuleManifest } from '@isbp/sdk';
import { describe, expect, it } from 'vitest';
import en from '../messages/en.json';
import ja from '../messages/ja-JP.json';
import zh from '../messages/zh-TW.json';
import { manifest as declared } from '../src/manifest';
import {
  ASSET_CATEGORIES,
  ASSET_STATUSES,
  COMPLIANCE_STATES,
  CONTRACT_BILLING,
  CONTRACT_KINDS,
  CONTRACT_STATUSES,
  LICENSE_TYPES,
} from '../src/model';

const manifest: ModuleManifest = declared;

type Tree = { [k: string]: string | Tree };
const catalogs = { en, 'zh-TW': zh, 'ja-JP': ja } as Record<string, Tree>;

const flatten = (o: Tree, p = ''): [string, string][] =>
  Object.entries(o).flatMap(([k, v]) =>
    typeof v === 'string' ? [[`${p}${k}`, v]] : flatten(v, `${p}${k}.`),
  );

const lookup = (o: Tree, path: string): string | undefined => {
  let cur: string | Tree | undefined = o;
  for (const seg of path.split('.')) cur = typeof cur === 'object' ? cur[seg] : undefined;
  return typeof cur === 'string' ? cur : undefined;
};

/** Top-level ICU arguments (`{name}`, `{count, plural, …}`). */
function placeholders(message: string): string[] {
  const out = new Set<string>();
  let depth = 0;
  for (let i = 0; i < message.length; i++) {
    if (message[i] === '{') {
      if (depth === 0) {
        const m = /^\{\s*(\w+)/.exec(message.slice(i));
        if (m) out.add(m[1]!);
      }
      depth++;
    } else if (message[i] === '}') depth--;
  }
  return [...out].sort();
}

const notificationKey = (type: string) =>
  `notifications.${type.split('.').slice(1).join('_').replaceAll('-', '_')}`;

describe('itam message catalogs', () => {
  it('ship the same keys in every locale', () => {
    const keys = (c: Tree) =>
      flatten(c)
        .map(([k]) => k)
        .sort();
    expect(keys(catalogs['zh-TW']!)).toEqual(keys(catalogs.en!));
    expect(keys(catalogs['ja-JP']!)).toEqual(keys(catalogs.en!));
  });

  it('use the same ICU arguments in every locale, balanced braces and no angle brackets', () => {
    const base = new Map(flatten(en as Tree));
    for (const [locale, catalog] of Object.entries(catalogs))
      for (const [key, value] of flatten(catalog)) {
        expect(value, `${locale}:${key}`).not.toMatch(/[<>]/);
        expect(value.split('{').length, `${locale}:${key} braces`).toBe(value.split('}').length);
        expect(placeholders(value), `${locale}:${key}`).toEqual(placeholders(base.get(key) ?? ''));
      }
  });

  it('label, title and body every notification type', () => {
    for (const n of manifest.notifications ?? [])
      for (const catalog of Object.values(catalogs))
        for (const part of ['label', 'title', 'body'])
          expect(lookup(catalog, `${notificationKey(n.type)}.${part}`), `${n.type}.${part}`).toBeDefined();
  });

  it('translate every manifest key (navigation, permissions, settings, workflows, portal, entities)', () => {
    const keys: (string | undefined)[] = [
      manifest.name,
      manifest.description,
      ...(manifest.navigation ?? []).flatMap((n) => [n.label, n.group]),
      ...(manifest.permissions ?? []).map((p) => p.description),
      ...(manifest.settings ?? []).flatMap((s) => [s.label, s.description]),
      ...(manifest.workflows ?? []).flatMap((w) => [w.name, w.description]),
      ...(manifest.portal?.entries ?? []).flatMap((e) => [e.label, e.description]),
      ...(manifest.customFields?.entities ?? []).map((e) => e.name),
      ...(manifest.records?.types ?? []).map((t) => t.name),
      ...(manifest.syncEntities ?? []).map((e) => e.name),
    ];
    for (const key of keys.filter((k): k is string => Boolean(k))) {
      expect(key.startsWith('itam.'), key).toBe(true);
      for (const catalog of Object.values(catalogs))
        expect(lookup(catalog, key.slice('itam.'.length)), key).toBeDefined();
    }
  });

  it('label every sync field', () => {
    const source = readFileSync(join(__dirname, '../src/server/sync.ts'), 'utf8');
    const fields = [...source.matchAll(/label\('([A-Za-z]+)'\)/g)].map((m) => `sync.fields.${m[1]}`);
    expect(fields.length).toBeGreaterThan(12);
    for (const key of [...fields, 'history.via'])
      for (const catalog of Object.values(catalogs)) expect(lookup(catalog, key), key).toBeDefined();
  });

  it('label every audit action the server records', () => {
    const dir = join(__dirname, '../src/server');
    const actions = new Set<string>(['itam.asset.disposal_rejected', 'itam.asset.disposal_cancelled']);
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.ts'))) {
      const source = readFileSync(join(dir, file), 'utf8');
      for (const m of source.matchAll(/action: '(itam\.[a-z_.]+)'/g)) actions.add(m[1]!);
    }
    expect(actions.size).toBeGreaterThan(20);
    for (const action of actions)
      for (const catalog of Object.values(catalogs))
        expect(lookup(catalog, `audit.${action.split('.').slice(1).join('_')}`), action).toBeDefined();
  });

  it('name every status, category, type and kind (record resolvers use the status keys)', () => {
    const groups: [string, readonly string[]][] = [
      ['status', ASSET_STATUSES],
      ['category', ASSET_CATEGORIES],
      ['compliance', COMPLIANCE_STATES],
      ['contractStatus', CONTRACT_STATUSES],
      ['contractKind', CONTRACT_KINDS],
      ['licenseType', LICENSE_TYPES],
      ['billing', CONTRACT_BILLING],
    ];
    for (const catalog of Object.values(catalogs))
      for (const [group, values] of groups)
        for (const v of values) expect(lookup(catalog, `${group}.${v}`), `${group}.${v}`).toBeDefined();
  });

  it('uses the Taiwan and Microsoft-style vocabulary', () => {
    expect(lookup(zh as Tree, 'entities.license')).toContain('授權');
    expect(lookup(zh as Tree, 'meta.name')).toBe('資產');
    expect(lookup(ja as Tree, 'meta.name')).toBe('資産');
    expect(lookup(ja as Tree, 'entities.license')).toContain('ライセンス');
    expect(lookup(ja as Tree, 'vendors.title')).toBe('ベンダー');
  });
});
