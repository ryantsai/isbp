import { formatRequestNumber } from '@isbp/contracts';
import {
  formAssignments,
  forms,
  formSubmissions,
  formVersions,
  processActionRuns,
  workflowDefinitions,
  workflowInstances,
  workflowVersions,
} from '@isbp/db/schema';
import {
  type Db,
  GROUP_JSONPATH,
  groupPathVars,
  type LocalizedText,
  type Reference,
  type ReferenceFinder,
  type ReferenceTarget,
} from '@isbp/sdk/server';
import { and, desc, eq, inArray, isNotNull, isNull, or, type SQL, sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

/** Whether a JSON document (a form version, an approval graph) names the group (`GROUP_JSONPATH`). */
const namesGroup = (doc: AnyPgColumn, t: ReferenceTarget) =>
  sql`jsonb_path_match(${doc}, ${GROUP_JSONPATH}::jsonpath, ${groupPathVars(t)}::jsonb)`;

/** Whether a JSON document holds the record's `type:id` (record fields, table columns, action settings). */
const namesRecord = (doc: AnyPgColumn, t: ReferenceTarget) =>
  sql`jsonb_path_exists(${doc}, ${'$.** ? (@ == $ref)'}::jsonpath, ${JSON.stringify({ ref: `${t.type}:${t.id}` })}::jsonb)`;

/** A request still in approval, or with process actions queued or running. */
const openRequest = or(
  eq(formSubmissions.status, 'pending'),
  sql`exists (select 1 from ${processActionRuns} where ${processActionRuns.submissionId} = ${formSubmissions.id} and ${inArray(processActionRuns.status, ['queued', 'running'])})`,
);

/** "REQ-01039 · New laptop" in every language the form's name has. */
const requestLabel = (n: number, name: LocalizedText): LocalizedText =>
  Object.fromEntries(
    Object.entries(name).map(([locale, text]) => [locale, `${formatRequestNumber(n)} · ${text}`]),
  ) as LocalizedText;

async function openRequests(tx: Db, where: SQL, limit: number): Promise<Reference[]> {
  const rows = await tx
    .select({ number: formSubmissions.number, name: forms.name })
    .from(formSubmissions)
    .innerJoin(forms, eq(forms.id, formSubmissions.formId))
    .innerJoin(
      formVersions,
      and(eq(formVersions.formId, formSubmissions.formId), eq(formVersions.version, formSubmissions.version)),
    )
    .where(and(openRequest, where))
    .orderBy(desc(formSubmissions.createdAt))
    .limit(limit);
  return rows.map((r) => ({
    kind: 'request',
    label: requestLabel(r.number, r.name),
    href: `/requests/${formatRequestNumber(r.number)}`,
  }));
}

/** Published forms whose current version names it: the next request would fail. */
async function liveForms(tx: Db, where: (doc: AnyPgColumn) => SQL, limit: number): Promise<Reference[]> {
  const rows = await tx
    .select({ id: forms.id, name: forms.name })
    .from(forms)
    .innerJoin(
      formVersions,
      and(eq(formVersions.formId, forms.id), eq(formVersions.version, forms.publishedVersion)),
    )
    .where(and(isNull(forms.archivedAt), isNotNull(forms.publishedVersion), where(formVersions.schema)))
    .limit(limit);
  return rows.map((r) => ({ kind: 'setting', label: r.name, href: `/admin/forms/${r.id}` }));
}

/**
 * What the core still uses a group for: requests whose form version acts on it, approvals in progress whose process
 * names it, open to-dos assigned to it, and published forms and approval processes. (Roles given to the group go with
 * it; module records owning it are cleared by their foreign keys; scheduled reminders find their recipients when they
 * are sent, and nobody could cancel one to make way.)
 */
export const groupReferences: ReferenceFinder = async (t, _ctx, { tx, limit }) => {
  const out: Reference[] = [];
  const add = (refs: Reference[]) => out.push(...refs.slice(0, limit - out.length));

  add(await openRequests(tx, namesGroup(formVersions.schema, t), limit));
  if (out.length >= limit) return out;

  const approvals = await tx
    .select({ label: workflowInstances.subjectLabel, href: workflowInstances.subjectHref })
    .from(workflowInstances)
    .innerJoin(
      workflowVersions,
      and(
        eq(workflowVersions.definitionId, workflowInstances.definitionId),
        eq(workflowVersions.version, workflowInstances.version),
      ),
    )
    .where(and(eq(workflowInstances.status, 'running'), namesGroup(workflowVersions.graph, t)))
    .orderBy(desc(workflowInstances.startedAt))
    .limit(limit);
  add(approvals.map((a) => ({ kind: 'approval', label: a.label, href: a.href })));
  if (out.length >= limit) return out;

  // To-dos of an archived form wait unseen (they come back if it is restored): they don't hold the group.
  const todos = await tx
    .select({ title: formAssignments.title, formId: formAssignments.formId })
    .from(formAssignments)
    .innerJoin(forms, eq(forms.id, formAssignments.formId))
    .where(
      and(
        eq(formAssignments.assigneeGroupId, t.id),
        eq(formAssignments.status, 'open'),
        isNull(forms.archivedAt),
      ),
    )
    .orderBy(formAssignments.dueAt)
    .limit(limit);
  add(todos.map((a) => ({ kind: 'todo', label: a.title, href: `/admin/forms/${a.formId}?tab=assignments` })));
  if (out.length >= limit) return out;

  add(await liveForms(tx, (doc) => namesGroup(doc, t), limit));
  if (out.length >= limit) return out;

  const processes = await tx
    .select({ id: workflowDefinitions.id, name: workflowDefinitions.name })
    .from(workflowDefinitions)
    .innerJoin(
      workflowVersions,
      and(
        eq(workflowVersions.definitionId, workflowDefinitions.id),
        eq(workflowVersions.version, workflowDefinitions.publishedVersion),
      ),
    )
    .where(and(isNull(workflowDefinitions.archivedAt), namesGroup(workflowVersions.graph, t)))
    .limit(limit);
  add(processes.map((p) => ({ kind: 'setting', label: p.name, href: `/admin/workflows/${p.id}` })));
  return out;
};

/** Requests in progress whose answers name the record, and published forms whose settings do. */
export const recordReferences: ReferenceFinder = async (t, _ctx, { tx, limit }) => {
  const requests = await openRequests(tx, namesRecord(formSubmissions.data, t), limit);
  if (requests.length >= limit) return requests;
  return [...requests, ...(await liveForms(tx, (doc) => namesRecord(doc, t), limit - requests.length))];
};
