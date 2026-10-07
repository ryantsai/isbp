import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import en from '../messages/en.json';
import ja from '../messages/ja-JP.json';
import zh from '../messages/zh-TW.json';
import type { ModuleManifest } from '@isbp/sdk';
import { manifest as declared } from '../src/manifest';

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

/** Top-level ICU arguments (`{name}`, `{metric, select, …}`). */
function placeholders(message: string): string[] {
  const out = new Set<string>();
  let depth = 0;
  for (let i = 0; i < message.length; i++) {
    if (message[i] === '{') {
      if (depth === 0) {
        const m = /^\{\s*([\w]+)/.exec(message.slice(i));
        if (m) out.add(m[1]!);
      }
      depth++;
    } else if (message[i] === '}') depth--;
  }
  return [...out].sort();
}

/** `itsm.ticket.created` → `notifications.ticket_created` (kernel convention). */
const notificationKey = (type: string) =>
  `notifications.${type.split('.').slice(1).join('_').replaceAll('-', '_')}`;

describe('itsm message catalogs', () => {
  it('use the same ICU arguments in every locale and no angle brackets', () => {
    const base = new Map(flatten(en as Tree));
    for (const [locale, catalog] of Object.entries(catalogs))
      for (const [key, value] of flatten(catalog)) {
        expect(value, `${locale}:${key}`).not.toMatch(/[<>]/);
        expect(placeholders(value), `${locale}:${key}`).toEqual(placeholders(base.get(key) ?? ''));
      }
  });

  it('label, title and body every notification type', () => {
    for (const n of manifest.notifications ?? [])
      for (const catalog of Object.values(catalogs))
        for (const part of ['label', 'title', 'body'])
          expect(lookup(catalog, `${notificationKey(n.type)}.${part}`), `${n.type}.${part}`).toBeDefined();
  });

  it('translate every manifest key (navigation, permissions, settings, workflows)', () => {
    const keys: (string | undefined)[] = [
      manifest.name,
      manifest.description,
      ...(manifest.navigation ?? []).flatMap((n) => [n.label, n.group].filter(Boolean) as string[]),
      ...(manifest.permissions ?? []).map((p) => p.description),
      ...(manifest.settings ?? []).flatMap((s) => [s.label, s.description].filter(Boolean) as string[]),
      ...(manifest.workflows ?? []).flatMap((w) => [w.name, w.description].filter(Boolean) as string[]),
      ...(manifest.portal?.entries ?? []).flatMap(
        (e) => [e.label, e.description].filter(Boolean) as string[],
      ),
    ];
    for (const key of keys.filter((k): k is string => Boolean(k))) {
      expect(key.startsWith('itsm.'), key).toBe(true);
      for (const catalog of Object.values(catalogs))
        expect(lookup(catalog, key.slice('itsm.'.length)), key).toBeDefined();
    }
  });

  it('label every audit action the server records', () => {
    const dir = join(__dirname, '../src/server');
    const actions = new Set<string>(['itsm.change.approved', 'itsm.change.rejected']);
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.ts'))) {
      const source = readFileSync(join(dir, file), 'utf8');
      for (const m of source.matchAll(/action: '(itsm\.[a-z_.]+)'/g)) actions.add(m[1]!);
      for (const m of source.matchAll(/audit\('(itsm\.[a-z_.]+)'/g)) actions.add(m[1]!);
    }
    expect(actions.size).toBeGreaterThan(10);
    for (const action of actions)
      for (const catalog of Object.values(catalogs))
        expect(lookup(catalog, `audit.${action.split('.').slice(1).join('_')}`), action).toBeDefined();
  });

  it('name every status, type and resolution the contract knows', () => {
    for (const catalog of Object.values(catalogs)) {
      for (const s of ['new', 'in_progress', 'authorization', 'known_error', 'rejected'])
        expect(lookup(catalog, `status.${s}`)).toBeDefined();
      for (const r of ['solved', 'workaround', 'cancelled_by_requester'])
        expect(lookup(catalog, `resolution.${r}`)).toBeDefined();
    }
  });
});
