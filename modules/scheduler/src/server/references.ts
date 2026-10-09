import { GROUP_JSONPATH, groupPathVars, type ReferenceFinder } from '@isbp/sdk/server';
import { and, eq, sql } from 'drizzle-orm';
import { jobHref } from '../model';
import { jobs } from './schema';

/**
 * Enabled jobs whose settings name the group (e.g. "Assign a form" to it), by id or by key: the next run would fail.
 * Owning a job doesn't count: the owner is cleared with the group.
 */
const groupReferences: ReferenceFinder = async (t, _ctx, { tx, limit }) => {
  const rows = await tx
    .select({ id: jobs.id, name: jobs.name })
    .from(jobs)
    .where(
      and(
        eq(jobs.enabled, true),
        sql`jsonb_path_match(${jobs.config}, ${GROUP_JSONPATH}::jsonpath, ${groupPathVars(t)}::jsonb)`,
      ),
    )
    .limit(limit);
  return rows.map((j) => ({ kind: 'setting', label: j.name, href: jobHref(j.id) }));
};

export const references = { 'core.group': groupReferences };
