import {
  CHANGE_SET_PACKAGE_FORMAT,
  type ChangeSetPackage,
  type ChangeSetPackageItem,
  type ItemOp,
  REF_PREFIX,
} from '../contracts';
import { refsIn } from './refs';

/**
 * Change sets as files (`isbp.change-set-package`, version 1): what an export writes and the checks an import makes
 * beyond the schema. Pure, so the API, tests and package authors share them.
 */

export interface PackageIssue {
  /** `items.<index>.<field>`. */
  path: string;
  message: string;
  code: string;
}

/** An item as `POST /change-sets/:id/items` takes it, checked against its kind's operations. */
export interface ProposalProblem {
  /** The error message of the 422 (`targetId is required`). */
  summary: string;
  issue: { path: 'op' | 'targetId' | 'value'; message: string; code: string };
}

/**
 * What makes a proposal impossible before any kind looks at it: an operation the kind doesn't support, no target for
 * an update, archive or delete, no object value for a create or update.
 */
export function proposalProblems(
  item: Pick<ChangeSetPackageItem, 'kind' | 'op' | 'targetId' | 'value'>,
  operations: readonly ItemOp[],
): ProposalProblem[] {
  const out: ProposalProblem[] = [];
  if (!operations.includes(item.op))
    out.push({
      summary: `${item.kind} does not support "${item.op}"`,
      issue: { path: 'op', message: `use one of: ${operations.join(', ')}`, code: 'operation' },
    });
  if (item.op !== 'create' && !item.targetId)
    out.push({
      summary: 'targetId is required',
      issue: { path: 'targetId', message: 'required for update, archive and delete', code: 'required' },
    });
  const needsValue = item.op === 'create' || item.op === 'update';
  if (needsValue && (!item.value || typeof item.value !== 'object' || Array.isArray(item.value)))
    out.push({
      summary: 'value must be an object',
      issue: { path: 'value', message: 'the full value in the kind’s schema', code: 'required' },
    });
  return out;
}

/**
 * A package's problems beyond its schema and its kinds' operations (`operationsOf` gives a kind's): names used twice,
 * references to unknown or later items, two changes to the same object, missing targets or values. Paths are
 * `items.<index>.<field>`.
 */
export function packageIssues(
  pkg: Pick<ChangeSetPackage, 'items'>,
  operationsOf: (kind: string) => readonly ItemOp[] | undefined,
): PackageIssue[] {
  const issues: PackageIssue[] = [];
  const earlier = new Set<string>();
  const targets = new Map<string, number>();
  pkg.items.forEach((item, index) => {
    const at = (field: string) => `items.${index}${field ? `.${field}` : ''}`;
    const operations = operationsOf(item.kind);
    if (operations)
      for (const p of proposalProblems(item, operations))
        issues.push({
          path: at(p.issue.path),
          message: p.issue.path === 'op' ? p.summary : p.issue.message,
          code: p.issue.code,
        });
    const targetId = item.op === 'create' ? null : (item.targetId ?? null);
    for (const r of refsIn(item.value))
      if (!earlier.has(r))
        issues.push({
          path: at('value'),
          message: `"${REF_PREFIX}${r}" must name an earlier item of this package`,
          code: 'unknown_ref',
        });
    for (const r of refsIn(targetId))
      if (!earlier.has(r))
        issues.push({
          path: at('targetId'),
          message: `"${REF_PREFIX}${r}" must name an earlier item of this package`,
          code: 'unknown_ref',
        });
    if (targetId) {
      const key = `${item.kind}\u0000${targetId}`;
      const first = targets.get(key);
      if (first !== undefined)
        issues.push({
          path: at('targetId'),
          message: `item ${first} already changes this ${item.kind}: merge the two changes`,
          code: 'duplicate_target',
        });
      else targets.set(key, index);
    }
    if (item.ref) {
      if (earlier.has(item.ref))
        issues.push({
          path: at('ref'),
          message: `another item is already named "${item.ref}"`,
          code: 'duplicate_ref',
        });
      earlier.add(item.ref);
    }
  });
  return issues;
}

/** The text in every locale (a change set's title and summary are plain text in whoever wrote them's language). */
const everyLocale = (text: string) => ({ en: text, 'zh-TW': text, 'ja-JP': text });

/**
 * The package of a change set: its items in position order with their names (`ref`) and `"$ref:<name>"` references
 * as proposed, the title and summary as text in every locale. Targets of updates, archives and deletes are ids in
 * this environment.
 */
export function packageOf(
  changeSet: { title: string; summary: string; reference: string },
  items: readonly {
    position: number;
    ref: string | null;
    kind: string;
    op: ItemOp;
    targetId: string | null;
    label: string;
    value: unknown;
    note: string | null;
  }[],
): ChangeSetPackage {
  const title = changeSet.title.trim() || changeSet.reference;
  return {
    format: CHANGE_SET_PACKAGE_FORMAT,
    version: 1,
    title: everyLocale(title.slice(0, 200)),
    ...(changeSet.summary.trim() ? { summary: everyLocale(changeSet.summary.trim().slice(0, 4000)) } : {}),
    items: [...items]
      .sort((a, b) => a.position - b.position)
      .map((i) => ({
        ...(i.ref ? { ref: i.ref } : {}),
        kind: i.kind,
        op: i.op,
        ...(i.op !== 'create' && i.targetId ? { targetId: i.targetId } : {}),
        ...(i.label ? { label: i.label.slice(0, 200) } : {}),
        ...((i.op === 'create' || i.op === 'update') && i.value !== null && i.value !== undefined
          ? { value: i.value }
          : {}),
        ...(i.note ? { note: i.note.slice(0, 2000) } : {}),
      })),
  };
}
