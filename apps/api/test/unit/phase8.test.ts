import type { Messages } from '@isbp/i18n';
import {
  type AuthContext,
  factsFromJsonSchema,
  type FieldDef,
  type ModuleManifest,
  type RecordRef,
} from '@isbp/sdk/server';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { moduleMessages } from '../../src/generated/module-messages';
import { recordFieldFacts, verifyRecordFields } from '../../src/kernel/fields';

const A = 'cmdb.ci:0199a0c2-7a3e-7cc1-9a51-3c2f1b8e4d01';
const B = 'cmdb.ci:0199a0c2-7a3e-7cc1-9a51-3c2f1b8e4d02';
const HIDDEN = 'cmdb.ci:0199a0c2-7a3e-7cc1-9a51-3c2f1b8e4d03';

const FACTS = new Map<string, Record<string, unknown>>([
  [A, { environment: 'production', criticality: 'high', tags: ['erp'] }],
  [B, { environment: 'development', criticality: 'low', tags: ['dev', 'lab'] }],
  [HIDDEN, { environment: 'production', criticality: 'critical', tags: [] }],
]);
const key = (r: RecordRef) => `${r.type}:${r.id}`;
const records = {
  facts: async (refs: readonly RecordRef[]) =>
    new Map(refs.flatMap((r) => (FACTS.has(key(r)) ? [[key(r), FACTS.get(key(r))!] as const] : []))),
  /** The person sees A and B; without a person, everything that exists. */
  readable: async (refs: readonly RecordRef[], auth: AuthContext | null) =>
    new Set(refs.map(key).filter((k) => FACTS.has(k) && (auth === null || k !== HIDDEN))),
};
const person = {} as AuthContext;

const label = { en: 'CI' };
const one: FieldDef = {
  key: 'ci',
  type: 'record',
  label,
  record: { types: ['cmdb.ci'], where: { fact: 'environment', op: 'eq', value: 'production' } },
};
const many: FieldDef = { key: 'cis', type: 'record', label, record: { types: ['cmdb.ci'], multiple: true } };

describe('recordFieldFacts', () => {
  it('gives a single pick its record’s facts and a multi pick one list per fact', async () => {
    expect(await recordFieldFacts([one, many], { ci: A, cis: [A, B] }, records.facts)).toEqual({
      ci: FACTS.get(A),
      cis: {
        environment: ['production', 'development'],
        criticality: ['high', 'low'],
        tags: ['erp', 'dev', 'lab'],
      },
    });
  });

  it('skips empty fields and unknown records', async () => {
    expect(await recordFieldFacts([one, many], { ci: '', cis: ['cmdb.ci:nope'] }, records.facts)).toEqual({});
  });
});

describe('verifyRecordFields', () => {
  it('accepts readable records that match the field’s where', async () => {
    expect(await verifyRecordFields(records, [one, many], { ci: A, cis: [A, B] }, person)).toEqual({});
  });

  it('refuses records the person can’t read, outside where, unknown or malformed', async () => {
    expect(await verifyRecordFields(records, [one], { ci: HIDDEN }, person)).toEqual({
      ci: { code: 'record' },
    });
    expect(await verifyRecordFields(records, [one], { ci: B }, person)).toEqual({ ci: { code: 'record' } });
    expect(await verifyRecordFields(records, [many], { cis: [A, 'cmdb.ci:gone'] }, person)).toEqual({
      cis: { code: 'record' },
    });
    expect(await verifyRecordFields(records, [many], { cis: ['cmdb.ci:a.b'] }, person)).toEqual({
      cis: { code: 'record' },
    });
  });

  it('only checks existence without a person, and trusts records already stored', async () => {
    expect(await verifyRecordFields(records, [one], { ci: HIDDEN }, null)).toEqual({});
    expect(
      await verifyRecordFields(records, [many], { cis: [HIDDEN, A] }, person, { cis: [HIDDEN] }),
    ).toEqual({});
  });
});

const get = (catalog: Messages, path: string): unknown =>
  path.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], catalog);

describe('record facts declared by modules', () => {
  it('name every fact and value in the owning module’s three catalogs', async () => {
    let checked = 0;
    for (const [id, loaders] of Object.entries(moduleMessages)) {
      const { manifest } = (await import(`@isbp/module-${id}/manifest`)) as { manifest: ModuleManifest };
      for (const type of manifest.records?.types ?? []) {
        if (!type.facts) continue;
        const facts = factsFromJsonSchema(z.toJSONSchema(type.facts, { unrepresentable: 'any' }));
        expect(facts.length, `${id}.${type.type}`).toBeGreaterThan(0);
        for (const locale of ['en', 'zh-TW', 'ja-JP'] as const) {
          const catalog = { [id]: (await loaders[locale]()).default } as Messages;
          for (const f of facts) {
            expect(f.label, `${id}.${type.type}.${f.path} label`).toBeTruthy();
            expect(typeof get(catalog, f.label!), `${locale}: ${f.label}`).toBe('string');
            if (f.valueLabels)
              for (const v of f.options ?? [])
                expect(typeof get(catalog, `${f.valueLabels}.${v}`), `${locale}: ${f.valueLabels}.${v}`).toBe(
                  'string',
                );
            checked++;
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
});
