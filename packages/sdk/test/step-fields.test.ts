import { describe, expect, it } from 'vitest';
import type { FieldDef } from '../src/fields';
import {
  type ApprovalStep,
  MAX_STEP_FIELDS,
  parseStepFact,
  simulateWorkflow,
  stepDecisionFields,
  stepsBefore,
  validateStepFields,
  validateWorkflowGraph,
  type WorkflowGraph,
  workflowGraphSchema,
} from '../src/workflow';

const name = (en: string) => ({ en });
const approval = (id: string, extra: Partial<ApprovalStep> = {}): ApprovalStep => ({
  id,
  type: 'approval',
  name: name(id),
  approvers: [{ type: 'manager' }],
  mode: 'any',
  ...extra,
});

const result: FieldDef = {
  key: 'result',
  type: 'select',
  label: name('Result'),
  required: true,
  options: [
    { value: 'ok', label: name('OK') },
    { value: 'cab', label: name('Needs the CAB') },
  ],
};
const notes: FieldDef = { key: 'notes', type: 'textarea', label: name('Notes') };
const wiped: FieldDef = { key: 'wipedOn', type: 'date', label: name('Wiped on'), required: true };

describe('step fields schema', () => {
  it('accepts an approval step with fields and when they are required', () => {
    const graph: WorkflowGraph = {
      steps: [approval('review', { fields: [result, notes], fieldsRequiredOn: 'both' })],
    };
    expect(workflowGraphSchema.safeParse(graph).success).toBe(true);
  });

  it('refuses duplicate keys, too many fields, invalid fields and unknown required-on values', () => {
    const parse = (step: Partial<ApprovalStep> | Record<string, unknown>) =>
      workflowGraphSchema.safeParse({ steps: [{ ...approval('review'), ...step }] }).success;
    expect(parse({ fields: [result, { ...notes, key: 'result' }] })).toBe(false);
    const many = Array.from({ length: MAX_STEP_FIELDS + 1 }, (_, i) => ({ ...notes, key: `n${i}` }));
    expect(parse({ fields: many })).toBe(false);
    expect(parse({ fields: many.slice(0, MAX_STEP_FIELDS) })).toBe(true);
    expect(parse({ fields: [{ ...result, options: [] }] })).toBe(false);
    expect(parse({ fields: [{ ...notes, key: 'Bad key' }] })).toBe(false);
    expect(parse({ fields: [{ key: 'ci', type: 'record', label: name('CI') }] })).toBe(false);
    expect(parse({ fieldsRequiredOn: 'never' })).toBe(false);
  });
});

describe('validateStepFields', () => {
  const step = approval('review', { fields: [result, notes, wiped] });

  it('needs the required fields to approve, and checks values like form answers', () => {
    expect(validateStepFields(step, 'approve', {}).errors).toEqual({
      result: { code: 'required' },
      wipedOn: { code: 'required' },
    });
    expect(validateStepFields(step, 'approve', { result: 'maybe', wipedOn: '2026-02-30' }).errors).toEqual({
      result: { code: 'option' },
      wipedOn: { code: 'date' },
    });
    const ok = validateStepFields(step, 'approve', {
      result: 'ok',
      wipedOn: '2026-10-01',
      notes: '  done \r\n',
      extra: 'dropped',
    });
    expect(ok).toEqual({
      ok: true,
      values: { result: 'ok', wipedOn: '2026-10-01', notes: 'done' },
      errors: {},
    });
  });

  it('makes required fields optional when rejecting, unless the step asks for them on both', () => {
    expect(validateStepFields(step, 'reject', {}).ok).toBe(true);
    expect(validateStepFields(step, 'reject', { result: 'nope' }).errors).toEqual({
      result: { code: 'option' },
    });
    expect(stepDecisionFields(step, 'reject').some((f) => f.required)).toBe(false);
    const both = { ...step, fieldsRequiredOn: 'both' as const };
    expect(validateStepFields(both, 'reject', {}).errors).toHaveProperty('result');
    expect(validateStepFields(approval('plain'), 'approve', { anything: 1 })).toEqual({
      ok: true,
      values: {},
      errors: {},
    });
  });

  it('drops hidden conditional fields', () => {
    const conditional = approval('review', {
      fields: [result, { ...notes, required: true, visibleWhen: { fact: 'result', op: 'eq', value: 'cab' } }],
    });
    expect(validateStepFields(conditional, 'approve', { result: 'ok', notes: 'x' }).values).toEqual({
      result: 'ok',
    });
    expect(validateStepFields(conditional, 'approve', { result: 'cab' }).errors).toEqual({
      notes: { code: 'required' },
    });
  });
});

describe('stepsBefore and step facts', () => {
  const graph: WorkflowGraph = {
    steps: [
      approval('first', { fields: [result] }),
      {
        id: 'both',
        type: 'parallel',
        name: name('Both'),
        branches: [
          { id: 'left', name: name('Left'), steps: [approval('l1', { fields: [notes] }), approval('l2')] },
          { id: 'right', name: name('Right'), steps: [approval('r1')] },
        ],
      },
      approval('last'),
    ],
  };

  it('lists the approval steps that may have been decided before a step', () => {
    const ids = (id: string) => stepsBefore(graph, id).map((s) => s.id);
    expect(ids('first')).toEqual([]);
    expect(ids('l2')).toEqual(['first', 'l1']);
    expect(ids('r1')).toEqual(['first']);
    expect(ids('last')).toEqual(['first', 'l1', 'l2', 'r1']);
    expect(ids('unknown')).toEqual([]);
  });

  it('parses steps.<id>.<key> paths only', () => {
    expect(parseStepFact('steps.first.result')).toEqual({ stepId: 'first', key: 'result' });
    expect(parseStepFact('steps.first')).toBeNull();
    expect(parseStepFact('steps.first.result.more')).toBeNull();
    expect(parseStepFact('data.result')).toBeNull();
  });

  it('flags facts of steps that are not before the reader, and fields the step lacks', () => {
    const at = (when: ApprovalStep['when'], where: 'r1' | 'last' | 'first') => {
      const g = structuredClone(graph);
      const walk = (steps: WorkflowGraph['steps']) =>
        steps.forEach((s) => {
          if (s.id === where) s.when = when;
          if (s.type === 'parallel') s.branches.forEach((b) => walk(b.steps));
        });
      walk(g.steps);
      return validateWorkflowGraph(g).filter((i) => i.code === 'stepFact');
    };
    expect(at({ fact: 'steps.first.result', op: 'eq', value: 'cab' }, 'last')).toEqual([]);
    expect(at({ fact: 'steps.l1.notes', op: 'notEmpty' }, 'last')).toEqual([]);
    // A parallel branch beside it, the step itself, a missing key.
    expect(at({ fact: 'steps.l1.notes', op: 'notEmpty' }, 'r1')).toEqual([
      { stepId: 'r1', code: 'stepFact' },
    ]);
    expect(at({ fact: 'steps.first.result', op: 'eq', value: 'x' }, 'first')).toHaveLength(1);
    expect(at({ fact: 'steps.first.missing', op: 'empty' }, 'last')).toHaveLength(1);
    // Approver rules read step facts too.
    const g = structuredClone(graph);
    (g.steps[2] as ApprovalStep).approvers = [{ type: 'fact', fact: 'steps.last.handler' }];
    expect(validateWorkflowGraph(g)).toContainEqual({ stepId: 'last', code: 'stepFact' });
  });

  it('flags step fields whose conditions or defaults the form builder would refuse', () => {
    const issues = (fields: FieldDef[]) =>
      validateWorkflowGraph({ steps: [approval('s', { fields })] }).filter((i) => i.code === 'stepFields');
    expect(issues([result, { ...notes, visibleWhen: { fact: 'result', op: 'eq', value: 'cab' } }])).toEqual(
      [],
    );
    expect(issues([{ ...notes, visibleWhen: { fact: 'other', op: 'notEmpty' } }])).toHaveLength(1);
    expect(issues([{ ...notes, visibleWhen: { fact: 'notes', op: 'notEmpty' } }])).toHaveLength(1);
    expect(issues([{ ...result, defaultValue: 'nope' }])).toHaveLength(1);
  });

  it('routes on step facts when they are known (the simulator uses the same interpreter)', () => {
    const g: WorkflowGraph = {
      steps: [
        approval('review', { fields: [result] }),
        approval('cab', { when: { fact: 'steps.review.result', op: 'eq', value: 'cab' } }),
      ],
    };
    expect(simulateWorkflow(g, { steps: { review: { result: 'cab' } } }).order).toEqual(['review', 'cab']);
    const skipped = simulateWorkflow(g, { steps: { review: { result: 'ok' } } });
    expect(skipped.state.steps.cab).toEqual({ status: 'skipped', reason: 'condition' });
  });
});
