/**
 * Service catalog fulfilment: a published Phase 1 form mapped in `itsm.catalog_items` opens a service
 * request when it is submitted (or once approved), carrying the answers, and reports the request's
 * progress back on the submission. Events are at-least-once, so this is idempotent on the submission id.
 */
import { groups, users } from '@isbp/db/schema';
import {
  evaluateCondition,
  type FieldDef,
  type FormSubmissionInfo,
  localize,
  type ModuleContext,
} from '@isbp/sdk/server';
import { eq, inArray, sql } from 'drizzle-orm';
import { categoryMap } from './lookups';
import { isDone } from './rules';
import { catalogItems, type TicketAnswer, tickets } from './schema';
import { SYSTEM_ACTOR, type TicketService } from './tickets';

/** Impact × urgency that land on each priority in the ITIL matrix. */
const LEVELS: Record<number, [impact: number, urgency: number]> = {
  1: [1, 1],
  2: [1, 2],
  3: [2, 2],
  4: [3, 3],
};

const isUniqueViolation = (err: unknown): boolean => {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code === '23505' || e?.cause?.code === '23505';
};

function isField(el: unknown): el is FieldDef & { id: string } {
  return Boolean(el && typeof el === 'object' && 'key' in el && typeof (el as FieldDef).key === 'string');
}

const isEmpty = (v: unknown) =>
  v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);

/** Answers as `label → value` (English values; people's names for user fields; hidden fields skipped). */
export async function renderAnswers(
  ctx: ModuleContext,
  schema: FormSubmissionInfo['schema'],
  data: Record<string, unknown>,
): Promise<TicketAnswer[]> {
  const fields = schema.elements
    .filter(isField)
    .filter((f) => !f.visibleWhen || evaluateCondition(f.visibleWhen, data));
  const userIds = fields
    .filter((f) => f.type === 'user')
    .flatMap((f) => (Array.isArray(data[f.key]) ? (data[f.key] as string[]) : [data[f.key]]))
    .filter((v): v is string => typeof v === 'string');
  const names = new Map(
    userIds.length
      ? (
          await ctx.db
            .select({ id: users.id, name: users.displayName })
            .from(users)
            .where(inArray(users.id, [...new Set(userIds)]))
        ).map((u) => [u.id, u.name])
      : [],
  );
  const optionLabel = (f: FieldDef, v: unknown) =>
    localize(f.options?.find((o) => o.value === v)?.label, 'en') || String(v);
  const out: TicketAnswer[] = [];
  for (const f of fields) {
    const v = data[f.key];
    if (isEmpty(v)) continue;
    let value: string;
    switch (f.type) {
      case 'boolean':
        value = v ? 'Yes' : 'No';
        break;
      case 'select':
        value = optionLabel(f, v);
        break;
      case 'multiselect':
        value = (Array.isArray(v) ? v : [v]).map((x) => optionLabel(f, x)).join(', ');
        break;
      case 'user':
        value = (Array.isArray(v) ? v : [v]).map((x) => names.get(String(x)) ?? String(x)).join(', ');
        break;
      case 'number':
        value = typeof v === 'number' ? v.toLocaleString('en-US') : String(v);
        break;
      default:
        value = Array.isArray(v) ? v.join(', ') : String(v);
    }
    out.push({ key: f.key, label: f.label, value });
  }
  return out;
}

export class FulfilmentService {
  constructor(
    private readonly ctx: ModuleContext,
    private readonly tickets: TicketService,
  ) {}

  private async mapping(formKey: string) {
    const [m] = await this.ctx.db.select().from(catalogItems).where(eq(catalogItems.formKey, formKey));
    return m?.active ? m : null;
  }

  private async existing(submissionId: string) {
    const [row] = await this.ctx.db
      .select()
      .from(tickets)
      .where(sql`${tickets.source}->>'id' = ${submissionId}`);
    return row ?? null;
  }

  /** `core.form-submission.created`: fulfil now when mapped "on submit", or when the form has no approval. */
  async onSubmitted(submissionId: string) {
    const sub = await this.ctx.forms.submission(submissionId);
    if (!sub) return null;
    const m = await this.mapping(sub.form.key);
    if (!m) return null;
    if (m.fulfilOn === 'submitted' || sub.status === 'submitted' || sub.status === 'approved')
      return this.fulfil(sub, m);
    return null;
  }

  /** `core.form-submission.completed`: approved → fulfil (once); rejected/cancelled → cancel an early SR. */
  async onCompleted(submissionId: string, status: 'approved' | 'rejected' | 'cancelled') {
    const sub = await this.ctx.forms.submission(submissionId);
    if (!sub) return null;
    if (status === 'approved') {
      const early = await this.existing(submissionId);
      if (early?.status === 'pending_approval')
        // Opened on submit while the approval ran: the work can start now.
        return this.ctx.transaction((tx) =>
          this.tickets.applyStatus(tx, early, 'new', {
            actor: SYSTEM_ACTOR,
            data: { submission: 'approved' },
          }),
        );
      const m = await this.mapping(sub.form.key);
      return m ? this.fulfil(sub, m) : null;
    }
    const t = await this.existing(submissionId);
    if (!t || isDone(t.status)) return null;
    return this.ctx.transaction((tx) =>
      this.tickets.applyStatus(tx, t, 'cancelled', {
        actor: SYSTEM_ACTOR,
        resolutionCode: 'cancelled_by_requester',
        resolutionNotes:
          status === 'rejected'
            ? 'The request was not approved.'
            : 'The request was withdrawn by the requester.',
        data: { submission: status },
      }),
    );
  }

  async fulfil(
    sub: FormSubmissionInfo,
    m: typeof catalogItems.$inferSelect,
    opts: { quiet?: boolean; at?: Date } = {},
  ) {
    const found = await this.existing(sub.id);
    if (found) return found;
    const requester = sub.submittedBy
      ? (
          await this.ctx.db
            .select({ id: users.id, name: users.displayName, departmentId: users.departmentId })
            .from(users)
            .where(eq(users.id, sub.submittedBy))
        )[0]
      : undefined;
    const answers = await renderAnswers(this.ctx, sub.schema, sub.data);
    const formName = localize(sub.form.name, 'en');
    const title = `${formName} — ${requester?.name ?? sub.reference}`.slice(0, 200);
    const description = [
      `Request ${sub.reference} submitted through the "${formName}" form.`,
      '',
      ...answers.map((a) => `- ${localize(a.label, 'en')}: ${a.value}`),
    ].join('\n');
    const category = m.categoryId ? (await categoryMap(this.ctx.db)).get(m.categoryId) : undefined;
    const [impact, urgency] = LEVELS[m.priority] ?? LEVELS[3]!;
    let groupId = m.groupId ?? category?.defaultGroupId ?? null;
    if (!groupId) {
      const key = await this.ctx.settings.get<string>('defaultGroupKey');
      const [g] = key
        ? await this.ctx.db.select({ id: groups.id }).from(groups).where(eq(groups.key, key))
        : [];
      groupId = g?.id ?? null;
    }
    try {
      return await this.ctx.transaction((tx) =>
        this.tickets.insertTicket(
          tx,
          {
            type: 'service_request',
            // Opened on submit while the form's approval is still running.
            status: sub.status === 'pending' ? 'pending_approval' : 'new',
            title,
            description: description.slice(0, 20_000),
            impact,
            urgency,
            priority: m.priority,
            categoryId: category?.id ?? null,
            requesterId: requester?.id ?? null,
            requestedForId: null,
            departmentId: requester?.departmentId ?? null,
            assignmentGroupId: groupId,
            assigneeId: null,
            channel: 'form',
            source: {
              type: 'form-submission',
              id: sub.id,
              reference: sub.reference,
              formKey: sub.form.key,
              formName: sub.form.name,
            },
            answers,
            major: false,
            attributes: {},
            manualFields: ['category', 'group', 'priority'],
            createdBy: null,
            createdAt: opts.at,
            ciIds: [],
          },
          SYSTEM_ACTOR,
          { quiet: opts.quiet },
        ),
      );
    } catch (err) {
      if (isUniqueViolation(err)) return this.existing(sub.id);
      throw err;
    }
  }
}
