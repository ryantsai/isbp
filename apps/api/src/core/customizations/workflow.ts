import { createWorkflowSchema } from '@isbp/contracts';
import { loadCoreMessages } from '@isbp/i18n/messages';
import { applications, forms, groups, roles, workflowDefinitions, workflowVersions } from '@isbp/db/schema';
import {
  type ApproverRule,
  type AuthContext,
  conditionFacts,
  type CustomizationHandler,
  type CustomizationIssue,
  type Db,
  ErrorCodes,
  FACT_PATH_RE,
  type FieldDef,
  formFields,
  HttpError,
  localize,
  type ModuleContext,
  RESERVED_FACTS,
  STEP_FACTS_ROOT,
  walkSteps,
  type WorkflowGraph,
  workflowGraphSchema,
  type WorkflowIssue,
  type WorkflowStep,
} from '@isbp/sdk/server';
import { and, asc, eq, ilike, isNotNull, isNull, ne, or } from 'drizzle-orm';
import { z } from 'zod';
import { canonicalJson } from '../../kernel/crypto';
import { PLATFORM_APP_KEY } from '../../kernel/rbac';
import { getKernel } from '../kernel-ref';
import { likePattern } from '../util';
import { stepFieldsOf, WorkflowAdminService } from '../services/workflows';
import { configChangeWorkflow } from './examples';
import { enabledRecordTypes, recordTypeReference } from './record-reference';
import { catalogLocalized, catalogText, isUuid, templateTexts } from './shared';

const schema = z.object({
  name: createWorkflowSchema.shape.name.describe('Name administrators see, e.g. "Laptop request approval"'),
  description: createWorkflowSchema.shape.description.describe('What the workflow is for (optional)'),
  triggerKey: createWorkflowSchema.shape.triggerKey.describe(
    'The trigger it decides, from reference.triggers (e.g. core.form-submission). Fixed after creation.',
  ),
  graph: workflowGraphSchema.describe('The steps, run in order (see the guide for step and approver types)'),
  isDefault: z
    .boolean()
    .describe('Make it the trigger’s default: it decides every request that does not name a workflow'),
});
export type WorkflowValue = z.output<typeof schema>;

type DefinitionRow = typeof workflowDefinitions.$inferSelect;

/** Cap on the groups and roles listed in the guide and the template's choices. */
const REFERENCE_LIMIT = 200;

async function findDefinition(db: Db, id: string): Promise<DefinitionRow | null> {
  if (!isUuid(id)) return null;
  const [d] = await db.select().from(workflowDefinitions).where(eq(workflowDefinitions.id, id));
  return d ?? null;
}

/** The live graph: the published version, or the draft of a workflow that was never published. */
async function liveGraph(db: Db, d: DefinitionRow): Promise<{ graph: WorkflowGraph; published: boolean }> {
  if (d.publishedVersion === null) return { graph: d.draft, published: false };
  const [v] = await db
    .select({ graph: workflowVersions.graph })
    .from(workflowVersions)
    .where(and(eq(workflowVersions.definitionId, d.id), eq(workflowVersions.version, d.publishedVersion)));
  return v ? { graph: v.graph, published: true } : { graph: d.draft, published: false };
}

/** Dot paths of every step and branch (`graph.steps.1.branches.0.steps.2`), for issue paths. */
function stepPaths(steps: readonly WorkflowStep[], prefix: string, out = new Map<string, string>()) {
  steps.forEach((step, i) => {
    const path = `${prefix}.${i}`;
    if (!out.has(step.id)) out.set(step.id, path);
    if (step.type === 'parallel' || step.type === 'condition')
      step.branches.forEach((b, j) => {
        if (!out.has(b.id)) out.set(b.id, `${path}.branches.${j}`);
        stepPaths(b.steps, `${path}.branches.${j}.steps`, out);
      });
    if (step.type === 'condition') {
      if (!out.has(step.otherwise.id)) out.set(step.otherwise.id, `${path}.otherwise`);
      stepPaths(step.otherwise.steps, `${path}.otherwise.steps`, out);
    }
  });
  return out;
}

const GRAPH_ISSUES: Record<string, { field?: string; message: string }> = {
  empty: { message: 'Add at least one step' },
  noApprovers: { field: 'approvers', message: 'An approval step needs at least one approver rule' },
  quorumInvalid: { field: 'quorum', message: 'quorum must be between 1 and the number of approver rules' },
  requesterApprover: {
    field: 'approvers',
    message: 'The requester cannot approve their own request ("requester" is for notify steps only)',
  },
  escalationTargets: { field: 'sla.escalateTo', message: 'sla.onBreach "escalate" needs sla.escalateTo' },
  remindAfterDue: { field: 'sla.remindHours', message: 'sla.remindHours must be below sla.dueHours' },
  noBranches: {
    field: 'branches',
    message: 'A parallel step needs at least two branches, a condition step at least one',
  },
  noRecipients: { field: 'recipients', message: 'A notify step needs at least one recipient' },
  stepFact: {
    message:
      'Reads steps.<stepId>.<key> of a step that does not come before it, or a key that step has no field for (a step sees the fields of the approval steps before it)',
  },
  stepFields: {
    field: 'fields',
    message:
      'A step field shows depending on an unknown field or on its own answer (visibleWhen reads the other fields of the step by key), or its defaultValue is not a valid answer',
  },
  unknownRecordType: {
    field: 'fields',
    message:
      'A record step field offers a record type that does not exist: use a type from reference.recordTypes',
  },
  duplicateId: { message: 'Step and branch ids must be unique' },
  tooDeep: { message: 'Steps are nested too deeply (at most 5 levels)' },
  tooManySteps: { message: 'Too many steps (at most 100)' },
  unknownGroup: { message: 'Names a group that does not exist: use a key from reference.groups' },
  unknownRole: { message: 'Names a role that does not exist: use a key from reference.roles' },
  unknownUser: {
    message: 'Names a person who does not exist or is not active (look people up with core.find_users)',
  },
};

function graphIssue(paths: Map<string, string>, issue: WorkflowIssue): CustomizationIssue {
  const known = GRAPH_ISSUES[issue.code];
  const step = issue.stepId ? paths.get(issue.stepId) : undefined;
  const base = step ?? 'graph.steps';
  const path = known?.field && step ? `${base}.${known.field}` : base;
  const where = issue.stepId ? `Step "${issue.stepId}": ` : '';
  return {
    path,
    message: `${where}${known?.message ?? issue.code}`,
    code: issue.code.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`),
  };
}

/** Fact paths the graph reads: step and branch conditions and "approver from fact" rules. */
function factsRead(graph: WorkflowGraph): string[] {
  const out: string[] = [];
  const rule = (r: ApproverRule) => {
    if (r.type === 'fact') out.push(r.fact);
    if ('fallback' in r && r.fallback) rule(r.fallback);
  };
  for (const { step } of walkSteps(graph.steps)) {
    out.push(...conditionFacts(step.when));
    if (step.type === 'condition') step.branches.forEach((b) => out.push(...conditionFacts(b.when)));
    if (step.type === 'approval') [...step.approvers, ...(step.sla?.escalateTo ?? [])].forEach(rule);
    if (step.type === 'notify') step.recipients.forEach(rule);
  }
  return out;
}

/** `request.durationDays` → "Duration (days)" from the builder's catalog, otherwise humanised. */
async function factLabels() {
  const en = (await loadCoreMessages('en')).workflows as Record<string, unknown> | undefined;
  const labels = (en?.facts ?? {}) as Record<string, string>;
  return (path: string) => {
    const hit = labels[path.replaceAll('.', '_')];
    if (hit) return hit;
    const words = (path.split('.').pop() ?? path)
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/[_-]+/g, ' ');
    return words.charAt(0).toUpperCase() + words.slice(1).toLowerCase();
  };
}

/** A custom field as a workflow fact: `attributes.<key>`, and for record fields `records.<key>.<fact>`. */
function customFieldFacts(f: FieldDef) {
  return {
    path: `attributes.${f.key}`,
    type: f.type,
    label: localize(f.label, 'en') || f.key,
    ...(f.options ? { options: f.options.map((o) => o.value) } : {}),
    ...(f.type === 'record'
      ? {
          records: `records.${f.key}.<fact> with the facts of ${f.record?.types.join(', ')} (reference.recordTypes)`,
        }
      : {}),
  };
}

async function triggerReference(ctx: ModuleContext) {
  const label = await factLabels();
  const fields = getKernel().fields;
  return Promise.all(
    (await new WorkflowAdminService(ctx).triggers()).map(async (t) => ({
      key: t.key,
      module: t.moduleId,
      name: await catalogText(t.name),
      description: t.description ? await catalogText(t.description) : null,
      subject: t.subject,
      required: t.required,
      defaultWorkflow: t.defaultDefinition,
      facts: t.facts.map((f) => ({
        path: f.path,
        type: f.type,
        label: label(f.path),
        ...(f.options ? { options: f.options } : {}),
        ...(f.description ? { description: f.description } : {}),
      })),
      // The subject's custom fields come along as facts (`ctx.fields.facts`): the ones defined today.
      ...(t.customFieldEntity
        ? {
            customFieldEntity: t.customFieldEntity,
            customFieldFacts: (await fields.definitions(t.customFieldEntity)).map(customFieldFacts),
          }
        : {}),
    })),
  );
}

/**
 * Published request forms with their field keys, so a form-submission workflow can name data.<key> and
 * records.<key>.<fact> of the form it will be attached to.
 */
async function formReference(db: Db) {
  const rows = await db
    .select({ key: forms.key, name: forms.name, workflowId: forms.workflowDefinitionId, draft: forms.draft })
    .from(forms)
    .where(and(isNull(forms.archivedAt), isNotNull(forms.publishedVersion)))
    .orderBy(asc(forms.key))
    .limit(REFERENCE_LIMIT);
  return rows.map((f) => ({
    key: f.key,
    name: localize(f.name, 'en'),
    workflowId: f.workflowId,
    fields: formFields(f.draft)
      .slice(0, 50)
      .map((x) => ({
        key: x.key,
        type: x.type,
        ...(x.options ? { options: x.options.map((o) => o.value) } : {}),
        ...(x.record ? { recordTypes: x.record.types, multiple: Boolean(x.record.multiple) } : {}),
      })),
  }));
}

async function platformRoles(db: Db) {
  return db
    .select({ key: roles.key, name: roles.name })
    .from(roles)
    .innerJoin(applications, eq(applications.id, roles.applicationId))
    .where(eq(applications.key, PLATFORM_APP_KEY))
    .orderBy(asc(roles.name))
    .limit(REFERENCE_LIMIT);
}

async function groupList(db: Db) {
  return db
    .select({ key: groups.key, name: groups.name })
    .from(groups)
    .orderBy(asc(groups.name))
    .limit(REFERENCE_LIMIT);
}

const INSTRUCTIONS = `An approval workflow decides one trigger: something a module asks approval for, such as a form submission or an access request (reference.triggers). Value: name, description, triggerKey (fixed after creation), graph, isDefault.

graph.steps run in order. Step types:
- approval: approvers (a list of rules; each rule is one slot), mode "any" (first answer decides) | "all" (every slot approves) | "quorum" (with quorum ≤ number of rules); optional when (the step is skipped unless the condition holds), ifNoApprover "reject" (default) | "skip", sla { dueHours, remindHours (below dueHours), onBreach "notify" | "escalate" | "approve" | "reject", escalateTo (rules, required for "escalate") }, instructions, allowDelegation (default true), allowSelfApproval (default false).
- parallel: branches [{ id, name, steps }] (two or more) that run at the same time; every branch must approve.
- condition: branches [{ id, name, when, steps }] (the first whose condition holds runs) and otherwise { id, name, steps }.
- notify: recipients (rules) and an optional message; FYI only, no decision.
Approver rules: { "type": "manager", "level"?: 1-5 } (the requester's manager; 2 = the manager's manager), { "type": "department-head" }, { "type": "group", "groupKey" }, { "type": "role", "roleKey" }, { "type": "user", "userId" }, { "type": "fact", "fact": "<path to a user id or a list of them>" }, { "type": "fact", "fact": "<path to a group key or list>", "kind": "group" } (the members of that group or groups, e.g. records.cis.ownerGroup = the support groups of the CIs picked in a form's record field "cis"; reference.recordTypes marks the facts that hold group keys or user ids), { "type": "requester" } (notify steps only). Any rule may carry a "fallback" rule used when it resolves to nobody (a CI without a support group).
Conditions: { "fact", "op", "value" } with op eq | neq | gt | gte | lt | lte | in | nin (value is a list) | contains | empty | notEmpty (no value); combine with { "all": [...] }, { "any": [...] }, { "not": {...} }. Facts are the trigger's facts (reference.triggers[].facts, e.g. role.riskLevel, requester.departmentCode); for core.form-submission, a form's answers are data.<fieldKey> (data.amount) and the facts of the records picked in its record fields are records.<fieldKey>.<fact> (records.cis.criticality eq "critical": a list per fact for multiple fields, matched by eq/in on any element). reference.forms lists the published forms with their field keys (and record types), reference.recordTypes every record type's facts with their values. { "fact", "op", "valueFact" } compares with another fact instead of a value. Triggers with customFieldEntity also get the subject's custom fields: attributes.<key>, and records.<key>.<fact> for record custom fields (reference.triggers[].customFieldFacts).
Step fields (approval steps): fields [...] are what the approver fills in with the decision — the "filled in by IS" part of a paper form (evaluation result, handling notes, completion date, wipe time, review checklist). The same field model as a form's fields (core.form: { key, type, label, help?, required?, options?, validation?, defaultValue?, visibleWhen?, record? }; visibleWhen reads the step's other fields by key), at most 20, unique keys. fieldsRequiredOn: "approve" (default: required fields are needed to approve, optional when rejecting) | "both". Values are validated like form answers, stored with the decision, shown on the request, and become facts steps.<stepId>.<key> for the steps AFTER that step (conditions and approver rules, e.g. { "fact": "steps.it-review.result", "op": "eq", "value": "needs-cab" } or { "type": "fact", "fact": "steps.it-review.handler" } for a user field) — never for the step itself, earlier steps or parallel branches beside it; a step id used this way must start with a letter. Forms' process actions see them too: {{steps.<stepId>.<key>}} in text templates. With several approvers on a step, the latest decision's value counts.
graph.repeatApprovers (optional, default "ask"): what happens when someone already approved an earlier step of the same request. "ask" asks them again at every step. "skip" counts that earlier approval instead, so they are not asked again: the step records it as approved, and a step whose approvers all approved earlier completes without asking anyone. Rejections never count, and a delegate's approval counts for the person who decided it.
Every name, instructions and message is LocalizedText: give "en", "zh-TW" and "ja-JP". Step and branch ids are short unique slugs (letters, digits, - and _), e.g. "manager", "it-assets".
Use only group and role keys from reference.groups and reference.roles; find people with core.find_users.
isDefault: the default workflow decides every request of its trigger that does not name a workflow; a required trigger always keeps exactly one. Forms name their workflow themselves (core.form's workflowId), so form-submission workflows rarely need to be the default.
Applying publishes a new version when the graph changes; approvals already running keep the version they started with.`;

const laptopExample: WorkflowValue = {
  name: 'Laptop request approval',
  description: 'Department head; IS asset management too when the laptop costs more than 60 000 TWD',
  triggerKey: 'core.form-submission',
  isDefault: false,
  graph: {
    steps: [
      {
        id: 'department-head',
        type: 'approval',
        name: { en: 'Department head approval', 'zh-TW': '部門主管簽核', 'ja-JP': '部門長の承認' },
        approvers: [{ type: 'department-head' }],
        mode: 'any',
        sla: { dueHours: 48, remindHours: 24, onBreach: 'notify' },
      },
      {
        id: 'it-assets',
        type: 'approval',
        name: { en: 'IS asset management', 'zh-TW': 'IS 資產管理', 'ja-JP': 'IS 資産管理' },
        when: { fact: 'data.amount', op: 'gt', value: 60000 },
        approvers: [{ type: 'group', groupKey: 'it-asset-management' }],
        mode: 'any',
      },
    ],
  },
};

const riskExample: WorkflowValue = {
  name: 'Access requests by risk',
  description: 'Manager first; high-risk roles also need security and the role owner',
  triggerKey: 'core.access-request',
  isDefault: true,
  graph: {
    steps: [
      {
        id: 'manager',
        type: 'approval',
        name: { en: 'Manager approval', 'zh-TW': '主管簽核', 'ja-JP': '上長の承認' },
        approvers: [{ type: 'manager' }],
        mode: 'any',
        ifNoApprover: 'skip',
      },
      {
        id: 'by-risk',
        type: 'condition',
        name: { en: 'By risk', 'zh-TW': '依風險', 'ja-JP': 'リスク別' },
        branches: [
          {
            id: 'high',
            name: { en: 'High risk', 'zh-TW': '高風險', 'ja-JP': '高リスク' },
            when: { fact: 'role.riskLevel', op: 'eq', value: 'high' },
            steps: [
              {
                id: 'security-and-owner',
                type: 'approval',
                name: { en: 'Security and owner', 'zh-TW': '資安與擁有者', 'ja-JP': 'セキュリティと所有者' },
                approvers: [
                  { type: 'role', roleKey: 'platform-admin' },
                  {
                    type: 'fact',
                    fact: 'role.ownerId',
                    fallback: { type: 'role', roleKey: 'identity-admin' },
                  },
                ],
                mode: 'all',
              },
            ],
          },
        ],
        otherwise: {
          id: 'standard',
          name: { en: 'Standard', 'zh-TW': '一般', 'ja-JP': '標準' },
          steps: [
            {
              id: 'notify-owner',
              type: 'notify',
              name: { en: 'Tell the owner', 'zh-TW': '通知擁有者', 'ja-JP': '所有者に通知' },
              recipients: [{ type: 'fact', fact: 'role.ownerId' }],
            },
          ],
        },
      },
    ],
  },
};

/**
 * Record step fields may only newly offer record types the person may pick from (the admin API refuses others). A
 * permission matter, refused with 403 and the permission (decision 77), so a dry run marks the item for a reviewer.
 */
function assertStepRecordTypes(graph: WorkflowGraph, before: WorkflowGraph | null, auth: AuthContext) {
  const records = getKernel().records;
  const pickable = new Set(records.types(auth).map((t) => t.type));
  const had = before ? stepFieldsOf(before) : new Map<string, FieldDef[]>();
  for (const [stepId, fields] of stepFieldsOf(graph))
    for (const f of fields) {
      if (f.type !== 'record') continue;
      const kept = new Set(
        had.get(stepId)?.find((b) => b.key === f.key && b.type === 'record')?.record?.types ?? [],
      );
      for (const type of f.record?.types ?? []) {
        const entry = records.entry(type);
        if (!entry || kept.has(type) || pickable.has(type)) continue;
        throw new HttpError(
          403,
          ErrorCodes.FORBIDDEN,
          `Offering ${type} records needs ${entry.def.permission}`,
          {
            permission: entry.def.permission,
            path: `graph.steps.${stepId}.fields`,
          },
        );
      }
    }
}

const deviceReturnExample: WorkflowValue = {
  name: 'Device return',
  description: 'IS records how the device was handled; security checks it when data had to be kept',
  triggerKey: 'core.form-submission',
  isDefault: false,
  graph: {
    steps: [
      {
        id: 'it-handling',
        type: 'approval',
        name: { en: 'IS handling', 'zh-TW': 'IS 處理', 'ja-JP': 'IS による処理' },
        approvers: [{ type: 'group', groupKey: 'it-admins' }],
        mode: 'any',
        fields: [
          {
            key: 'wipedOn',
            type: 'date',
            label: { en: 'Data wiped on', 'zh-TW': '資料清除日期', 'ja-JP': 'データ消去日' },
            required: true,
          },
          {
            key: 'keepData',
            type: 'boolean',
            label: { en: 'Data had to be kept', 'zh-TW': '需保留資料', 'ja-JP': 'データの保持が必要' },
          },
          {
            key: 'notes',
            type: 'textarea',
            label: { en: 'Handling notes', 'zh-TW': '處理說明', 'ja-JP': '処理メモ' },
          },
        ],
      },
      {
        id: 'security',
        type: 'approval',
        name: { en: 'Security check', 'zh-TW': '資安檢查', 'ja-JP': 'セキュリティ確認' },
        when: { fact: 'steps.it-handling.keepData', op: 'eq', value: true },
        approvers: [{ type: 'group', groupKey: 'security-team' }],
        mode: 'any',
      },
    ],
  },
};

/** Default binding as the value asks; a required trigger keeps its only default (check() refuses that). */
async function bindDefault(svc: WorkflowAdminService, ctx: ModuleContext, id: string, wanted: boolean) {
  const d = (await findDefinition(ctx.db, id))!;
  if (wanted && !d.isDefault) await svc.makeDefaultRow(id);
  else if (!wanted && d.isDefault && !getKernel().workflows.trigger(d.triggerKey)?.def.required)
    await svc.clearDefaultRow(id);
}

const TEMPLATE_TEXTS = [
  'trigger',
  'name',
  'firstApprover',
  'approverManager',
  'approverDepartmentHead',
  'approverGroup',
  'approverRole',
  'firstGroup',
  'firstRole',
  'secondStep',
  'secondGroup',
  'onlyAbove',
  'conditionFact',
  'conditionFactHelp',
  'conditionAmount',
  'isDefault',
  'isDefaultHelp',
  'stepManager',
  'stepDepartmentHead',
  'stepGroup',
  'stepRole',
  'stepSecond',
] as const;

export const workflowKind: CustomizationHandler<WorkflowValue> = {
  schema,

  async guide(ctx) {
    const [triggers, groupRows, roleRows, recordTypes, formRows] = await Promise.all([
      triggerReference(ctx),
      groupList(ctx.db),
      platformRoles(ctx.db),
      recordTypeReference(enabledRecordTypes()),
      formReference(ctx.db),
    ]);
    return {
      instructions: INSTRUCTIONS,
      reference: { triggers, groups: groupRows, roles: roleRows, recordTypes, forms: formRows },
      examples: [
        {
          description:
            'Laptop requests (a form with a number field "amount"): the department head, then the IS asset group only above 60 000. Replace the group key with one from reference.groups.',
          value: laptopExample,
        },
        {
          description:
            'Access requests: the manager (skipped when there is none), then for high-risk roles a platform administrator and the role owner both approve; otherwise the owner is told.',
          value: riskExample,
        },
        {
          description:
            'Configuration change requests (a form whose multiple record field "cis" picks cmdb.ci records, and a select "risk"): the manager, then the support groups of the picked CIs (a group fact, IS administrators when a CI has none), then the Change Advisory Board when a picked CI is critical or the risk is high. Replace the group keys with ones from reference.groups.',
          value: configChangeWorkflow,
        },
        {
          description:
            'Step fields: IS fills in the wipe date (required to approve), whether data had to be kept and notes; a later step runs only when IS ticked "keep data" (steps.it-handling.keepData). Replace the group keys with ones from reference.groups.',
          value: deviceReturnExample,
        },
      ],
    };
  },

  async list({ q, limit, includeArchived }, ctx) {
    const rows = await ctx.db
      .select()
      .from(workflowDefinitions)
      .where(
        and(
          includeArchived ? undefined : isNull(workflowDefinitions.archivedAt),
          q
            ? or(
                ilike(workflowDefinitions.name, likePattern(q)),
                ilike(workflowDefinitions.key, likePattern(q)),
                ilike(workflowDefinitions.triggerKey, likePattern(q)),
              )
            : undefined,
        ),
      )
      .orderBy(asc(workflowDefinitions.triggerKey), asc(workflowDefinitions.name))
      .limit(limit);
    return rows.map((d) => ({
      id: d.id,
      label: d.name,
      description: `${d.triggerKey}${d.isDefault ? ' (default)' : ''}${d.description ? ` · ${d.description}` : ''}`,
      archived: Boolean(d.archivedAt),
      href: `/admin/workflows/${d.id}`,
    }));
  },

  async get(id, ctx) {
    const d = await findDefinition(ctx.db, id);
    if (!d) return null;
    const { graph } = await liveGraph(ctx.db, d);
    return {
      id: d.id,
      label: d.name,
      description: d.description,
      archived: Boolean(d.archivedAt),
      href: `/admin/workflows/${d.id}`,
      value: {
        name: d.name,
        description: d.description,
        triggerKey: d.triggerKey,
        graph,
        isDefault: d.isDefault,
      },
    };
  },

  async check(change, ctx) {
    if (change.op !== 'create' && change.op !== 'update') return [];
    const v = change.value!;
    const issues: CustomizationIssue[] = [];
    const trigger = getKernel().workflows.trigger(v.triggerKey);
    if (!trigger)
      issues.push({
        path: 'triggerKey',
        code: 'unknown_trigger',
        message: `Unknown trigger "${v.triggerKey}": use a key from reference.triggers`,
      });
    let publishes = true;
    if (change.op === 'update') {
      const d = (await findDefinition(ctx.db, change.id!))!;
      if (d.triggerKey !== v.triggerKey)
        issues.push({
          path: 'triggerKey',
          code: 'immutable',
          message: `The trigger of a workflow cannot change (it is "${d.triggerKey}"); create a new workflow instead`,
        });
      if (d.archivedAt)
        issues.push({ path: '', code: 'archived', message: 'Restore the workflow before editing it' });
      const live = await liveGraph(ctx.db, d);
      publishes = !live.published || canonicalJson(live.graph) !== canonicalJson(v.graph);
    }
    // The graph is checked when it will be published — the same rules as publishing in the builder.
    if (publishes) {
      const paths = stepPaths(v.graph.steps, 'graph.steps');
      for (const issue of await new WorkflowAdminService(ctx).issues(v.graph))
        issues.push(graphIssue(paths, issue));
      if (trigger?.def.facts) {
        const declared = new WorkflowAdminService(ctx).triggerFacts(v.triggerKey);
        const roots = new Set([
          ...(declared?.map((f) => f.path.split('.')[0]) ?? []),
          // Custom fields of the trigger's subject come along (`ctx.fields.facts`).
          ...(trigger.def.customFieldEntity ? ['attributes', 'records'] : []),
          // What approvers fill in (`fields`): checked against the graph by the `stepFact` issue above.
          STEP_FACTS_ROOT,
          // Reserved facts every condition may read (`today`).
          ...RESERVED_FACTS,
        ]);
        for (const fact of new Set(factsRead(v.graph)))
          if (!FACT_PATH_RE.test(fact) || !roots.has(fact.split('.')[0]!))
            issues.push({
              path: 'graph',
              code: 'unknown_fact',
              message: `"${fact}" is not a fact of ${v.triggerKey}: use reference.triggers[].facts (form answers are data.<fieldKey>)`,
            });
      }
    }
    if (trigger?.def.required && !v.isDefault) {
      const [other] = await ctx.db
        .select({ id: workflowDefinitions.id })
        .from(workflowDefinitions)
        .where(
          and(
            eq(workflowDefinitions.triggerKey, v.triggerKey),
            eq(workflowDefinitions.isDefault, true),
            isNull(workflowDefinitions.archivedAt),
            change.id ? ne(workflowDefinitions.id, change.id) : undefined,
          ),
        )
        .limit(1);
      if (!other)
        issues.push({
          path: 'isDefault',
          code: 'default_required',
          message: `${v.triggerKey} always needs a default workflow: keep this one as the default, or make another one the default first`,
        });
    }
    return issues;
  },

  async apply(change, ctx, auth) {
    const svc = new WorkflowAdminService(ctx);
    const v = change.value;
    switch (change.op) {
      case 'create': {
        assertStepRecordTypes(v!.graph, null, auth);
        // The `*Row` writes: the kind only needs the ids, not the views the admin API returns.
        const created = await svc.createRow(
          { name: v!.name, description: v!.description ?? null, triggerKey: v!.triggerKey },
          auth,
        );
        await svc.updateRow(
          created.id,
          { name: v!.name, description: v!.description ?? null, draft: v!.graph },
          auth,
        );
        await svc.publishRow(created.id, auth);
        await bindDefault(svc, ctx, created.id, v!.isDefault);
        return { id: created.id };
      }
      case 'update': {
        const id = change.id!;
        const d = (await findDefinition(ctx.db, id))!;
        const live = await liveGraph(ctx.db, d);
        // An unchanged graph keeps the draft as it is (someone may be editing it in the builder).
        const publish = !live.published || canonicalJson(live.graph) !== canonicalJson(v!.graph);
        if (publish) assertStepRecordTypes(v!.graph, d.draft, auth);
        await svc.updateRow(
          id,
          { name: v!.name, description: v!.description ?? null, draft: publish ? v!.graph : undefined },
          auth,
        );
        if (publish) await svc.publishRow(id, auth);
        await bindDefault(svc, ctx, id, v!.isDefault);
        return { id };
      }
      case 'archive':
        await svc.archive(change.id!);
        return { id: change.id! };
      case 'restore':
        await svc.restore(change.id!);
        return { id: change.id! };
      default:
        throw new Error(`core.workflow does not support ${change.op}`);
    }
  },

  templates: [
    {
      id: 'approval-chain',
      label: 'core.customizations.approvalChain.label',
      description: 'core.customizations.approvalChain.description',
      async fields(ctx) {
        const t = await templateTexts('approvalChain', TEMPLATE_TEXTS);
        const triggers = getKernel().workflows.triggers();
        const [triggerNames, groupRows, roleRows] = await Promise.all([
          Promise.all(triggers.map(({ def }) => catalogLocalized(def.name))),
          groupList(ctx.db),
          platformRoles(ctx.db),
        ]);
        const when = (fact: string, value: string | boolean) => ({ fact, op: 'eq' as const, value });
        const groupOptions = groupRows.map((g) => ({ value: g.key, label: { en: g.name } }));
        const condition = { all: [when('secondStep', true), when('onlyAbove', true)] };
        const fields: (FieldDef | false)[] = [
          {
            key: 'trigger',
            type: 'select',
            label: t('trigger'),
            required: true,
            options: triggers.map(({ def }, i) => ({ value: def.key, label: triggerNames[i]! })),
          },
          { key: 'name', type: 'text', label: t('name'), required: true, validation: { maxLength: 200 } },
          {
            key: 'firstApprover',
            type: 'select',
            label: t('firstApprover'),
            required: true,
            defaultValue: 'manager',
            options: [
              { value: 'manager', label: t('approverManager') },
              { value: 'department-head', label: t('approverDepartmentHead') },
              ...(groupRows.length ? [{ value: 'group', label: t('approverGroup') }] : []),
              ...(roleRows.length ? [{ value: 'role', label: t('approverRole') }] : []),
            ],
          },
          groupRows.length > 0 && {
            key: 'firstGroup',
            type: 'select',
            label: t('firstGroup'),
            required: true,
            options: groupOptions,
            visibleWhen: when('firstApprover', 'group'),
          },
          roleRows.length > 0 && {
            key: 'firstRole',
            type: 'select',
            label: t('firstRole'),
            required: true,
            options: roleRows.map((r) => ({ value: r.key, label: { en: r.name } })),
            visibleWhen: when('firstApprover', 'role'),
          },
          groupRows.length > 0 && { key: 'secondStep', type: 'boolean', label: t('secondStep') },
          groupRows.length > 0 && {
            key: 'secondGroup',
            type: 'select',
            label: t('secondGroup'),
            required: true,
            options: groupOptions,
            visibleWhen: when('secondStep', true),
          },
          groupRows.length > 0 && {
            key: 'onlyAbove',
            type: 'boolean',
            label: t('onlyAbove'),
            visibleWhen: when('secondStep', true),
          },
          groupRows.length > 0 && {
            key: 'conditionFact',
            type: 'text',
            label: t('conditionFact'),
            help: t('conditionFactHelp'),
            placeholder: { en: 'data.amount' },
            required: true,
            defaultValue: 'data.amount',
            // The workflow schema checks the full fact path; this only keeps typos out early.
            validation: { maxLength: 200, pattern: '[a-zA-Z_][\\w.-]{0,199}' },
            visibleWhen: condition,
          },
          groupRows.length > 0 && {
            key: 'conditionAmount',
            type: 'number',
            label: t('conditionAmount'),
            required: true,
            visibleWhen: condition,
          },
          { key: 'isDefault', type: 'boolean', label: t('isDefault'), help: t('isDefaultHelp') },
        ];
        return fields.filter((f): f is FieldDef => Boolean(f));
      },
      async build(answers) {
        const t = await templateTexts('approvalChain', TEMPLATE_TEXTS);
        const first = answers.firstApprover as 'manager' | 'department-head' | 'group' | 'role';
        const approver: ApproverRule =
          first === 'group'
            ? { type: 'group', groupKey: answers.firstGroup as string }
            : first === 'role'
              ? { type: 'role', roleKey: answers.firstRole as string }
              : { type: first };
        const steps: WorkflowStep[] = [
          {
            id: first,
            type: 'approval',
            name: t(
              {
                manager: 'stepManager',
                'department-head': 'stepDepartmentHead',
                group: 'stepGroup',
                role: 'stepRole',
              }[first],
            ),
            approvers: [approver],
            mode: 'any',
          },
        ];
        if (answers.secondStep === true)
          steps.push({
            id: 'second-approval',
            type: 'approval',
            name: t('stepSecond'),
            approvers: [{ type: 'group', groupKey: answers.secondGroup as string }],
            mode: 'any',
            ...(answers.onlyAbove === true
              ? {
                  when: {
                    fact: answers.conditionFact as string,
                    op: 'gt' as const,
                    value: answers.conditionAmount as number,
                  },
                }
              : {}),
          });
        const name = answers.name as string;
        return {
          op: 'create',
          label: name,
          value: {
            name,
            description: null,
            triggerKey: answers.trigger as string,
            graph: { steps },
            isDefault: answers.isDefault === true,
          },
        };
      },
    },
  ],
};
