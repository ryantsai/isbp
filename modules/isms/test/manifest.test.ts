import type { ModuleManifest } from '@isbp/sdk';
import { describe, expect, it } from 'vitest';
import en from '../messages/en.json';
import ja from '../messages/ja-JP.json';
import zh from '../messages/zh-TW.json';
import {
  ACCOUNT_STATES,
  ASSET_STATUSES,
  createAssetSchema,
  createReviewSchema,
  createStocktakeSchema,
  PASSWORD_REASONS,
  PRIVILEGES,
  RECURRENCES,
  REGISTER_COLUMNS,
  REVIEW_COLUMNS,
  REVIEW_DECISIONS,
  REVIEW_STATUSES,
  STOCKTAKE_RESULTS,
  STOCKTAKE_STATUSES,
  updateAssetSchema,
  updateSharedAccountSchema,
  upsertClassSchema,
} from '../src/contracts';
import { manifest as typed } from '../src/manifest';
import { DEFAULT_LABELS, DEFAULT_TAXONOMY } from '../src/server/taxonomy';

const manifest: ModuleManifest = typed;
type Catalog = Record<string, unknown>;

const flat = (o: Catalog, p = ''): [string, string][] =>
  Object.entries(o).flatMap(([k, v]) =>
    typeof v === 'object' && v
      ? flat(v as Catalog, `${p}${k}.`)
      : [[`${p}${k}`, String(v)] as [string, string]],
  );

/** ICU arguments (`{name}`, `{count, plural, …}`); branch text never matches (it has spaces, `#` or CJK). */
const args = (message: string) => [...message.matchAll(/\{\s*([A-Za-z]\w*)\s*[,}]/g)].map((m) => m[1]).sort();
const get = (catalog: Catalog, path: string) =>
  path.split('.').reduce<unknown>((o, k) => (o as Catalog | undefined)?.[k], catalog);

describe('isms manifest', () => {
  it('declares everything in its own namespace', () => {
    for (const p of manifest.permissions ?? []) expect(p.key.startsWith('isms.')).toBe(true);
    for (const e of manifest.events?.emits ?? []) {
      expect(e.name.startsWith('isms.')).toBe(true);
      expect(e.schema, e.name).toBeDefined();
    }
    for (const tool of manifest.ai?.tools ?? []) expect(tool.name.startsWith('isms.')).toBe(true);
    for (const n of manifest.notifications ?? []) expect(n.type.startsWith('isms.')).toBe(true);
  });

  it('gives everyone the participant role and nobody else anything by default', () => {
    expect(manifest.roles?.filter((r) => r.grantByDefault).map((r) => r.key)).toEqual(['isms-participant']);
    expect(manifest.roles?.find((r) => r.key === 'isms-participant')?.permissions).toEqual(['isms.self.use']);
    // Sign-off is a security officer's, never an asset manager's.
    const am = manifest.roles?.find((r) => r.key === 'isms-asset-manager')?.permissions ?? [];
    expect(am).not.toContain('isms.stocktakes.signoff');
    expect(am).not.toContain('isms.reviews.signoff');
  });

  it('consumes people leaving and moving, and declares the asset record with facts', () => {
    expect(manifest.events?.consumes).toEqual(['core.user.offboarded', 'core.user.transferred']);
    expect(manifest.records?.types.map((t) => [t.type, t.permission, Boolean(t.facts)])).toEqual([
      ['asset', 'isms.assets.read', true],
      ['account', 'isms.accounts.read', false],
    ]);
    expect(manifest.customFields?.entities).toEqual([{ type: 'asset', name: 'isms.entities.asset' }]);
    expect(manifest.processActions?.map((a) => [a.action, a.permission])).toEqual([
      ['register-shared-account', 'isms.accounts.manage'],
    ]);
    expect(manifest.customizations?.map((k) => [k.kind, k.operations])).toEqual([
      ['asset-class', ['create', 'update', 'archive']],
    ]);
    for (const tool of manifest.ai?.tools ?? []) expect(tool.readOnly).toBe(true);
  });

  it('makes the password notification mandatory', () => {
    expect(
      manifest.notifications?.find((n) => n.type === 'isms.account.password_change_due')?.mandatory,
    ).toBe(true);
  });
});

describe('contracts', () => {
  it('fills defaults on create and never on update', () => {
    const created = createAssetSchema.parse({
      name: ' Core firewall ',
      classId: '0192b9a0-0000-7000-8000-000000000001',
      siteId: '0192b9a0-0000-7000-8000-000000000002',
      confidentiality: 4,
      integrity: 1,
      availability: 4,
    });
    expect(created).toMatchObject({ name: 'Core firewall', quantity: 1, userIds: [] });
    expect(updateAssetSchema.parse({ name: 'x' })).toEqual({ name: 'x' });
    expect(updateAssetSchema.parse({ location: '' })).toEqual({ location: null });
    expect(updateSharedAccountSchema.parse({})).toEqual({});
    expect(createStocktakeSchema.parse({ name: 'x', dueOn: '2026-12-31' })).toMatchObject({
      recurrence: 'none',
    });
    expect(
      createReviewSchema.parse({
        target: 'fw',
        reviewerId: '0192b9a0-0000-7000-8000-000000000003',
        dueOn: '2026-12-31',
      }).recurrence,
    ).toBe('none');
  });

  it('refuses scores outside 1–4, bad codes and impossible dates', () => {
    const base = {
      name: 'x',
      classId: '0192b9a0-0000-7000-8000-000000000001',
      siteId: '0192b9a0-0000-7000-8000-000000000002',
      integrity: 1,
      availability: 1,
    };
    expect(createAssetSchema.safeParse({ ...base, confidentiality: 5 }).success).toBe(false);
    expect(createAssetSchema.safeParse({ ...base, confidentiality: 0 }).success).toBe(false);
    expect(createStocktakeSchema.safeParse({ name: 'x', dueOn: '2026-02-30' }).success).toBe(false);
    const cls = { name: { en: 'X' }, guidance: { c: lv(), i: lv(), a: lv() }, subclasses: [] };
    expect(upsertClassSchema.safeParse({ ...cls, code: 'HW' }).success).toBe(true);
    for (const code of ['hw', 'H', 'HWXYZ', 'H1'])
      expect(upsertClassSchema.safeParse({ ...cls, code }).success, code).toBe(false);
  });
});

function lv() {
  return { '1': {}, '2': {}, '3': {}, '4': {} };
}

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
      ['assetStatus', ASSET_STATUSES],
      ['stocktakeStatus', STOCKTAKE_STATUSES],
      ['stocktakeResult', STOCKTAKE_RESULTS],
      ['reviewStatus', REVIEW_STATUSES],
      ['reviewDecision', REVIEW_DECISIONS],
      ['privilege', PRIVILEGES],
      ['accountState', ACCOUNT_STATES],
      ['recurrence', RECURRENCES],
      ['csv.columns', REGISTER_COLUMNS],
      ['csvColumns', REGISTER_COLUMNS],
      ['csv.review', REVIEW_COLUMNS],
      ['reviewColumns', REVIEW_COLUMNS],
    ];
    for (const catalog of [en, zh, ja]) {
      for (const [prefix, values] of enums)
        for (const v of values) expect(get(catalog, `${prefix}.${v}`), `${prefix}.${v}`).toBeTruthy();
      const keys = [
        manifest.name,
        manifest.description!,
        ...(manifest.navigation ?? []).flatMap((n) => [n.label, ...(n.group ? [n.group] : [])]),
        ...(manifest.permissions ?? []).map((p) => p.description),
        ...(manifest.settings ?? []).flatMap((s) => [s.label, s.description!]),
        ...(manifest.customFields?.entities ?? []).map((e) => e.name),
        ...(manifest.records?.types ?? []).map((r) => r.name),
        ...(manifest.processActions ?? []).flatMap((a) => [a.name, a.description]),
        ...(manifest.customizations ?? []).map((k) => k.label),
      ];
      for (const key of keys) expect(get(catalog, key.replace(/^isms\./, '')), key).toBeTruthy();
      for (const e of manifest.events?.emits ?? [])
        expect(get(catalog, `audit.${e.name.replace(/^isms\./, '').replace('.', '_')}`), e.name).toBeTruthy();
      for (const n of manifest.notifications ?? []) {
        const key = `notifications.${n.type.replace(/^isms\./, '').replace(/[.-]/g, '_')}`;
        for (const part of ['label', 'title', 'body'])
          expect(get(catalog, `${key}.${part}`), `${key}.${part}`).toBeTruthy();
      }
      for (const reason of PASSWORD_REASONS) expect(PASSWORD_REASONS).toContain(reason);
    }
  });

  it('carry names, descriptions and guidance for every default class, sub-class and label', () => {
    for (const catalog of [en, zh, ja]) {
      for (const { code, subclasses } of DEFAULT_TAXONOMY) {
        expect(get(catalog, `defaults.classes.${code}.name`), code).toBeTruthy();
        for (const s of subclasses)
          expect(get(catalog, `defaults.classes.${code}.subclasses.${s}.name`), s).toBeTruthy();
        for (const d of ['c', 'i', 'a'])
          for (const l of ['1', '2', '3', '4'])
            expect(
              typeof get(catalog, `defaults.classes.${code}.guidance.${d}.${l}`),
              `${code} ${d}${l}`,
            ).toBe('string');
        // Score 1 always has guidance; empty levels mean "doesn't apply".
        for (const d of ['c', 'i', 'a'])
          expect(get(catalog, `defaults.classes.${code}.guidance.${d}.1`)).toBeTruthy();
      }
      for (const l of DEFAULT_LABELS)
        expect(get(catalog, `defaults.labels.${l.key}.name`), l.key).toBeTruthy();
    }
  });
});
