import { describe, expect, it } from 'vitest';
import {
  defaultFieldValues,
  type FieldDef,
  fieldDefSchema,
  formSchemaSchema,
  isSafePattern,
  validateFields,
  visibleElements,
  visibleFieldKeys,
} from '../src/fields';

const label = { en: 'Label' };
const fields: FieldDef[] = [
  {
    key: 'deviceType',
    type: 'select',
    label,
    required: true,
    options: [
      { value: 'laptop', label: { en: 'Laptop' } },
      { value: 'monitor', label: { en: 'Monitor' } },
    ],
  },
  {
    key: 'model',
    type: 'text',
    label,
    required: true,
    visibleWhen: { fact: 'deviceType', op: 'eq', value: 'laptop' },
  },
  { key: 'reason', type: 'textarea', label, validation: { minLength: 5 } },
  { key: 'cost', type: 'number', label, validation: { min: 0, max: 5000 } },
  { key: 'urgent', type: 'boolean', label },
  { key: 'neededBy', type: 'date', label },
  { key: 'costCenter', type: 'text', label, validation: { pattern: 'CC-\\d{4}' } },
  {
    key: 'extras',
    type: 'multiselect',
    label,
    options: [
      { value: 'dock', label },
      { value: 'bag', label },
    ],
    validation: { max: 1 },
  },
  { key: 'contact', type: 'email', label },
  { key: 'manager', type: 'user', label },
];

describe('validateFields', () => {
  it('coerces valid values and drops unknown keys', () => {
    const r = validateFields(fields, {
      deviceType: 'laptop',
      model: '  X1 Carbon ',
      cost: '1499.5',
      urgent: 'true',
      neededBy: '2026-12-01',
      costCenter: 'CC-1234',
      extras: 'dock',
      contact: 'a@b.co',
      manager: '0199A1B2-0000-7000-8000-000000000001',
      bogus: 'dropped',
    });
    expect(r.ok).toBe(true);
    expect(r.values).toEqual({
      deviceType: 'laptop',
      model: 'X1 Carbon',
      cost: 1499.5,
      urgent: true,
      neededBy: '2026-12-01',
      costCenter: 'CC-1234',
      extras: ['dock'],
      contact: 'a@b.co',
      manager: '0199a1b2-0000-7000-8000-000000000001',
    });
  });

  it('reports field-level error codes', () => {
    const r = validateFields(fields, {
      model: 'x',
      reason: 'abc',
      cost: 9000,
      neededBy: '2026-02-30',
      costCenter: 'CC-12',
      extras: ['dock', 'bag'],
      contact: 'nope',
      manager: 'someone',
    });
    expect(r.ok).toBe(false);
    expect(r.errors).toEqual({
      deviceType: { code: 'required' },
      reason: { code: 'tooShort', params: { min: 5 } },
      cost: { code: 'max', params: { max: 5000 } },
      neededBy: { code: 'date' },
      costCenter: { code: 'pattern' },
      extras: { code: 'max', params: { max: 1 } },
      contact: { code: 'email' },
      manager: { code: 'user' },
    });
  });

  it('neither requires nor keeps hidden fields', () => {
    const r = validateFields(fields, { deviceType: 'monitor', model: 'smuggled' });
    expect(r.ok).toBe(true);
    expect(r.values).toEqual({ deviceType: 'monitor' });
    expect(validateFields(fields, { deviceType: 'laptop' }).errors.model).toEqual({ code: 'required' });
  });

  it('treats a required checkbox as "must be ticked"', () => {
    const consent: FieldDef[] = [{ key: 'agree', type: 'boolean', label, required: true }];
    expect(validateFields(consent, { agree: false }).errors.agree).toEqual({ code: 'required' });
    expect(validateFields(consent, { agree: true }).ok).toBe(true);
  });
});

describe('visibility', () => {
  it('resolves chained conditions to a fixed point', () => {
    const chain: FieldDef[] = [
      { key: 'a', type: 'boolean', label },
      { key: 'b', type: 'text', label, visibleWhen: { fact: 'a', op: 'eq', value: true } },
      { key: 'c', type: 'text', label, visibleWhen: { fact: 'b', op: 'notEmpty' } },
    ];
    expect([...visibleFieldKeys(chain, { a: true, b: 'x' })]).toEqual(['a', 'b', 'c']);
    // b is hidden, so its stale value must not keep c visible.
    expect([...visibleFieldKeys(chain, { a: false, b: 'x' })]).toEqual(['a']);
  });

  it('applies conditions to display elements too', () => {
    const schema = {
      elements: [
        { id: '1', key: 'a', type: 'boolean' as const, label },
        {
          id: '2',
          type: 'paragraph' as const,
          text: label,
          visibleWhen: { fact: 'a', op: 'eq' as const, value: true },
        },
      ],
    };
    expect(visibleElements(schema, { a: false }).map((e) => e.id)).toEqual(['1']);
    expect(visibleElements(schema, { a: true }).map((e) => e.id)).toEqual(['1', '2']);
  });
});

describe('schemas', () => {
  it('requires options for select fields and unique keys in forms', () => {
    expect(fieldDefSchema.safeParse({ key: 'x', type: 'select', label }).success).toBe(false);
    expect(fieldDefSchema.safeParse({ key: 'Bad Key', type: 'text', label }).success).toBe(false);
    expect(fieldDefSchema.safeParse({ key: 'x', type: 'text', label: {} }).success).toBe(false);
    const dup = formSchemaSchema.safeParse({
      elements: [
        { id: '1', key: 'a', type: 'text', label },
        { id: '2', key: 'a', type: 'text', label },
      ],
    });
    expect(dup.success).toBe(false);
  });

  it('refuses catastrophic-backtracking patterns', () => {
    expect(isSafePattern('CC-\\d{4}')).toBe(true);
    expect(isSafePattern('(a+)+$')).toBe(false);
    expect(isSafePattern('([a-z]*)*')).toBe(false);
    expect(isSafePattern('[')).toBe(false);
  });
});

describe('defaultFieldValues', () => {
  it('fills defaults and keeps existing values', () => {
    expect(
      defaultFieldValues(
        [
          { key: 'a', type: 'text', label, defaultValue: 'x' },
          { key: 'b', type: 'multiselect', label, options: [{ value: 'v', label }] },
          { key: 'c', type: 'boolean', label },
        ],
        { a: 'kept' },
      ),
    ).toEqual({ a: 'kept', b: [], c: false });
  });
});
