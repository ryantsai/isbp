import { forms, groups } from '@isbp/db/schema';
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
import { asc, isNotNull } from 'drizzle-orm';
import { getKernel } from '../kernel-ref';
import { FORM_SUBMISSION_TRIGGER } from '../services/forms';
import type { FormValue } from './form';
import { QUESTION_TEXTS, questionElements, questionFields, unusedFormKey } from './form-questions';
import { recordTypeFacts } from '../routes/records';
import { groupFactsOf, pickableRecordTypes } from './record-reference';
import { catalogLocalized, coreLocalized, fieldKeyOf, localeOf, templateTexts, typedText } from './shared';

/*
 * Guided template "Request process" (`approval-process`; builtin mode, no chat model): a request form with its
 * questions — records people pick among them — who may use it, and its own approval workflow, proposed together in
 * one change set (the form refers to the workflow with "$ref:<ref>"); optionally raising a change or a ticket, or
 * notifying a group, once a request is approved.
 */

const CREATE_CHANGE = 'itsm.create-change';
const CREATE_TICKET = 'itsm.create-ticket';
const NOTIFY = 'core.notify';
const CI_TYPE = 'cmdb.ci';
const WORKFLOW_REF = 'approval';
const FORM_REF = 'form';
/** The category choice that asks for a new one. */
const NEW_CATEGORY = '__new';
/** Portal groups with their own label in every language (`requests.categories.<key>`). */
const KNOWN_CATEGORIES = ['hardware', 'software', 'access', 'security', 'changes', 'other'] as const;
const AFTER = ['nothing', 'change', 'ticket', 'notify'] as const;
type After = (typeof AFTER)[number];

const TEXTS = [
  'name',
  'category',
  'categoryNew',
  'newCategory',
  'audience',
  'audienceHelp',
  'audienceEveryone',
  'audienceGroups',
  'audienceGroupKeys',
  'recordType',
  'recordTypeHelp',
  'recordLabel',
  'recordMultiple',
  ...QUESTION_TEXTS,
  'managerApproves',
  'recordPersonApproves',
  'recordPersonFact',
  'recordGroupApproves',
  'recordGroupFact',
  'groupApproves',
  'group',
  'afterApproval',
  'afterApprovalHelp',
  'afterNothing',
  'afterChange',
  'afterTicket',
  'afterNotify',
  'ticketCategory',
  'ticketGroup',
  'notifyGroups',
  'stepManager',
  'stepRecordPerson',
  'stepRecordGroup',
  'stepGroup',
  'workflowSuffix',
  'actionName',
  'actionTicketName',
  'actionNotifyName',
] as const;

const invalid = (path: string) =>
  new HttpError(422, ErrorCodes.VALIDATION_FAILED, 'Invalid answers', {
    issues: [{ path, message: 'required' }],
  });

/**
 * Record types the person may offer, numbered for their questions: the facts that name a group ("which group
 * approves") and a person ("which person approves", such as an application's business owner).
 */
function recordChoices(auth: AuthContext) {
  return pickableRecordTypes(auth).map((t, i) => ({
    ...t,
    index: i,
    groupFacts: groupFactsOf(t.def),
    userFacts: recordTypeFacts(t.def).filter((f) => f.ref === 'user'),
  }));
}

/** Whether the person may add an action of this type (its module enabled, its permission held). */
function canUse(auth: AuthContext, type: string) {
  return getKernel()
    .processActions.list(auth)
    .some((a) => a.type === type && a.allowed);
}

const canRaiseChange = (auth: AuthContext) => canUse(auth, CREATE_CHANGE);

/** The choices an action type offers for one of its settings (a ticket's category, the groups to notify). */
async function actionOptions(type: string, key: string, auth: AuthContext) {
  if (!canUse(auth, type)) return [];
  const fields = await getKernel().processActions.fields(type, { form: null, locale: 'en', auth });
  return fields.find((f) => f.key === key)?.options ?? [];
}

/** An action of `type` with the type's defaults, plus `config`. */
async function actionWithDefaults(
  type: string,
  id: string,
  name: FormAction['name'],
  schema: FormSchema,
  auth: AuthContext,
  config: Record<string, unknown>,
): Promise<FormAction> {
  const fields = await getKernel().processActions.fields(type, { form: schema, locale: 'en', auth });
  const defaults = Object.fromEntries(
    fields.filter((f) => f.defaultValue !== undefined).map((f) => [f.key, f.defaultValue]),
  );
  return { id, on: 'approved', type, name, config: { ...defaults, ...config } };
}

/**
 * Categories to choose from: the portal's own (with their label in every language), then the ones forms already
 * use (once, whatever their case), then "something else".
 */
async function categoryOptions(ctx: ModuleContext, newLabel: FieldDef['label']) {
  const rows = await ctx.db
    .selectDistinct({ category: forms.category })
    .from(forms)
    .where(isNotNull(forms.category))
    .limit(200);
  const seen = new Set<string>(KNOWN_CATEGORIES);
  const known = await Promise.all(
    KNOWN_CATEGORIES.map(async (key) => ({
      value: key,
      label: await coreLocalized(`requests.categories.${key}`),
    })),
  );
  const used = rows
    .map((r) => r.category!.trim())
    .filter((c) => {
      const lower = c.toLowerCase();
      if (!c || seen.has(lower)) return false;
      seen.add(lower);
      return true;
    })
    .sort((a, b) => a.localeCompare(b))
    .map((c) => ({ value: c, label: { en: c } }));
  return [...known, ...used, { value: NEW_CATEGORY, label: newLabel }];
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
    const [ticketCategories, ticketGroups, notifyGroups] = await Promise.all([
      actionOptions(CREATE_TICKET, 'categoryId', auth),
      actionOptions(CREATE_TICKET, 'groupId', auth),
      actionOptions(NOTIFY, 'groups', auth),
    ]);
    const after: After[] = [
      'nothing',
      ...(canRaiseChange(auth) ? (['change'] as const) : []),
      ...(canUse(auth, CREATE_TICKET) ? (['ticket'] as const) : []),
      ...(canUse(auth, NOTIFY) && notifyGroups.length ? (['notify'] as const) : []),
    ];
    const afterLabel: Record<After, string> = {
      nothing: 'afterNothing',
      change: 'afterChange',
      ticket: 'afterTicket',
      notify: 'afterNotify',
    };
    const picked = { fact: 'recordType', op: 'notEmpty' as const };
    const fields: (FieldDef | false)[] = [
      { key: 'name', type: 'text', label: t('name'), required: true, validation: { maxLength: 200 } },
      {
        key: 'category',
        type: 'select',
        label: t('category'),
        options: await categoryOptions(ctx, t('categoryNew')),
        width: 'half',
      },
      {
        key: 'newCategory',
        type: 'text',
        label: t('newCategory'),
        required: true,
        width: 'half',
        validation: { maxLength: 64 },
        visibleWhen: { fact: 'category', op: 'eq', value: NEW_CATEGORY },
      },
      {
        // Not required: left out (an older client, the API), the form is for everyone.
        key: 'audience',
        type: 'select',
        label: t('audience'),
        help: t('audienceHelp'),
        defaultValue: 'everyone',
        options: [
          { value: 'everyone', label: t('audienceEveryone') },
          ...(groupList.length ? [{ value: 'groups', label: t('audienceGroups') }] : []),
        ],
      },
      groupList.length > 0 && {
        key: 'audienceGroupKeys',
        type: 'multiselect',
        label: t('audienceGroupKeys'),
        required: true,
        options: groupList,
        visibleWhen: { fact: 'audience', op: 'eq', value: 'groups' },
      },
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
      // A person the picked record names approves (an application's business owner, a project's manager).
      records.some((r) => r.userFacts.length) && {
        key: 'recordPersonApproves',
        type: 'boolean',
        label: t('recordPersonApproves'),
        visibleWhen: {
          fact: 'recordType',
          op: 'in',
          value: records.filter((r) => r.userFacts.length).map((r) => r.type),
        },
      },
      ...(await Promise.all(
        records
          .filter((r) => r.userFacts.length)
          .map(async (r): Promise<FieldDef> => ({
            key: `recordPersonFact${r.index}`,
            type: 'select',
            label: t('recordPersonFact'),
            required: true,
            defaultValue: r.userFacts[0]!.path,
            options: await Promise.all(
              r.userFacts.map(async (f) => ({
                value: f.path,
                label: f.label ? await catalogLocalized(f.label) : { en: f.path },
              })),
            ),
            visibleWhen: {
              all: [
                { fact: 'recordType', op: 'eq', value: r.type },
                { fact: 'recordPersonApproves', op: 'eq', value: true },
              ],
            },
          })),
      )),
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
      after.length > 1 && {
        // Not required: left out, nothing else happens.
        key: 'afterApproval',
        type: 'select',
        label: t('afterApproval'),
        help: t('afterApprovalHelp'),
        defaultValue: 'nothing',
        options: after.map((a) => ({ value: a, label: t(afterLabel[a]) })),
      },
      ticketCategories.length > 0 && {
        key: 'ticketCategory',
        type: 'select',
        label: t('ticketCategory'),
        options: ticketCategories,
        width: 'half',
        visibleWhen: { fact: 'afterApproval', op: 'eq', value: 'ticket' },
      },
      ticketGroups.length > 0 && {
        key: 'ticketGroup',
        type: 'select',
        label: t('ticketGroup'),
        options: ticketGroups,
        width: 'half',
        visibleWhen: { fact: 'afterApproval', op: 'eq', value: 'ticket' },
      },
      notifyGroups.length > 0 && {
        key: 'notifyGroups',
        type: 'multiselect',
        label: t('notifyGroups'),
        required: true,
        options: notifyGroups,
        visibleWhen: { fact: 'afterApproval', op: 'eq', value: 'notify' },
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
    const managerApproves = answers.managerApproves === true;
    if (managerApproves)
      steps.push({
        id: 'manager',
        type: 'approval',
        name: t('stepManager'),
        approvers: [{ type: 'manager' }],
        mode: 'any',
        // A requester without a manager goes on to the next step.
        ifNoApprover: 'skip',
      });
    const personFact = record
      ? (answers[`recordPersonFact${record.index}`] as string | undefined)
      : undefined;
    if (
      record &&
      recordKey &&
      answers.recordPersonApproves === true &&
      personFact &&
      record.userFacts.some((f) => f.path === personFact)
    )
      steps.push({
        id: 'record-person',
        type: 'approval',
        name: t('stepRecordPerson'),
        // A record without that person never rejects every request: the requester's manager approves instead,
        // or, when the manager approved already, the step is skipped.
        approvers: [
          {
            type: 'fact',
            fact: `records.${recordKey}.${personFact}`,
            ...(managerApproves ? {} : { fallback: { type: 'manager' as const } }),
          },
        ],
        mode: 'any',
        ...(managerApproves ? { ifNoApprover: 'skip' as const } : {}),
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
    const afterApproval: After = AFTER.includes(answers.afterApproval as After)
      ? (answers.afterApproval as After)
      : 'nothing';
    if (afterApproval === 'change' && canRaiseChange(auth))
      schema.actions = [await raiseChange(schema, recordKey, recordType, auth, t('actionName'))];
    if (afterApproval === 'ticket' && canUse(auth, CREATE_TICKET))
      schema.actions = [
        await actionWithDefaults(CREATE_TICKET, 'raise-ticket', t('actionTicketName'), schema, auth, {
          ...(typeof answers.ticketCategory === 'string' ? { categoryId: answers.ticketCategory } : {}),
          ...(typeof answers.ticketGroup === 'string' ? { groupId: answers.ticketGroup } : {}),
        }),
      ];
    if (afterApproval === 'notify' && canUse(auth, NOTIFY)) {
      const notified = Array.isArray(answers.notifyGroups) ? (answers.notifyGroups as string[]) : [];
      if (!notified.length) throw invalid('notifyGroups');
      schema.actions = [
        await actionWithDefaults(NOTIFY, 'notify-group', t('actionNotifyName'), schema, auth, {
          toRequester: false,
          groups: notified,
        }),
      ];
    }
    const audienceKeys = Array.isArray(answers.audienceGroupKeys)
      ? (answers.audienceGroupKeys as string[])
      : [];
    if (answers.audience === 'groups' && !audienceKeys.length) throw invalid('audienceGroupKeys');
    const category =
      answers.category === NEW_CATEGORY
        ? ((answers.newCategory as string | undefined)?.trim() ?? null)
        : ((answers.category as string | undefined) ?? null);

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
        category: category || null,
        schema,
        // The workflow proposed just before it in the same change set.
        workflowId: `$ref:${WORKFLOW_REF}`,
        audience:
          answers.audience === 'groups' ? { type: 'groups', groupKeys: audienceKeys } : { type: 'everyone' },
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
