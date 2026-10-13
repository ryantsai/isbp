import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ModuleManifest } from '@isbp/sdk';
import { describe, expect, it } from 'vitest';
import en from '../messages/en.json';
import ja from '../messages/ja-JP.json';
import zh from '../messages/zh-TW.json';
import {
  MEMBER_ROLES,
  PROJECT_HEALTHS,
  PROJECT_STATUSES,
  TASK_PRIORITIES,
  TASK_STATUSES,
  TASK_TYPES,
} from '../src/model';
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

describe('projects message catalogs', () => {
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

  it('translate every manifest key', () => {
    const keys = [
      manifest.name,
      manifest.description,
      ...(manifest.navigation ?? []).flatMap((n) => [n.label, n.group]),
      ...(manifest.permissions ?? []).map((p) => p.description),
      ...(manifest.settings ?? []).flatMap((s) => [s.label, s.description]),
      ...(manifest.workflows ?? []).flatMap((w) => [w.name, w.description]),
      ...(manifest.customFields?.entities ?? []).map((e) => e.name),
      ...(manifest.records?.types ?? []).map((r) => r.name),
      ...(manifest.syncEntities ?? []).map((e) => e.name),
    ].filter((k): k is string => Boolean(k));
    for (const key of keys) {
      expect(key.startsWith('projects.'), key).toBe(true);
      for (const catalog of Object.values(catalogs))
        expect(lookup(catalog, key.slice('projects.'.length)), key).toBeDefined();
    }
  });

  it('label every sync field', () => {
    const source = readFileSync(join(__dirname, '../src/server/sync.ts'), 'utf8');
    const fields = [...source.matchAll(/label\('([A-Za-z]+)'\)/g)].map((m) => `sync.fields.${m[1]}`);
    expect(fields.length).toBeGreaterThan(18);
    for (const key of [...fields, 'sync.via'])
      for (const catalog of Object.values(catalogs)) expect(lookup(catalog, key), key).toBeDefined();
  });

  it('label every audit action the server records', () => {
    const dir = join(__dirname, '../src/server');
    const actions = new Set<string>();
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.ts'))) {
      const source = readFileSync(join(dir, file), 'utf8');
      for (const m of source.matchAll(/action:\s*'(projects\.[a-z_.-]+)'/g)) actions.add(m[1]!);
    }
    // Conditional actions (`archived ? … : …`, `statusChanged ? … : …`).
    for (const a of [
      'projects.project.archived',
      'projects.project.unarchived',
      'projects.project.proposal_rejected',
      'projects.project.proposal_cancelled',
      'projects.task.moved',
      'projects.task.status_changed',
      'projects.milestone.completed',
      'projects.report-template.archived',
      'projects.report-template.restored',
    ])
      actions.add(a);
    expect(actions.size).toBeGreaterThan(20);
    for (const action of actions)
      for (const catalog of Object.values(catalogs))
        expect(lookup(catalog, `audit.${action.split('.').slice(1).join('_')}`), action).toBeDefined();
  });

  it('name every status, health, type, priority and role', () => {
    for (const catalog of Object.values(catalogs)) {
      for (const s of PROJECT_STATUSES) expect(lookup(catalog, `projectStatus.${s}`)).toBeDefined();
      for (const s of TASK_STATUSES) expect(lookup(catalog, `taskStatus.${s}`)).toBeDefined();
      for (const h of PROJECT_HEALTHS) expect(lookup(catalog, `health.${h}`)).toBeDefined();
      for (const ty of TASK_TYPES) expect(lookup(catalog, `taskType.${ty}`)).toBeDefined();
      for (const p of TASK_PRIORITIES) expect(lookup(catalog, `priority.${p}`)).toBeDefined();
      for (const r of MEMBER_ROLES) expect(lookup(catalog, `roles.${r}`)).toBeDefined();
    }
  });
});
