import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import en from '../messages/en.json';
import ja from '../messages/ja-JP.json';
import zh from '../messages/zh-TW.json';
import {
  aiCreateDraftInput,
  aiGetArticleInput,
  aiSearchArticlesInput,
  articleReference,
  createArticleSchema,
  parseArticleRef,
} from '../src/contracts';
import type { AiToolDef, WorkflowTriggerDef } from '@isbp/sdk';
import { manifest } from '../src/manifest';

type Tree = { [key: string]: string | Tree };
const flat = (o: Tree, p = ''): Record<string, string> =>
  Object.fromEntries(
    Object.entries(o).flatMap(([k, v]) =>
      typeof v === 'string' ? [[`${p}${k}`, v]] : Object.entries(flat(v, `${p}${k}.`)),
    ),
  );
/** ICU argument names (`{name}`, `{count, plural, …}`), ignoring the text inside branches. */
const args = (message: string) =>
  [...new Set([...message.matchAll(/\{(\w+)(?=[,}])/g)].map((m) => m[1]))].sort();

describe('knowledge manifest', () => {
  it('only declares permissions, events, tools, triggers and notifications in its own namespace', () => {
    const own = (s: string) => s.startsWith('knowledge.');
    expect((manifest.permissions ?? []).every((p) => own(p.key))).toBe(true);
    expect((manifest.events?.emits ?? []).every((e) => own(e.name))).toBe(true);
    expect((manifest.ai?.tools ?? []).every((t) => own(t.name))).toBe(true);
    expect((manifest.workflows ?? []).every((w) => own(w.key))).toBe(true);
    expect((manifest.notifications ?? []).every((n) => own(n.type))).toBe(true);
  });

  it('exposes the AI tool contract Helpdesk AI relies on (none destructive)', () => {
    const tools: Record<string, AiToolDef> = Object.fromEntries(
      (manifest.ai?.tools ?? []).map((t) => [t.name, t as AiToolDef]),
    );
    expect(Object.keys(tools).sort()).toEqual([
      'knowledge.create_draft',
      'knowledge.get_article',
      'knowledge.search_articles',
    ]);
    expect(tools['knowledge.search_articles']!.permission).toBe('knowledge.articles.read');
    expect(tools['knowledge.get_article']!.permission).toBe('knowledge.articles.read');
    expect(tools['knowledge.create_draft']!.permission).toBe('knowledge.articles.write');
    expect(Object.values(tools).some((t) => t.destructive)).toBe(false);
  });

  it('applies the documented tool defaults and limits', () => {
    expect(aiSearchArticlesInput.parse({ query: 'vpn' })).toEqual({ query: 'vpn', limit: 5 });
    expect(aiSearchArticlesInput.safeParse({ query: 'vpn', limit: 11 }).success).toBe(false);
    expect(aiSearchArticlesInput.safeParse({ query: '' }).success).toBe(false);
    expect(aiGetArticleInput.safeParse({}).success).toBe(false);
    expect(aiGetArticleInput.safeParse({ reference: 'KB-00042' }).success).toBe(true);
    // No language: the tool writes in the caller's (never silently English); internal by default.
    const draft = aiCreateDraftInput.parse({ title: 'T', body: 'B' });
    expect(draft).toMatchObject({ audience: 'agents' });
    expect(draft.locale).toBeUndefined();
    expect(aiCreateDraftInput.safeParse({ title: 'T', body: 'B', tags: Array(11).fill('x') }).success).toBe(
      false,
    );
  });

  it('declares the opt-in publish trigger and its notifications', () => {
    const trigger = manifest.workflows?.[0] as WorkflowTriggerDef | undefined;
    expect(trigger).toMatchObject({ key: 'knowledge.publish', subject: 'article' });
    expect(trigger?.required).toBeUndefined();
    expect(manifest.notifications?.map((n) => n.type).sort()).toEqual([
      'knowledge.article.approved',
      'knowledge.article.feedback',
      'knowledge.article.rejected',
      'knowledge.article.review_due',
    ]);
    expect(manifest.events?.consumes).toEqual(
      expect.arrayContaining([
        'knowledge.article.published',
        'knowledge.article.retired',
        'knowledge.article.deleted',
      ]),
    );
  });

  it('lets the Integrations Hub sync articles with its own permission, named in every locale', () => {
    expect(manifest.syncEntities).toEqual([
      expect.objectContaining({ entity: 'article', permission: 'knowledge.articles.sync' }),
    ]);
    expect(manifest.permissions?.map((p) => p.key)).toContain('knowledge.articles.sync');
    const emitted = new Set(manifest.events?.emits?.map((e) => e.name));
    for (const name of manifest.syncEntities![0]!.events) expect(emitted.has(name), name).toBe(true);
    const source = readFileSync(join(__dirname, '../src/server/sync.ts'), 'utf8');
    const fields = [...source.matchAll(/label\('([A-Za-z]+)'\)/g)].map((m) => `sync.fields.${m[1]}`);
    expect(fields.length).toBeGreaterThan(7);
    const keys = [
      ...fields,
      manifest.syncEntities![0]!.name.slice('knowledge.'.length),
      ...(manifest.permissions ?? []).map((p) => p.description.slice('knowledge.'.length)),
      'sync.locales.en',
      'sync.locales.zh-TW',
      'sync.locales.ja-JP',
      'article.syncedFrom',
    ];
    for (const catalog of [flat(en), flat(zh), flat(ja)])
      for (const key of keys) expect(catalog[key], key).toBeTruthy();
  });

  it('ships the same message keys and ICU arguments in every locale', () => {
    const base = flat(en);
    for (const other of [flat(zh), flat(ja)]) {
      expect(Object.keys(other).sort()).toEqual(Object.keys(base).sort());
      for (const [key, value] of Object.entries(base)) expect(args(other[key]!), key).toEqual(args(value));
    }
  });

  it('has catalog text for every notification type and audit action', () => {
    const messages = flat(en);
    for (const n of manifest.notifications ?? []) {
      const key = `notifications.${n.type.split('.').slice(1).join('_')}`;
      expect(messages[`${key}.title`], key).toBeTruthy();
      expect(messages[`${key}.label`], key).toBeTruthy();
    }
    for (const e of manifest.events?.emits ?? [])
      expect(messages[`audit.${e.name.split('.').slice(1).join('_')}`], e.name).toBeTruthy();
  });
});

describe('references and inputs', () => {
  it('formats and parses KB references', () => {
    expect(articleReference(42)).toBe('KB-00042');
    expect(articleReference(123456)).toBe('KB-123456');
    expect(parseArticleRef('KB-00042')).toEqual({ number: 42 });
    expect(parseArticleRef('kb42')).toEqual({ number: 42 });
    expect(parseArticleRef('0190C1D2-0000-7000-8000-000000000042')).toEqual({
      id: '0190c1d2-0000-7000-8000-000000000042',
    });
    expect(parseArticleRef('INC-00042')).toBeNull();
    expect(parseArticleRef("1' or 1=1")).toBeNull();
  });

  it('normalises tags and caps them at ten', () => {
    expect(createArticleSchema.parse({ title: 'x', tags: [' VPN ', 'Wi-Fi'] }).tags).toEqual([
      'vpn',
      'wi-fi',
    ]);
    expect(createArticleSchema.safeParse({ title: 'x', tags: Array(11).fill('a') }).success).toBe(false);
  });
});
