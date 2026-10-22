import { describe, expect, it } from 'vitest';
import {
  countByKind,
  dependencies,
  dependentsOf,
  formsUsing,
  groupByProcess,
  type PlanItem,
  planOfPackage,
  workflowItemOf,
} from '../src/lib/processes';

/** A small process pack: shared groups, two processes (one with a schedule), a ticket workflow and a field. */
const pack = planOfPackage([
  { ref: 'group-a', kind: 'core.group', op: 'create', value: { key: 'approvers', name: 'Approvers' } },
  { ref: 'group-b', kind: 'core.group', op: 'create', value: { key: 'it-ops', name: 'IS operations' } },
  { ref: 'group-c', kind: 'core.group', op: 'create', value: { key: 'network', name: 'Network' } },
  {
    ref: 'category',
    kind: 'itsm.category',
    op: 'create',
    value: { key: 'anomaly', name: { en: 'Anomaly' }, defaultGroupId: '$ref:group-b' },
  },
  {
    ref: 'workflow-account',
    kind: 'core.workflow',
    op: 'create',
    value: {
      name: 'Account approval',
      triggerKey: 'core.form-submission',
      graph: {
        steps: [
          { id: 'm', type: 'approval', approvers: [{ type: 'manager' }] },
          { id: 'a', type: 'approval', approvers: [{ type: 'group', groupKey: 'approvers' }] },
        ],
      },
    },
  },
  {
    ref: 'form-account',
    kind: 'core.form',
    op: 'create',
    value: {
      key: 'account',
      name: { en: 'Account request' },
      workflowId: '$ref:workflow-account',
      schema: {
        elements: [],
        actions: [{ id: 't', type: 'itsm.create-ticket', config: { categoryId: '$ref:category' } }],
      },
      audience: { type: 'groups', groupKeys: ['it-ops'] },
    },
  },
  {
    ref: 'workflow-firewall',
    kind: 'core.workflow',
    op: 'create',
    value: {
      name: 'Firewall approval',
      triggerKey: 'core.form-submission',
      graph: { steps: [{ id: 'n', type: 'approval', approvers: [{ type: 'group', groupKey: 'network' }] }] },
    },
  },
  {
    ref: 'form-firewall',
    kind: 'core.form',
    op: 'create',
    value: { key: 'firewall', name: { en: 'Firewall rule' }, workflowId: '$ref:workflow-firewall' },
  },
  {
    ref: 'workflow-resolution',
    kind: 'core.workflow',
    op: 'create',
    value: {
      name: 'Resolution sign-off',
      triggerKey: 'itsm.resolution',
      graph: {
        steps: [{ id: 's', type: 'approval', approvers: [{ type: 'group', groupKey: 'approvers' }] }],
      },
    },
  },
  {
    ref: 'field',
    kind: 'core.custom-field',
    op: 'create',
    value: { entityType: 'itsm.ticket', field: { key: 'hardened', type: 'boolean' } },
  },
  {
    ref: 'job',
    kind: 'scheduler.job',
    op: 'create',
    value: {
      name: 'Yearly firewall review',
      ownerGroupId: '$ref:group-c',
      config: {
        formKey: 'firewall',
        assignee: { type: 'group', groupKey: 'network' },
        alsoNotify: { groupKey: 'it-ops' },
      },
    },
  },
]);

const ids = (items: readonly PlanItem[]) => items.map((i) => i.ref);
const byRef = (ref: string) => pack.find((i) => i.ref === ref)!;

describe('what items refer to', () => {
  it('follows $ref values and targets, and keys of earlier items named by a property for that kind', () => {
    const deps = dependencies(pack);
    const of = (ref: string) => [...deps.get(byRef(ref).id)!].map((id) => pack[Number(id)]!.ref).sort();
    expect(of('category')).toEqual(['group-b']);
    expect(of('workflow-account')).toEqual(['group-a']);
    // Its workflow and ticket category by $ref, its audience group by key.
    expect(of('form-account')).toEqual(['category', 'group-b', 'workflow-account']);
    // The schedule names the form by `formKey` and its groups by `groupKey` and `$ref`.
    expect(of('job')).toEqual(['form-firewall', 'group-b', 'group-c']);
    expect(of('field')).toEqual([]);
  });

  it('ignores keys of later items, keys of another kind and the item itself', () => {
    const items = planOfPackage([
      { ref: 'wf', kind: 'core.workflow', op: 'create', value: { approvers: [{ groupKey: 'later' }] } },
      { ref: 'g', kind: 'core.group', op: 'create', value: { key: 'later' } },
      { ref: 'f', kind: 'core.form', op: 'create', value: { key: 'x', roleKey: 'later', formKey: 'x' } },
    ]);
    expect([...dependencies(items).values()].map((s) => s.size)).toEqual([0, 0, 0]);
  });

  it('lists everything that breaks when an item is removed, transitively and in order', () => {
    expect(ids(dependentsOf(pack, byRef('workflow-firewall').id))).toEqual(['form-firewall', 'job']);
    expect(ids(dependentsOf(pack, byRef('group-b').id))).toEqual(['category', 'form-account', 'job']);
    expect(ids(dependentsOf(pack, byRef('group-a').id))).toEqual([
      'workflow-account',
      'form-account',
      'workflow-resolution',
    ]);
    expect(dependentsOf(pack, byRef('field').id)).toEqual([]);
  });
});

describe('grouping by process', () => {
  const grouping = groupByProcess(pack);
  const groupRefs = grouping.groups.map((g) => [
    g.type,
    g.itemIds.map((id) => pack.find((i) => i.id === id)!.ref),
  ]);

  it('puts each form with its workflow, the schedules that assign it and what only it uses', () => {
    expect(groupRefs).toEqual([
      // Used by several processes (or a process and something else): shared, first.
      ['shared', ['group-a', 'group-b']],
      // The ticket category only this form's action names.
      ['process', ['category', 'workflow-account', 'form-account']],
      // The network group is used only by this process's workflow and schedule.
      ['process', ['group-c', 'workflow-firewall', 'form-firewall', 'job']],
      ['other', ['workflow-resolution', 'field']],
    ]);
    expect(grouping.groupOf.get(byRef('job').id)).toBe(`process:${byRef('form-firewall').id}`);
  });

  it('counts processes, then the other items by kind, without the workflows of processes', () => {
    expect(countByKind(pack, grouping)).toEqual({
      processes: 2,
      kinds: [
        { kind: 'core.group', count: 3 },
        { kind: 'itsm.category', count: 1 },
        { kind: 'core.workflow', count: 1 },
        { kind: 'core.custom-field', count: 1 },
        { kind: 'scheduler.job', count: 1 },
      ],
    });
  });

  it('keeps a workflow two forms use apart, and has no process without a form', () => {
    const items = planOfPackage([
      { ref: 'wf', kind: 'core.workflow', op: 'create', value: { name: 'Shared approval' } },
      { ref: 'f1', kind: 'core.form', op: 'create', value: { key: 'one', workflowId: '$ref:wf' } },
      { ref: 'f2', kind: 'core.form', op: 'create', value: { key: 'two', workflowId: '$ref:wf' } },
    ]);
    expect(groupByProcess(items).groups.map((g) => [g.type, g.itemIds])).toEqual([
      ['shared', ['0']],
      ['process', ['1']],
      ['process', ['2']],
    ]);
    const lone = planOfPackage([{ kind: 'core.custom-field', op: 'create', value: {} }]);
    expect(groupByProcess(lone).groups.map((g) => g.type)).toEqual(['other']);
    expect(countByKind(lone).processes).toBe(0);
  });

  it('finds a form’s workflow item and the forms that use a workflow', () => {
    expect(workflowItemOf(byRef('form-account'), pack)?.ref).toBe('workflow-account');
    expect(workflowItemOf(byRef('job'), pack)).toBeNull();
    expect(ids(formsUsing(byRef('workflow-firewall'), pack))).toEqual(['form-firewall']);
    expect(formsUsing(byRef('workflow-resolution'), pack)).toEqual([]);
  });
});
