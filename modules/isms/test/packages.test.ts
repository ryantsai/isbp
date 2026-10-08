import {
  type ChangeSetPackage,
  formSchemaSchema,
  type FormSchema,
  type Locale,
  validateForm,
  validateWorkflowGraph,
  workflowGraphSchema,
} from '@isbp/sdk';
import { describe, expect, it } from 'vitest';
import en from '../messages/en.json';
import ja from '../messages/ja-JP.json';
import zh from '../messages/zh-TW.json';
import { ismsProcesses } from '../src/server/packages/isms-processes';

/*
 * The ISMS process pack as data: every form and workflow value fits the shared schemas, every text people read is in
 * the three languages, workflow names are catalog keys, and the rules behave as the paper forms ask. It is built for
 * the installer's language: plain-text values (group and job names, reminders, ticket texts, labels) come in that
 * language, with the same keys, references and `{{…}}` placeholders in each. (The package format and `packageIssues`
 * for each language: `apps/api/test/unit/packages.test.ts`; whether each item passes its kind's checks: the
 * integration test `apps/api/test/integration/isms-pack.test.ts`.)
 */

type Value = Record<string, unknown>;
const LOCALES = ['en', 'zh-TW', 'ja-JP'] as const satisfies readonly Locale[];
const builds = Object.fromEntries(LOCALES.map((l) => [l, ismsProcesses(l)])) as Record<
  Locale,
  ChangeSetPackage
>;
const catalogs: Record<Locale, unknown> = { en, 'zh-TW': zh, 'ja-JP': ja };
const items = builds.en.items;
const values = (kind: string) => items.filter((i) => i.kind === kind).map((i) => i.value as Value);
const form = (key: string) => values('core.form').find((f) => f.key === key)!.schema as FormSchema;
const get = (catalog: unknown, path: string) =>
  path.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], catalog);

/** Every object that looks like LocalizedText (has `en`) in a value, with its path. */
function texts(v: unknown, path = ''): [string, Record<string, unknown>][] {
  if (Array.isArray(v)) return v.flatMap((x, i) => texts(x, `${path}.${i}`));
  if (!v || typeof v !== 'object') return [];
  const o = v as Record<string, unknown>;
  if (typeof o.en === 'string') return [[path, o]];
  return Object.entries(o).flatMap(([k, x]) => texts(x, `${path}.${k}`));
}

describe('ISMS process pack', () => {
  it('holds the groups, categories, forms, workflows and jobs of the process set', () => {
    const count = (kind: string) => items.filter((i) => i.kind === kind).length;
    expect([
      count('core.group'),
      count('itsm.category'),
      count('core.custom-field'),
      count('core.workflow'),
      count('core.form'),
      count('scheduler.job'),
    ]).toEqual([5, 3, 1, 21, 21, 8]);
    expect(values('core.form').every((f) => String(f.key).startsWith('isms-'))).toBe(true);
  });

  it('fits the form and workflow schemas, and the builder’s checks', () => {
    for (const f of values('core.form')) {
      const parsed = formSchemaSchema.safeParse(f.schema);
      expect(parsed.error?.issues ?? [], String(f.key)).toEqual([]);
    }
    for (const w of values('core.workflow')) {
      const graph = workflowGraphSchema.parse(w.graph);
      expect(validateWorkflowGraph(graph), String(w.name)).toEqual([]);
    }
  });

  it('gives every text people read in en, zh-TW and ja-JP', () => {
    for (const [path, text] of texts(items)) {
      for (const locale of ['en', 'zh-TW', 'ja-JP'])
        expect(
          typeof text[locale] === 'string' && (text[locale] as string).trim(),
          `${path} ${locale}`,
        ).toBeTruthy();
    }
  });

  it('names workflows by catalog keys present in all three catalogs', () => {
    for (const w of values('core.workflow')) {
      const key = String(w.name).replace(/^isms\./, '');
      for (const catalog of [en, zh, ja]) expect(get(catalog, key), key).toBeTruthy();
    }
  });

  it('carries no people and no secrets', () => {
    const json = JSON.stringify(items);
    expect(json).not.toMatch(/"(userId|ownerId|custodianId)"/);
    for (const g of values('core.group'))
      expect(Object.keys(g).sort()).toEqual(['attributes', 'description', 'key', 'name']);
    expect(json).not.toMatch(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/);
  });

  it('holds firewall rules to at most a year after their start', () => {
    const schema = form('isms-firewall-rule');
    const answers = (validUntil: string) => ({
      reasonType: 'project',
      request: 'add',
      reason: 'Partner API',
      validFrom: '2026-10-01',
      validUntil,
      rules: [{ source: 'a', destination: 'b', port: '443/tcp', decision: 'allow' }],
    });
    expect(validateForm(schema, answers('2027-10-01')).ok).toBe(true);
    expect(validateForm(schema, answers('2027-10-02')).errors.validUntil?.code).toBe('rule');
    expect(validateForm(schema, answers('2026-09-30')).errors.validUntil?.code).toBe('rule');
  });

  it('asks for a reason for administrator privileges and for at least one account', () => {
    const schema = form('isms-account-request');
    const base = { subject: '0192b9a0-0000-7000-8000-000000000001', reason: 'new_hire' };
    expect(validateForm(schema, base).errors.newAccounts?.code).toBe('rule');
    const admin = {
      ...base,
      changes: [{ system: 'ad', target: 'Domain', account: 'x', action: 'change', toPrivilege: 'admin' }],
    };
    expect(validateForm(schema, admin).errors.privilegedReason?.code).toBe('rule');
    expect(validateForm(schema, { ...admin, privilegedReason: 'Runs backups' }).ok).toBe(true);
  });

  it('needs the consents and checklist boxes ticked', () => {
    const schema = form('isms-device-checkout');
    const answers = { deviceType: 'laptop', purpose: 'Field work' };
    expect(validateForm(schema, { ...answers, agree: false }).errors.agree?.code).toBe('required');
    expect(validateForm(schema, { ...answers, agree: true }).ok).toBe(true);
  });
});

/* ───────────── built for the installer's language ───────────── */

/** Keys whose string values are text people read (the kinds keep them in one language). */
const TEXT_KEYS = new Set(['name', 'description', 'title', 'message', 'note', 'notes', 'condition', 'label']);
/** Workflow names are catalog keys, the same in every language. */
const isCatalogKey = (s: string) => s.startsWith('isms.packages.');
const isText = (key: string, s: string) => TEXT_KEYS.has(key) && !isCatalogKey(s);
const placeholders = (s: string) => (s.match(/\{\{[^}]*\}\}/g) ?? []).sort();
/** Has words outside its placeholders (`{{request.url}}` alone reads the same in every language). */
const hasWords = (s: string) => /\p{L}{2,}/u.test(s.replace(/\{\{[^}]*\}\}/g, ''));

/** Every string of `a` (with its key), next to what is at the same path of `b`. */
function pairs(
  a: unknown,
  b: unknown,
  path = '',
  key = '',
): { path: string; key: string; a: string; b: unknown }[] {
  if (typeof a === 'string') return [{ path, key, a, b }];
  if (Array.isArray(a))
    return a.flatMap((x, i) => pairs(x, Array.isArray(b) ? b[i] : undefined, `${path}.${i}`, key));
  if (!a || typeof a !== 'object') return [];
  const other = b && typeof b === 'object' ? (b as Record<string, unknown>) : {};
  return Object.entries(a).flatMap(([k, x]) => pairs(x, other[k], `${path}.${k}`, k));
}

/** The package with its plain text blanked: what must be the same in every language. */
function skeleton(v: unknown, key = ''): unknown {
  if (typeof v === 'string') return isText(key, v) ? '…' : v;
  if (Array.isArray(v)) return v.map((x) => skeleton(x, key));
  if (!v || typeof v !== 'object') return v;
  return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, skeleton(x, k)]));
}

describe('ISMS process pack, built for the installer’s language', () => {
  it('resolves every plain text and keeps keys, references, field keys and step ids', () => {
    for (const locale of LOCALES) {
      const pkg = builds[locale];
      expect(JSON.stringify(pkg), locale).not.toContain('$plain');
      expect(skeleton(pkg), locale).toEqual(skeleton(builds.en));
      for (const item of pkg.items.filter((i) => i.kind === 'core.form')) {
        const parsed = formSchemaSchema.safeParse((item.value as Value).schema);
        expect(parsed.error?.issues ?? [], `${locale} ${item.ref}`).toEqual([]);
      }
    }
  });

  it('writes plain text in each language, with the same placeholders', () => {
    for (const locale of ['zh-TW', 'ja-JP'] as const) {
      const untranslated = pairs(builds.en, builds[locale])
        .filter((p) => isText(p.key, p.a) && hasWords(p.a) && p.b === p.a)
        .map((p) => p.path);
      expect(untranslated, locale).toEqual([]);
      for (const p of pairs(builds.en, builds[locale]))
        expect(typeof p.b === 'string' ? placeholders(p.b) : null, `${locale} ${p.path}`).toEqual(
          placeholders(p.a),
        );
    }
  });

  it('names the groups and scheduled jobs in the installer’s language', () => {
    const named = (locale: Locale, kind: string) =>
      builds[locale].items.filter((i) => i.kind === kind).map((i) => i.value as Value);
    const groupNames = Object.fromEntries(named('zh-TW', 'core.group').map((g) => [g.key, g.name]));
    expect(groupNames).toEqual({
      'isms-authority': '權責主管',
      'isms-it': '資訊部門',
      'isms-network': '網路管理人員',
      'isms-server-room': '機房管理員',
      'isms-security-review': '資訊安全複審',
    });
    expect(named('en', 'core.group').find((g) => g.key === 'isms-authority')!.name).toBe('ISMS approvers');
    const job = named('zh-TW', 'scheduler.job').find(
      (j) => (j.config as Value).formKey === 'isms-server-room-inspection',
    )!;
    expect(job.name).toBe('ISMS：每月機房巡檢');
    expect((job.config as Value).title).toBe('機房巡檢 {{period}}');
    for (const locale of LOCALES)
      for (const j of named(locale, 'scheduler.job')) {
        expect(String(j.name), locale).toMatch(/^ISMS[:：]/);
        expect(String((j.config as Value).title), `${locale} ${String(j.name)}`).toContain('{{period}}');
      }
  });

  it('labels each workflow with its catalog name in that language', () => {
    for (const locale of LOCALES)
      for (const item of builds[locale].items.filter((i) => i.kind === 'core.workflow')) {
        const key = String((item.value as Value).name).replace(/^isms\./, '');
        expect(item.label, `${locale} ${key}`).toBe(get(catalogs[locale], key));
      }
  });
});
