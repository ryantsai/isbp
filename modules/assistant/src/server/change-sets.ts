import { applications, rolePermissions, roles, users } from '@isbp/db/schema';
import {
  type AuthContext,
  type BuiltTemplateItem,
  type CustomizationKindInfo,
  type Db,
  ErrorCodes,
  HttpError,
  httpErrors,
  likePattern,
  localize,
  matchPermission,
  type ModuleContext,
  type Page,
  type VersionedObject,
  type WorkflowCompletion,
} from '@isbp/sdk/server';
import { and, asc, count, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import {
  type ChangeSetDetail,
  type ChangeSetItem,
  type ChangeSetPackage,
  type ChangeSetQuery,
  type ChangeSetSummary,
  changeSetHref,
  changeSetReference,
  type CheckResult,
  DESTRUCTIVE_OPS,
  MAX_PACKAGE_ITEMS,
  type ObjectSnapshot,
  type PermissionRole,
  type ProposeItemInput,
  REF_PREFIX,
} from '../contracts';
import { type AppliedLink, appliedLinks } from '../lib/links';
import { type PackageIssue, packageIssues, packageOf, proposalProblems } from '../lib/packages';
import { dependentsOf } from '../lib/processes';
import { labelOf, refsIn, renameRefs, resolveRefs, uniqueRef } from '../lib/refs';
import {
  type ChangeSetItemRow,
  changeSetItems,
  type ChangeSetRow,
  changeSets,
  conversations,
  type LastError,
} from './schema';
import { linkLines, text } from './text';
import { appendTurns } from './turns';

export const REVIEW_TRIGGER = 'assistant.change-set';
/** As many as a package may hold, so every package fits one change set. */
export const MAX_ITEMS = MAX_PACKAGE_ITEMS;

/** The platform's own application (its roles are the ones messages name). */
const PLATFORM_APP = 'isbp';
const READ_ALL = 'assistant.change-sets.read';
const MANAGE = 'assistant.change-sets.manage';

/** Thrown to roll back a dry run's transaction. */
class DryRunRollback extends Error {}

type Creator = { type: 'user' | 'service'; id: string | null; name: string };

/** Where an imported change set came from (audited with its creation). */
export type PackageSource = { type: 'file' } | { type: 'package'; moduleId: string; key: string };

function creatorOf(auth: AuthContext): Creator {
  if (auth.user) return { type: 'user', id: auth.user.id, name: auth.user.displayName };
  return {
    type: 'service',
    id: auth.client?.id ?? auth.principal.id,
    name: auth.client?.name ?? auth.principal.name,
  };
}

const snapshot = (o: VersionedObject | null): ObjectSnapshot | null =>
  o
    ? {
        id: o.id,
        label: o.label,
        archived: !!o.archived,
        href: o.href ?? null,
        ...(o.links?.length ? { links: o.links } : {}),
        version: o.version,
        value: o.value,
      }
    : null;

const OK: CheckResult = {
  ok: true,
  needsApprover: false,
  code: null,
  message: null,
  issues: [],
  permission: null,
};

/** A JSON column's value as a statement parameter (null is SQL NULL, as the ORM writes it). */
const jsonParam = (value: unknown) =>
  value === null || value === undefined ? sql`null::jsonb` : sql`${JSON.stringify(value)}::jsonb`;

/**
 * The dry-run results of a set's items, stored in one statement: one update per item made a dry run of N items N round
 * trips. `updated_at` is set as the ORM sets it on every update.
 */
async function writeChecks(tx: Db, checks: ReadonlyMap<string, CheckResult>) {
  if (!checks.size) return;
  const rows = [...checks].map(([id, check]) => sql`(${id}::uuid, ${jsonParam(check)})`);
  await tx.execute(sql`
    update "assistant"."change_set_items" as i
    set "check" = v."check", "updated_at" = ${new Date()}
    from (values ${sql.join(rows, sql`, `)}) as v("id", "check")
    where i."id" = v."id"
  `);
}

/** What applying an item left on it: the object it made or changed, and the snapshots before and after. */
interface AppliedItem {
  id: string;
  appliedId: string;
  before: ObjectSnapshot | null;
  after: ObjectSnapshot | null;
}

/** The applied items' results, stored in one statement (see {@link writeChecks}); each passed its check. */
async function writeApplied(tx: Db, applied: readonly AppliedItem[]) {
  if (!applied.length) return;
  const rows = applied.map(
    (a) => sql`(${a.id}::uuid, ${a.appliedId}, ${jsonParam(a.before)}, ${jsonParam(a.after)})`,
  );
  await tx.execute(sql`
    update "assistant"."change_set_items" as i
    set "applied_id" = v."applied_id", "before" = v."before", "after" = v."after",
        "check" = ${jsonParam(OK)}, "updated_at" = ${new Date()}
    from (values ${sql.join(rows, sql`, `)}) as v("id", "applied_id", "before", "after")
    where i."id" = v."id"
  `);
}

/** An object a change set made or changed, for the kind that owns it to refresh what it caches after commit. */
interface CommittedChange {
  kind: string;
  op: ChangeSetItemRow['op'];
  id: string;
}

/** Each item's object (what it made, or the object it changed), except references to objects of the set itself. */
function changedObjects(
  items: readonly Pick<ChangeSetItemRow, 'kind' | 'op' | 'appliedId' | 'targetId'>[],
): CommittedChange[] {
  return items.flatMap((i) => {
    const target = i.appliedId ?? i.targetId;
    return target && !target.startsWith('$ref:') ? [{ kind: i.kind, op: i.op, id: target }] : [];
  });
}

/**
 * Postgres errors of two transactions meeting rather than of the change itself: a lock not available in time, a
 * serialization failure, a deadlock, a statement cancelled by its timeout while waiting.
 */
const BUSY_PG_CODES = new Set(['55P03', '40001', '40P01', '57014']);
const UNIQUE_VIOLATION = '23505';
/** How long a dry run, apply or rollback waits for another one touching the same kinds of configuration. */
const LOCK_WAIT = '60s';

/** The SQLSTATE of a database error (drivers and ORMs wrap it in `cause`), or null. */
function pgCodeOf(err: unknown): string | null {
  let e: unknown = err;
  for (let depth = 0; depth < 4 && e && typeof e === 'object'; depth++) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) return code;
    e = (e as { cause?: unknown }).cause;
  }
  return null;
}

/**
 * An error a person can act on, or null when it is an unexpected one (shown as INTERNAL, never with its internals):
 * the kind's own refusal as it is, "another change set is busy" for concurrency, "already exists" for a unique key.
 */
export function readableError(err: unknown): HttpError | null {
  if (err instanceof HttpError) return err;
  const code = pgCodeOf(err);
  if (code && BUSY_PG_CODES.has(code))
    return new HttpError(
      409,
      ErrorCodes.CHANGE_SET_BUSY,
      'Another change set is being applied or tried right now. Try again in a moment.',
    );
  if (code === UNIQUE_VIOLATION)
    return new HttpError(409, ErrorCodes.CONFLICT, 'Something with the same name or key already exists');
  return null;
}

/** A dry-run or apply error as an item's check result. */
export function checkFromError(error: unknown): CheckResult {
  const err = readableError(error) ?? error;
  if (err instanceof HttpError) {
    const d = (err.details ?? {}) as { issues?: CheckResult['issues']; permission?: string };
    const permissionDenied = err.statusCode === 403 || err.code === ErrorCodes.PRIVILEGE_ESCALATION;
    return {
      ok: false,
      needsApprover: permissionDenied,
      code: String(err.code),
      message: err.message,
      issues: Array.isArray(d.issues) ? d.issues.slice(0, 50) : [],
      permission: typeof d.permission === 'string' ? d.permission : null,
    };
  }
  return {
    ok: false,
    needsApprover: false,
    code: ErrorCodes.INTERNAL,
    message: 'Unexpected error',
    issues: [],
    permission: null,
  };
}

/** How a rollback undoes an applied item, or null when it can't. */
function inverseOf(
  item: ChangeSetItemRow,
  kind: CustomizationKindInfo | undefined,
): { op: 'delete' | 'archive' | 'update' | 'restore'; value: unknown } | null {
  if (!kind) return null;
  switch (item.op) {
    case 'create':
      if (kind.operations.includes('delete')) return { op: 'delete', value: null };
      if (kind.operations.includes('archive')) return { op: 'archive', value: null };
      return null;
    case 'update':
      return item.before ? { op: 'update', value: item.before.value } : null;
    case 'archive':
      return { op: 'restore', value: null };
    case 'delete':
      return null;
  }
}

/**
 * Change sets: drafts of configuration changes built from proposals (people, templates, agents), dry-run after every
 * edit, applied in one transaction by a person, reviewed through the `assistant.change-set` workflow, rolled back
 * in one transaction. Design: docs/architecture.md §13.2.
 */
export class ChangeSetService {
  constructor(private readonly ctx: ModuleContext) {}

  /* ───────────── loading and visibility ───────────── */

  private isCreator(row: ChangeSetRow, auth: AuthContext): boolean {
    const me = creatorOf(auth);
    return !!me.id && row.createdById === me.id && row.createdByType === me.type;
  }

  private async visible(row: ChangeSetRow, auth: AuthContext): Promise<boolean> {
    if (this.isCreator(row, auth) || auth.can(READ_ALL)) return true;
    return !!(
      row.workflowInstanceId &&
      auth.user &&
      (await this.ctx.workflows.isApprover(row.workflowInstanceId, auth.user.id))
    );
  }

  /** The change set if the caller may see it; 404 otherwise (never 403). */
  async load(id: string, auth: AuthContext, db: Db = this.ctx.db): Promise<ChangeSetRow> {
    const [row] = await db.select().from(changeSets).where(eq(changeSets.id, id));
    if (!row || !(await this.visible(row, auth))) throw httpErrors.notFound('Change set not found');
    return row;
  }

  private canEdit(row: ChangeSetRow, auth: AuthContext) {
    return row.status === 'draft' && (this.isCreator(row, auth) || auth.can(MANAGE));
  }

  private async editable(id: string, auth: AuthContext): Promise<ChangeSetRow> {
    const row = await this.load(id, auth);
    if (!this.isCreator(row, auth) && !auth.can(MANAGE)) throw httpErrors.forbidden();
    if (row.status !== 'draft')
      throw new HttpError(409, ErrorCodes.INVALID_STATE, `The change set is ${row.status}`, {
        status: row.status,
      });
    return row;
  }

  async itemsOf(id: string, db: Db = this.ctx.db): Promise<ChangeSetItemRow[]> {
    return db
      .select()
      .from(changeSetItems)
      .where(eq(changeSetItems.changeSetId, id))
      .orderBy(asc(changeSetItems.position));
  }

  private kindsFor(auth: AuthContext): Map<string, CustomizationKindInfo> {
    return new Map(this.ctx.customizations.kinds(auth).map((k) => [k.kind, k]));
  }

  /* ───────────── creating and editing ───────────── */

  async create(
    input: { title?: string; summary?: string; conversationId?: string | null },
    auth: AuthContext,
  ): Promise<ChangeSetRow> {
    const creator = creatorOf(auth);
    return this.ctx.transaction(async (tx) => {
      const [row] = await tx
        .insert(changeSets)
        .values({
          title: input.title ?? '',
          summary: input.summary ?? '',
          createdByType: creator.type,
          createdById: creator.id,
          createdByName: creator.name.slice(0, 200),
          conversationId: input.conversationId ?? null,
        })
        .returning();
      const reference = changeSetReference(row!.number);
      await this.ctx.audit.record(
        {
          action: 'assistant.change-set.created',
          entityType: 'assistant.change-set',
          entityId: row!.id,
          entityLabel: reference,
        },
        { tx },
      );
      await this.ctx.events.publish(
        'assistant.change-set.created',
        { changeSetId: row!.id, reference, title: row!.title, kinds: [] },
        { tx },
      );
      return row!;
    });
  }

  async update(id: string, input: { title?: string; summary?: string }, auth: AuthContext) {
    await this.editable(id, auth);
    await this.ctx.db
      .update(changeSets)
      .set({
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.summary !== undefined ? { summary: input.summary } : {}),
      })
      .where(eq(changeSets.id, id));
    return this.detail(id, auth);
  }

  /**
   * Adds an item (or replaces the one with the same `ref`, or the earlier change to the same object), then dry-runs
   * the whole set. Proposing needs the kind's read permission; the target's version is remembered.
   */
  async propose(
    changeSetId: string | null,
    input: ProposeItemInput,
    auth: AuthContext,
  ): Promise<{ changeSet: ChangeSetRow; item: ChangeSetItemRow }> {
    const { row, item } = await this.stage(changeSetId, input, auth);
    await this.dryRun(row.id, auth);
    const [fresh] = await this.ctx.db.select().from(changeSets).where(eq(changeSets.id, row.id));
    const [freshItem] = await this.ctx.db.select().from(changeSetItems).where(eq(changeSetItems.id, item.id));
    return { changeSet: fresh!, item: freshItem! };
  }

  /**
   * Writes one item into the set (a new change set when none is given), without dry-running the set: {@link propose}
   * does that after it, and a template checks its set once after all its items. Returns the set and the saved item.
   */
  private async stage(
    changeSetId: string | null,
    input: ProposeItemInput,
    auth: AuthContext,
  ): Promise<{ row: ChangeSetRow; item: ChangeSetItemRow }> {
    const kind = this.kindsFor(auth).get(input.kind);
    if (!kind)
      throw new HttpError(404, ErrorCodes.NOT_FOUND, `Unknown or unavailable kind ${input.kind}`, {
        kind: input.kind,
      });
    const [problem] = proposalProblems(input, kind.operations);
    if (problem)
      throw new HttpError(422, ErrorCodes.VALIDATION_FAILED, problem.summary, { issues: [problem.issue] });
    const creating = input.op === 'create';
    const targetId = creating ? null : (input.targetId ?? null);
    const needsValue = input.op === 'create' || input.op === 'update';

    // A target may itself be a reference to an object created earlier in the set: no version then.
    const current =
      targetId && !targetId.startsWith('$ref:')
        ? await this.ctx.customizations.get(input.kind, targetId, auth)
        : null;
    if (targetId && !targetId.startsWith('$ref:') && !current)
      throw new HttpError(404, ErrorCodes.NOT_FOUND, `${input.kind} ${targetId} was not found`, {
        kind: input.kind,
        id: targetId,
      });

    const row = changeSetId ? await this.editable(changeSetId, auth) : await this.create({ title: '' }, auth);
    const label =
      input.label?.trim() ||
      labelOf(input.value) ||
      current?.label ||
      `${input.kind} ${targetId ?? ''}`.trim();

    const item = await this.ctx.transaction(async (tx) => {
      await tx.select({ id: changeSets.id }).from(changeSets).where(eq(changeSets.id, row.id)).for('update');
      const items = await this.itemsOf(row.id, tx);
      const replaced =
        (input.ref ? items.find((i) => i.ref === input.ref) : undefined) ??
        (targetId ? items.find((i) => i.kind === input.kind && i.targetId === targetId) : undefined);
      // A reference must point at an earlier item.
      const position = replaced ? replaced.position : (items.at(-1)?.position ?? -1) + 1;
      const earlier = new Set(items.filter((i) => i.position < position && i.ref).map((i) => i.ref!));
      const unknown = [...refsIn(input.value), ...refsIn(targetId)].filter((r) => !earlier.has(r));
      if (unknown.length)
        throw new HttpError(422, ErrorCodes.VALIDATION_FAILED, 'Unknown reference', {
          issues: unknown.map((r) => ({
            path: 'value',
            message: `"$ref:${r}" must name an earlier item of this change set`,
            code: 'unknown_ref',
          })),
        });
      if (!replaced && items.length >= MAX_ITEMS)
        throw new HttpError(
          422,
          ErrorCodes.VALIDATION_FAILED,
          `A change set holds at most ${MAX_ITEMS} items`,
        );
      if (input.ref && replaced && replaced.ref !== input.ref && items.some((i) => i.ref === input.ref))
        throw new HttpError(409, ErrorCodes.CONFLICT, `Another item is already named ${input.ref}`);
      const values = {
        ref: input.ref ?? replaced?.ref ?? null,
        kind: input.kind,
        op: input.op,
        targetId,
        label: label.slice(0, 200),
        value: needsValue ? input.value : null,
        note: input.note ?? null,
        baseVersion: current?.version ?? null,
        check: null,
      };
      const [saved] = replaced
        ? await tx.update(changeSetItems).set(values).where(eq(changeSetItems.id, replaced.id)).returning()
        : await tx
            .insert(changeSetItems)
            .values({ ...values, changeSetId: row.id, position })
            .returning();
      if (!row.title)
        await tx
          .update(changeSets)
          .set({ title: saved!.label.slice(0, 200) })
          .where(eq(changeSets.id, row.id));
      await tx.update(changeSets).set({ updatedAt: new Date() }).where(eq(changeSets.id, row.id));
      return saved!;
    });
    return { row, item };
  }

  /**
   * Proposes what a guided template built — one change, or several referring to each other (a workflow and the form
   * that uses it) — in order, into one change set (a new one unless given). Names the change set already uses are
   * renamed, references included. Every kind is checked first, so nothing is added when one can't be proposed.
   */
  async proposeTemplate(
    changeSetId: string | null,
    built: { label: string | null; items: readonly BuiltTemplateItem[] },
    auth: AuthContext,
  ): Promise<string> {
    const kinds = this.kindsFor(auth);
    for (const item of built.items) {
      const kind = kinds.get(item.kind);
      if (!kind || !kind.operations.includes(item.op))
        throw new HttpError(404, ErrorCodes.NOT_FOUND, `Unknown or unavailable kind ${item.kind}`, {
          kind: item.kind,
        });
    }
    if (changeSetId) await this.editable(changeSetId, auth);
    const taken = new Set(
      changeSetId ? (await this.itemsOf(changeSetId)).flatMap((i) => (i.ref ? [i.ref] : [])) : [],
    );
    const names = new Map<string, string>();
    for (const item of built.items)
      if (item.ref) {
        const name = uniqueRef(item.ref, taken);
        taken.add(name);
        names.set(item.ref, name);
      }
    // The changes are all written, then the set is checked once: a check after each change would only be overwritten.
    // A failure part-way still checks what was written, as proposing change by change did.
    let id = changeSetId;
    let written = false;
    try {
      for (const item of built.items) {
        const { row } = await this.stage(
          id,
          {
            kind: item.kind,
            op: item.op,
            targetId: item.id,
            label: item.label ?? undefined,
            value: renameRefs(item.value, names),
            ...(item.ref ? { ref: names.get(item.ref) } : {}),
          },
          auth,
        );
        written = true;
        id = row.id;
      }
    } catch (err) {
      if (written) await this.dryRun(id!, auth);
      throw err;
    }
    if (written) await this.dryRun(id!, auth);
    // A new change set from several changes is named after the template's own one (the form, not its workflow).
    if (!changeSetId && built.items.length > 1 && built.label)
      await this.ctx.db
        .update(changeSets)
        .set({ title: built.label.slice(0, 200) })
        .where(eq(changeSets.id, id!));
    return id!;
  }

  /**
   * A new draft change set from a package (an exported change set, a file, a module's built-in package), named after
   * it in the person's language. Every item is checked as a proposal is (`propose`): kinds the person may read and
   * their operations, targets that exist here (their versions become the base), references to earlier items. When
   * anything fails nothing is created: 400 `PACKAGE_UNSUPPORTED` (modules not enabled, unknown kinds), 403 (kinds the
   * person can't read), 422 `VALIDATION_FAILED` (`issues` at `items.<index>.<field>`). Then the set is dry-run once.
   */
  async importPackage(pkg: ChangeSetPackage, auth: AuthContext, from: PackageSource): Promise<string> {
    const needs = this.ctx.customizations.requirements(pkg, auth);
    if (needs.missingModules.length || needs.unknownKinds.length)
      throw new HttpError(
        400,
        ErrorCodes.PACKAGE_UNSUPPORTED,
        'The package needs modules or kinds this platform does not have',
        { missingModules: needs.missingModules, unknownKinds: needs.unknownKinds },
      );
    if (needs.unreadableKinds.length)
      throw new HttpError(403, ErrorCodes.FORBIDDEN, 'Proposing these changes needs more permissions', {
        permissions: [...new Set(needs.unreadableKinds.map((k) => k.permission))],
        kinds: needs.unreadableKinds.map((k) => k.kind),
      });
    const kinds = this.kindsFor(auth);
    const issues: PackageIssue[] = packageIssues(pkg, (k) => kinds.get(k)?.operations);
    // Targets are ids of this environment: each must exist (and its version is the base, as when proposing).
    const current = new Map<number, VersionedObject>();
    for (const [index, item] of pkg.items.entries()) {
      if (item.op === 'create' || !item.targetId || item.targetId.startsWith(REF_PREFIX)) continue;
      const obj = await this.ctx.customizations.get(item.kind, item.targetId, auth).catch(() => null);
      if (obj) current.set(index, obj);
      else
        issues.push({
          path: `items.${index}.targetId`,
          message: `${item.kind} ${item.targetId} was not found here`,
          code: 'not_found',
        });
    }
    if (issues.length) {
      const indexOf = (path: string) => Number(path.split('.')[1]);
      throw new HttpError(422, ErrorCodes.VALIDATION_FAILED, 'The package has problems', {
        issues: issues.sort((a, b) => indexOf(a.path) - indexOf(b.path)).slice(0, 100),
      });
    }

    const locale = auth.user?.locale ?? 'en';
    const creator = creatorOf(auth);
    const id = await this.ctx.transaction(async (tx) => {
      const [row] = await tx
        .insert(changeSets)
        .values({
          title: localize(pkg.title, locale).slice(0, 200),
          summary: localize(pkg.summary, locale).slice(0, 4000),
          createdByType: creator.type,
          createdById: creator.id,
          createdByName: creator.name.slice(0, 200),
        })
        .returning();
      await tx.insert(changeSetItems).values(
        pkg.items.map((item, position) => {
          const targetId = item.op === 'create' ? null : (item.targetId ?? null);
          const label =
            item.label?.trim() ||
            labelOf(item.value, locale) ||
            current.get(position)?.label ||
            `${item.kind} ${targetId ?? ''}`.trim();
          return {
            changeSetId: row!.id,
            position,
            ref: item.ref ?? null,
            kind: item.kind,
            op: item.op,
            targetId,
            label: label.slice(0, 200),
            value: item.op === 'create' || item.op === 'update' ? item.value : null,
            note: item.note?.trim() || null,
            baseVersion: current.get(position)?.version ?? null,
            check: null,
          };
        }),
      );
      const reference = changeSetReference(row!.number);
      const kindList = [...new Set(pkg.items.map((i) => i.kind))];
      await this.ctx.audit.record(
        {
          action: 'assistant.change-set.created',
          entityType: 'assistant.change-set',
          entityId: row!.id,
          entityLabel: reference,
          metadata: {
            from: { ...from, ...(pkg.key ? { packageKey: pkg.key } : {}) },
            items: pkg.items.length,
            kinds: kindList,
          },
        },
        { tx },
      );
      await this.ctx.events.publish(
        'assistant.change-set.created',
        { changeSetId: row!.id, reference, title: row!.title, kinds: kindList },
        { tx },
      );
      return row!.id;
    });
    await this.dryRun(id, auth);
    return id;
  }

  /** The change set as a package (`isbp.change-set-package`), for whoever may see it. */
  async exportPackage(id: string, auth: AuthContext): Promise<{ reference: string; pkg: ChangeSetPackage }> {
    const row = await this.load(id, auth);
    const reference = changeSetReference(row.number);
    const items = await this.itemsOf(id);
    if (!items.length) throw new HttpError(422, ErrorCodes.VALIDATION_FAILED, 'The change set is empty');
    return { reference, pkg: packageOf({ ...row, reference }, items) };
  }

  /**
   * Removes an item by id or `ref`. Later items referring to it fail their dry run until fixed, unless
   * `withDependents`: then they go too (by `$ref` or a key they name, transitively), so no change is left broken.
   */
  async removeItem(
    changeSetId: string,
    itemIdOrRef: string,
    auth: AuthContext,
    opts: { withDependents?: boolean } = {},
  ) {
    await this.editable(changeSetId, auth);
    const items = await this.itemsOf(changeSetId);
    const item = items.find((i) => i.id === itemIdOrRef || i.ref === itemIdOrRef);
    if (!item) throw httpErrors.notFound('Item not found');
    const ids = [item.id, ...(opts.withDependents ? dependentsOf(items, item.id).map((i) => i.id) : [])];
    await this.ctx.db
      .delete(changeSetItems)
      .where(and(eq(changeSetItems.changeSetId, changeSetId), inArray(changeSetItems.id, ids)));
    await this.dryRun(changeSetId, auth);
  }

  /** Takes the objects' current versions as the new base (after looking at what changed), then dry-runs again. */
  async refresh(id: string, auth: AuthContext) {
    await this.editable(id, auth);
    for (const item of await this.itemsOf(id)) {
      if (item.op === 'create' || !item.targetId || item.targetId.startsWith('$ref:')) continue;
      const current = await this.ctx.customizations.get(item.kind, item.targetId, auth).catch(() => null);
      await this.ctx.db
        .update(changeSetItems)
        .set({ baseVersion: current?.version ?? null })
        .where(eq(changeSetItems.id, item.id));
    }
    await this.dryRun(id, auth);
    return this.detail(id, auth);
  }

  /* ───────────── dry run ───────────── */

  /**
   * Serialises dry runs, applies and rollbacks that touch the same kinds of configuration (two installs of one
   * package create the same group keys): a transaction-scoped advisory lock per kind, taken in order at the start of
   * the transaction, so the second waits for the first instead of blocking on its uncommitted rows item by item.
   * Waiting longer than {@link LOCK_WAIT} fails with `CHANGE_SET_BUSY` (via {@link readableError}).
   */
  private async lockKinds(tx: Db, items: readonly { kind: string }[]) {
    const kinds = [...new Set(items.map((i) => i.kind))].sort();
    if (!kinds.length) return;
    const { rows } = await tx.execute<{ t: string }>(sql`select current_setting('statement_timeout') as t`);
    await tx.execute(sql`select set_config('statement_timeout', ${LOCK_WAIT}, true)`);
    for (const kind of kinds)
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext('assistant.change-set'), hashtext(${kind}))`,
      );
    await tx.execute(sql`select set_config('statement_timeout', ${rows[0]?.t ?? '30s'}, true)`);
  }

  /**
   * Runs every item in order inside one transaction that is always rolled back — each in a savepoint, so one
   * failure doesn't hide the next — as `auth` with each kind's apply permission assumed. Stores each item's result.
   */
  async dryRun(id: string, auth: AuthContext): Promise<Map<string, CheckResult>> {
    const [row] = await this.ctx.db.select().from(changeSets).where(eq(changeSets.id, id));
    if (!row) throw httpErrors.notFound('Change set not found');
    const items = await this.itemsOf(id);
    const results = new Map<string, CheckResult>();
    const source = { type: 'change-set', id, reference: changeSetReference(row.number) };
    try {
      await this.ctx.transaction(async (tx) => {
        await this.lockKinds(tx, items);
        const ids = new Map<string, string>();
        for (const item of items) {
          const value = resolveRefs(item.value, ids);
          const target = item.targetId ? resolveRefs(item.targetId, ids) : { value: null, missing: [] };
          const missing = [...value.missing, ...target.missing];
          if (missing.length) {
            results.set(item.id, {
              ...OK,
              ok: false,
              code: 'UNRESOLVED_REFERENCE',
              message: `Depends on ${missing.map((m) => `"${m}"`).join(', ')}, which did not apply`,
            });
            continue;
          }
          try {
            const applied = await tx.transaction((sp) =>
              this.ctx.customizations.apply(
                item.kind,
                { op: item.op, id: (target.value as string | null) ?? null, value: value.value },
                { auth, tx: sp as unknown as Db, source, dryRun: true },
              ),
            );
            if (item.ref) ids.set(item.ref, applied.id);
            results.set(item.id, OK);
          } catch (err) {
            if (!(err instanceof HttpError))
              this.ctx.logger.warn({ err, changeSetId: id, kind: item.kind }, 'dry run of an item failed');
            results.set(item.id, checkFromError(err));
          }
        }
        throw new DryRunRollback();
      });
    } catch (err) {
      if (!(err instanceof DryRunRollback)) {
        // Another change set held the same kinds for too long: every item says so (and can be checked again).
        const readable = readableError(err);
        if (readable?.code !== ErrorCodes.CHANGE_SET_BUSY) throw err;
        const busy = checkFromError(readable);
        for (const item of items) results.set(item.id, busy);
      }
    }
    await this.ctx.transaction(async (tx) => {
      await writeChecks(tx, results);
      await tx.update(changeSets).set({ checkedAt: new Date() }).where(eq(changeSets.id, id));
    });
    return results;
  }

  /* ───────────── applying ───────────── */

  private async fail(id: string, error: unknown, tx?: Db) {
    const err = readableError(error) ?? error;
    const lastError: LastError =
      err instanceof HttpError
        ? { code: String(err.code), message: err.message, details: err.details, at: new Date().toISOString() }
        : { code: ErrorCodes.INTERNAL, message: 'Unexpected error', at: new Date().toISOString() };
    await (tx ?? this.ctx.db).update(changeSets).set({ lastError }).where(eq(changeSets.id, id));
    return lastError;
  }

  /**
   * Applies every item in order in one transaction as `auth`, who must hold each kind's apply permission. Archives
   * and deletes need `confirm`. Base versions must still match (`CHANGE_SET_STALE`). A change set in review can be
   * applied directly by someone with the permissions: the review is then cancelled.
   */
  async apply(
    id: string,
    input: { confirm: boolean },
    auth: AuthContext,
    opts: { viaReview?: WorkflowCompletion } = {},
  ): Promise<void> {
    const row = await this.load(id, auth);
    if (row.status !== 'draft' && row.status !== 'in_review')
      throw new HttpError(409, ErrorCodes.INVALID_STATE, `The change set is ${row.status}`, {
        status: row.status,
      });
    const items = await this.itemsOf(id);
    if (!items.length) throw new HttpError(422, ErrorCodes.VALIDATION_FAILED, 'The change set is empty');
    const destructive = items.filter((i) => DESTRUCTIVE_OPS.includes(i.op));
    if (destructive.length && !input.confirm)
      throw new HttpError(409, ErrorCodes.CONFIRMATION_REQUIRED, 'Archives and deletes need confirmation', {
        items: destructive.map((i) => ({ id: i.id, kind: i.kind, op: i.op, label: i.label })),
      });
    const kinds = this.kindsFor(auth);
    const missing = [...new Set(items.map((i) => i.kind))]
      .map((k) => kinds.get(k))
      .filter((k) => !k?.canApply);
    if (missing.length)
      throw new HttpError(403, ErrorCodes.FORBIDDEN, 'Applying this change set needs more permissions', {
        permissions: missing.map((k) => k?.applyPermission ?? 'unknown'),
      });

    const reference = changeSetReference(row.number);
    const source = { type: 'change-set', id, reference };
    const applier = { id: auth.user?.id ?? null, name: auth.principal.name };
    let changes: CommittedChange[] = [];
    try {
      await this.ctx.transaction(async (tx) => {
        await this.lockKinds(tx, items);
        const [locked] = await tx.select().from(changeSets).where(eq(changeSets.id, id)).for('update');
        if (locked!.status !== row.status)
          throw new HttpError(409, ErrorCodes.INVALID_STATE, `The change set is ${locked!.status}`, {
            status: locked!.status,
          });
        const ids = new Map<string, string>();
        const applied: AppliedItem[] = [];
        for (const item of items) {
          const value = resolveRefs(item.value, ids);
          const target = item.targetId ? resolveRefs(item.targetId, ids) : { value: null, missing: [] };
          try {
            if (value.missing.length || target.missing.length)
              throw new HttpError(422, ErrorCodes.VALIDATION_FAILED, 'Unresolved reference', {
                issues: [...value.missing, ...target.missing].map((r) => ({
                  path: 'value',
                  message: `"$ref:${r}" did not resolve`,
                  code: 'unknown_ref',
                })),
              });
            const result = await this.ctx.customizations.apply(
              item.kind,
              {
                op: item.op,
                id: (target.value as string | null) ?? null,
                value: value.value,
                // Objects referenced through `$ref` were created in this transaction: nothing to compare.
                ...(item.op === 'create' || item.targetId?.startsWith('$ref:')
                  ? {}
                  : { baseVersion: item.baseVersion }),
              },
              { auth, tx, source },
            );
            if (item.ref) ids.set(item.ref, result.id);
            applied.push({
              id: item.id,
              appliedId: result.id,
              before: snapshot(result.before),
              after: snapshot(result.after),
            });
          } catch (error) {
            const err = readableError(error);
            if (err)
              throw new HttpError(err.statusCode, err.code, err.message, {
                ...(err.details as object),
                itemId: item.id,
                position: item.position,
                label: item.label,
              });
            throw error;
          }
        }
        await writeApplied(tx, applied);
        const appliedIds = new Map(applied.map((a) => [a.id, a.appliedId]));
        changes = changedObjects(
          items.map((item) => ({ ...item, appliedId: appliedIds.get(item.id) ?? null })),
        );
        await tx
          .update(changeSets)
          .set({
            status: 'applied',
            appliedById: applier.id,
            appliedByName: applier.name.slice(0, 200),
            appliedAt: new Date(),
            lastError: null,
          })
          .where(eq(changeSets.id, id));
        if (row.status === 'in_review' && row.workflowInstanceId && !opts.viaReview)
          await this.ctx.workflows.cancel(row.workflowInstanceId, `Applied directly by ${applier.name}`, {
            tx,
          });
        await this.ctx.audit.record(
          {
            action: 'assistant.change-set.applied',
            entityType: 'assistant.change-set',
            entityId: id,
            entityLabel: reference,
            metadata: {
              items: items.length,
              kinds: [...new Set(items.map((i) => i.kind))],
              review: opts.viaReview?.instanceId ?? null,
            },
          },
          { tx, principal: auth.principal },
        );
        await this.ctx.events.publish(
          'assistant.change-set.applied',
          { changeSetId: id, reference, title: row.title, kinds: [...new Set(items.map((i) => i.kind))] },
          { tx },
        );
        if (row.createdByType === 'user' && row.createdById && row.createdById !== applier.id)
          await this.ctx.notifications.notify(
            {
              type: 'assistant.change-set.applied',
              recipients: [row.createdById],
              params: { reference, title: row.title || reference, by: applier.name },
              href: changeSetHref(id),
            },
            { tx },
          );
      });
    } catch (err) {
      await this.fail(id, err);
      // Concurrency and duplicate keys as errors people can act on; the kind's own refusals as they are.
      throw readableError(err) ?? err;
    }
    await this.committed(changes);
  }

  /** Lets each kind refresh what it caches, now that its changes are committed. */
  private async committed(changes: readonly CommittedChange[]) {
    for (const change of changes)
      await this.ctx.customizations.committed(change.kind, { op: change.op, id: change.id });
  }

  /* ───────────── review ───────────── */

  /** Starts the `assistant.change-set` workflow. Failing items must be fixed first; items only a reviewer can apply are fine. */
  async submit(id: string, input: { note?: string }, auth: AuthContext) {
    const row = await this.editable(id, auth);
    const items = await this.itemsOf(id);
    if (!items.length) throw new HttpError(422, ErrorCodes.VALIDATION_FAILED, 'The change set is empty');
    const checks = await this.dryRun(id, auth);
    const failing = items.filter((i) => {
      const c = checks.get(i.id);
      return c && !c.ok && !c.needsApprover;
    });
    if (failing.length)
      throw new HttpError(422, ErrorCodes.VALIDATION_FAILED, 'Fix the failing items first', {
        issues: failing.map((i) => ({ path: i.ref ?? i.id, message: checks.get(i.id)!.message ?? 'failed' })),
      });
    const stale = await this.staleItems(items, auth);
    if (stale.length)
      throw new HttpError(409, ErrorCodes.CHANGE_SET_STALE, 'Objects changed since they were proposed', {
        items: stale.map((i) => ({ id: i.id, label: i.label })),
      });
    const reference = changeSetReference(row.number);
    const kinds = [...new Set(items.map((i) => i.kind))];
    await this.ctx.transaction(async (tx) => {
      const started = await this.ctx.workflows.start(
        REVIEW_TRIGGER,
        {
          subject: {
            type: 'change-set',
            id,
            label: `${reference} ${row.title}`.trim(),
            href: changeSetHref(id),
          },
          facts: {
            kinds,
            modules: [...new Set(kinds.map((k) => k.split('.')[0]!))],
            itemCount: items.length,
            destructive: items.some((i) => DESTRUCTIVE_OPS.includes(i.op)),
            title: row.title,
          },
          requesterId: row.createdByType === 'user' ? row.createdById : null,
        },
        { tx },
      );
      await tx
        .update(changeSets)
        .set({
          status: 'in_review',
          workflowInstanceId: started?.instanceId ?? null,
          reviewRequestedAt: new Date(),
          reviewNote: input.note ?? null,
          lastError: null,
        })
        .where(eq(changeSets.id, id));
      await this.ctx.audit.record(
        {
          action: 'assistant.change-set.submitted',
          entityType: 'assistant.change-set',
          entityId: id,
          entityLabel: reference,
          metadata: { instanceId: started?.instanceId ?? null, kinds },
        },
        { tx },
      );
      await this.ctx.events.publish(
        'assistant.change-set.submitted',
        { changeSetId: id, reference, title: row.title, kinds },
        { tx },
      );
    });
  }

  /** Cancels the review and returns the change set to draft. */
  async withdraw(id: string, auth: AuthContext) {
    const row = await this.load(id, auth);
    if (!this.isCreator(row, auth) && !auth.can(MANAGE)) throw httpErrors.forbidden();
    if (row.status !== 'in_review')
      throw new HttpError(409, ErrorCodes.INVALID_STATE, `The change set is ${row.status}`, {
        status: row.status,
      });
    await this.ctx.transaction(async (tx) => {
      await tx.update(changeSets).set({ status: 'draft' }).where(eq(changeSets.id, id));
      if (row.workflowInstanceId)
        await this.ctx.workflows.cancel(row.workflowInstanceId, 'Withdrawn', { tx });
      await this.ctx.audit.record(
        {
          action: 'assistant.change-set.withdrawn',
          entityType: 'assistant.change-set',
          entityId: id,
          entityLabel: changeSetReference(row.number),
        },
        { tx },
      );
    });
  }

  /** The review decided: approved → apply as the approver; otherwise back to draft, telling the requester why. */
  async onReviewCompleted(result: WorkflowCompletion) {
    const [row] = await this.ctx.db.select().from(changeSets).where(eq(changeSets.id, result.subjectId));
    if (!row || row.status !== 'in_review' || row.workflowInstanceId !== result.instanceId) return;
    const reference = changeSetReference(row.number);
    if (result.outcome === 'approved') {
      const approver = result.decidedBy ? await this.ctx.rbac.authFor(result.decidedBy.id) : null;
      if (approver) {
        try {
          await this.apply(row.id, { confirm: true }, approver, { viaReview: result });
        } catch (err) {
          return this.returnToDraft(row, reference, err);
        }
        await this.tellConversation(row, reference, approver.principal.name);
        return;
      }
      return this.returnToDraft(
        row,
        reference,
        new HttpError(409, ErrorCodes.INVALID_STATE, 'Approved without a person to apply it', {
          reason: 'no_approver',
        }),
      );
    }
    if (result.outcome === 'rejected')
      return this.returnToDraft(
        row,
        reference,
        new HttpError(409, ErrorCodes.INVALID_STATE, result.comment ?? 'Rejected', { reason: 'rejected' }),
      );
    await this.ctx.db
      .update(changeSets)
      .set({ status: 'draft' })
      .where(and(eq(changeSets.id, row.id), eq(changeSets.status, 'in_review')));
  }

  /**
   * The conversation that built a change set hears that its review applied it, with the links of what it made (a
   * form's own page), so the person finds them where they asked for the change. Best effort: never undoes the apply.
   */
  private async tellConversation(row: ChangeSetRow, reference: string, by: string) {
    if (!row.conversationId) return;
    try {
      const [conv] = await this.ctx.db
        .select({ locale: users.locale })
        .from(conversations)
        .innerJoin(users, eq(users.id, conversations.userId))
        .where(eq(conversations.id, row.conversationId));
      if (!conv) return;
      const links = await this.appliedLinksOf(row.id);
      const content = [
        text(conv.locale, 'reviewApplied', { reference, by }),
        ...(links.length ? [linkLines(links, conv.locale)] : []),
      ].join('\n\n');
      await appendTurns(this.ctx, row.conversationId, [{ role: 'assistant', content, mode: 'builtin' }]);
    } catch (err) {
      this.ctx.logger.warn(
        { err, changeSetId: row.id },
        'could not note the applied review in its conversation',
      );
    }
  }

  /** Where people use what an applied change set made or changed (e.g. a form's own page), in item order. */
  async appliedLinksOf(id: string): Promise<AppliedLink[]> {
    const [row] = await this.ctx.db
      .select({ status: changeSets.status })
      .from(changeSets)
      .where(eq(changeSets.id, id));
    if (row?.status !== 'applied') return [];
    return appliedLinks(await this.itemsOf(id));
  }

  private async returnToDraft(row: ChangeSetRow, reference: string, err: unknown) {
    await this.ctx.transaction(async (tx) => {
      const lastError = await this.fail(row.id, err, tx);
      await tx.update(changeSets).set({ status: 'draft' }).where(eq(changeSets.id, row.id));
      await this.ctx.audit.record(
        {
          action: 'assistant.change-set.returned',
          entityType: 'assistant.change-set',
          entityId: row.id,
          entityLabel: reference,
          metadata: { code: lastError.code, message: lastError.message },
        },
        { tx },
      );
      await this.ctx.events.publish(
        'assistant.change-set.returned',
        { changeSetId: row.id, reference, title: row.title, kinds: [] },
        { tx },
      );
      if (row.createdByType === 'user' && row.createdById)
        await this.ctx.notifications.notify(
          {
            type: 'assistant.change-set.returned',
            recipients: [row.createdById],
            params: { reference, title: row.title || reference, reason: lastError.message },
            href: changeSetHref(row.id),
          },
          { tx },
        );
    });
  }

  /* ───────────── rollback ───────────── */

  /** Why the change set can't be rolled back automatically, or null. */
  private rollbackBlocked(
    row: ChangeSetRow,
    items: ChangeSetItemRow[],
    kinds: Map<string, CustomizationKindInfo>,
  ) {
    if (row.status !== 'applied') return null;
    return items.some((i) => !inverseOf(i, kinds.get(i.kind))) ? 'not_reversible' : null;
  }

  /** Undoes every item in reverse order in one transaction; each object must still be as the change set left it. */
  async rollback(id: string, input: { confirm: boolean; reason?: string }, auth: AuthContext) {
    const row = await this.load(id, auth);
    if (row.status !== 'applied')
      throw new HttpError(409, ErrorCodes.INVALID_STATE, `The change set is ${row.status}`, {
        status: row.status,
      });
    if (!input.confirm)
      throw new HttpError(409, ErrorCodes.CONFIRMATION_REQUIRED, 'Rolling back needs confirmation');
    const items = await this.itemsOf(id);
    const kinds = this.kindsFor(auth);
    const missing = [...new Set(items.map((i) => i.kind))].filter((k) => !kinds.get(k)?.canApply);
    if (missing.length)
      throw new HttpError(403, ErrorCodes.FORBIDDEN, 'Rolling back this change set needs more permissions', {
        permissions: missing.map((k) => kinds.get(k)?.applyPermission ?? k),
      });
    if (this.rollbackBlocked(row, items, kinds))
      throw new HttpError(409, ErrorCodes.NOT_SUPPORTED, 'Some changes cannot be undone automatically', {
        reason: 'not_reversible',
        items: items
          .filter((i) => !inverseOf(i, kinds.get(i.kind)))
          .map((i) => ({ id: i.id, label: i.label })),
      });
    const reference = changeSetReference(row.number);
    const source = { type: 'change-set-rollback', id, reference };
    try {
      await this.ctx.transaction(async (tx) => {
        await this.lockKinds(tx, items);
        const [locked] = await tx.select().from(changeSets).where(eq(changeSets.id, id)).for('update');
        if (locked!.status !== 'applied')
          throw new HttpError(409, ErrorCodes.INVALID_STATE, `The change set is ${locked!.status}`);
        for (const item of [...items].reverse()) {
          const inverse = inverseOf(item, kinds.get(item.kind))!;
          try {
            await this.ctx.customizations.apply(
              item.kind,
              {
                op: inverse.op,
                id: item.appliedId ?? item.targetId,
                value: inverse.value,
                baseVersion: item.after?.version ?? null,
              },
              { auth, tx, source },
            );
          } catch (error) {
            const err = readableError(error);
            if (err)
              throw new HttpError(err.statusCode, err.code, err.message, {
                ...(err.details as object),
                itemId: item.id,
                label: item.label,
              });
            throw error;
          }
        }
        await tx
          .update(changeSets)
          .set({
            status: 'rolled_back',
            rolledBackById: auth.user?.id ?? null,
            rolledBackByName: auth.principal.name.slice(0, 200),
            rolledBackAt: new Date(),
            lastError: null,
          })
          .where(eq(changeSets.id, id));
        await this.ctx.audit.record(
          {
            action: 'assistant.change-set.rolled_back',
            entityType: 'assistant.change-set',
            entityId: id,
            entityLabel: reference,
            metadata: { items: items.length, reason: input.reason ?? null },
          },
          { tx, principal: auth.principal },
        );
        await this.ctx.events.publish(
          'assistant.change-set.rolled_back',
          { changeSetId: id, reference, title: row.title, kinds: [...new Set(items.map((i) => i.kind))] },
          { tx },
        );
        if (row.createdByType === 'user' && row.createdById && row.createdById !== auth.user?.id)
          await this.ctx.notifications.notify(
            {
              type: 'assistant.change-set.rolled-back',
              recipients: [row.createdById],
              params: { reference, title: row.title || reference, by: auth.principal.name },
              href: changeSetHref(id),
            },
            { tx },
          );
      });
    } catch (err) {
      await this.fail(id, err);
      // Concurrency and duplicate keys as errors people can act on; the kind's own refusals as they are.
      throw readableError(err) ?? err;
    }
    await this.committed(changedObjects(items));
  }

  async discard(id: string, auth: AuthContext) {
    const row = await this.editable(id, auth);
    await this.ctx.transaction(async (tx) => {
      await tx.update(changeSets).set({ status: 'discarded' }).where(eq(changeSets.id, id));
      await this.ctx.audit.record(
        {
          action: 'assistant.change-set.discarded',
          entityType: 'assistant.change-set',
          entityId: id,
          entityLabel: changeSetReference(row.number),
        },
        { tx },
      );
      await this.ctx.events.publish(
        'assistant.change-set.discarded',
        { changeSetId: id, reference: changeSetReference(row.number), title: row.title, kinds: [] },
        { tx },
      );
    });
  }

  /* ───────────── reading ───────────── */

  private async staleItems(items: ChangeSetItemRow[], auth: AuthContext) {
    const out: ChangeSetItemRow[] = [];
    for (const i of items) {
      if (i.op === 'create' || !i.targetId || i.targetId.startsWith('$ref:')) continue;
      const now = await this.ctx.customizations.get(i.kind, i.targetId, auth).catch(() => null);
      if ((now?.version ?? null) !== i.baseVersion) out.push(i);
    }
    return out;
  }

  private summary(row: ChangeSetRow, items: Pick<ChangeSetItemRow, 'kind' | 'check'>[]): ChangeSetSummary {
    return {
      id: row.id,
      number: row.number,
      reference: changeSetReference(row.number),
      title: row.title,
      summary: row.summary,
      status: row.status,
      itemCount: items.length,
      kinds: [...new Set(items.map((i) => i.kind))],
      ready: items.length > 0 && items.every((i) => i.check?.ok),
      createdBy: { type: row.createdByType, id: row.createdById, name: row.createdByName },
      appliedBy: row.appliedAt ? { id: row.appliedById, name: row.appliedByName ?? '' } : null,
      appliedAt: row.appliedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  /**
   * For each permission, the narrowest platform system roles that grant it (most exactly, then with the fewest
   * permissions), so a page can say "needs Workflow administrator" instead of a code. Role names are the manifests'
   * English; the web translates them.
   */
  async rolesFor(permissions: readonly string[]): Promise<PermissionRole[]> {
    const wanted = [...new Set(permissions.filter(Boolean))];
    if (!wanted.length) return [];
    const rows = await this.ctx.db
      .select({
        id: roles.id,
        key: roles.key,
        name: roles.name,
        moduleId: roles.moduleId,
        permission: rolePermissions.permission,
      })
      .from(roles)
      .innerJoin(applications, eq(applications.id, roles.applicationId))
      .innerJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
      .where(and(eq(applications.key, PLATFORM_APP), eq(roles.isSystem, true)));
    const byRole = new Map<
      string,
      { key: string; name: string; moduleId: string | null; grants: string[] }
    >();
    for (const r of rows) {
      const role = byRole.get(r.id) ?? { key: r.key, name: r.name, moduleId: r.moduleId, grants: [] };
      role.grants.push(r.permission);
      byRole.set(r.id, role);
    }
    const all = [...byRole.values()];
    // How exactly a role grants it: `core.workflows.manage` (3) before `core.workflows.*` (2), `core.*` and `*`.
    const specificity = (grants: readonly string[], permission: string) =>
      Math.max(
        -1,
        ...grants
          .filter((g) => matchPermission(g, permission))
          .map((g) => g.split('.').filter((seg) => seg !== '*').length),
      );
    return wanted.map((permission) => ({
      permission,
      roles: all
        .map((r) => ({ ...r, score: specificity(r.grants, permission) }))
        .filter((r) => r.score >= 0)
        .sort((a, b) => b.score - a.score || a.grants.length - b.grants.length || a.key.localeCompare(b.key))
        .slice(0, 2)
        .map(({ key, name, moduleId }) => ({ key, name, moduleId })),
    }));
  }

  async summaryOf(id: string, auth: AuthContext): Promise<ChangeSetSummary> {
    const row = await this.load(id, auth);
    return this.summary(row, await this.itemsOf(id));
  }

  async detail(id: string, auth: AuthContext): Promise<ChangeSetDetail> {
    const row = await this.load(id, auth);
    const items = await this.itemsOf(id);
    const kinds = this.kindsFor(auth);
    const open = row.status === 'draft' || row.status === 'in_review';
    const outItems: ChangeSetItem[] = [];
    for (const i of items) {
      const live =
        i.targetId && !i.targetId.startsWith('$ref:') && kinds.has(i.kind)
          ? await this.ctx.customizations.get(i.kind, i.targetId, auth).catch(() => null)
          : null;
      outItems.push({
        id: i.id,
        position: i.position,
        ref: i.ref,
        kind: i.kind,
        op: i.op,
        targetId: i.targetId,
        label: i.label,
        value: i.value ?? null,
        current: snapshot(live),
        baseVersion: i.baseVersion,
        stale:
          open &&
          i.op !== 'create' &&
          !!i.targetId &&
          !i.targetId.startsWith('$ref:') &&
          kinds.has(i.kind) &&
          (live?.version ?? null) !== i.baseVersion,
        check: i.check,
        appliedId: i.appliedId,
        before: i.before,
        after: i.after,
        note: i.note,
      });
    }
    const creator = this.isCreator(row, auth);
    const manage = auth.can(MANAGE);
    const missing = [
      ...new Set(
        [...new Set(items.map((i) => i.kind))]
          .map((k) => kinds.get(k))
          .filter((k) => !k?.canApply)
          .map((k) => k?.applyPermission ?? 'unknown'),
      ),
    ];
    const blocked = this.rollbackBlocked(row, items, kinds);
    const errorPermissions = (row.lastError?.details as { permissions?: unknown } | undefined)?.permissions;
    const permissionRoles = await this.rolesFor([
      ...missing,
      ...items.flatMap((i) => (i.check?.permission ? [i.check.permission] : [])),
      ...(Array.isArray(errorPermissions) ? errorPermissions.filter((p) => typeof p === 'string') : []),
    ]);
    return {
      ...this.summary(row, items),
      items: outItems,
      conversationId: row.conversationId,
      review: row.workflowInstanceId
        ? {
            instanceId: row.workflowInstanceId,
            requestedAt: row.reviewRequestedAt,
            note: row.reviewNote,
          }
        : null,
      lastError: row.lastError ? { ...row.lastError, at: new Date(row.lastError.at) } : null,
      checkedAt: row.checkedAt,
      destructive: items.some((i) => DESTRUCTIVE_OPS.includes(i.op)),
      rolledBackBy: row.rolledBackAt ? { id: row.rolledBackById, name: row.rolledBackByName ?? '' } : null,
      rolledBackAt: row.rolledBackAt,
      permissions: {
        canEdit: this.canEdit(row, auth),
        canApply: open && items.length > 0 && missing.length === 0,
        canSubmit: row.status === 'draft' && items.length > 0 && (creator || manage),
        canWithdraw: row.status === 'in_review' && (creator || manage),
        canRollback: row.status === 'applied' && missing.length === 0 && !blocked,
        canDiscard: row.status === 'draft' && (creator || manage),
        missing,
        rollbackBlocked: blocked,
      },
      permissionRoles,
      href: changeSetHref(row.id),
    };
  }

  async list(q: ChangeSetQuery, auth: AuthContext): Promise<Page<ChangeSetSummary>> {
    if (q.scope === 'all') auth.require(READ_ALL);
    const me = creatorOf(auth);
    const where = and(
      q.scope === 'all'
        ? undefined
        : and(eq(changeSets.createdByType, me.type), eq(changeSets.createdById, me.id ?? sql`null`)),
      q.status ? eq(changeSets.status, q.status) : undefined,
      q.q
        ? or(
            ilike(changeSets.title, likePattern(q.q)),
            sql`('CS-' || lpad(${changeSets.number}::text, 5, '0')) ilike ${likePattern(q.q)}`,
          )
        : undefined,
    );
    const sortable = {
      updatedAt: changeSets.updatedAt,
      createdAt: changeSets.createdAt,
      number: changeSets.number,
      title: changeSets.title,
      status: changeSets.status,
    };
    const key = (q.sort?.replace(/^-/, '') ?? 'updatedAt') as keyof typeof sortable;
    const column = sortable[key] ?? changeSets.updatedAt;
    const direction = !q.sort || q.sort.startsWith('-') ? desc : asc;
    const [rows, [total]] = await Promise.all([
      this.ctx.db
        .select()
        .from(changeSets)
        .where(where)
        .orderBy(direction(column), desc(changeSets.id))
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize),
      this.ctx.db.select({ n: count() }).from(changeSets).where(where),
    ]);
    const items = rows.length
      ? await this.ctx.db
          .select({
            changeSetId: changeSetItems.changeSetId,
            kind: changeSetItems.kind,
            check: changeSetItems.check,
          })
          .from(changeSetItems)
          .where(
            inArray(
              changeSetItems.changeSetId,
              rows.map((r) => r.id),
            ),
          )
      : [];
    return {
      items: rows.map((r) =>
        this.summary(
          r,
          items.filter((i) => i.changeSetId === r.id),
        ),
      ),
      total: total!.n,
      page: q.page,
      pageSize: q.pageSize,
    };
  }
}
