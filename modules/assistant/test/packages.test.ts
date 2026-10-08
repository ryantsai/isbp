import type { ChangeSetPackage } from '@isbp/sdk';
import { describe, expect, it } from 'vitest';
import { changeSetPackageSchema, type ItemOp } from '../src/contracts';
import { packageIssues, packageOf, proposalProblems } from '../src/lib/packages';

const ALL: ItemOp[] = ['create', 'update', 'archive', 'delete'];
const ops = (kind: string): ItemOp[] | undefined =>
  kind === 'core.form' ? ['create', 'update', 'archive'] : kind.startsWith('core.') ? ALL : undefined;

/** A package as a module author writes it (typed by the SDK). */
const process: ChangeSetPackage = {
  format: 'isbp.change-set-package',
  version: 1,
  key: 'change-requests',
  title: { en: 'Change requests', 'zh-TW': '變更申請' },
  summary: { en: 'A CAB group, its approval and the form' },
  requires: { modules: ['itsm'] },
  items: [
    { kind: 'core.group', op: 'create', value: { key: 'cab', name: 'Change Advisory Board' } },
    {
      ref: 'approval',
      kind: 'core.workflow',
      op: 'create',
      value: {
        name: 'Change approval',
        graph: { steps: [{ approvers: [{ type: 'group', groupKey: 'cab' }] }] },
      },
    },
    { ref: 'form', kind: 'core.form', op: 'create', value: { key: 'change', workflowId: '$ref:approval' } },
  ],
};

describe('the package format', () => {
  it('accepts what the SDK type describes, and nothing else', () => {
    expect(changeSetPackageSchema.parse(process)).toEqual(process);
    const bad = (patch: Record<string, unknown>) =>
      changeSetPackageSchema.safeParse({ ...process, ...patch }).success;
    expect(bad({ version: 2 })).toBe(false);
    expect(bad({ format: 'something-else' })).toBe(false);
    expect(bad({ title: {} })).toBe(false);
    expect(bad({ title: { fr: 'Demandes' } })).toBe(false);
    expect(bad({ extra: 1 })).toBe(false);
    expect(bad({ items: [] })).toBe(false);
    expect(bad({ items: [{ kind: 'core.form', op: 'create', values: {} }] })).toBe(false);
    expect(bad({ items: [{ kind: 'Core.Form', op: 'create', value: {} }] })).toBe(false);
    expect(bad({ items: [{ ref: '1st', kind: 'core.form', op: 'create', value: {} }] })).toBe(false);
    expect(bad({ requires: { modules: ['Not A Module'] } })).toBe(false);
    expect(
      bad({ items: Array.from({ length: 301 }, () => ({ kind: 'core.group', op: 'create', value: {} })) }),
    ).toBe(false);
  });
});

describe('checks beyond the schema', () => {
  it('passes a well-formed package', () => {
    expect(packageIssues(process, ops)).toEqual([]);
  });

  it('reports names used twice, references to later or unknown items and two changes to one object', () => {
    const issues = packageIssues(
      {
        items: [
          { ref: 'form', kind: 'core.form', op: 'create', value: { workflowId: '$ref:approval' } },
          { ref: 'approval', kind: 'core.workflow', op: 'create', value: { name: 'A' } },
          { ref: 'approval', kind: 'core.workflow', op: 'create', value: { name: 'B' } },
          { kind: 'core.form', op: 'update', targetId: '$ref:nope', value: {} },
          { kind: 'core.role', op: 'update', targetId: 'r1', value: { name: 'x' } },
          { kind: 'core.role', op: 'delete', targetId: 'r1' },
        ],
      },
      ops,
    );
    expect(issues.map((i) => [i.path, i.code])).toEqual([
      ['items.0.value', 'unknown_ref'],
      ['items.2.ref', 'duplicate_ref'],
      ['items.3.targetId', 'unknown_ref'],
      ['items.5.targetId', 'duplicate_target'],
    ]);
  });

  it('checks each item as a proposal: operation, target, value', () => {
    expect(
      proposalProblems({ kind: 'core.form', op: 'delete', targetId: 'f' }, ['create', 'update', 'archive']),
    ).toEqual([
      {
        summary: 'core.form does not support "delete"',
        issue: { path: 'op', message: 'use one of: create, update, archive', code: 'operation' },
      },
    ]);
    expect(
      packageIssues(
        {
          items: [
            { kind: 'core.form', op: 'update', value: { key: 'x' } },
            { kind: 'core.form', op: 'create', value: [] },
            { kind: 'core.form', op: 'archive', targetId: 'f1' },
            { kind: 'unknown.kind', op: 'create' },
          ],
        },
        ops,
      ).map((i) => [i.path, i.code]),
    ).toEqual([
      ['items.0.targetId', 'required'],
      ['items.1.value', 'required'],
    ]);
  });
});

describe('exporting a change set', () => {
  it('writes the items in order with their names, the text in every locale, and only what each op needs', () => {
    const pkg = packageOf({ title: 'Laptop requests', summary: '', reference: 'CS-00012' }, [
      {
        position: 1,
        ref: 'form',
        kind: 'core.form',
        op: 'create',
        targetId: null,
        label: 'Laptop request',
        value: { workflowId: '$ref:approval' },
        note: null,
      },
      {
        position: 0,
        ref: 'approval',
        kind: 'core.workflow',
        op: 'create',
        targetId: null,
        label: 'Laptop approval',
        value: { name: 'Laptop approval' },
        note: 'Department head first',
      },
      {
        position: 2,
        ref: null,
        kind: 'core.form',
        op: 'archive',
        targetId: 'f-old',
        label: 'Old laptop form',
        value: null,
        note: null,
      },
    ]);
    expect(pkg).toEqual({
      format: 'isbp.change-set-package',
      version: 1,
      title: { en: 'Laptop requests', 'zh-TW': 'Laptop requests', 'ja-JP': 'Laptop requests' },
      items: [
        {
          ref: 'approval',
          kind: 'core.workflow',
          op: 'create',
          label: 'Laptop approval',
          value: { name: 'Laptop approval' },
          note: 'Department head first',
        },
        {
          ref: 'form',
          kind: 'core.form',
          op: 'create',
          label: 'Laptop request',
          value: { workflowId: '$ref:approval' },
        },
        { kind: 'core.form', op: 'archive', targetId: 'f-old', label: 'Old laptop form' },
      ],
    });
    expect(changeSetPackageSchema.safeParse(pkg).success).toBe(true);
    expect(packageIssues(pkg, ops)).toEqual([]);
    // An untitled change set is named after its reference.
    expect(packageOf({ title: ' ', summary: '', reference: 'CS-00013' }, []).title.en).toBe('CS-00013');
  });
});
