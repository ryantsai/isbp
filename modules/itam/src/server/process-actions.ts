/**
 * Process actions request forms can run here (`manifest.processActions`):
 * - `itam.approve-software`: a software install request was approved — add the title to the approved-software list
 *   (or extend the entry that covers it) for the requester's department or the whole company, until a date from an
 *   answer or a step field;
 * - `itam.assign-asset`: hand the device picked in an asset field to the requester or a person picked in the form,
 *   with the request (e.g. the signed confidentiality agreement) on the asset's history;
 * - `itam.return-asset`: take the picked device back — its condition, in stock or in repair, how long its data is
 *   kept and when it must be wiped; the approver is recorded as the person who received it.
 * Each run acts through the module's own services (state machine, audit, events) and is idempotent on the run.
 */
import {
  ErrorCodes,
  type FieldDef,
  type FormSchema,
  formFields,
  HttpError,
  type LocalizedText,
  parseRecordRef,
  type ProcessActionHandler,
  type ProcessActionInput,
} from '@isbp/sdk/server';
import en from '../../messages/en.json';
import ja from '../../messages/ja-JP.json';
import zh from '../../messages/zh-TW.json';
import {
  type ApprovalScope,
  formatAssetTag,
  isUuid,
  LICENSE_MODELS,
  type LicenseModel,
  RETURN_STATUSES,
  type ReturnStatus,
} from '../model';
import type { AssetEventRequest } from './schema';
import { services } from './services';
import { type Actor, itamConfig } from './support';

const CATALOGS = { en, 'zh-TW': zh as typeof en, 'ja-JP': ja as typeof en };
const text = (pick: (c: typeof en) => string): LocalizedText => ({
  en: pick(CATALOGS.en),
  'zh-TW': pick(CATALOGS['zh-TW']),
  'ja-JP': pick(CATALOGS['ja-JP']),
});
type Labels = typeof en.processActions;
const t = (pick: (c: Labels) => string) => text((c) => pick(c.processActions));

export const ASSET_TYPE = 'itam.asset';
const REQUESTER = 'requester';
const FIELD_PREFIX = 'field:';
const FROM_STEP = 'step';
const NONE = 'none';
/** `<step id>.<field key>` of a step field (`steps.<step>.<key>` in conditions and templates). */
const STEP_FIELD_PATTERN = '[a-zA-Z_][\\w-]{0,63}\\.[a-z][a-zA-Z0-9_]{0,63}';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function invalid(path: string, message: string, code = 'invalid'): HttpError {
  return new HttpError(400, ErrorCodes.VALIDATION_FAILED, message, { issues: [{ path, message, code }] });
}

/** The form's fields of some types, as choices (`field:<key>`). */
const fieldChoices = (form: FormSchema | null, accept: (f: FieldDef) => boolean, prefix = FIELD_PREFIX) =>
  formFields(form)
    .filter(accept)
    .map((f) => ({ value: `${prefix}${f.key}`, label: f.label }));

/** Where the device comes from: an asset field of the form, or a field the approver fills in at a step. */
const ASSET_SOURCE = { from: 'assetField', step: 'assetStepField' };

function assetSource(form: FormSchema | null): FieldDef[] {
  return [
    {
      key: ASSET_SOURCE.from,
      type: 'select',
      label: t((x) => x.common.assetField),
      help: t((x) => x.common.assetFieldHelp),
      required: true,
      options: [
        ...fieldChoices(form, (f) => f.type === 'record' && Boolean(f.record?.types.includes(ASSET_TYPE))),
        { value: FROM_STEP, label: t((x) => x.common.fromStep) },
      ],
    },
    {
      key: ASSET_SOURCE.step,
      type: 'text',
      label: t((x) => x.common.stepField),
      help: t((x) => x.common.assetStepFieldHint),
      required: true,
      placeholder: { en: 'issue.device' },
      visibleWhen: { fact: ASSET_SOURCE.from, op: 'eq', value: FROM_STEP },
      validation: { maxLength: 130, pattern: STEP_FIELD_PATTERN },
    },
  ];
}

/** "A date from an answer, or from a step field": the select and the step field it may name. */
function dateSource(
  form: FormSchema | null,
  keys: { from: string; step: string },
  labels: { from: LocalizedText; help?: LocalizedText; none: LocalizedText },
): FieldDef[] {
  return [
    {
      key: keys.from,
      type: 'select',
      label: labels.from,
      help: labels.help,
      defaultValue: NONE,
      options: [
        { value: NONE, label: labels.none },
        ...fieldChoices(form, (f) => f.type === 'date'),
        { value: FROM_STEP, label: t((x) => x.common.fromStep) },
      ],
    },
    {
      key: keys.step,
      type: 'text',
      label: t((x) => x.common.stepField),
      help: t((x) => x.common.stepFieldHint),
      required: true,
      placeholder: { en: 'receive.retainUntil' },
      visibleWhen: { fact: keys.from, op: 'eq', value: FROM_STEP },
      validation: { maxLength: 130, pattern: STEP_FIELD_PATTERN },
    },
  ];
}

/** The date a `dateSource` points at (`YYYY-MM-DD`; a date-time counts as its day), or null when it is empty. */
function dateFrom(
  config: Record<string, unknown>,
  request: ProcessActionInput['request'],
  keys: { from: string; step: string },
): string | null {
  const from = String(config[keys.from] ?? NONE);
  let value: unknown;
  if (from === FROM_STEP) {
    const [stepId = '', key = ''] = String(config[keys.step] ?? '').split('.');
    value = request.steps?.[stepId]?.[key];
  } else if (from.startsWith(FIELD_PREFIX)) value = request.data[from.slice(FIELD_PREFIX.length)];
  if (value === undefined || value === null || value === '') return null;
  const day = typeof value === 'string' ? value.slice(0, 10) : '';
  if (!DATE_RE.test(day)) throw invalid(keys.from, 'The chosen value is not a date');
  return day;
}

/** The assets picked in the request's asset field or the step field (a single or a multi-pick field), at most 20. */
function pickedAssets(config: Record<string, unknown>, request: ProcessActionInput['request']): string[] {
  const from = String(config[ASSET_SOURCE.from] ?? '');
  let raw: unknown;
  if (from === FROM_STEP) {
    const [stepId = '', key = ''] = String(config[ASSET_SOURCE.step] ?? '').split('.');
    raw = request.steps?.[stepId]?.[key];
  } else if (from.startsWith(FIELD_PREFIX)) raw = request.data[from.slice(FIELD_PREFIX.length)];
  else if (from) raw = request.data[from];
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return [
    ...new Set(
      list
        .map((v) => (typeof v === 'string' ? parseRecordRef(v) : null))
        .filter((r): r is NonNullable<typeof r> => r?.type === ASSET_TYPE && isUuid(r.id))
        .map((r) => r.id),
    ),
  ].slice(0, 20);
}

/** The request a step comes from, on the asset's history (and the idempotency key). */
const requestOf = (input: ProcessActionInput): AssetEventRequest => ({
  runId: input.runId,
  submissionId: input.request.id,
  reference: input.request.reference,
  formKey: input.request.form.key,
});

/** The history names the approver (who handed over or received the device), else the form. */
const actorFor = (input: ProcessActionInput): Actor =>
  input.request.decidedBy
    ? { actorId: input.request.decidedBy.id, actorName: null }
    : { actorId: null, actorName: input.request.form.name.en ?? input.request.form.key };

const clip = (v: unknown, max: number) => {
  const s = String(v ?? '').trim();
  return s ? s.slice(0, max) : null;
};

/** A licence-type answer as a licence model: the value itself, or a common way of writing it. */
export function licenseModelOf(answer: unknown): LicenseModel | null {
  if (typeof answer !== 'string') return null;
  const v = answer
    .trim()
    .toLowerCase()
    .replace(/[\s/-]+/g, '_');
  if ((LICENSE_MODELS as readonly string[]).includes(v)) return v as LicenseModel;
  const aliases: Record<string, LicenseModel> = {
    freeware: 'free',
    opensource: 'open_source',
    oss: 'open_source',
    trial: 'shareware',
    shareware_trial: 'shareware',
    purchase: 'paid',
    purchased: 'paid',
    paid_licence: 'paid',
    paid_license: 'paid',
    commercial: 'paid',
    saas: 'subscription',
  };
  return aliases[v] ?? null;
}

/* ───────────────────────────── itam.approve-software ───────────────────────────── */

const SOFTWARE_DATE = { from: 'validUntilFrom', step: 'validUntilStepField' };

export const approveSoftwareAction: ProcessActionHandler = {
  fields(_ctx, { form }) {
    const a = (pick: (x: Labels['approveSoftware']) => string) => t((x) => pick(x.approveSoftware));
    const selects = fieldChoices(form, (f) => f.type === 'select');
    return [
      {
        key: 'title',
        type: 'text',
        label: a((x) => x.title),
        help: a((x) => x.titleHelp),
        required: true,
        validation: { maxLength: 400 },
      },
      { key: 'publisher', type: 'text', label: a((x) => x.publisher), validation: { maxLength: 400 } },
      {
        key: 'version',
        type: 'text',
        label: a((x) => x.version),
        help: a((x) => x.versionHelp),
        validation: { maxLength: 200 },
      },
      {
        key: 'licenseModel',
        type: 'select',
        label: a((x) => x.licenseModel),
        required: true,
        defaultValue: 'free',
        width: 'half',
        options: LICENSE_MODELS.map((m) => ({ value: m, label: text((c) => c.licenseModel[m]) })),
      },
      ...(selects.length
        ? [
            {
              key: 'licenseModelField',
              type: 'select' as const,
              label: a((x) => x.licenseModelField),
              help: a((x) => x.licenseModelFieldHelp),
              width: 'half' as const,
              options: selects,
            },
          ]
        : []),
      {
        key: 'scope',
        type: 'select',
        label: a((x) => x.scope),
        required: true,
        defaultValue: 'department',
        options: [
          { value: 'department', label: a((x) => x.scopeDepartment) },
          { value: 'company', label: a((x) => x.scopeCompany) },
        ],
      },
      ...dateSource(form, SOFTWARE_DATE, {
        from: a((x) => x.validUntil),
        help: a((x) => x.validUntilHelp),
        none: a((x) => x.permanent),
      }),
      {
        key: 'notes',
        type: 'textarea',
        label: a((x) => x.notes),
        defaultValue: 'Approved with {{request.reference}} ({{requester.displayName}}).',
        validation: { maxLength: 5000 },
      },
    ] satisfies FieldDef[];
  },

  async run(input, ctx) {
    const { config, request, auth } = input;
    const title = clip(config.title, 200);
    if (!title) throw invalid('title', 'The request gave no software name', 'required');
    const answer =
      typeof config.licenseModelField === 'string' && config.licenseModelField.startsWith(FIELD_PREFIX)
        ? request.data[config.licenseModelField.slice(FIELD_PREFIX.length)]
        : undefined;
    const licenseModel = licenseModelOf(answer) ?? licenseModelOf(config.licenseModel) ?? 'free';
    const scope: ApprovalScope = config.scope === 'company' ? 'company' : 'departments';
    const { entry, created, changed } = await services(ctx).approvedSoftware.approveFromRequest(
      {
        title,
        publisher: clip(config.publisher, 200),
        version: clip(config.version, 64),
        licenseModel,
        scope,
        departmentId: request.requester?.departmentId ?? null,
        validUntil: dateFrom(config, request, SOFTWARE_DATE),
        notes: clip(config.notes, 5000),
      },
      auth,
      requestOf(input),
    );
    return {
      reference: entry.version ? `${entry.title} ${entry.version}` : entry.title,
      // The list is for software readers; the requester sees the result on the request.
      href: null,
      summary: !changed
        ? 'itam.processActions.approveSoftware.unchanged'
        : `itam.processActions.approveSoftware.${created ? 'added' : 'extended'}${entry.validUntil ? 'Until' : ''}`,
      summaryParams: entry.validUntil ? { until: entry.validUntil } : null,
    };
  },
};

/* ───────────────────────────── itam.assign-asset ───────────────────────────── */

export const assignAssetAction: ProcessActionHandler = {
  fields(_ctx, { form }) {
    const a = (pick: (x: Labels['assignAsset']) => string) => t((x) => pick(x.assignAsset));
    return [
      ...assetSource(form),
      {
        key: 'assignTo',
        type: 'select',
        label: a((x) => x.assignTo),
        required: true,
        defaultValue: REQUESTER,
        options: [
          { value: REQUESTER, label: a((x) => x.requester) },
          ...fieldChoices(form, (f) => f.type === 'user'),
        ],
      },
      {
        key: 'note',
        type: 'textarea',
        label: a((x) => x.note),
        defaultValue: 'Checked out with {{request.reference}} ({{request.form}}).',
        validation: { maxLength: 2000 },
      },
    ] satisfies FieldDef[];
  },

  async run(input, ctx) {
    const { config, request, auth } = input;
    const ids = pickedAssets(config, request);
    if (!ids.length) return { reference: null, href: null, summary: 'itam.processActions.common.noAsset' };
    const choice = String(config.assignTo ?? REQUESTER);
    const userId =
      choice === REQUESTER
        ? (request.requester?.id ?? null)
        : choice.startsWith(FIELD_PREFIX)
          ? request.data[choice.slice(FIELD_PREFIX.length)]
          : null;
    if (typeof userId !== 'string' || !isUuid(userId))
      throw invalid('assignTo', 'The request names nobody to hand the device to', 'required');
    const svc = services(ctx).assets;
    const tags: string[] = [];
    for (const id of ids) {
      const a = await svc.assign(id, { userId, note: clip(config.note, 2000) }, auth, {
        request: requestOf(input),
        actor: actorFor(input),
      });
      tags.push(formatAssetTag(a.number));
    }
    return {
      reference: tags.join(', ').slice(0, 200),
      // The requester finds their device under My devices.
      href: userId === request.requester?.id ? '/itam/mine' : null,
      summary: 'itam.processActions.assignAsset.assigned',
      record: ids.length === 1 ? { type: ASSET_TYPE, id: ids[0]! } : null,
    };
  },
};

/* ───────────────────────────── itam.return-asset ───────────────────────────── */

const RETENTION = { from: 'retentionFrom', step: 'retentionStepField' };

export const returnAssetAction: ProcessActionHandler = {
  async fields(ctx, { form }) {
    const a = (pick: (x: Labels['returnAsset']) => string) => t((x) => pick(x.returnAsset));
    const cfg = await itamConfig(ctx);
    return [
      ...assetSource(form),
      {
        key: 'toStatus',
        type: 'select',
        label: a((x) => x.toStatus),
        required: true,
        defaultValue: 'in_stock',
        width: 'half',
        options: RETURN_STATUSES.map((s) => ({ value: s, label: text((c) => c.status[s]) })),
      },
      {
        key: 'condition',
        type: 'textarea',
        label: a((x) => x.condition),
        help: a((x) => x.conditionHelp),
        validation: { maxLength: 2000 },
      },
      ...dateSource(form, RETENTION, {
        from: a((x) => x.retention),
        help: a((x) => x.retentionHelp),
        none: a((x) => x.noRetention),
      }),
      {
        key: 'wipeMonths',
        type: 'number',
        label: a((x) => x.wipeMonths),
        help: a((x) => x.wipeMonthsHelp),
        defaultValue: cfg.wipeMonths,
        width: 'half',
        validation: { min: 0, max: 60 },
      },
      {
        key: 'scheduleWipe',
        type: 'boolean',
        label: a((x) => x.scheduleWipe),
        help: a((x) => x.scheduleWipeHelp),
        defaultValue: true,
      },
    ] satisfies FieldDef[];
  },

  async run(input, ctx) {
    const { config, request, auth } = input;
    const ids = pickedAssets(config, request);
    if (!ids.length) return { reference: null, href: null, summary: 'itam.processActions.common.noAsset' };
    const toStatus: ReturnStatus = config.toStatus === 'in_repair' ? 'in_repair' : 'in_stock';
    const retainUntil = dateFrom(config, request, RETENTION);
    const months = typeof config.wipeMonths === 'number' ? config.wipeMonths : undefined;
    const svc = services(ctx).assets;
    const tags: string[] = [];
    let wipeDue: string | null = null;
    for (const id of ids) {
      const a = await svc.returnAsset(
        id,
        {
          toStatus,
          note: clip(config.condition, 2000),
          dataRetainUntil: retainUntil,
          // Only devices that store data get a wipe; the switch turns it off for all.
          ...(config.scheduleWipe === false ? { scheduleWipe: false } : {}),
        },
        auth,
        { request: requestOf(input), actor: actorFor(input), wipeMonths: months },
      );
      tags.push(formatAssetTag(a.number));
      if (a.wipeDue && (!wipeDue || a.wipeDue > wipeDue)) wipeDue = a.wipeDue;
    }
    return {
      reference: tags.join(', ').slice(0, 200),
      href: null,
      summary: wipeDue
        ? 'itam.processActions.returnAsset.returnedWipe'
        : 'itam.processActions.returnAsset.returned',
      summaryParams: wipeDue ? { date: wipeDue } : null,
      record: ids.length === 1 ? { type: ASSET_TYPE, id: ids[0]! } : null,
    };
  },
};

export const processActions: Record<string, ProcessActionHandler> = {
  'approve-software': approveSoftwareAction,
  'assign-asset': assignAssetAction,
  'return-asset': returnAssetAction,
};
