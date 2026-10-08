import { describe, expect, it } from 'vitest';
import {
  conditionSchema,
  evaluateCondition,
  getFact,
  shiftDate,
  TODAY_FACT,
  todayFact,
  withToday,
} from '../src/conditions';
import {
  defaultFieldValues,
  emptyRow,
  expandRowFields,
  type FieldDef,
  fieldDefSchema,
  formActionSchema,
  type FormSchema,
  formSchemaSchema,
  MAX_ROWS,
  unknownConditionFacts,
  validateFields,
  validateForm,
} from '../src/fields';
import { renderTemplate } from '../src/templates';

const label = { en: 'Label' };
const owner = '0199a0c2-7a3e-7cc1-9a51-3c2f1b8e4d10';

/** Firewall rule lines: port (required, 1–65535), protocol (tcp/udp), owner (a person), until (a date). */
const rules: FieldDef = {
  key: 'rules',
  type: 'rows',
  label: { en: 'Rules' },
  required: true,
  rows: {
    max: 3,
    fields: [
      {
        key: 'port',
        type: 'number',
        label: { en: 'Port' },
        required: true,
        validation: { min: 1, max: 65535 },
      },
      {
        key: 'protocol',
        type: 'select',
        label: { en: 'Protocol' },
        defaultValue: 'tcp',
        options: [
          { value: 'tcp', label: { en: 'TCP' } },
          { value: 'udp', label: { en: 'UDP' } },
        ],
      },
      { key: 'owner', type: 'user', label: { en: 'Owner' } },
      { key: 'until', type: 'date', label: { en: 'Until' } },
    ],
  },
};

describe('table fields (rows): definitions', () => {
  it('accepts columns of the simple types with min and max rows', () => {
    expect(fieldDefSchema.safeParse(rules).success).toBe(true);
  });

  it('needs at least one column', () => {
    expect(fieldDefSchema.safeParse({ key: 't', type: 'rows', label }).success).toBe(false);
    expect(fieldDefSchema.safeParse({ key: 't', type: 'rows', label, rows: { fields: [] } }).success).toBe(
      false,
    );
  });

  it('refuses a table inside a table, conditions on columns and duplicate column keys', () => {
    const col = { key: 'a', type: 'text', label };
    const of = (fields: unknown[], extra: object = {}) =>
      fieldDefSchema.safeParse({ key: 't', type: 'rows', label, rows: { fields, ...extra } }).success;
    expect(of([{ ...col, type: 'rows', rows: { fields: [col] } }])).toBe(false);
    expect(of([{ ...col, visibleWhen: { fact: 'b', op: 'notEmpty' } }])).toBe(false);
    expect(of([col, col])).toBe(false);
    expect(of([col, { ...col, key: 'b', type: 'select' }])).toBe(false); // a select needs options
    expect(of([col], { min: 3, max: 2 })).toBe(false);
    expect(of([col], { max: MAX_ROWS + 1 })).toBe(false);
    expect(of([col], { min: 1, max: MAX_ROWS })).toBe(true);
  });

  it('has no default value', () => {
    expect(fieldDefSchema.safeParse({ ...rules, defaultValue: 'x' }).success).toBe(false);
  });

  it('is a field of a form like any other', () => {
    const schema: FormSchema = { elements: [{ id: 'r', ...rules }] };
    expect(formSchemaSchema.safeParse(schema).success).toBe(true);
  });
});

describe('table fields (rows): answers', () => {
  it('cleans each row and keeps only the columns', () => {
    const r = validateFields([rules], {
      rules: [
        { port: '443', protocol: 'tcp', owner: owner.toUpperCase(), extra: 'dropped' },
        { port: 22, until: '2026-12-31' },
      ],
    });
    expect(r.ok).toBe(true);
    expect(r.values.rules).toEqual([
      { port: 443, protocol: 'tcp', owner },
      { port: 22, until: '2026-12-31' },
    ]);
  });

  it('reports errors per cell as <table>.<row>.<column>, with the row index as given', () => {
    const r = validateFields([rules], {
      rules: [{ port: 443 }, { port: 0, protocol: 'icmp' }, { protocol: 'udp' }],
    });
    expect(r.ok).toBe(false);
    expect(r.errors).toEqual({
      'rules.1.port': { code: 'min', params: { min: 1 } },
      'rules.1.protocol': { code: 'option' },
      'rules.2.port': { code: 'required' },
    });
  });

  it('ignores rows left empty (an unticked box or blank text counts as empty)', () => {
    const r = validateFields([rules], {
      rules: [{ port: '', protocol: '' }, { port: 8080 }, { owner: '  ' }],
    });
    expect(r.ok).toBe(true);
    expect(r.values.rules).toEqual([{ port: 8080 }]);
  });

  it('requires at least one row when required, and checks the number of rows', () => {
    expect(validateFields([rules], { rules: [] }).errors).toEqual({ rules: { code: 'required' } });
    expect(validateFields([rules], { rules: [{}, {}] }).errors).toEqual({ rules: { code: 'required' } });
    const four = Array.from({ length: 4 }, (_, i) => ({ port: i + 1 }));
    expect(validateFields([rules], { rules: four }).errors).toEqual({
      rules: { code: 'maxRows', params: { max: 3 } },
    });
    const atLeastTwo: FieldDef = { ...rules, required: false, rows: { ...rules.rows!, min: 2 } };
    expect(validateFields([atLeastTwo], { rules: [{ port: 1 }] }).errors).toEqual({
      rules: { code: 'minRows', params: { min: 2 } },
    });
    // Optional and empty: no error, no value.
    expect(validateFields([atLeastTwo], { rules: [] })).toEqual({ ok: true, values: {}, errors: {} });
  });

  it('never takes more than the hard limit of rows, whatever max says', () => {
    const many: FieldDef = { ...rules, rows: { fields: rules.rows!.fields } };
    const rows = Array.from({ length: MAX_ROWS + 1 }, (_, i) => ({ port: i + 1 }));
    expect(validateFields([many], { rules: rows }).errors.rules).toEqual({
      code: 'maxRows',
      params: { max: MAX_ROWS },
    });
  });

  it('refuses something that is not a list of rows', () => {
    expect(validateFields([rules], { rules: 'port 443' }).errors).toEqual({ rules: { code: 'type' } });
    expect(validateFields([rules], { rules: [{ port: 443 }, 'x'] }).errors).toEqual({
      'rules.1': { code: 'type' },
    });
  });

  it('starts a required table with one empty row (the columns’ defaults)', () => {
    expect(defaultFieldValues([rules]).rules).toEqual([{ port: '', protocol: 'tcp', owner: '', until: '' }]);
    expect(defaultFieldValues([{ ...rules, required: false }]).rules).toEqual([]);
    expect(emptyRow(rules)).toEqual({ port: '', protocol: 'tcp', owner: '', until: '' });
  });

  it('expands cells into fields of their own for server checks (people, records)', () => {
    const { fields, values } = expandRowFields([rules, { key: 'note', type: 'text', label }], {
      rules: [{ port: 1, owner }, { port: 2 }],
      note: 'n',
    });
    expect(fields.map((f) => f.key)).toEqual([
      'rules.0.port',
      'rules.0.protocol',
      'rules.0.owner',
      'rules.0.until',
      'rules.1.port',
      'rules.1.protocol',
      'rules.1.owner',
      'rules.1.until',
      'note',
    ]);
    expect(values).toEqual({ 'rules.0.port': 1, 'rules.0.owner': owner, 'rules.1.port': 2, note: 'n' });
  });
});

describe('conditions over table rows', () => {
  const data = { rules: [{ port: 443, protocol: 'tcp' }, { port: 22 }, { port: 53, protocol: 'udp' }] };

  it('reads a column across all rows, and keeps numeric indexes', () => {
    expect(getFact(data, 'rules.port')).toEqual([443, 22, 53]);
    expect(getFact(data, 'rules.protocol')).toEqual(['tcp', 'udp']);
    expect(getFact(data, 'rules.1.port')).toBe(22);
    expect(getFact({ data }, 'data.rules.port')).toEqual([443, 22, 53]);
    expect(getFact({ rules: [] }, 'rules.port')).toEqual([]);
  });

  it('matches when any row does', () => {
    expect(evaluateCondition({ fact: 'rules.port', op: 'eq', value: 22 }, data)).toBe(true);
    expect(evaluateCondition({ fact: 'rules.protocol', op: 'in', value: ['udp'] }, data)).toBe(true);
    expect(evaluateCondition({ fact: 'rules.protocol', op: 'contains', value: 'icmp' }, data)).toBe(false);
    expect(evaluateCondition({ fact: 'rules.port', op: 'gt', value: 1024 }, data)).toBe(false);
    expect(evaluateCondition({ fact: 'rules.port', op: 'lt', value: 100 }, data)).toBe(true);
    expect(evaluateCondition({ fact: 'rules.owner', op: 'empty' }, data)).toBe(true);
    expect(evaluateCondition({ fact: 'rules.protocol', op: 'notEmpty' }, data)).toBe(true);
  });

  it('works in form rules and visibility (a table column by <table>.<column>)', () => {
    const schema: FormSchema = {
      elements: [
        { id: 'r', ...rules },
        {
          id: 'j',
          key: 'justification',
          type: 'textarea',
          label,
          visibleWhen: { fact: 'rules.port', op: 'eq', value: 22 },
        },
      ],
      rules: [
        {
          id: 'ssh',
          when: { fact: 'rules.port', op: 'eq', value: 22 },
          require: { fact: 'justification', op: 'notEmpty' },
          message: { en: 'Explain why SSH is needed' },
          fields: ['justification'],
        },
      ],
    };
    expect(validateForm(schema, { rules: [{ port: 443 }] }).ok).toBe(true);
    expect(validateForm(schema, { rules: [{ port: 443 }, { port: 22 }] }).errors.justification?.code).toBe(
      'rule',
    );
    expect(validateForm(schema, { rules: [{ port: 22 }], justification: 'Vendor support' }).ok).toBe(true);
    expect(unknownConditionFacts([rules], { fact: 'rules.port', op: 'eq', value: 1 })).toEqual([]);
  });
});

describe('date offsets and today', () => {
  it('shifts dates and date-times by days; anything else is no value', () => {
    expect(shiftDate('2026-02-27', 2)).toBe('2026-03-01');
    expect(shiftDate('2026-01-10', -10)).toBe('2025-12-31');
    expect(shiftDate('2026-10-08T12:00:00.000Z', 1)).toBe('2026-10-09T12:00:00.000Z');
    expect(shiftDate(['2026-01-01', 'x'], 1)).toEqual(['2026-01-02']);
    expect(shiftDate('soon', 1)).toBeUndefined();
    expect(shiftDate(5, 1)).toBeUndefined();
  });

  it('compares with another date plus or minus days (valueOffsetDays)', () => {
    const withinAYear = { fact: 'end', op: 'lte' as const, valueFact: 'start', valueOffsetDays: 366 };
    expect(evaluateCondition(withinAYear, { start: '2026-01-01', end: '2027-01-02' })).toBe(true);
    expect(evaluateCondition(withinAYear, { start: '2026-01-01', end: '2027-01-03' })).toBe(false);
    const notBefore = { fact: 'wipe', op: 'gte' as const, value: '2026-10-01', valueOffsetDays: -7 };
    expect(evaluateCondition(notBefore, { wipe: '2026-09-24' })).toBe(true);
    expect(evaluateCondition(notBefore, { wipe: '2026-09-23' })).toBe(false);
    // An offset on something that isn't a date never matches.
    expect(evaluateCondition({ fact: 'n', op: 'lte', value: 3, valueOffsetDays: 1 }, { n: 1 })).toBe(false);
  });

  it('is part of the condition schema (whole days, bounded)', () => {
    const base = { fact: 'end', op: 'lte', valueFact: 'start' };
    expect(conditionSchema.safeParse({ ...base, valueOffsetDays: 30 }).success).toBe(true);
    expect(conditionSchema.safeParse({ ...base, valueOffsetDays: 1.5 }).success).toBe(false);
    expect(conditionSchema.safeParse({ ...base, valueOffsetDays: 100_000 }).success).toBe(false);
  });

  it('offers today (UTC) to conditions; a fact of the same name wins', () => {
    const now = new Date('2026-10-08T23:30:00Z');
    expect(todayFact(now)).toBe('2026-10-08');
    expect(withToday({ a: 1 }, now)).toEqual({ today: '2026-10-08', a: 1 });
    expect(withToday({ today: 'mine' }, now)).toEqual({ today: 'mine' });
    expect(withToday(null, now)).toEqual({ today: '2026-10-08' });
  });

  it('lets form rules compare with today (and is not an unknown field)', () => {
    const schema: FormSchema = {
      elements: [{ id: 's', key: 'start', type: 'date', label, required: true }],
      rules: [
        {
          id: 'future',
          require: { fact: 'start', op: 'gte', valueFact: TODAY_FACT },
          message: { en: 'The start cannot be in the past' },
          fields: ['start'],
        },
      ],
    };
    expect(validateForm(schema, { start: '2026-10-08' }, { today: '2026-10-08' }).ok).toBe(true);
    expect(validateForm(schema, { start: '2026-10-07' }, { today: '2026-10-08' }).errors.start?.code).toBe(
      'rule',
    );
    expect(unknownConditionFacts([], { fact: 'start', op: 'gte', valueFact: TODAY_FACT })).toEqual(['start']);
  });
});

describe('conditional actions (FormAction.when)', () => {
  const action = { id: 'grant', on: 'approved' as const, type: 'core.grant-role', config: {} };

  it('takes a condition', () => {
    expect(
      formActionSchema.safeParse({ ...action, when: { fact: 'data.access', op: 'eq', value: 'vpn' } })
        .success,
    ).toBe(true);
    expect(
      formActionSchema.safeParse({
        ...action,
        when: {
          all: [
            { fact: 'steps.review.result', op: 'eq', value: 'ok' },
            { fact: 'today', op: 'lte', value: '2027-01-01' },
          ],
        },
      }).success,
    ).toBe(true);
    expect(formActionSchema.safeParse(action).success).toBe(true);
  });

  it('refuses a malformed condition', () => {
    expect(formActionSchema.safeParse({ ...action, when: { fact: 'data.x', op: 'like' } }).success).toBe(
      false,
    );
    expect(formActionSchema.safeParse({ ...action, when: { fact: 'bad path!', op: 'eq' } }).success).toBe(
      false,
    );
    expect(formActionSchema.safeParse({ ...action, when: 'data.x == 1' }).success).toBe(false);
  });

  it('is kept by the form schema', () => {
    const when = { fact: 'data.rules.port', op: 'eq' as const, value: 22 };
    const parsed = formSchemaSchema.parse({
      elements: [{ id: 'r', ...rules }],
      actions: [{ ...action, when }],
    });
    expect(parsed.actions?.[0]?.when).toEqual(when);
  });
});

describe('templates of tables', () => {
  const context = {
    data: {
      rules: [
        { port: 443, protocol: 'tcp', open: true },
        { port: 22, protocol: 'tcp', tags: ['a', 'b'] },
        {},
      ],
    },
    answers: { rules: 'Port: 443 · Protocol: TCP\nPort: 22 · Protocol: TCP' },
  };

  it('renders one line per row, cells joined by " · " (empty rows left out)', () => {
    expect(renderTemplate('{{data.rules}}', context)).toBe('443 · tcp · true\n22 · tcp · a, b');
  });

  it('can address one row or one cell', () => {
    expect(renderTemplate('{{data.rules.1}}', context)).toBe('{"port":22,"protocol":"tcp","tags":["a","b"]}');
    expect(renderTemplate('{{data.rules.0.port}}', context)).toBe('443');
  });

  it('shows the labelled lines of answers as they are', () => {
    expect(renderTemplate('{{answers.rules}}', context)).toBe(
      'Port: 443 · Protocol: TCP\nPort: 22 · Protocol: TCP',
    );
  });
});
