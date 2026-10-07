/**
 * Jobs as linkable records (`scheduler.job`) for the platform's record registry — the "Linked records" and
 * attachment panels and pickers in other modules (e.g. link the job that loads a warehouse to the
 * application it feeds). Every job is visible with `scheduler.jobs.read`; `editable` follows ownership.
 */
import {
  type AuthContext,
  likePattern,
  type ModuleContext,
  type RecordResolver,
  type RecordSummary,
  type SearchHit,
  type StatusTone,
} from '@isbp/sdk/server';
import { desc, ilike, inArray, or, sql } from 'drizzle-orm';
import { jobHref, jobReference, type RunStatus } from '../model';
import { groupsOf, READ, viewerOf } from './access';
import type { JobRow } from './engine';
import { jobs } from './schema';
import { services } from './services';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const TONE: Record<RunStatus, StatusTone> = {
  queued: 'info',
  running: 'info',
  retrying: 'warning',
  succeeded: 'success',
  failed: 'danger',
  timed_out: 'danger',
  cancelled: 'neutral',
  skipped: 'neutral',
};

function condition(term: string) {
  const p = likePattern(term);
  const m = /^JOB-?0*(\d+)$/i.exec(term);
  return or(
    ilike(jobs.name, p),
    ilike(jobs.description, p),
    m ? sql`${jobs.number} = ${Number(m[1])}` : undefined,
  );
}

async function summaries(rows: JobRow[], ctx: ModuleContext, auth: AuthContext): Promise<RecordSummary[]> {
  const groups = await groupsOf(ctx.db, auth);
  const last = await services(ctx).jobs.lastRuns(rows.map((r) => r.id));
  return rows.map((j) => {
    const status = last.get(j.id)?.status;
    return {
      id: j.id,
      reference: jobReference(j.number),
      title: j.name,
      subtitle: j.enabled ? j.type : null,
      status: !j.enabled
        ? { key: 'scheduler.jobs.disabled', tone: 'neutral' as const }
        : status
          ? { key: `scheduler.runStatus.${status}`, tone: TONE[status] }
          : null,
      href: jobHref(j.id),
      editable: viewerOf(auth, j, groups).canEdit,
    };
  });
}

const job: RecordResolver = {
  async resolve(ids, ctx, auth) {
    const valid = [...new Set(ids.filter((id) => UUID_RE.test(id)))];
    if (!valid.length || !auth.can(READ)) return [];
    const rows = await ctx.db.select().from(jobs).where(inArray(jobs.id, valid));
    return summaries(rows, ctx, auth);
  },
  async search(query, ctx, auth, limit) {
    if (!auth.can(READ)) return [];
    const q = query.trim();
    const rows = await ctx.db
      .select()
      .from(jobs)
      .where(q ? condition(q) : undefined)
      .orderBy(q ? sql`lower(${jobs.name}) = lower(${q}) desc` : desc(jobs.updatedAt), jobs.name)
      .limit(limit);
    return summaries(rows, ctx, auth);
  },
};

export const records = { job };

/** Command palette: jobs by name or `JOB-00042`. */
export async function search(
  query: string,
  ctx: ModuleContext,
  auth: AuthContext,
  limit: number,
): Promise<SearchHit[]> {
  if (!auth.can(READ)) return [];
  const q = query.trim();
  if (!q) return [];
  const rows = await ctx.db
    .select({ id: jobs.id, name: jobs.name, number: jobs.number, type: jobs.type })
    .from(jobs)
    .where(condition(q))
    .orderBy(sql`lower(${jobs.name}) = lower(${q}) desc`, jobs.name)
    .limit(limit);
  return rows.map((r) => ({
    id: r.id,
    type: 'job',
    title: r.name,
    subtitle: jobReference(r.number),
    href: jobHref(r.id),
    icon: 'calendar-clock',
  }));
}
