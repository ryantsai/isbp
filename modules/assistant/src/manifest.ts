import { defineManifest, type WorkflowGraph } from '@isbp/sdk';
import { z } from 'zod';
import { toolInputs } from './tool-inputs';

const changeSetRef = z.object({
  changeSetId: z.uuid(),
  reference: z.string(),
  title: z.string(),
  kinds: z.array(z.string()),
});

/** Facts a review workflow can branch on (e.g. role changes to identity administrators). */
const reviewFacts = z.object({
  kinds: z.array(z.string()).describe('Customisation kinds in the change set, e.g. core.workflow'),
  modules: z.array(z.string()).describe('Modules that own them'),
  itemCount: z.number().describe('Number of changes'),
  destructive: z.boolean().describe('Archives or deletes something'),
  title: z.string().describe('Title of the change set'),
});

/** Without a bound workflow: one approval by a platform administrator. */
const reviewGraph: WorkflowGraph = {
  steps: [
    {
      id: 'platform-admin',
      type: 'approval',
      name: {
        en: 'Platform administrator review',
        'zh-TW': '平台管理員審核',
        'ja-JP': 'プラットフォーム管理者のレビュー',
      },
      approvers: [{ type: 'role', roleKey: 'platform-admin' }],
      mode: 'any',
      sla: { dueHours: 72, remindHours: 24, onBreach: 'notify' },
      instructions: {
        en: 'Open the change set, review each change and whether it can be applied, then approve to apply it with your permissions.',
        'zh-TW': '請開啟變更集，檢閱每項變更及其預先檢查結果，核准後將以您的權限套用。',
        'ja-JP':
          '変更セットを開き、各変更とその事前チェックの結果を確認してください。承認すると、あなたの権限で適用されます。',
      },
    },
  ],
};

/**
 * The AI agent that customises the platform: conversations, change sets (drafts a person applies, reviews or rolls
 * back), guided templates for builtin mode. Configuration surfaces come from every module's customisation kinds
 * (`ctx.customizations`). Design: docs/architecture.md §13.
 */
export const manifest = defineManifest({
  id: 'assistant',
  version: '0.1.0',
  name: 'assistant.meta.name',
  description: 'assistant.meta.description',
  icon: 'sparkles',
  navigation: [
    {
      id: 'change-sets',
      label: 'assistant.nav.changeSets',
      description: 'assistant.nav.changeSetsAbout',
      href: '/assistant/change-sets',
      icon: 'git-pull-request-arrow',
      permission: 'assistant.agent.use',
      section: 'admin',
      area: 'automation',
      order: 24,
    },
    {
      // Ready-made processes (built-in change-set packages), installed as a draft change set.
      id: 'packages',
      label: 'assistant.nav.packages',
      description: 'assistant.nav.packagesAbout',
      href: '/assistant/packs',
      icon: 'package-open',
      permission: 'assistant.agent.use',
      section: 'admin',
      area: 'automation',
      order: 25,
    },
  ],
  permissions: [
    { key: 'assistant.agent.use', description: 'assistant.permissions.use' },
    { key: 'assistant.change-sets.read', description: 'assistant.permissions.changeSetsRead' },
    { key: 'assistant.change-sets.manage', description: 'assistant.permissions.changeSetsManage' },
  ],
  roles: [
    {
      key: 'assistant-user',
      name: 'Assistant user',
      description: 'Use the assistant and prepare change sets for the surfaces you can see',
      permissions: ['assistant.agent.use'],
    },
    {
      key: 'assistant-admin',
      name: 'Assistant administrator',
      description: 'See every change set, and edit, discard or withdraw anyone’s',
      permissions: ['assistant.*'],
    },
  ],
  events: {
    emits: [
      { name: 'assistant.change-set.created', schema: changeSetRef },
      {
        name: 'assistant.change-set.submitted',
        description: 'A review was requested',
        schema: changeSetRef,
      },
      {
        name: 'assistant.change-set.applied',
        description: 'Every change was applied in one transaction',
        schema: changeSetRef,
      },
      {
        name: 'assistant.change-set.returned',
        description: 'The review was rejected, or applying it after approval failed: back to draft',
        schema: changeSetRef,
      },
      { name: 'assistant.change-set.rolled_back', schema: changeSetRef },
      { name: 'assistant.change-set.discarded', schema: changeSetRef },
    ],
  },
  settings: [
    {
      key: 'maxToolRounds',
      label: 'assistant.settings.maxToolRounds',
      description: 'assistant.settings.maxToolRoundsHelp',
      type: 'number',
      default: 12,
      advanced: true,
    },
  ],
  workflows: [
    {
      key: 'assistant.change-set',
      name: 'assistant.workflows.changeSet.name',
      description: 'assistant.workflows.changeSet.description',
      subject: 'change-set',
      facts: reviewFacts,
      required: true,
      defaultGraph: reviewGraph,
    },
  ],
  notifications: [
    { type: 'assistant.change-set.applied', defaultChannels: ['inApp', 'email'] },
    { type: 'assistant.change-set.returned', defaultChannels: ['inApp', 'email'] },
    { type: 'assistant.change-set.rolled-back', defaultChannels: ['inApp', 'email'] },
  ],
  ai: {
    tools: [
      {
        name: 'assistant.list_kinds',
        description:
          'List the configurable surfaces (customisation kinds) you can propose changes to, and whether you may apply them.',
        input: toolInputs.listKinds,
        permission: 'assistant.agent.use',
        readOnly: true,
      },
      {
        name: 'assistant.describe_kind',
        description:
          'The JSON schema of a kind’s value, how to build a good one, live reference data (ids, keys, facts) and examples. Call it before proposing that kind.',
        input: toolInputs.describeKind,
        permission: 'assistant.agent.use',
        readOnly: true,
      },
      {
        name: 'assistant.list_objects',
        description: 'List existing objects of a kind (id, name), e.g. the approval workflows.',
        input: toolInputs.listObjects,
        permission: 'assistant.agent.use',
        readOnly: true,
      },
      {
        name: 'assistant.get_object',
        description: 'Read one object of a kind with its full value and version, before proposing an update.',
        input: toolInputs.getObject,
        permission: 'assistant.agent.use',
        readOnly: true,
      },
      {
        name: 'assistant.propose_change',
        description:
          'Add a proposed change (create, update, archive, delete) to a change set — a draft a person reviews and applies; nothing goes live. Returns the dry run of the whole set.',
        input: toolInputs.proposeChange,
        permission: 'assistant.agent.use',
      },
      {
        name: 'assistant.remove_change',
        description: 'Remove a proposed change from a change set by its ref or id.',
        input: toolInputs.removeChange,
        permission: 'assistant.agent.use',
      },
      {
        name: 'assistant.get_change_set',
        description: 'A change set’s status, link and the latest dry run of every item.',
        input: toolInputs.getChangeSet,
        permission: 'assistant.agent.use',
        readOnly: true,
      },
      {
        name: 'assistant.apply_change_set',
        description:
          'Apply every change of a change set now, in one transaction, with the person’s own permissions. The person confirms it first; it can be rolled back.',
        input: toolInputs.applyChangeSet,
        permission: 'assistant.agent.use',
        destructive: true,
      },
      {
        name: 'assistant.rollback_change_set',
        description: 'Undo an applied change set in one transaction. The person confirms it first.',
        input: toolInputs.rollbackChangeSet,
        permission: 'assistant.agent.use',
        destructive: true,
      },
      {
        name: 'assistant.request_review',
        description:
          'Send a change set for review when the person may not (or would rather not) apply it: approving it applies it with the approver’s permissions.',
        input: toolInputs.requestReview,
        permission: 'assistant.agent.use',
      },
      {
        name: 'assistant.update_change_set',
        description: 'Set a change set’s title and its summary for the reviewer.',
        input: toolInputs.updateChangeSet,
        permission: 'assistant.agent.use',
      },
    ],
  },
  search: { entities: ['change-set'] },
});
