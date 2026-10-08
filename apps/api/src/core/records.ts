/**
 * Requests (form submissions) as linkable records (`core.request`): the request page hosts the platform's links and
 * attachments panels, so evidence goes through `ctx.files` (policy, scanning, audit) like on any record. Visibility
 * and `editable` follow the request rules in `services/request-access.ts`.
 */
import { formatRequestNumber } from '@isbp/contracts';
import { departments, formSubmissions, forms, users } from '@isbp/db/schema';
import {
  type AuthContext,
  likePattern,
  localize,
  type ModuleContext,
  type RecordResolver,
  type RecordSummary,
  type StatusTone,
} from '@isbp/sdk/server';
import { and, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import type { RequestFacts } from './manifest';
import { requestAccess, visibleRequestsWhere } from './services/request-access';

export const REQUEST_RECORD_TYPE = 'core.request';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const validIds = (ids: readonly string[]) => [...new Set(ids.filter((id) => UUID_RE.test(id)))];

const STATUS_TONE: Record<string, StatusTone> = {
  submitted: 'info',
  pending: 'warning',
  approved: 'success',
  rejected: 'danger',
  cancelled: 'neutral',
};

const columns = {
  sub: formSubmissions,
  formName: forms.name,
  formKey: forms.key,
  requester: users.displayName,
};

type Row = {
  sub: typeof formSubmissions.$inferSelect;
  formName: (typeof forms.$inferSelect)['name'];
  formKey: string;
  requester: string | null;
};

async function summaries(rows: Row[], ctx: ModuleContext, auth: AuthContext): Promise<RecordSummary[]> {
  const access = await requestAccess(
    ctx.db,
    rows.map((r) => r.sub),
    auth,
  );
  const locale = auth.user?.locale ?? 'en';
  return rows.flatMap(({ sub, formName, requester }) => {
    const a = access.get(sub.id);
    if (!a?.view) return [];
    const reference = formatRequestNumber(sub.number);
    const form = localize(formName, locale);
    return [
      {
        id: sub.id,
        reference,
        title: requester ? `${form} — ${requester}` : form,
        subtitle: null,
        status: { key: `workflows.status.request.${sub.status}`, tone: STATUS_TONE[sub.status] ?? 'neutral' },
        href: `/requests/${reference}`,
        editable: a.edit,
      },
    ];
  });
}

function base(ctx: ModuleContext) {
  return ctx.db
    .select(columns)
    .from(formSubmissions)
    .innerJoin(forms, eq(forms.id, formSubmissions.formId))
    .leftJoin(users, eq(users.id, formSubmissions.submittedBy));
}

/** `REQ-01042`, `req 1042`, `01042` → 1042. */
function requestNumber(term: string): number | null {
  const m = /^(?:req[-\s]?)?0*(\d{1,12})$/i.exec(term.trim());
  return m ? Number(m[1]) : null;
}

export const requestRecords: RecordResolver = {
  async resolve(ids, ctx, auth) {
    const valid = validIds(ids);
    if (!valid.length) return [];
    const rows = await base(ctx).where(inArray(formSubmissions.id, valid));
    return summaries(rows, ctx, auth);
  },

  async search(query, ctx, auth, limit) {
    const term = query.trim();
    const number = term ? requestNumber(term) : null;
    const like = term ? likePattern(term) : null;
    const rows = await base(ctx)
      .where(
        and(
          visibleRequestsWhere(auth, {
            submittedBy: formSubmissions.submittedBy,
            instanceId: formSubmissions.workflowInstanceId,
          }),
          number !== null
            ? eq(formSubmissions.number, number)
            : like
              ? or(
                  ilike(forms.key, like),
                  sql`${forms.name}->>'en' ilike ${like}`,
                  sql`${forms.name}->>'zh-TW' ilike ${like}`,
                  sql`${forms.name}->>'ja-JP' ilike ${like}`,
                  ilike(users.displayName, like),
                )
              : undefined,
        ),
      )
      .orderBy(desc(formSubmissions.createdAt))
      .limit(limit);
    return summaries(rows, ctx, auth);
  },

  /** Approval facts by id — not permission-filtered (they route approvals; never returned to people). */
  async facts(ids, ctx) {
    const valid = validIds(ids);
    if (!valid.length) return new Map();
    const rows = await ctx.db
      .select({
        id: formSubmissions.id,
        formKey: forms.key,
        status: formSubmissions.status,
        requesterId: formSubmissions.submittedBy,
        departmentCode: departments.code,
      })
      .from(formSubmissions)
      .innerJoin(forms, eq(forms.id, formSubmissions.formId))
      .leftJoin(users, eq(users.id, formSubmissions.submittedBy))
      .leftJoin(departments, eq(departments.id, users.departmentId))
      .where(inArray(formSubmissions.id, valid));
    return new Map(
      rows.map(({ id, ...f }): [string, RequestFacts] => [
        id,
        {
          formKey: f.formKey,
          status: f.status,
          requesterId: f.requesterId,
          departmentCode: f.departmentCode,
        },
      ]),
    );
  },
};
