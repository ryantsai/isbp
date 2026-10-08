import { groups } from '@isbp/db/schema';
import {
  type AuthContext,
  type CustomizationTemplate,
  ErrorCodes,
  type FieldDef,
  type FormAction,
  type FormSchema,
  formFields,
  HttpError,
  type ModuleContext,
  type WorkflowStep,
} from '@isbp/sdk/server';
import { asc } from 'drizzle-orm';
import { getKernel } from '../kernel-ref';
import { FORM_SUBMISSION_TRIGGER } from '../services/forms';
import type { FormValue } from './form';
import { QUESTION_TEXTS, questionElements, questionFields, unusedFormKey } from './form-questions';
import { groupFactsOf, pickableRecordTypes } from './record-reference';
import { catalogLocalized, fieldKeyOf, localeOf, templateTexts, typedText } from './shared';

/*
 * Guided template "Approval process" (builtin mode, no chat model): a request form with its questions — records
 * people pick among them — and its own approval workflow, proposed together in one change set (the form refers to
 * the workflow with "$ref:<ref>"), optionally raising a change once a request is approved.
 */

const CREATE_CHANGE = 'itsm.create-change';
const CI_TYPE = 'cmdb.ci';
const WORKFLOW_REF = 'approval';
const FORM_REF = 'form';

const TEXTS = [
  'name',
  'category',
  'recordType',
  'recordTypeHelp',
  'recordLabel',
  'recordMultiple',
  ...QUESTION_TEXTS,
  'managerApproves',
  'recordGroupApproves',
  'recordGroupFact',
  'groupApproves',
  'group',
  'createChange',
  'createChangeHelp',
  'stepManager',
  'stepRecordGroup',
  'stepGroup',
  'workflowSuffix',
  'actionName',
] as const;

const invalid = (path: string) =>
  new HttpError(422, ErrorCodes.VALIDATION_FAILED, 'Invalid answers', {
    issues: [{ path, message: 'required' }],
  });

/** Record types the person may offer, those with group facts numbered for their "which group" question. */
function recordChoices(auth: AuthContext) {
  return pickableRecordTypes(auth).map((t, i) => ({ ...t, index: i, groupFacts: groupFactsOf(t.def) }));
}

/** Whether the person may add a "raise a change" action (ITSM installed, its permission held). */
function canRaiseChange(auth: AuthContext) {
  return getKernel()
    .processActions.list(auth)
    .some((a) => a.type === CREATE_CHANGE && a.allowed);
}

/** The "raise a change" action for this form: the type's defaults, the CIs and the planned window from the form. */
async function raiseChange(
  schema: FormSchema,
  recordKey: string | null,
  recordType: string | null,
  auth: AuthContext,
  name: FormAction['name'],
): Promise<FormAction> {
  const fields = await getKernel().processActions.fields(CREATE_CHANGE, { form: schema, locale: 'en', auth });
  const config: Record<string, unknown> = Object.fromEntries(
    fields.filter((f) => f.defaultValue !== undefined).map((f) => [f.key, f.defaultValue]),
  );
  const has = new Set(fields.map((f) => f.key));
  if (recordKey && recordType === CI_TYPE && has.has('ciField')) config.ciField = recordKey;
  const dates = formFields(schema).filter((f) => f.type === 'date');
  const window = dates.length >= 2 && has.has('plannedStartField') && has.has('plannedEndField');
  if (window) {
    config.plannedStartField = dates[0]!.key;
    config.plannedEndField = dates[1]!.key;
  }
  // Submitting to the change's own authorization needs its planned window.
  config.submit = window;
  return { id: 'raise-change', on: 'approved', type: CREATE_CHANGE, name, config };
}

async function groupOptions(ctx: ModuleContext) {
  const rows = await ctx.db
    .select({ key: groups.key, name: groups.name })
    .from(groups)
    .orderBy(asc(groups.name))
    .limit(200);
  return rows.map((g) => ({ value: g.key, label: { en: g.name } }));
}

export const approvalProcessTemplate: CustomizationTemplate<FormValue> = {
  id: 'approval-process',
  label: 'core.customizations.approvalProcess.label',
  description: 'core.customizations.approvalProcess.description',

  async fields(ctx, auth) {
    const t = await templateTexts('approvalProcess', TEXTS);
    const records = recordChoices(auth);
    const typeNames = await Promise.all(records.map((r) => catalogLocalized(r.def.name)));
    const groupList = await groupOptions(ctx);
    const picked = { fact: 'recordType', op: 'notEmpty' as const };
    const fields: (FieldDef | false)[] = [
      { key: 'name', type: 'text', label: t('name'), required: true, validation: { maxLength: 200 } },
      { key: 'category', type: 'text', label: t('category'), validation: { maxLength: 64 } },
      records.length > 0 && {
        key: 'recordType',
        type: 'select',
        label: t('recordType'),
        help: t('recordTypeHelp'),
        options: records.map((r, i) => ({ value: r.type, label: typeNames[i]! })),
      },
      records.length > 0 && {
        key: 'recordLabel',
        type: 'text',
        label: t('recordLabel'),
        required: true,
        validation: { maxLength: 200 },
        visibleWhen: picked,
      },
      records.length > 0 && {
        key: 'recordMultiple',
        type: 'boolean',
        label: t('recordMultiple'),
        width: 'half',
        visibleWhen: picked,
      },
      // Without a record field, the first question is the form's only one: the build insists on one of the two.
      ...(await questionFields(t, { firstRequired: false })),
      { key: 'managerApproves', type: 'boolean', label: t('managerApproves'), defaultValue: true },
      records.some((r) => r.groupFacts.length) && {
        key: 'recordGroupApproves',
        type: 'boolean',
        label: t('recordGroupApproves'),
        visibleWhen: {
          fact: 'recordType',
          op: 'in',
          value: records.filter((r) => r.groupFacts.length).map((r) => r.type),
        },
      },
      // Which of the picked records' group facts names the approving group, per record type.
      ...(await Promise.all(
        records
          .filter((r) => r.groupFacts.length)
          .map(async (r): Promise<FieldDef> => ({
            key: `recordGroupFact${r.index}`,
            type: 'select',
            label: t('recordGroupFact'),
            required: true,
            defaultValue: r.groupFacts[0]!.path,
            options: await Promise.all(
              r.groupFacts.map(async (f) => ({
                value: f.path,
                label: f.label ? await catalogLocalized(f.label) : { en: f.path },
              })),
            ),
            visibleWhen: {
              all: [
                { fact: 'recordType', op: 'eq', value: r.type },
                { fact: 'recordGroupApproves', op: 'eq', value: true },
              ],
            },
          })),
      )),
      groupList.length > 0 && { key: 'groupApproves', type: 'boolean', label: t('groupApproves') },
      groupList.length > 0 && {
        key: 'group',
        type: 'select',
        label: t('group'),
        required: true,
        options: groupList,
        visibleWhen: { fact: 'groupApproves', op: 'eq', value: true },
      },
      canRaiseChange(auth) && {
        key: 'createChange',
        type: 'boolean',
        label: t('createChange'),
        help: t('createChangeHelp'),
      },
    ];
    return fields.filter((f): f is FieldDef => Boolean(f));
  },

  async build(answers, ctx, auth) {
    const t = await templateTexts('approvalProcess', TEXTS);
    const name = answers.name as string;
    const key = await unusedFormKey(ctx, name);
    const recordType = (answers.recordType as string | undefined) ?? null;
    const record = recordType ? recordChoices(auth).find((r) => r.type === recordType) : undefined;

    // The questions: the records people pick first, then the typed questions.
    const taken = new Set<string>();
    const elements: FormSchema['elements'] = [];
    let recordKey: string | null = null;
    if (record) {
      const label = answers.recordLabel as string;
      recordKey = fieldKeyOf(label) || 'records';
      taken.add(recordKey);
      elements.push({
        id: recordKey,
        key: recordKey,
        type: 'record',
        label: typedText(label, auth),
        required: true,
        record: { types: [record.type], ...(answers.recordMultiple === true ? { multiple: true } : {}) },
      });
    }
    elements.push(...questionElements(answers, auth, taken));
    if (!elements.length) throw invalid('q1Label');

    // Who approves, in order.
    const steps: WorkflowStep[] = [];
    if (answers.managerApproves === true)
      steps.push({
        id: 'manager',
        type: 'approval',
        name: t('stepManager'),
        approvers: [{ type: 'manager' }],
        mode: 'any',
        // A requester without a manager goes on to the next step.
        ifNoApprover: 'skip',
      });
    const groupFact = record ? (answers[`recordGroupFact${record.index}`] as string | undefined) : undefined;
    if (record && recordKey && answers.recordGroupApproves === true && groupFact)
      steps.push({
        id: 'record-group',
        type: 'approval',
        name: t('stepRecordGroup'),
        approvers: [{ type: 'fact', fact: `records.${recordKey}.${groupFact}`, kind: 'group' }],
        mode: 'any',
      });
    if (answers.groupApproves === true && typeof answers.group === 'string')
      steps.push({
        id: 'group',
        type: 'approval',
        name: t('stepGroup'),
        approvers: [{ type: 'group', groupKey: answers.group }],
        mode: 'any',
      });
    if (!steps.length) throw invalid('managerApproves');

    const schema: FormSchema = { elements };
    if (answers.createChange === true && canRaiseChange(auth))
      schema.actions = [await raiseChange(schema, recordKey, recordType, auth, t('actionName'))];

    const locale = localeOf(auth);
    const workflowName = `${name} – ${t('workflowSuffix')[locale] ?? t('workflowSuffix').en}`.slice(0, 200);
    return {
      op: 'create',
      label: name,
      ref: FORM_REF,
      value: {
        key,
        name: typedText(name, auth),
        description: null,
        icon: 'clipboard-check',
        category: (answers.category as string | undefined) ?? null,
        schema,
        // The workflow proposed just before it in the same change set.
        workflowId: `$ref:${WORKFLOW_REF}`,
        audience: { type: 'everyone' },
        active: true,
      },
      before: [
        {
          kind: 'core.workflow',
          op: 'create',
          ref: WORKFLOW_REF,
          label: workflowName,
          value: {
            name: workflowName,
            description: null,
            triggerKey: FORM_SUBMISSION_TRIGGER,
            graph: { steps },
            isDefault: false,
          },
        },
      ],
    };
  },
};
