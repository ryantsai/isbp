/**
 * Process actions forms can run (`manifest.processActions`): raise a change from a request — linked to the CIs it
 * picked and, when asked, submitted to the change's own CAB authorization (never bypassed, decision 72) — or raise
 * an incident or service request for the requester. Each run is idempotent: the ticket's `source` is the run.
 */
import { groups, users } from '@isbp/db/schema';
import {
  ErrorCodes,
  type FieldDef,
  type FormSchema,
  formFields,
  HttpError,
  type LocalizedText,
  type ModuleContext,
  parseRecordRef,
  type ProcessActionHandler,
  type ProcessActionInput,
} from '@isbp/sdk/server';
import { asc, eq, ne, sql } from 'drizzle-orm';
import en from '../../messages/en.json';
import ja from '../../messages/ja-JP.json';
import zh from '../../messages/zh-TW.json';
import { createTicketSchema, riskSchema } from '../contracts';
import type { TicketRow } from './dto';
import { isValidTimeZone, localToInstant } from './business-time';
import { categoryMap } from './lookups';
import { refOf, ticketHref } from './rules';
import { type TicketSource, tickets } from './schema';
import { services } from './services';
import { actorOf } from './tickets';

const CATALOGS = { en, 'zh-TW': zh as typeof en, 'ja-JP': ja as typeof en };
const text = (pick: (c: typeof en) => string): LocalizedText => ({
  en: pick(CATALOGS.en),
  'zh-TW': pick(CATALOGS['zh-TW']),
  'ja-JP': pick(CATALOGS['ja-JP']),
});

const EVERYONE = 'everyone';
const CI_TYPE = 'cmdb.ci';
/** Impact × urgency that land on each priority in the ITIL matrix (as catalog fulfilment). */
const LEVELS: Record<string, [impact: 1 | 2 | 3, urgency: 1 | 2 | 3]> = {
  '1': [1, 1],
  '2': [1, 2],
  '3': [2, 2],
  '4': [3, 3],
};

const isUniqueViolation = (err: unknown): boolean => {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code === '23505' || e?.cause?.code === '23505';
};

/** The form's fields of some types, as choices. */
const fieldChoices = (form: FormSchema | null, accept: (f: FieldDef) => boolean) =>
  formFields(form)
    .filter(accept)
    .map((f) => ({ value: f.key, label: f.label }));

async function groupOptions(ctx: ModuleContext) {
  const rows = await ctx.db
    .select({ id: groups.id, name: groups.name })
    .from(groups)
    .where(ne(groups.key, EVERYONE))
    .orderBy(asc(groups.name))
    .limit(500);
  return rows.map((g) => ({ value: g.id, label: { en: g.name } }));
}

async function categoryOptions(ctx: ModuleContext, types: readonly string[]) {
  return [...(await categoryMap(ctx.db)).values()]
    .filter((c) => c.active && c.ticketTypes.some((t) => types.includes(t)))
    .map((c) => ({ value: c.id, label: c.name }));
}

function invalid(path: string, message: string, code = 'invalid'): HttpError {
  return new HttpError(400, ErrorCodes.VALIDATION_FAILED, message, { issues: [{ path, message, code }] });
}

/** Values of the form a ticket input is built from, validated like the API's create (a refusal is permanent). */
function ticketInput(raw: unknown) {
  const parsed = createTicketSchema.safeParse(raw);
  if (!parsed.success)
    throw new HttpError(400, ErrorCodes.VALIDATION_FAILED, 'The ticket the action builds is not valid', {
      issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message, code: i.code })),
    });
  return parsed.data;
}

const sourceOf = (input: ProcessActionInput): TicketSource => ({
  type: 'process-action',
  id: input.runId,
  submissionId: input.request.id,
  reference: input.request.reference,
  formKey: input.request.form.key,
  formName: input.request.form.name,
});

async function bySource(ctx: ModuleContext, runId: string): Promise<TicketRow | null> {
  const [row] = await ctx.db
    .select()
    .from(tickets)
    .where(sql`${tickets.source}->>'id' = ${runId}`);
  return row ?? null;
}

/** Creates the ticket once per run: a retry (or a duplicate delivery) finds the one it made. */
async function raiseOnce(
  input: ProcessActionInput,
  ctx: ModuleContext,
  create: () => Promise<TicketRow>,
): Promise<TicketRow> {
  const existing = await bySource(ctx, input.runId);
  if (existing) return existing;
  try {
    return await create();
  } catch (err) {
    if (isUniqueViolation(err)) {
      const raced = await bySource(ctx, input.runId);
      if (raced) return raced;
    }
    throw err;
  }
}

const text200 = (v: unknown, fallback: string) => (String(v ?? '').trim() || fallback).slice(0, 200);
const textLong = (v: unknown) => String(v ?? '').slice(0, 20_000);

/* ───────────────────────────── itsm.create-change ───────────────────────────── */

const DAY_MS = 24 * 60 * 60 * 1000;
const QUARTER_MS = 15 * 60 * 1000;
const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Change types a form may raise: never a standard (pre-approved) change, which would skip the CAB (decision 72). */
export const FORM_CHANGE_TYPES = ['normal', 'emergency'] as const;
const formChangeType = (v: unknown): (typeof FORM_CHANGE_TYPES)[number] | null =>
  v === 'normal' || v === 'emergency' ? v : null;

/** The requester's time zone (their profile's, when the runtime knows it), else UTC. */
async function zoneOf(ctx: ModuleContext, userId: string | null | undefined): Promise<string> {
  if (!userId) return 'UTC';
  const [u] = await ctx.db.select({ tz: users.timezone }).from(users).where(eq(users.id, userId));
  return u?.tz && isValidTimeZone(u.tz) ? u.tz : 'UTC';
}

/**
 * An answer as an instant. A date-only answer (`YYYY-MM-DD`) is a day in the requester's time zone: its start, or for
 * the end of a window the start of the next day (a one-day window is that whole day). Other values are read as given.
 */
export function instantFrom(
  data: Record<string, unknown>,
  key: unknown,
  timeZone: string,
  end = false,
): number | null {
  if (typeof key !== 'string' || !key) return null;
  const v = data[key];
  if (typeof v !== 'string' || !v) return null;
  const m = DATE_ONLY_RE.exec(v);
  if (m) {
    const day = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / DAY_MS;
    return Number.isFinite(day) ? localToInstant(end ? day + 1 : day, 0, timeZone) : null;
  }
  const t = new Date(v).getTime();
  return Number.isNaN(t) ? null : t;
}

/**
 * The planned window as of `now`: one that already started begins at the next quarter hour instead (a change planned
 * for today can still be submitted); `passed` when it has ended (or ends before that quarter hour).
 */
export function plannedWindow(
  start: number | null,
  end: number | null,
  now: number,
): { start: number | null; end: number | null; passed: boolean } {
  if (start === null || end === null) return { start, end, passed: false };
  const next = Math.ceil((now + 60_000) / QUARTER_MS) * QUARTER_MS;
  if (end <= next) return { start, end, passed: true };
  return { start: start < now + 60_000 ? next : start, end, passed: false };
}

const isoOf = (t: number | null) => (t === null ? null : new Date(t).toISOString());

function ciIdsFrom(data: Record<string, unknown>, key: unknown): string[] {
  if (typeof key !== 'string' || !key) return [];
  const raw = data[key];
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return [
    ...new Set(
      list
        .map((v) => (typeof v === 'string' ? parseRecordRef(v) : null))
        .filter((r): r is NonNullable<typeof r> => r?.type === CI_TYPE)
        .map((r) => r.id),
    ),
  ].slice(0, 20);
}

export const createChangeAction: ProcessActionHandler = {
  async fields(ctx, { form }) {
    const [cats, groupList] = await Promise.all([categoryOptions(ctx, ['change']), groupOptions(ctx)]);
    const ciFields = fieldChoices(
      form,
      (f) => f.type === 'record' && Boolean(f.record?.types.includes(CI_TYPE)),
    );
    const dateFields = fieldChoices(form, (f) => f.type === 'date');
    const selectFields = fieldChoices(form, (f) => f.type === 'select');
    const c = (pick: (x: typeof en.processActions.createChange) => string) =>
      text((x) => pick(x.processActions.createChange));
    return [
      {
        key: 'title',
        type: 'text',
        label: c((x) => x.title),
        required: true,
        defaultValue: '{{request.form}}: {{requester.displayName}}',
        validation: { maxLength: 400 },
      },
      {
        key: 'description',
        type: 'textarea',
        label: c((x) => x.descriptionField),
        defaultValue: 'Raised from request {{request.reference}} ({{request.url}}).',
        validation: { maxLength: 20_000 },
      },
      {
        key: 'changeType',
        type: 'select',
        label: c((x) => x.changeType),
        required: true,
        defaultValue: 'normal',
        width: 'half',
        options: FORM_CHANGE_TYPES.map((t) => ({ value: t, label: text((x) => x.changeType[t]) })),
      },
      {
        key: 'risk',
        type: 'select',
        label: c((x) => x.risk),
        required: true,
        defaultValue: 'medium',
        width: 'half',
        options: riskSchema.options.map((r) => ({ value: r, label: text((x) => x.risk[r]) })),
      },
      ...(selectFields.length
        ? [
            {
              key: 'changeTypeField',
              type: 'select' as const,
              label: c((x) => x.changeTypeField),
              help: c((x) => x.changeTypeFieldHelp),
              options: selectFields,
            },
            {
              key: 'riskField',
              type: 'select' as const,
              label: c((x) => x.riskField),
              help: c((x) => x.riskFieldHelp),
              options: selectFields,
            },
          ]
        : []),
      ...(cats.length
        ? [
            {
              key: 'categoryId',
              type: 'select' as const,
              label: c((x) => x.category),
              options: cats,
              width: 'half' as const,
            },
          ]
        : []),
      ...(groupList.length
        ? [
            {
              key: 'groupId',
              type: 'select' as const,
              label: c((x) => x.group),
              options: groupList,
              width: 'half' as const,
            },
          ]
        : []),
      ...(ciFields.length
        ? [
            {
              key: 'ciField',
              type: 'select' as const,
              label: c((x) => x.ciField),
              help: c((x) => x.ciFieldHelp),
              options: ciFields,
            },
          ]
        : []),
      ...(dateFields.length
        ? [
            {
              key: 'plannedStartField',
              type: 'select' as const,
              label: c((x) => x.plannedStart),
              options: dateFields,
              width: 'half' as const,
            },
            {
              key: 'plannedEndField',
              type: 'select' as const,
              label: c((x) => x.plannedEnd),
              options: dateFields,
              width: 'half' as const,
            },
          ]
        : []),
      {
        key: 'backoutPlan',
        type: 'textarea',
        label: c((x) => x.backoutPlan),
        validation: { maxLength: 20_000 },
      },
      {
        key: 'submit',
        type: 'boolean',
        label: c((x) => x.submit),
        help: c((x) => x.submitHelp),
        defaultValue: true,
      },
    ] satisfies FieldDef[];
  },

  async validate(config) {
    if (config.submit === true && (!config.plannedStartField || !config.plannedEndField))
      throw invalid(
        config.plannedStartField ? 'plannedEndField' : 'plannedStartField',
        'Submitting a change for authorization needs its planned window',
        'required',
      );
  },

  async run(input, ctx) {
    const { config, request, auth } = input;
    const svc = services(ctx).tickets;
    const riskAnswer = typeof config.riskField === 'string' ? request.data[config.riskField] : undefined;
    const risk = riskSchema.safeParse(riskAnswer).success ? riskAnswer : config.risk;
    // Normal or emergency, from the answer when it is one of them; never standard (an old saved one counts as normal).
    const typeAnswer =
      typeof config.changeTypeField === 'string' ? request.data[config.changeTypeField] : undefined;
    const changeType = formChangeType(typeAnswer) ?? formChangeType(config.changeType) ?? 'normal';
    const zone = await zoneOf(ctx, request.requester?.id);
    const window = plannedWindow(
      instantFrom(request.data, config.plannedStartField, zone),
      instantFrom(request.data, config.plannedEndField, zone, true),
      Date.now(),
    );
    const ciIds = ciIdsFrom(request.data, config.ciField);
    let change = await raiseOnce(input, ctx, async () =>
      svc.create(
        ticketInput({
          type: 'change',
          title: text200(config.title, request.reference),
          description: textLong(config.description),
          categoryId: config.categoryId ?? null,
          assignmentGroupId: config.groupId ?? null,
          requesterId: request.requester?.id ?? null,
          ciIds,
          change: {
            changeType,
            risk,
            // The change shows its source request ("From request REQ-01030 · …"): no English text here.
            reason: '',
            plannedStart: isoOf(window.start),
            plannedEnd: isoOf(window.end),
            backoutPlan: textLong(config.backoutPlan),
          },
        }),
        auth,
        { channel: 'form', source: sourceOf(input) },
      ),
    );
    const self = { type: 'itsm.change', id: change.id };
    // Shown on the change and on each CI (links are idempotent).
    for (const id of ciIds) await ctx.records.link(self, { type: CI_TYPE, id });
    let submitted = change.status !== 'draft' && change.status !== 'assessment';
    // A window that has passed can't be authorized: the change is raised for someone to replan and submit.
    const late = config.submit === true && !submitted && window.passed;
    if (config.submit === true && !submitted && !late) {
      // Through the change's own required CAB workflow, exactly as a person submitting it would.
      if (change.status === 'draft')
        change = await ctx.transaction((tx) =>
          svc.applyStatus(tx, change, 'assessment', { actor: actorOf(auth) }),
        );
      change = await svc.submitChange(change, actorOf(auth), request.requester?.id ?? null);
      submitted = true;
    }
    const reference = refOf(change);
    return {
      reference,
      href: ticketHref(reference),
      summary: submitted
        ? 'itsm.processActions.createChange.submitted'
        : late
          ? 'itsm.processActions.createChange.windowPassed'
          : 'itsm.processActions.createChange.created',
      record: self,
    };
  },
};

/* ───────────────────────────── itsm.create-ticket ───────────────────────────── */

export const createTicketAction: ProcessActionHandler = {
  async fields(ctx) {
    const [cats, groupList] = await Promise.all([
      categoryOptions(ctx, ['incident', 'service_request']),
      groupOptions(ctx),
    ]);
    const c = (pick: (x: typeof en.processActions.createTicket) => string) =>
      text((x) => pick(x.processActions.createTicket));
    return [
      {
        key: 'type',
        type: 'select',
        label: c((x) => x.type),
        required: true,
        defaultValue: 'service_request',
        width: 'half',
        options: (['incident', 'service_request'] as const).map((t) => ({
          value: t,
          label: text((x) => x.types[t]),
        })),
      },
      {
        key: 'priority',
        type: 'select',
        label: c((x) => x.priority),
        required: true,
        defaultValue: '3',
        width: 'half',
        options: (['1', '2', '3', '4'] as const).map((p) => ({
          value: p,
          label: text((x) => x.priority[p]),
        })),
      },
      {
        key: 'title',
        type: 'text',
        label: c((x) => x.title),
        required: true,
        defaultValue: '{{request.form}}: {{requester.displayName}}',
        validation: { maxLength: 400 },
      },
      {
        key: 'description',
        type: 'textarea',
        label: c((x) => x.descriptionField),
        defaultValue: 'Request {{request.reference}} ({{request.url}}).',
        validation: { maxLength: 20_000 },
      },
      ...(cats.length
        ? [
            {
              key: 'categoryId',
              type: 'select' as const,
              label: c((x) => x.category),
              options: cats,
              width: 'half' as const,
            },
          ]
        : []),
      ...(groupList.length
        ? [
            {
              key: 'groupId',
              type: 'select' as const,
              label: c((x) => x.group),
              options: groupList,
              width: 'half' as const,
            },
          ]
        : []),
    ] satisfies FieldDef[];
  },

  async run(input, ctx) {
    const { config, request, auth } = input;
    if (!request.requester) throw invalid('type', 'The request has no requester to raise the ticket for');
    const [impact, urgency] = LEVELS[String(config.priority)] ?? LEVELS['3']!;
    const ticket = await raiseOnce(input, ctx, () =>
      services(ctx).tickets.create(
        ticketInput({
          type: config.type === 'incident' ? 'incident' : 'service_request',
          title: text200(config.title, request.reference),
          description: textLong(config.description),
          impact,
          urgency,
          categoryId: config.categoryId ?? null,
          assignmentGroupId: config.groupId ?? null,
          requesterId: request.requester!.id,
        }),
        auth,
        { channel: 'form', source: sourceOf(input) },
      ),
    );
    const reference = refOf(ticket);
    return {
      reference,
      href: ticketHref(reference),
      summary: 'itsm.processActions.createTicket.created',
      record: { type: 'itsm.ticket', id: ticket.id },
    };
  },
};

export const processActions: Record<string, ProcessActionHandler> = {
  'create-change': createChangeAction,
  'create-ticket': createTicketAction,
};
