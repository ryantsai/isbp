import { describe, expect, it } from 'vitest';
import { evaluateCondition, localize } from '../src/conditions';
import {
  advanceWorkflow,
  decideStep,
  emptyWorkflowState,
  factsFromJsonSchema,
  simulateWorkflow,
  validateWorkflowGraph,
  type ApprovalStep,
  type WorkflowGraph,
  workflowGraphSchema,
} from '../src/workflow';
import { z } from 'zod';

const name = (en: string) => ({ en });
const approval = (id: string, extra: Partial<ApprovalStep> = {}): ApprovalStep => ({
  id,
  type: 'approval',
  name: name(id),
  approvers: [{ type: 'manager' }],
  mode: 'any',
  ...extra,
});

describe('evaluateCondition', () => {
  const facts = {
    role: { riskLevel: 'high', key: 'db-admin' },
    amount: '1800',
    tags: ['vpn', 'prod'],
    empty: '',
  };

  it.each([
    [{ fact: 'role.riskLevel', op: 'eq', value: 'HIGH' }, true],
    [{ fact: 'role.riskLevel', op: 'neq', value: 'high' }, false],
    [{ fact: 'amount', op: 'gt', value: 1500 }, true],
    [{ fact: 'amount', op: 'lte', value: 1500 }, false],
    [{ fact: 'role.key', op: 'in', value: ['db-admin', 'dba'] }, true],
    [{ fact: 'role.key', op: 'nin', value: ['db-admin'] }, false],
    [{ fact: 'tags', op: 'contains', value: 'prod' }, true],
    [{ fact: 'tags', op: 'eq', value: 'vpn' }, true],
    [{ fact: 'empty', op: 'empty' }, true],
    [{ fact: 'missing.path', op: 'empty' }, true],
    [{ fact: 'missing.path', op: 'gt', value: 1 }, false],
    [
      {
        all: [
          { fact: 'amount', op: 'gte', value: 1800 },
          { fact: 'role.riskLevel', op: 'eq', value: 'high' },
        ],
      },
      true,
    ],
    [{ any: [{ fact: 'amount', op: 'lt', value: 10 }, { not: { fact: 'tags', op: 'empty' } }] }, true],
  ] as const)('%j → %s', (condition, expected) => {
    expect(evaluateCondition(condition as never, facts)).toBe(expected);
  });

  it('compares ISO dates ordinally', () => {
    expect(evaluateCondition({ fact: 'd', op: 'gt', value: '2026-01-01' }, { d: '2026-03-04' })).toBe(true);
  });
});

describe('localize', () => {
  it('falls back to English, then to any filled locale', () => {
    expect(localize({ en: 'Hello', 'ja-JP': 'こんにちは' }, 'ja-JP')).toBe('こんにちは');
    expect(localize({ en: 'Hello' }, 'zh-TW')).toBe('Hello');
    expect(localize({ 'zh-TW': '你好' }, 'ja-JP')).toBe('你好');
    expect(localize(null, 'en')).toBe('');
  });
});

describe('advanceWorkflow', () => {
  it('runs sequential steps one at a time', () => {
    const graph: WorkflowGraph = { steps: [approval('a'), approval('b')] };
    let r = advanceWorkflow(graph, emptyWorkflowState(), {});
    expect(r.outcome).toBe('running');
    expect(r.activated.map((s) => s.id)).toEqual(['a']);
    r.state.steps.a = { status: 'approved' };
    r = advanceWorkflow(graph, r.state, {});
    expect(r.activated.map((s) => s.id)).toEqual(['b']);
    r.state.steps.b = { status: 'approved' };
    expect(advanceWorkflow(graph, r.state, {}).outcome).toBe('approved');
  });

  it('does not mutate the previous state', () => {
    const prev = emptyWorkflowState();
    advanceWorkflow({ steps: [approval('a')] }, prev, {});
    expect(prev.steps).toEqual({});
  });

  it('skips steps whose `when` does not hold', () => {
    const graph: WorkflowGraph = {
      steps: [approval('sec', { when: { fact: 'risk', op: 'eq', value: 'high' } }), approval('owner')],
    };
    const r = advanceWorkflow(graph, emptyWorkflowState(), { risk: 'low' });
    expect(r.skipped.map((s) => s.id)).toEqual(['sec']);
    expect(r.activated.map((s) => s.id)).toEqual(['owner']);
  });

  it('activates every parallel branch and joins on all', () => {
    const graph: WorkflowGraph = {
      steps: [
        {
          id: 'p',
          type: 'parallel',
          name: name('p'),
          branches: [
            { id: 'b1', name: name('b1'), steps: [approval('x')] },
            { id: 'b2', name: name('b2'), steps: [approval('y'), approval('z')] },
          ],
        },
        approval('after'),
      ],
    };
    let r = advanceWorkflow(graph, emptyWorkflowState(), {});
    expect(r.activated.map((s) => s.id)).toEqual(['x', 'y']);
    r.state.steps.x = { status: 'approved' };
    r.state.steps.y = { status: 'approved' };
    r = advanceWorkflow(graph, r.state, {});
    expect(r.activated.map((s) => s.id)).toEqual(['z']);
    r.state.steps.z = { status: 'approved' };
    r = advanceWorkflow(graph, r.state, {});
    expect(r.state.steps.p?.status).toBe('approved');
    expect(r.activated.map((s) => s.id)).toEqual(['after']);
  });

  it('rejects the instance when any branch rejects', () => {
    const graph: WorkflowGraph = {
      steps: [
        {
          id: 'p',
          type: 'parallel',
          name: name('p'),
          branches: [
            { id: 'b1', name: name('b1'), steps: [approval('x')] },
            { id: 'b2', name: name('b2'), steps: [approval('y')] },
          ],
        },
      ],
    };
    const r = advanceWorkflow(graph, emptyWorkflowState(), {});
    r.state.steps.y = { status: 'rejected' };
    expect(advanceWorkflow(graph, r.state, {}).outcome).toBe('rejected');
  });

  it('picks the first matching condition branch, or the default branch', () => {
    const graph: WorkflowGraph = {
      steps: [
        {
          id: 'c',
          type: 'condition',
          name: name('c'),
          branches: [
            {
              id: 'big',
              name: name('big'),
              when: { fact: 'amount', op: 'gt', value: 5000 },
              steps: [approval('cfo')],
            },
            {
              id: 'mid',
              name: name('mid'),
              when: { fact: 'amount', op: 'gt', value: 1000 },
              steps: [approval('fin')],
            },
          ],
          otherwise: { id: 'small', name: name('small'), steps: [] },
        },
      ],
    };
    expect(advanceWorkflow(graph, emptyWorkflowState(), { amount: 9000 }).activated[0]?.id).toBe('cfo');
    const mid = advanceWorkflow(graph, emptyWorkflowState(), { amount: 2000 });
    expect(mid.activated[0]?.id).toBe('fin');
    expect(mid.branches).toEqual([{ stepId: 'c', branchId: 'mid' }]);
    // An empty default branch passes straight through.
    expect(advanceWorkflow(graph, emptyWorkflowState(), { amount: 10 }).outcome).toBe('approved');
  });

  it('keeps the chosen branch even if facts change later', () => {
    const graph: WorkflowGraph = {
      steps: [
        {
          id: 'c',
          type: 'condition',
          name: name('c'),
          branches: [
            {
              id: 'yes',
              name: name('yes'),
              when: { fact: 'f', op: 'eq', value: true },
              steps: [approval('a')],
            },
          ],
          otherwise: { id: 'no', name: name('no'), steps: [approval('b')] },
        },
      ],
    };
    const r = advanceWorkflow(graph, emptyWorkflowState(), { f: true });
    expect(advanceWorkflow(graph, r.state, { f: false }).activated).toEqual([]);
    expect(r.state.steps.c?.branch).toBe('yes');
  });

  it('completes notify steps immediately', () => {
    const graph: WorkflowGraph = {
      steps: [
        { id: 'n', type: 'notify', name: name('n'), recipients: [{ type: 'requester' }] },
        approval('a'),
      ],
    };
    const r = advanceWorkflow(graph, emptyWorkflowState(), {});
    expect(r.notifications.map((s) => s.id)).toEqual(['n']);
    expect(r.activated.map((s) => s.id)).toEqual(['a']);
  });

  it('approves an empty graph straight away', () => {
    expect(advanceWorkflow({ steps: [] }, emptyWorkflowState(), {}).outcome).toBe('approved');
  });
});

describe('decideStep', () => {
  it.each([
    ['any', undefined, ['pending', 'approved'], 'approved'],
    ['any', undefined, ['rejected', 'pending'], 'rejected'],
    ['all', undefined, ['approved', 'pending'], 'pending'],
    ['all', undefined, ['approved', 'approved'], 'approved'],
    ['all', undefined, ['approved', 'rejected'], 'rejected'],
    ['quorum', 2, ['approved', 'pending', 'approved'], 'approved'],
    ['quorum', 2, ['rejected', 'pending', 'approved'], 'pending'],
    ['quorum', 2, ['rejected', 'rejected', 'approved'], 'rejected'],
    ['quorum', 9, ['approved', 'approved'], 'approved'],
  ] as const)('%s(%s) %j → %s', (mode, quorum, slots, expected) => {
    expect(decideStep({ mode, quorum }, slots)).toBe(expected);
  });
});

describe('simulateWorkflow', () => {
  it('records the path taken', () => {
    const graph: WorkflowGraph = {
      steps: [
        approval('mgr'),
        approval('sec', { when: { fact: 'risk', op: 'eq', value: 'high' } }),
        approval('owner'),
      ],
    };
    const low = simulateWorkflow(graph, { risk: 'low' });
    expect(low.outcome).toBe('approved');
    expect(low.order).toEqual(['mgr', 'sec', 'owner']);
    expect(low.state.steps.sec?.status).toBe('skipped');
    const rejected = simulateWorkflow(graph, { risk: 'high' }, (s) =>
      s.id === 'sec' ? 'rejected' : 'approved',
    );
    expect(rejected.outcome).toBe('rejected');
    expect(rejected.state.steps.owner).toBeUndefined();
  });
});

describe('validateWorkflowGraph', () => {
  it('reports semantic problems per step', () => {
    const issues = validateWorkflowGraph({
      steps: [
        approval('a', { approvers: [] }),
        approval('b', { mode: 'quorum', quorum: 3 }),
        approval('c', { sla: { dueHours: 4, remindHours: 8, onBreach: 'escalate' } }),
        approval('a'),
        { id: 'p', type: 'parallel', name: name('p'), branches: [] },
      ],
    });
    expect(issues).toEqual(
      expect.arrayContaining([
        { stepId: 'a', code: 'noApprovers' },
        { stepId: 'b', code: 'quorumInvalid' },
        { stepId: 'c', code: 'escalationTargets' },
        { stepId: 'c', code: 'remindAfterDue' },
        { stepId: 'a', code: 'duplicateId' },
        { stepId: 'p', code: 'noBranches' },
      ]),
    );
    expect(validateWorkflowGraph({ steps: [] })).toEqual([{ stepId: null, code: 'empty' }]);
    expect(validateWorkflowGraph({ steps: [approval('ok')] })).toEqual([]);
  });

  it('rejects malformed graphs at the schema level', () => {
    expect(workflowGraphSchema.safeParse({ steps: [{ id: 'x', type: 'approval' }] }).success).toBe(false);
    expect(
      workflowGraphSchema.safeParse({
        steps: [approval('ok', { approvers: [{ type: 'fact', fact: 'role.ownerId' }] })],
      }).success,
    ).toBe(true);
  });
});

describe('factsFromJsonSchema', () => {
  it('flattens nested objects with types and options', () => {
    const schema = z.toJSONSchema(
      z.object({
        role: z.object({
          key: z.string(),
          riskLevel: z.enum(['low', 'medium', 'high']),
          ownerId: z.uuid().nullable(),
        }),
        durationDays: z.number().int().nullable(),
        permanent: z.boolean(),
      }),
    );
    expect(factsFromJsonSchema(schema)).toEqual([
      { path: 'role.key', type: 'string' },
      { path: 'role.riskLevel', type: 'string', options: ['low', 'medium', 'high'] },
      { path: 'role.ownerId', type: 'id' },
      { path: 'durationDays', type: 'number' },
      { path: 'permanent', type: 'boolean' },
    ]);
  });
});
