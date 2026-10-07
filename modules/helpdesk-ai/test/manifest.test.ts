import { describe, expect, it } from 'vitest';
import en from '../messages/en.json';
import ja from '../messages/ja-JP.json';
import zh from '../messages/zh-TW.json';
import type { ModuleManifest } from '@isbp/sdk';
import { manifest as declared } from '../src/manifest';

const manifest: ModuleManifest & { ai: { agent: { permissions: string[] } } } = declared as never;

type Tree = { [k: string]: string | Tree };
const flatten = (o: Tree, p = ''): Record<string, string> =>
  Object.fromEntries(
    Object.entries(o).flatMap(([k, v]) =>
      typeof v === 'object' ? Object.entries(flatten(v, `${p}${k}.`)) : [[`${p}${k}`, v]],
    ),
  );
/** Top-level ICU argument names (`{name}`, `{count, plural, …}`). */
const args = (s: string) => [...s.matchAll(/\{\s*(\w+)\s*[,}]/g)].map((m) => m[1]).sort();

describe('helpdesk-ai manifest', () => {
  it('only declares permissions and events in its own namespace', () => {
    for (const p of manifest.permissions ?? []) expect(p.key.startsWith('helpdesk-ai.')).toBe(true);
    for (const e of manifest.events?.emits ?? []) expect(e.name.startsWith('helpdesk-ai.')).toBe(true);
  });

  it('gives its agent identity least privilege: read tickets and articles, set triage — nothing else', () => {
    expect([...declared.ai.agent.permissions].sort()).toEqual([
      'itsm.tickets.read',
      'itsm.tickets.triage',
      'knowledge.articles.read',
      'knowledge.articles.read-internal',
    ]);
  });

  it('grants the virtual agent to everyone and keeps assist and insights opt-in', () => {
    const roles = Object.fromEntries((manifest.roles ?? []).map((r) => [r.key, r]));
    expect(roles['helpdesk-ai-user']?.grantByDefault).toBe(true);
    expect(roles['helpdesk-ai-user']?.permissions).toEqual(['helpdesk-ai.chat.use']);
    expect(roles['helpdesk-ai-agent']?.grantByDefault).toBeFalsy();
    expect(roles['helpdesk-ai-admin']?.permissions).toEqual(['helpdesk-ai.*']);
  });

  it('ships the same message keys and ICU arguments in every locale', () => {
    const base = flatten(en as Tree);
    for (const other of [zh, ja]) {
      const flat = flatten(other as Tree);
      expect(Object.keys(flat).sort()).toEqual(Object.keys(base).sort());
      for (const [key, value] of Object.entries(base))
        expect([key, args(flat[key]!)]).toEqual([key, args(value)]);
    }
  });

  it('has labels for every i18n key the manifest references, and no `<…>` in ICU strings', () => {
    const flat = flatten(en as Tree);
    const keys = [
      manifest.name,
      manifest.description!,
      ...(manifest.navigation ?? []).map((n) => n.label),
      ...(manifest.permissions ?? []).map((p) => p.description),
      ...(manifest.settings ?? []).flatMap((s) => [s.label, ...(s.description ? [s.description] : [])]),
    ].filter((k) => k.startsWith('helpdesk-ai.'));
    for (const k of keys) expect(flat[k.replace(/^helpdesk-ai\./, '')], k).toBeTypeOf('string');
    for (const catalog of [en, zh, ja])
      for (const v of Object.values(flatten(catalog as Tree))) expect(v).not.toMatch(/<[^>]*>/);
  });
});
