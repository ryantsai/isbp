import type { FormSchema, LocalizedText, WorkflowGraph } from '@isbp/sdk/server';

/*
 * The "Configuration change request" process (Phase 8 demo, docs/architecture.md §15.7), built only from what any
 * administrator or the assistant can configure: a form with a record field (CIs), rules and a process action, and a
 * workflow that routes on the picked CIs' facts. The demo seed applies exactly these values through the
 * customisation kinds, and the kinds' guides show them to models as worked examples, so both stay valid.
 */

const t3 = (en: string, zh: string, ja: string): LocalizedText => ({ en, 'zh-TW': zh, 'ja-JP': ja });

export const CONFIG_CHANGE_FORM_KEY = 'config-change';
export const CONFIG_CHANGE_WORKFLOW_NAME = 'Configuration change approval';
/** The group that approves changes to critical CIs or high-risk changes (the demo's CAB). */
export const CAB_GROUP_KEY = 'cab';
/** Approves when a picked CI has no support group. */
export const FALLBACK_GROUP_KEY = 'it-admins';
/**
 * Who sees the form: the IS groups whose members can read the CMDB (the demo grants them the CMDB viewer and manager
 * roles). Picking CIs needs that permission, so a form for everyone would ask most people for something they can't
 * give.
 */
export const CONFIG_CHANGE_AUDIENCE_GROUPS = [
  'it-admins',
  'service-desk',
  'network-team',
  'security-team',
  'dba-team',
] as const;

export const configChangeSchema: FormSchema = {
  elements: [
    {
      id: 'intro',
      type: 'paragraph',
      text: t3(
        'Plan a change to one or more configuration items. Who approves it follows the CIs you pick: your manager, the CIs’ support groups and, for critical CIs or high-risk changes, the Change Advisory Board.',
        '規劃對一或多個組態項目的變更。簽核人員依您選取的組態項目而定：您的主管、組態項目的支援群組，以及關鍵組態項目或高風險變更時的變更諮詢委員會 (CAB)。',
        '1 つ以上の構成アイテムへの変更を計画します。承認者は選択した構成アイテムによって決まります。上長、構成アイテムのサポート グループ、重要な構成アイテムや高リスクの変更では変更諮問委員会 (CAB) が承認します。',
      ),
    },
    {
      id: 'cis',
      key: 'cis',
      type: 'record',
      label: t3('Configuration items', '組態項目', '構成アイテム'),
      help: t3(
        'The CIs this change touches (not retired ones).',
        '此變更涉及的組態項目（不含已除役者）。',
        'この変更が影響する構成アイテム (廃止済みを除く) です。',
      ),
      required: true,
      record: { types: ['cmdb.ci'], multiple: true, where: { fact: 'status', op: 'neq', value: 'retired' } },
    },
    {
      id: 'title',
      key: 'title',
      type: 'text',
      label: t3('Summary', '摘要', '概要'),
      placeholder: t3(
        'e.g. Patch erp-db-01 to PostgreSQL 16.6',
        '例如：將 erp-db-01 修補至 PostgreSQL 16.6',
        '例: erp-db-01 を PostgreSQL 16.6 にパッチ適用',
      ),
      required: true,
      validation: { maxLength: 200 },
    },
    {
      id: 'changeType',
      key: 'changeType',
      type: 'select',
      label: t3('Change type', '變更類型', '変更の種類'),
      required: true,
      defaultValue: 'normal',
      width: 'half',
      options: [
        { value: 'normal', label: t3('Normal', '一般', '通常') },
        { value: 'emergency', label: t3('Emergency', '緊急', '緊急') },
      ],
    },
    {
      id: 'risk',
      key: 'risk',
      type: 'select',
      label: t3('Risk', '風險', 'リスク'),
      required: true,
      defaultValue: 'medium',
      width: 'half',
      options: [
        { value: 'low', label: t3('Low', '低', '低') },
        { value: 'medium', label: t3('Medium', '中', '中') },
        { value: 'high', label: t3('High', '高', '高') },
      ],
    },
    {
      id: 'plannedStart',
      key: 'plannedStart',
      type: 'date',
      label: t3('Planned start', '預計開始', '開始予定'),
      required: true,
      width: 'half',
    },
    {
      id: 'plannedEnd',
      key: 'plannedEnd',
      type: 'date',
      label: t3('Planned end', '預計結束', '終了予定'),
      required: true,
      width: 'half',
    },
    {
      id: 'description',
      key: 'description',
      type: 'textarea',
      label: t3('What will change', '變更內容', '変更内容'),
    },
    {
      id: 'backoutPlan',
      key: 'backoutPlan',
      type: 'textarea',
      label: t3('Rollback plan', '回復計畫', '切り戻し計画'),
      help: t3(
        'How you undo the change if it fails. Required when the risk is high.',
        '變更失敗時如何復原。高風險時必填。',
        '変更が失敗した場合の戻し方です。リスクが高い場合は必須です。',
      ),
    },
  ],
  rules: [
    {
      id: 'end-after-start',
      require: { fact: 'plannedEnd', op: 'gte', valueFact: 'plannedStart' },
      message: t3(
        'The end date can’t be before the start date',
        '結束日期不能早於開始日期',
        '終了日を開始日より前にすることはできません',
      ),
      fields: ['plannedEnd'],
    },
    {
      id: 'rollback-plan',
      when: { fact: 'risk', op: 'eq', value: 'high' },
      require: { fact: 'backoutPlan', op: 'notEmpty' },
      message: t3(
        'A high-risk change needs a rollback plan',
        '高風險變更須提供回復計畫',
        '高リスクの変更には切り戻し計画が必要です',
      ),
      fields: ['backoutPlan'],
    },
  ],
  actions: [
    {
      id: 'raise-change',
      on: 'approved',
      type: 'itsm.create-change',
      name: t3('Raise the change', '建立變更', '変更を作成'),
      config: {
        title: '{{request.reference}} {{data.title}}',
        description: '{{data.description}}',
        changeType: 'normal',
        changeTypeField: 'changeType',
        risk: 'medium',
        riskField: 'risk',
        ciField: 'cis',
        plannedStartField: 'plannedStart',
        plannedEndField: 'plannedEnd',
        backoutPlan: '{{data.backoutPlan}}',
        submit: true,
      },
    },
  ],
};

/** The form's value as the `core.form` kind takes it (for the IS groups, unless `groupKeys` says otherwise). */
export function configChangeForm(
  workflowId: string | null,
  groupKeys: readonly string[] = CONFIG_CHANGE_AUDIENCE_GROUPS,
) {
  return {
    key: CONFIG_CHANGE_FORM_KEY,
    name: t3('Configuration change request', '組態變更申請', '構成変更の申請'),
    description: t3(
      'Change servers, databases, network devices or services: approved by the CIs’ support groups.',
      '變更伺服器、資料庫、網路設備或服務：由組態項目的支援群組簽核。',
      'サーバー、データベース、ネットワーク機器、サービスの変更。構成アイテムのサポート グループが承認します。',
    ),
    icon: 'server-cog',
    category: 'changes',
    schema: configChangeSchema,
    workflowId,
    audience: { type: 'groups' as const, groupKeys: [...groupKeys] },
    active: true,
  };
}

/**
 * The requester's manager (skipped when there is none) → the support groups of the picked CIs (a group from the CI
 * record facts, IS administrators when a CI has none) → the Change Advisory Board when a picked CI is critical or
 * the risk is high.
 */
export const configChangeGraph: WorkflowGraph = {
  steps: [
    {
      id: 'manager',
      type: 'approval',
      name: t3('Manager approval', '主管簽核', '上長の承認'),
      approvers: [{ type: 'manager' }],
      mode: 'any',
      ifNoApprover: 'skip',
      sla: { dueHours: 24, remindHours: 8, onBreach: 'notify' },
    },
    {
      id: 'ci-owners',
      type: 'approval',
      name: t3('CI support group', '組態項目支援群組', '構成アイテムのサポート グループ'),
      approvers: [
        {
          type: 'fact',
          fact: 'records.cis.ownerGroup',
          kind: 'group',
          fallback: { type: 'group', groupKey: FALLBACK_GROUP_KEY },
        },
      ],
      mode: 'any',
      instructions: t3(
        'Check the plan, the window and the rollback plan for the CIs your group supports.',
        '請檢查您群組支援之組態項目的計畫、時段與回復計畫。',
        'あなたのグループがサポートする構成アイテムについて、計画、作業時間帯、切り戻し計画を確認してください。',
      ),
      sla: { dueHours: 48, remindHours: 24, onBreach: 'notify' },
    },
    {
      id: 'cab-check',
      type: 'condition',
      name: t3('Critical CI or high risk?', '關鍵組態項目或高風險？', '重要な構成アイテムまたは高リスク?'),
      branches: [
        {
          id: 'critical',
          name: t3('Critical CI or high risk', '關鍵組態項目或高風險', '重要な構成アイテムまたは高リスク'),
          when: {
            any: [
              { fact: 'records.cis.criticality', op: 'eq', value: 'critical' },
              { fact: 'data.risk', op: 'eq', value: 'high' },
            ],
          },
          steps: [
            {
              id: 'cab',
              type: 'approval',
              name: t3('Change Advisory Board', '變更諮詢委員會 (CAB)', '変更諮問委員会 (CAB)'),
              approvers: [{ type: 'group', groupKey: CAB_GROUP_KEY }],
              mode: 'any',
              sla: { dueHours: 72, remindHours: 48, onBreach: 'notify' },
            },
          ],
        },
      ],
      otherwise: {
        id: 'no-cab',
        name: t3('No CAB needed', '無須 CAB', 'CAB 不要'),
        steps: [],
      },
    },
  ],
};

/** The workflow's value as the `core.workflow` kind takes it. */
export const configChangeWorkflow = {
  name: CONFIG_CHANGE_WORKFLOW_NAME,
  description:
    'The requester’s manager, then the support groups of the picked CIs; the Change Advisory Board too when a CI is critical or the risk is high',
  triggerKey: 'core.form-submission',
  graph: configChangeGraph,
  isDefault: false,
};
