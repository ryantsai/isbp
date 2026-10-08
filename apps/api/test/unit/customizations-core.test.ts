import type { AuthContext, ModuleContext } from '@isbp/sdk/server';
import { describe, expect, it } from 'vitest';
import {
  catalogLocalized,
  coreLocalized,
  fieldKeyOf,
  matchesQuery,
  optionsOf,
  slugOf,
} from '../../src/core/customizations/shared';
import { workflowKind } from '../../src/core/customizations/workflow';

const auth = (locale: 'en' | 'zh-TW' | 'ja-JP') => ({ user: { locale } }) as unknown as AuthContext;

describe('customisation helpers', () => {
  it('derives keys and slugs from what people type', () => {
    expect(slugOf('Laptop request (2026)')).toBe('laptop-request-2026');
    expect(slugOf('筆記型電腦')).toBe('');
    expect(fieldKeyOf('Cost centre')).toBe('costCentre');
    expect(fieldKeyOf('2nd approver')).toBe('');
    expect(fieldKeyOf('申請原因')).toBe('');
  });

  it('turns lines into unique options in the author’s locale', () => {
    expect(optionsOf('Small\n\n Large \n大型\nSmall', auth('zh-TW'))).toEqual([
      { value: 'small', label: { 'zh-TW': 'Small' } },
      { value: 'large', label: { 'zh-TW': 'Large' } },
      { value: 'option-3', label: { 'zh-TW': '大型' } },
      { value: 'small-4', label: { 'zh-TW': 'Small' } },
    ]);
  });

  it('matches list queries case-insensitively', () => {
    expect(matchesQuery(undefined, 'x')).toBe(true);
    expect(matchesQuery('desk', null, 'Service Desk')).toBe(true);
    expect(matchesQuery('nope', 'Service Desk')).toBe(false);
  });

  it('resolves catalog keys in every locale', async () => {
    expect(await catalogLocalized('core.customizations.approvalChain.stepManager')).toEqual({
      en: 'Manager approval',
      'zh-TW': '主管簽核',
      'ja-JP': '上長の承認',
    });
    expect((await coreLocalized('fields.types.select.name')).en).toBe('Dropdown');
  });
});

describe('approval-chain template', () => {
  const build = (answers: Record<string, unknown>) =>
    workflowKind.templates![0]!.build(answers, {} as ModuleContext, auth('en'));

  it('builds a group or role first step and a conditional second step', async () => {
    const built = await build({
      trigger: 'core.access-request',
      name: 'By role',
      firstApprover: 'role',
      firstRole: 'identity-admin',
      secondStep: true,
      secondGroup: 'security',
      onlyAbove: true,
      conditionFact: 'request.durationDays',
      conditionAmount: 30,
      isDefault: true,
    });
    expect(built).toMatchObject({ op: 'create', label: 'By role' });
    expect(built.value).toEqual({
      name: 'By role',
      description: null,
      triggerKey: 'core.access-request',
      isDefault: true,
      graph: {
        steps: [
          {
            id: 'role',
            type: 'approval',
            name: { en: 'Role approval', 'zh-TW': '角色簽核', 'ja-JP': 'ロールの承認' },
            approvers: [{ type: 'role', roleKey: 'identity-admin' }],
            mode: 'any',
          },
          {
            id: 'second-approval',
            type: 'approval',
            name: { en: 'Second approval', 'zh-TW': '第二次簽核', 'ja-JP': '2 つ目の承認' },
            approvers: [{ type: 'group', groupKey: 'security' }],
            mode: 'any',
            when: { fact: 'request.durationDays', op: 'gt', value: 30 },
          },
        ],
      },
    });
    expect(workflowKind.schema.safeParse(built.value).success).toBe(true);
  });

  it('builds a single manager step', async () => {
    const built = await build({ trigger: 'core.form-submission', name: 'Simple', firstApprover: 'manager' });
    expect(built.value.graph.steps).toHaveLength(1);
    expect(built.value.graph.steps[0]).toMatchObject({ id: 'manager', approvers: [{ type: 'manager' }] });
    expect(built.value.isDefault).toBe(false);
  });
});
