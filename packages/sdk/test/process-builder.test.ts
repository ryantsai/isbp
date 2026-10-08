import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { conditionFacts, conditionSchema, evaluateCondition } from '../src/conditions';
import {
  defaultFieldValues,
  type FieldDef,
  fieldDefSchema,
  FORM_ERROR_KEY,
  type FormSchema,
  formSchemaSchema,
  MAX_RECORD_VALUES,
  validateFields,
  validateForm,
} from '../src/fields';
import { approverRuleSchema, factsFromJsonSchema } from '../src/workflow';

const label = { en: 'Label' };
const ci = 'cmdb.ci:0199a0c2-7a3e-7cc1-9a51-3c2f1b8e4d10';
const ci2 = 'cmdb.ci:0199a0c2-7a3e-7cc1-9a51-3c2f1b8e4d11';
const app = 'alm.application:0199a0c2-7a3e-7cc1-9a51-3c2f1b8e4d12';

describe('record fields', () => {
  const one: FieldDef = { key: 'ci', type: 'record', label, record: { types: ['cmdb.ci'] } };
  const many: FieldDef = {
    key: 'cis',
    type: 'record',
    label,
    required: true,
    record: { types: ['cmdb.ci', 'alm.application'], multiple: true },
  };

  it('accepts refs of the allowed types and de-duplicates lists', () => {
    const r = validateFields([one, many], { ci, cis: [ci, app, ci] });
    expect(r.ok).toBe(true);
    expect(r.values).toEqual({ ci, cis: [ci, app] });
  });

  it('accepts a single ref for a multi-pick field as a list', () => {
    expect(validateFields([many], { cis: ci2 }).values).toEqual({ cis: [ci2] });
  });

  it('refuses other types, malformed refs and too many values', () => {
    expect(validateFields([one], { ci: app }).errors.ci).toEqual({ code: 'record' });
    expect(validateFields([one], { ci: 'not a ref' }).errors.ci).toEqual({ code: 'record' });
    expect(validateFields([one], { ci: [ci] }).errors.ci).toEqual({ code: 'record' });
    expect(validateFields([many], { cis: [ci, 'cmdb.ci'] }).errors.cis).toEqual({ code: 'record' });
    const lots = Array.from(
      { length: MAX_RECORD_VALUES + 1 },
      (_, i) => `cmdb.ci:0199a0c2-7a3e-7cc1-9a51-${String(i).padStart(12, '0')}`,
    );
    expect(validateFields([many], { cis: lots }).errors.cis).toEqual({
      code: 'max',
      params: { max: MAX_RECORD_VALUES },
    });
  });

  it('requires a value when required and starts multi-pick fields empty', () => {
    expect(validateFields([many], { cis: [] }).errors.cis).toEqual({ code: 'required' });
    expect(defaultFieldValues([one, many])).toEqual({ ci: '', cis: [] });
  });

  it('needs at least one record type in the definition, and accepts a where filter', () => {
    expect(fieldDefSchema.safeParse({ key: 'ci', type: 'record', label }).success).toBe(false);
    expect(
      fieldDefSchema.safeParse({ key: 'ci', type: 'record', label, record: { types: ['CMDB'] } }).success,
    ).toBe(false);
    expect(
      fieldDefSchema.safeParse({
        ...one,
        record: { types: ['cmdb.ci'], where: { fact: 'environment', op: 'eq', value: 'production' } },
      }).success,
    ).toBe(true);
  });
});

describe('conditions comparing two facts (valueFact)', () => {
  it('compares a fact with another fact instead of a fixed value', () => {
    const c = { fact: 'end', op: 'gte' as const, valueFact: 'start' };
    expect(evaluateCondition(c, { start: '2026-10-01', end: '2026-10-03' })).toBe(true);
    expect(evaluateCondition(c, { start: '2026-10-05', end: '2026-10-03' })).toBe(false);
    expect(evaluateCondition({ fact: 'a', op: 'eq', valueFact: 'b' }, { a: 3, b: '3' })).toBe(true);
    expect(evaluateCondition({ fact: 'a.x', op: 'lt', valueFact: 'b.y' }, { a: { x: 1 }, b: { y: 2 } })).toBe(
      true,
    );
  });

  it('is part of the schema and of the facts a condition reads', () => {
    expect(conditionSchema.safeParse({ fact: 'end', op: 'gte', valueFact: 'start' }).success).toBe(true);
    expect(conditionSchema.safeParse({ fact: 'end', op: 'gte', valueFact: 'bad path!' }).success).toBe(false);
    expect(conditionFacts({ all: [{ fact: 'end', op: 'gte', valueFact: 'start' }] })).toEqual([
      'end',
      'start',
    ]);
  });

  it('treats a missing fact on either side as no match for comparisons', () => {
    expect(evaluateCondition({ fact: 'end', op: 'gte', valueFact: 'start' }, { end: '2026-10-03' })).toBe(
      false,
    );
  });
});

describe('validateForm (fields, then rules)', () => {
  const schema: FormSchema = {
    elements: [
      { id: 'a', key: 'start', type: 'date', label, required: true },
      { id: 'b', key: 'end', type: 'date', label, required: true },
      {
        id: 'c',
        key: 'risk',
        type: 'select',
        label,
        options: [
          { value: 'low', label },
          { value: 'high', label },
        ],
      },
      { id: 'd', key: 'rollback', type: 'textarea', label },
      {
        id: 'e',
        key: 'notes',
        type: 'text',
        label,
        visibleWhen: { fact: 'risk', op: 'eq', value: 'low' },
      },
    ],
    rules: [
      {
        id: 'order',
        require: { fact: 'end', op: 'gte', valueFact: 'start' },
        message: { en: 'The end must be after the start', 'zh-TW': '結束必須晚於開始' },
        fields: ['end'],
      },
      {
        id: 'rollback',
        when: { fact: 'risk', op: 'eq', value: 'high' },
        require: { fact: 'rollback', op: 'notEmpty' },
        message: { en: 'High-risk changes need a rollback plan' },
        fields: ['rollback'],
      },
      {
        id: 'form',
        require: { not: { fact: 'start', op: 'eq', value: '2026-12-25' } },
        message: { en: 'No changes on the 25th' },
      },
      {
        id: 'hidden',
        when: { fact: 'risk', op: 'eq', value: 'high' },
        require: { fact: 'rollback', op: 'contains', value: 'restore' },
        message: { en: 'Say how to restore' },
        fields: ['notes'],
      },
    ],
  };

  it('passes when every rule holds', () => {
    const r = validateForm(schema, { start: '2026-10-01', end: '2026-10-02', risk: 'low' });
    expect(r).toMatchObject({ ok: true, errors: {} });
  });

  it('reports field errors first, without running the rules', () => {
    const r = validateForm(schema, { start: '2026-10-05', end: '' });
    expect(r.errors).toEqual({ end: { code: 'required' } });
  });

  it('puts a failed rule on its fields with the rule message', () => {
    const r = validateForm(schema, { start: '2026-10-05', end: '2026-10-01', risk: 'high' });
    expect(r.ok).toBe(false);
    expect(r.errors.end).toEqual({ code: 'rule', message: schema.rules![0]!.message });
    expect(r.errors.rollback).toMatchObject({ code: 'rule' });
  });

  it('puts rules without (visible) fields above the form', () => {
    const r = validateForm(schema, { start: '2026-12-25', end: '2026-12-26', risk: 'high', rollback: 'x' });
    // `form` names no field; `hidden` names a field hidden for high risk.
    expect(r.errors[FORM_ERROR_KEY]).toEqual({ code: 'rule', message: { en: 'No changes on the 25th' } });
    expect(Object.keys(r.errors)).toEqual([FORM_ERROR_KEY]);
  });

  it('accepts rules in the form schema and refuses rules on unknown fields', () => {
    expect(formSchemaSchema.safeParse(schema).success).toBe(true);
    const bad = { ...schema, rules: [{ ...schema.rules![0]!, fields: ['nope'] }] };
    expect(formSchemaSchema.safeParse(bad).success).toBe(false);
  });
});

describe('approver rules from facts', () => {
  it('accepts a group-key fact (kind group) and user facts as before', () => {
    expect(
      approverRuleSchema.safeParse({ type: 'fact', fact: 'records.ci.ownerGroup', kind: 'group' }).success,
    ).toBe(true);
    expect(approverRuleSchema.safeParse({ type: 'fact', fact: 'data.approver' }).success).toBe(true);
    expect(approverRuleSchema.safeParse({ type: 'fact', fact: 'x', kind: 'team' }).success).toBe(false);
  });
});

describe('factsFromJsonSchema with builder hints', () => {
  it('reads label, value labels and the reference kind from .meta()', () => {
    const schema = z.object({
      criticality: z
        .enum(['high', 'low'])
        .meta({ label: 'cmdb.recordFacts.criticality', valueLabels: 'cmdb.criticality' }),
      ownerGroup: z.string().nullable().meta({ label: 'cmdb.recordFacts.ownerGroup', ref: 'group' }),
      ownerId: z.uuid().nullable().meta({ ref: 'user' }),
      tags: z.array(z.enum(['a', 'b'])),
    });
    expect(factsFromJsonSchema(z.toJSONSchema(schema))).toEqual([
      {
        path: 'criticality',
        type: 'string',
        options: ['high', 'low'],
        label: 'cmdb.recordFacts.criticality',
        valueLabels: 'cmdb.criticality',
      },
      { path: 'ownerGroup', type: 'string', label: 'cmdb.recordFacts.ownerGroup', ref: 'group' },
      { path: 'ownerId', type: 'id', ref: 'user' },
      { path: 'tags', type: 'list', options: ['a', 'b'] },
    ]);
  });
});
