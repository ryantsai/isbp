import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ModuleManifest } from '@isbp/sdk';
import { describe, expect, it } from 'vitest';
import en from '../messages/en.json';
import ja from '../messages/ja-JP.json';
import zh from '../messages/zh-TW.json';
import { manifest as declared } from '../src/manifest';
import { ITEM_STATUSES, MEETING_STATUSES, PERMISSIONS, ROUTE_ERRORS, VISIBILITIES } from '../src/model';

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
        const m = /^\{\s*([\w]+)/.exec(message.slice(i));
        if (m) out.add(m[1]!);
      }
      depth++;
    } else if (message[i] === '}') depth--;
  }
  return [...out].sort();
}

describe('meetings manifest', () => {
  it('only declares permissions, events, tools and notifications in its own namespace', () => {
    for (const p of manifest.permissions ?? []) expect(p.key.startsWith('meetings.')).toBe(true);
    for (const e of manifest.events?.emits ?? []) expect(e.name.startsWith('meetings.')).toBe(true);
    for (const tool of manifest.ai?.tools ?? []) expect(tool.name.startsWith('meetings.')).toBe(true);
    for (const n of manifest.notifications ?? []) expect(n.type.startsWith('meetings.')).toBe(true);
  });

  it('depends on no module: project tasks are reached through the tool registry', () => {
    expect(manifest.dependsOn).toEqual([]);
    const source = readdirSync(join(__dirname, '../src/server'))
      .map((f) => readFileSync(join(__dirname, '../src/server', f), 'utf8'))
      .join('\n');
    expect(source).not.toMatch(/from '@isbp\/module-projects/);
    expect(source).toContain("'projects.create_task'");
  });

  it('grants participation by default and keeps reading private meetings to its own roles', () => {
    expect(declared.roles.map((r) => r.key)).toEqual([
      'meetings-member',
      'meetings-reader',
      'meetings-admin',
    ]);
    expect(declared.roles.find((r) => r.key === 'meetings-member')).toMatchObject({
      grantByDefault: true,
      permissions: [PERMISSIONS.use],
    });
    expect(declared.roles.find((r) => r.key === 'meetings-reader')!.permissions).toContain(PERMISSIONS.read);
    expect(declared.roles.find((r) => r.key === 'meetings-admin')!.permissions).toEqual(['meetings.*']);
  });

  it('puts action items on My work and marks only the lookups read-only', () => {
    expect(declared.work.map((w) => [w.key, w.kind])).toEqual([['action-items', 'task']]);
    const tools = Object.fromEntries((manifest.ai?.tools ?? []).map((t) => [t.name, t]));
    expect(tools['meetings.find_meetings']!.readOnly).toBe(true);
    expect(tools['meetings.my_action_items']!.readOnly).toBe(true);
    expect(tools['meetings.create_minutes']!.readOnly).toBeUndefined();
    expect(tools['meetings.create_minutes']!.destructive).toBeUndefined();
  });
});

describe('meetings message catalogs', () => {
  it('ship the same keys in every locale', () => {
    const keys = (t: Tree) =>
      flatten(t)
        .map(([k]) => k)
        .sort();
    expect(keys(zh as Tree)).toEqual(keys(en as Tree));
    expect(keys(ja as Tree)).toEqual(keys(en as Tree));
  });

  it('use the same ICU arguments in every locale and no angle brackets', () => {
    const base = new Map(flatten(en as Tree));
    for (const [locale, catalog] of Object.entries(catalogs))
      for (const [key, value] of flatten(catalog)) {
        expect(value, `${locale}:${key}`).not.toMatch(/[<>]/);
        expect(value.trim(), `${locale}:${key}`).not.toBe('');
        expect(placeholders(value), `${locale}:${key}`).toEqual(placeholders(base.get(key) ?? ''));
      }
  });

  it('label, title and body every notification type', () => {
    for (const n of manifest.notifications ?? []) {
      const key = `notifications.${n.type.split('.').slice(1).join('_').replaceAll('-', '_')}`;
      for (const catalog of Object.values(catalogs))
        for (const part of ['label', 'title', 'body'])
          expect(lookup(catalog, `${key}.${part}`), `${n.type}.${part}`).toBeDefined();
    }
  });

  it('translate every manifest key and role', () => {
    const keys = [
      manifest.name,
      manifest.description,
      ...(manifest.navigation ?? []).flatMap((n) => [
        n.label,
        n.group,
        ...(n.tabs ?? []).map((t) => t.label),
      ]),
      ...(manifest.permissions ?? []).map((p) => p.description),
      ...(manifest.work ?? []).map((w) => w.label),
      ...(manifest.records?.types ?? []).map((r) => r.name),
    ].filter((k): k is string => Boolean(k));
    for (const key of keys) {
      expect(key.startsWith('meetings.'), key).toBe(true);
      for (const catalog of Object.values(catalogs))
        expect(lookup(catalog, key.slice('meetings.'.length)), key).toBeDefined();
    }
    for (const role of declared.roles)
      for (const catalog of Object.values(catalogs))
        for (const part of ['name', 'description'])
          expect(lookup(catalog, `systemRoles.${role.key}.${part}`), role.key).toBeDefined();
  });

  it('label every audit action the server records', () => {
    const dir = join(__dirname, '../src/server');
    const actions = new Set<string>();
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.ts'))) {
      const source = readFileSync(join(dir, file), 'utf8');
      for (const m of source.matchAll(/action:\s*'(meetings\.[a-z_.-]+)'/g)) actions.add(m[1]!);
    }
    // Meetings record their audit under the name of the event they publish (`meetings.ts` passes it through).
    for (const event of manifest.events?.emits ?? []) actions.add(event.name);
    expect(actions.size).toBeGreaterThanOrEqual(8);
    for (const action of actions)
      for (const catalog of Object.values(catalogs))
        expect(lookup(catalog, `audit.${action.split('.').slice(1).join('_')}`), action).toBeDefined();
  });

  it('name every status, visibility and routing error', () => {
    for (const catalog of Object.values(catalogs)) {
      for (const s of MEETING_STATUSES) expect(lookup(catalog, `status.${s}`)).toBeDefined();
      for (const s of ITEM_STATUSES) expect(lookup(catalog, `itemStatus.${s}`)).toBeDefined();
      for (const v of VISIBILITIES) expect(lookup(catalog, `visibility.${v}`)).toBeDefined();
      for (const e of ROUTE_ERRORS) expect(lookup(catalog, `items.routeErrors.${e}`)).toBeDefined();
    }
  });
});
