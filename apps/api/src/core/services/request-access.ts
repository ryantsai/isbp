import { approvalTasks } from '@isbp/db/schema';
import type { AuthContext, Db } from '@isbp/sdk/server';
import { type AnyColumn, and, eq, inArray, or, sql } from 'drizzle-orm';

/** What decides who sees a request (a form submission): its requester, status and approval. */
export interface RequestAccessSubject {
  id: string;
  submittedBy: string | null;
  status: string;
  workflowInstanceId: string | null;
}

export interface RequestAccess {
  /** May open the request (its page, the API, the `core.request` record). */
  view: boolean;
  /** May change its links and attachments (evidence). */
  edit: boolean;
}

const NONE: RequestAccess = { view: false, edit: false };

/** Holds every request: form administrators (and, read-only, workflow readers). */
function adminAccess(auth: AuthContext): RequestAccess | null {
  if (auth.can('core.forms.manage')) return { view: true, edit: true };
  if (auth.can('core.workflows.read')) return { view: true, edit: false };
  return null;
}

/**
 * Who may see and change requests — the one rule behind the request page, `/requests/:reference` and the
 * `core.request` record resolver (R17):
 * - the requester sees it, and adds links and evidence until it is withdrawn;
 * - approvers of its workflow (anyone who was asked, also through delegation) see it and add evidence until it is
 *   withdrawn — the "filled in by IT" part of a process often comes with a file;
 * - form administrators (`core.forms.manage`) see and change every request; workflow readers
 *   (`core.workflows.read`) see them.
 */
export async function requestAccess(
  db: Db,
  subjects: readonly RequestAccessSubject[],
  auth: AuthContext,
): Promise<Map<string, RequestAccess>> {
  const out = new Map<string, RequestAccess>();
  const admin = adminAccess(auth);
  const me = auth.user?.id ?? null;
  const instances = me
    ? [...new Set(subjects.map((s) => s.workflowInstanceId).filter((x): x is string => Boolean(x)))]
    : [];
  const asked =
    admin?.edit || !instances.length
      ? new Set<string>()
      : new Set(
          (
            await db
              .selectDistinct({ id: approvalTasks.instanceId })
              .from(approvalTasks)
              .where(
                and(
                  inArray(approvalTasks.instanceId, instances),
                  or(eq(approvalTasks.assigneeId, me!), eq(approvalTasks.delegatedFromId, me!)),
                ),
              )
          ).map((r) => r.id),
        );
  for (const s of subjects) {
    const open = s.status !== 'cancelled';
    const mine = Boolean(me && s.submittedBy === me);
    const approver = Boolean(s.workflowInstanceId && asked.has(s.workflowInstanceId));
    const view = Boolean(admin?.view) || mine || approver;
    const edit = Boolean(admin?.edit) || ((mine || approver) && open);
    out.set(s.id, view ? { view, edit } : NONE);
  }
  return out;
}

/** One request's access (see {@link requestAccess}). */
export async function accessOf(db: Db, subject: RequestAccessSubject, auth: AuthContext) {
  return (await requestAccess(db, [subject], auth)).get(subject.id) ?? NONE;
}

/**
 * SQL filter for lists and search: the requests `auth` may see (nothing to add for administrators and workflow
 * readers). `submittedBy` and `instanceId` are the submission's columns.
 */
export function visibleRequestsWhere(
  auth: AuthContext,
  columns: { submittedBy: AnyColumn; instanceId: AnyColumn },
) {
  if (adminAccess(auth)) return undefined;
  const me = auth.user?.id;
  if (!me) return sql`false`;
  return sql`(${columns.submittedBy} = ${me} or exists (select 1 from ${approvalTasks} t where t.instance_id = ${columns.instanceId} and (t.assignee_id = ${me} or t.delegated_from_id = ${me})))`;
}
