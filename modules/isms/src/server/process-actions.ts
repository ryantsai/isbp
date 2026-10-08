/**
 * `isms.register-shared-account`: once a shared-account request is approved, register the account (or add the new
 * members to the active account of that name on that system) with its custodian and members, linked to the request.
 * Members come from person fields of the form or from a person column of a table (`rows`) field — one row per user,
 * as on the paper form. Idempotent on the run (`account_events.dedupe_key`), written through the module's own rules.
 */
import {
  ErrorCodes,
  type FieldDef,
  formFields,
  HttpError,
  type LocalizedText,
  parseRecordRef,
  type ProcessActionHandler,
} from '@isbp/sdk/server';
import { formatRef, isUuid } from '../model';
import { accountHref } from './accounts';
import { services } from './services';
import { type Catalog, peopleByIds, textOf } from './support';

const t = (pick: (c: Catalog['processActions']['registerSharedAccount']) => string): LocalizedText =>
  textOf((c) => pick(c.processActions.registerSharedAccount));

const REQUESTER = 'requester';
/** Record types a target system can be picked from. */
const TARGET_TYPES = ['alm.application', 'cmdb.ci', 'itam.asset'];

const invalid = (path: string, message: string) =>
  new HttpError(400, ErrorCodes.VALIDATION_FAILED, message, { issues: [{ path, message }] });

/** Person fields of the form, and person columns of its table fields (`<table>.<column>`). */
function personOptions(form: Parameters<ProcessActionHandler['fields']>[1]['form']) {
  const out: { value: string; label: LocalizedText }[] = [];
  for (const f of formFields(form)) {
    if (f.type === 'user') out.push({ value: f.key, label: f.label });
    const rowsDef = (f as FieldDef & { rows?: { fields?: FieldDef[] } }).rows;
    if ((f.type as string) === 'rows')
      for (const c of rowsDef?.fields ?? [])
        if (c.type === 'user')
          out.push({
            value: `${f.key}.${c.key}`,
            label: Object.fromEntries(
              Object.entries(f.label).map(([l, v]) => [
                l,
                `${v} › ${(c.label as Record<string, string>)[l] ?? c.label.en ?? c.key}`,
              ]),
            ) as LocalizedText,
          });
  }
  return out;
}

/** People named by one configured source (a person field, or a person column of a table). */
function peopleFrom(data: Record<string, unknown>, source: string): string[] {
  const [key, column] = source.split('.');
  const value = data[key!];
  const ids: unknown[] = [];
  if (column) {
    if (Array.isArray(value))
      for (const row of value)
        if (row && typeof row === 'object') ids.push((row as Record<string, unknown>)[column]);
  } else if (Array.isArray(value)) ids.push(...value);
  else ids.push(value);
  return ids.filter((v): v is string => typeof v === 'string' && isUuid(v));
}

export const registerSharedAccountAction: ProcessActionHandler = {
  fields(_ctx, { form }) {
    const people = personOptions(form);
    const records = formFields(form)
      .filter((f) => f.type === 'record' && (f.record?.types ?? []).some((x) => TARGET_TYPES.includes(x)))
      .map((f) => ({ value: f.key, label: f.label }));
    return [
      {
        key: 'accountName',
        type: 'text',
        label: t((c) => c.accountName),
        help: t((c) => c.accountNameHelp),
        required: true,
        validation: { maxLength: 200 },
      },
      {
        key: 'targetSystem',
        type: 'text',
        label: t((c) => c.targetSystem),
        help: t((c) => c.templateHelp),
        validation: { maxLength: 200 },
      },
      ...(records.length
        ? [
            {
              key: 'targetField',
              type: 'select' as const,
              label: t((c) => c.targetField),
              help: t((c) => c.targetFieldHelp),
              options: records,
            },
          ]
        : []),
      {
        key: 'custodianField',
        type: 'select',
        label: t((c) => c.custodian),
        required: true,
        defaultValue: REQUESTER,
        options: [
          { value: REQUESTER, label: t((c) => c.requester) },
          ...people.filter((p) => !p.value.includes('.')),
        ],
      },
      {
        key: 'membersFields',
        type: 'multiselect',
        label: t((c) => c.members),
        help: t((c) => c.membersHelp),
        options: people,
      },
      { key: 'purpose', type: 'textarea', label: t((c) => c.purpose), validation: { maxLength: 2000 } },
      { key: 'project', type: 'text', label: t((c) => c.project), validation: { maxLength: 200 } },
    ] satisfies FieldDef[];
  },

  async validate(config, _ctx, { form }) {
    const people = personOptions(form).map((p) => p.value);
    const custodian = String(config.custodianField ?? REQUESTER);
    if (custodian !== REQUESTER && !people.includes(custodian))
      throw invalid('custodianField', 'Choose the requester or a person field of the form');
    const members = Array.isArray(config.membersFields) ? (config.membersFields as unknown[]) : [];
    if (members.some((m) => typeof m !== 'string' || !people.includes(m)))
      throw invalid('membersFields', 'Choose person fields (or person columns of tables) of the form');
  },

  async run({ config, request, runId, auth }, ctx) {
    const accountName = String(config.accountName ?? '').trim();
    if (!accountName) throw invalid('accountName', 'The account name came out empty');
    const custodianSource = String(config.custodianField ?? REQUESTER);
    const custodianId =
      custodianSource === REQUESTER
        ? (request.requester?.id ?? null)
        : (peopleFrom(request.data, custodianSource)[0] ?? null);
    if (!custodianId) throw invalid('custodianField', 'The request names no custodian');
    const sources = Array.isArray(config.membersFields) ? (config.membersFields as string[]) : [];
    const wanted = [...new Set(sources.flatMap((s) => peopleFrom(request.data, s)))];
    const people = await peopleByIds(ctx.db, [custodianId, ...wanted]);
    if (people.get(custodianId)?.status !== 'active')
      throw invalid('custodianField', 'The custodian is not active');
    // People who left in the meantime are not added.
    const memberIds = wanted.filter((id) => people.get(id)?.status === 'active');
    const targetKey = config.targetField ? String(config.targetField) : null;
    const rawTarget = targetKey ? request.data[targetKey] : null;
    const targetRef = (Array.isArray(rawTarget) ? rawTarget[0] : rawTarget) as unknown;
    const target = typeof targetRef === 'string' && parseRecordRef(targetRef) ? targetRef : null;
    const { account, created } = await services(ctx).accounts.registerFromRequest(
      {
        accountName: accountName.slice(0, 200),
        targetSystem:
          String(config.targetSystem ?? '')
            .trim()
            .slice(0, 200) || null,
        targetRef: target,
        custodianId,
        memberIds,
        purpose:
          String(config.purpose ?? '')
            .trim()
            .slice(0, 2000) || null,
        project:
          String(config.project ?? '')
            .trim()
            .slice(0, 200) || null,
        requestReference: request.reference,
        runId,
      },
      auth,
    );
    const reference = formatRef('account', account.number);
    return {
      reference,
      href: accountHref(reference),
      summary: created
        ? 'isms.processActions.registerSharedAccount.created'
        : 'isms.processActions.registerSharedAccount.updated',
      record: { type: 'isms.account', id: account.id },
    };
  },
};

export const processActions = { 'register-shared-account': registerSharedAccountAction };
