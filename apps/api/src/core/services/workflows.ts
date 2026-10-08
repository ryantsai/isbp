import type {
  approvalQuerySchema,
  createDelegationSchema,
  createWorkflowSchema,
  instanceQuerySchema,
  updateWorkflowSchema,
  workflowListQuerySchema,
} from '@isbp/contracts';
import {
  applications,
  approvalDelegations,
  approvalTasks,
  forms,
  groups,
  roles,
  users,
  workflowDefinitions,
  workflowEvents,
  workflowInstances,
  workflowVersions,
} from '@isbp/db/schema';
import {
  type ApproverRule,
  type AuthContext,
  ErrorCodes,
  factsFromJsonSchema,
  type FieldDef,
  findStep,
  HttpError,
  httpErrors,
  type ModuleContext,
  validateWorkflowGraph,
  walkSteps,
  type WorkflowGraph,
  type WorkflowIssue,
} from '@isbp/sdk/server';
import { and, asc, count, desc, eq, gt, ilike, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { canonicalJson } from '../../kernel/crypto';
import { PLATFORM_APP_KEY } from '../../kernel/rbac';
import { getKernel } from '../kernel-ref';
import { likePattern, pageOffset } from '../util';
import { assertRecordFieldTypes } from './forms';
import { peopleById, ref } from './people';

type InstanceRow = typeof workflowInstances.$inferSelect;
type TaskRow = typeof approvalTasks.$inferSelect;
type DefinitionRow = typeof workflowDefinitions.$inferSelect;

const slug = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50) || 'workflow';

function rulesOf(graph: WorkflowGraph): ApproverRule[] {
  const out: ApproverRule[] = [];
  const push = (r: ApproverRule) => {
    out.push(r);
    if ('fallback' in r && r.fallback) push(r.fallback);
  };
  for (const { step } of walkSteps(graph.steps)) {
    if (step.type === 'approval') {
      step.approvers.forEach(push);
      step.sla?.escalateTo?.forEach(push);
    } else if (step.type === 'notify') step.recipients.forEach(push);
  }
  return out;
}

/** The fields approvers fill in (`ApprovalStep.fields`), by step id. */
export function stepFieldsOf(graph: WorkflowGraph): Map<string, FieldDef[]> {
  const out = new Map<string, FieldDef[]>();
  for (const { step } of walkSteps(graph.steps))
    if (step.type === 'approval' && step.fields?.length) out.set(step.id, step.fields);
  return out;
}

/** Display names of the groups, roles and people a graph refers to (for diagrams shown to anyone). */
export async function referencedNames(db: ModuleContext['db'], graph: WorkflowGraph) {
  const rules = rulesOf(graph);
  const groupKeys = [...new Set(rules.flatMap((r) => (r.type === 'group' ? [r.groupKey] : [])))];
  const roleKeys = [...new Set(rules.flatMap((r) => (r.type === 'role' ? [r.roleKey] : [])))];
  const userIds = [...new Set(rules.flatMap((r) => (r.type === 'user' ? [r.userId] : [])))];
  const [g, r, u] = await Promise.all([
    groupKeys.length
      ? db.select({ key: groups.key, name: groups.name }).from(groups).where(inArray(groups.key, groupKeys))
      : Promise.resolve([]),
    roleKeys.length
      ? db
          .select({ key: roles.key, name: roles.name })
          .from(roles)
          .innerJoin(applications, eq(applications.id, roles.applicationId))
          .where(and(inArray(roles.key, roleKeys), eq(applications.key, PLATFORM_APP_KEY)))
      : Promise.resolve([]),
    userIds.length
      ? db.select({ id: users.id, name: users.displayName }).from(users).where(inArray(users.id, userIds))
      : Promise.resolve([]),
  ]);
  return {
    groups: Object.fromEntries(g.map((x) => [x.key, x.name])),
    roles: Object.fromEntries(r.map((x) => [x.key, x.name])),
    users: Object.fromEntries(u.map((x) => [x.id, x.name])),
  };
}

/* ───────────────────────────── instance views ───────────────────────────── */

/** Read models of instances shared by the approvals inbox, request pages and the admin monitor. */
export class InstanceViews {
  constructor(private readonly ctx: ModuleContext) {}

  private get engine() {
    return getKernel().workflows;
  }

  async summaries(rows: InstanceRow[]) {
    const out = new Map<string, ReturnType<typeof this.summary>>();
    if (!rows.length) return out;
    const ids = rows.map((r) => r.id);
    const [pending, defs] = await Promise.all([
      this.ctx.db
        .select({ instanceId: approvalTasks.instanceId, assigneeId: approvalTasks.assigneeId })
        .from(approvalTasks)
        .where(and(inArray(approvalTasks.instanceId, ids), eq(approvalTasks.status, 'pending'))),
      this.ctx.db
        .select({ id: workflowDefinitions.id, key: workflowDefinitions.key, name: workflowDefinitions.name })
        .from(workflowDefinitions)
        .where(inArray(workflowDefinitions.id, [...new Set(rows.map((r) => r.definitionId))])),
    ]);
    const people = await peopleById(this.ctx.db, [
      ...rows.flatMap((r) => [r.requesterId, r.subjectUserId]),
      ...pending.map((p) => p.assigneeId),
    ]);
    const defById = new Map(defs.map((d) => [d.id, d]));
    for (const r of rows) {
      const graph = await this.engine.graph(r.definitionId, r.version);
      out.set(
        r.id,
        this.summary(
          r,
          graph,
          defById.get(r.definitionId) ?? { id: r.definitionId, key: '?', name: '?' },
          pending.filter((p) => p.instanceId === r.id).map((p) => p.assigneeId),
          people,
        ),
      );
    }
    return out;
  }

  private summary(
    r: InstanceRow,
    graph: WorkflowGraph,
    def: { id: string; key: string; name: string },
    pendingIds: string[],
    people: Awaited<ReturnType<typeof peopleById>>,
  ) {
    const currentSteps = walkSteps(graph.steps)
      .map((s) => s.step)
      .filter(
        (s) => s.type === 'approval' && r.state.steps[s.id]?.status === 'active' && r.status === 'running',
      )
      .map((s) => ({ id: s.id, name: s.name }));
    return {
      id: r.id,
      triggerKey: r.triggerKey,
      definition: def,
      version: r.version,
      subject: { type: r.subjectType, id: r.subjectId, label: r.subjectLabel, href: r.subjectHref },
      requester: ref(people, r.requesterId),
      subjectUser: ref(people, r.subjectUserId),
      status: r.status,
      startedAt: r.startedAt,
      completedAt: r.completedAt,
      outcomeComment: r.outcomeComment,
      pendingWith: [...new Set(pendingIds)].map((id) => ref(people, id)!),
      currentSteps,
    };
  }

  async summaryOf(instanceId: string | null) {
    if (!instanceId) return null;
    const [row] = await this.ctx.db
      .select()
      .from(workflowInstances)
      .where(eq(workflowInstances.id, instanceId));
    if (!row) return null;
    return (await this.summaries([row])).get(row.id) ?? null;
  }

  taskDto(t: TaskRow, people: Awaited<ReturnType<typeof peopleById>>) {
    return {
      id: t.id,
      stepId: t.stepId,
      slot: t.slot,
      status: t.status,
      assignee: ref(people, t.assigneeId)!,
      delegatedFrom: ref(people, t.delegatedFromId),
      isEscalation: t.isEscalation,
      comment: t.comment,
      data: t.data ?? null,
      decidedAt: t.decidedAt,
      decidedBy: ref(people, t.decidedById),
      dueAt: t.dueAt,
      createdAt: t.createdAt,
    };
  }

  /**
   * The decisions of an instance in order (approved and rejected tasks, also automatic ones), each with its step's
   * fields and what the approver filled in; `userIds` are the people named in those values.
   */
  async decisions(instanceId: string | null) {
    const none = { items: [], userIds: [] as string[] };
    if (!instanceId) return none;
    const [row] = await this.ctx.db
      .select({ definitionId: workflowInstances.definitionId, version: workflowInstances.version })
      .from(workflowInstances)
      .where(eq(workflowInstances.id, instanceId));
    if (!row) return none;
    const [graph, tasks] = await Promise.all([
      this.engine.graph(row.definitionId, row.version),
      this.ctx.db
        .select()
        .from(approvalTasks)
        .where(
          and(
            eq(approvalTasks.instanceId, instanceId),
            inArray(approvalTasks.status, ['approved', 'rejected']),
          ),
        )
        .orderBy(asc(approvalTasks.decidedAt), asc(approvalTasks.createdAt)),
    ]);
    const people = await peopleById(
      this.ctx.db,
      tasks.map((t) => t.decidedById),
    );
    const userIds: string[] = [];
    const items = tasks.map((t) => {
      const step = findStep(graph, t.stepId);
      const fields = step?.type === 'approval' ? (step.fields ?? []) : [];
      const data = t.data ?? {};
      for (const f of fields)
        if (f.type === 'user' && typeof data[f.key] === 'string') userIds.push(data[f.key] as string);
      return {
        taskId: t.id,
        stepId: t.stepId,
        step: step?.name ?? { en: t.stepId },
        status: t.status as 'approved' | 'rejected',
        decidedBy: ref(people, t.decidedById),
        decidedAt: t.decidedAt,
        comment: t.comment,
        fields,
        data,
      };
    });
    return { items, userIds };
  }

  async canView(row: InstanceRow, auth: AuthContext): Promise<boolean> {
    const me = auth.user?.id;
    if (auth.can('core.workflows.read')) return true;
    if (!me) return false;
    if (row.requesterId === me || row.subjectUserId === me) return true;
    return this.engine.involves(row.id, me);
  }

  async detail(id: string, auth: AuthContext) {
    const [row] = await this.ctx.db.select().from(workflowInstances).where(eq(workflowInstances.id, id));
    if (!row || !(await this.canView(row, auth))) throw httpErrors.notFound('Workflow instance not found');
    const [summary, tasks, events, graph] = await Promise.all([
      this.summaries([row]).then((m) => m.get(row.id)!),
      this.ctx.db
        .select()
        .from(approvalTasks)
        .where(eq(approvalTasks.instanceId, id))
        .orderBy(asc(approvalTasks.createdAt)),
      this.ctx.db
        .select()
        .from(workflowEvents)
        .where(eq(workflowEvents.instanceId, id))
        .orderBy(asc(workflowEvents.seq))
        .limit(500),
      this.engine.graph(row.definitionId, row.version),
    ]);
    const people = await peopleById(
      this.ctx.db,
      tasks.flatMap((t) => [t.assigneeId, t.delegatedFromId, t.decidedById]),
    );
    const me = auth.user?.id;
    return {
      ...summary,
      graph,
      names: await referencedNames(this.ctx.db, graph),
      state: row.state,
      facts: row.facts,
      tasks: tasks.map((t) => this.taskDto(t, people)),
      events: events.map((e) => ({
        seq: e.seq,
        type: e.type,
        stepId: e.stepId,
        taskId: e.taskId,
        actorId: e.actorId,
        actorName: e.actorName,
        data: e.data,
        createdAt: e.createdAt,
      })),
      canCancel: row.status === 'running' && (row.requesterId === me || auth.can('core.workflows.manage')),
      myTaskId: tasks.find((t) => t.status === 'pending' && t.assigneeId === me)?.id ?? null,
    };
  }
}

/* ───────────────────────────── definitions (admin) ───────────────────────────── */

export class WorkflowAdminService {
  readonly views: InstanceViews;

  constructor(private readonly ctx: ModuleContext) {
    this.views = new InstanceViews(ctx);
  }

  private get db() {
    return this.ctx.db;
  }

  private get engine() {
    return getKernel().workflows;
  }

  async triggers() {
    const defaults = await this.db
      .select({
        id: workflowDefinitions.id,
        name: workflowDefinitions.name,
        triggerKey: workflowDefinitions.triggerKey,
      })
      .from(workflowDefinitions)
      .where(and(eq(workflowDefinitions.isDefault, true), isNull(workflowDefinitions.archivedAt)));
    return this.engine.triggers().map(({ moduleId, def }) => {
      let facts: ReturnType<typeof factsFromJsonSchema> = [];
      try {
        facts = def.facts ? factsFromJsonSchema(z.toJSONSchema(def.facts, { unrepresentable: 'any' })) : [];
      } catch {
        facts = [];
      }
      const d = defaults.find((x) => x.triggerKey === def.key);
      return {
        key: def.key,
        moduleId,
        name: def.name,
        description: def.description ?? null,
        subject: def.subject,
        required: Boolean(def.required),
        customFieldEntity: def.customFieldEntity ?? null,
        facts: [
          ...facts,
          { path: 'requester.departmentCode', type: 'string' as const },
          { path: 'requester.jobTitle', type: 'string' as const },
          { path: 'subjectUser.departmentCode', type: 'string' as const },
        ],
        defaultDefinition: d ? { id: d.id, name: d.name } : null,
      };
    });
  }

  private assertTrigger(key: string) {
    if (!this.engine.trigger(key)) throw httpErrors.badRequest(`Unknown workflow trigger "${key}"`);
  }

  private async find(id: string): Promise<DefinitionRow> {
    const [d] = await this.db.select().from(workflowDefinitions).where(eq(workflowDefinitions.id, id));
    if (!d) throw httpErrors.notFound('Workflow not found');
    return d;
  }

  private async summaries(rows: DefinitionRow[]) {
    const ids = rows.map((r) => r.id);
    const running = ids.length
      ? await this.db
          .select({ id: workflowInstances.definitionId, n: count() })
          .from(workflowInstances)
          .where(and(inArray(workflowInstances.definitionId, ids), eq(workflowInstances.status, 'running')))
          .groupBy(workflowInstances.definitionId)
      : [];
    const published = ids.length
      ? await this.db
          .select({
            id: workflowVersions.definitionId,
            version: workflowVersions.version,
            graph: workflowVersions.graph,
          })
          .from(workflowVersions)
          .where(inArray(workflowVersions.definitionId, ids))
      : [];
    const people = await peopleById(
      this.db,
      rows.map((r) => r.updatedBy),
    );
    return rows.map((r) => {
      const pub = published.find((p) => p.id === r.id && p.version === r.publishedVersion);
      return {
        id: r.id,
        key: r.key,
        name: r.name,
        description: r.description,
        triggerKey: r.triggerKey,
        isDefault: r.isDefault,
        isSystem: r.isSystem,
        publishedVersion: r.publishedVersion,
        archived: Boolean(r.archivedAt),
        hasUnpublishedChanges: !pub || canonicalJson(pub.graph) !== canonicalJson(r.draft),
        stepCount: walkSteps(r.draft.steps).length,
        running: running.find((x) => x.id === r.id)?.n ?? 0,
        updatedAt: r.updatedAt,
        updatedBy: ref(people, r.updatedBy),
        published: pub?.graph ?? null,
      };
    });
  }

  async list(q: z.output<typeof workflowListQuerySchema>) {
    const rows = await this.db
      .select()
      .from(workflowDefinitions)
      .where(
        and(
          q.triggerKey ? eq(workflowDefinitions.triggerKey, q.triggerKey) : undefined,
          q.includeArchived ? undefined : isNull(workflowDefinitions.archivedAt),
          q.q
            ? or(
                ilike(workflowDefinitions.name, likePattern(q.q)),
                ilike(workflowDefinitions.key, likePattern(q.q)),
              )
            : undefined,
        ),
      )
      .orderBy(desc(workflowDefinitions.isDefault), asc(workflowDefinitions.name));
    return (await this.summaries(rows)).map(({ published: _p, ...s }) => s);
  }

  /** Semantic issues plus references to groups/roles/people that no longer exist. */
  async issues(graph: WorkflowGraph): Promise<WorkflowIssue[]> {
    const issues: (WorkflowIssue | { stepId: string | null; code: string })[] = validateWorkflowGraph(graph);
    const rules = rulesOf(graph);
    const groupKeys = [...new Set(rules.flatMap((r) => (r.type === 'group' ? [r.groupKey] : [])))];
    const roleKeys = [...new Set(rules.flatMap((r) => (r.type === 'role' ? [r.roleKey] : [])))];
    const userIds = [...new Set(rules.flatMap((r) => (r.type === 'user' ? [r.userId] : [])))];
    const [g, r, u] = await Promise.all([
      groupKeys.length
        ? this.db.select({ key: groups.key }).from(groups).where(inArray(groups.key, groupKeys))
        : Promise.resolve([]),
      roleKeys.length
        ? this.db.select({ key: roles.key }).from(roles).where(inArray(roles.key, roleKeys))
        : Promise.resolve([]),
      userIds.length
        ? this.db
            .select({ id: users.id })
            .from(users)
            .where(and(inArray(users.id, userIds), eq(users.status, 'active')))
        : Promise.resolve([]),
    ]);
    const has = {
      g: new Set(g.map((x) => x.key)),
      r: new Set(r.map((x) => x.key)),
      u: new Set(u.map((x) => x.id)),
    };
    for (const { step } of walkSteps(graph.steps)) {
      const own: ApproverRule[] = [];
      const collect = (x: ApproverRule) => {
        own.push(x);
        if ('fallback' in x && x.fallback) collect(x.fallback);
      };
      if (step.type === 'approval') [...step.approvers, ...(step.sla?.escalateTo ?? [])].forEach(collect);
      if (step.type === 'notify') step.recipients.forEach(collect);
      for (const rule of own) {
        if (rule.type === 'group' && !has.g.has(rule.groupKey))
          issues.push({ stepId: step.id, code: 'unknownGroup' });
        if (rule.type === 'role' && !has.r.has(rule.roleKey))
          issues.push({ stepId: step.id, code: 'unknownRole' });
        if (rule.type === 'user' && !has.u.has(rule.userId))
          issues.push({ stepId: step.id, code: 'unknownUser' });
      }
    }
    // Record step fields may only offer record types that exist.
    const records = getKernel().records;
    for (const [stepId, fields] of stepFieldsOf(graph))
      if (fields.some((f) => f.type === 'record' && f.record?.types.some((t) => !records.entry(t))))
        issues.push({ stepId, code: 'unknownRecordType' });
    return issues as WorkflowIssue[];
  }

  async get(id: string) {
    const d = await this.find(id);
    const [summary] = await this.summaries([d]);
    const [versions, usedForms, usedRoles] = await Promise.all([
      this.db
        .select()
        .from(workflowVersions)
        .where(eq(workflowVersions.definitionId, id))
        .orderBy(desc(workflowVersions.version)),
      this.db
        .select({ id: forms.id, key: forms.key, name: forms.name })
        .from(forms)
        .where(and(eq(forms.workflowDefinitionId, id), isNull(forms.archivedAt))),
      this.db
        .select({ id: roles.id, key: roles.key, name: roles.name })
        .from(roles)
        .where(eq(roles.requestWorkflowId, id)),
    ]);
    const people = await peopleById(
      this.db,
      versions.map((v) => v.publishedBy),
    );
    return {
      ...summary!,
      draft: d.draft,
      versions: versions.map((v) => ({
        version: v.version,
        publishedAt: v.publishedAt,
        publishedBy: ref(people, v.publishedBy),
      })),
      issues: await this.issues(d.draft),
      names: await referencedNames(this.db, d.draft),
      usedBy: { forms: usedForms, roles: usedRoles },
    };
  }

  async create(input: z.output<typeof createWorkflowSchema>, auth: AuthContext) {
    this.assertTrigger(input.triggerKey);
    let draft: WorkflowGraph = { steps: [] };
    if (input.copyFromId) {
      const src = await this.find(input.copyFromId);
      if (src.triggerKey !== input.triggerKey)
        throw httpErrors.badRequest('Copy from a workflow of the same trigger');
      draft = src.draft;
    }
    let key = input.key ?? slug(input.name);
    for (
      let i = 2;
      (
        await this.db
          .select({ id: workflowDefinitions.id })
          .from(workflowDefinitions)
          .where(eq(workflowDefinitions.key, key))
      ).length;
      i++
    )
      key = `${input.key ?? slug(input.name)}-${i}`;
    const row = await this.ctx.transaction(async (tx) => {
      const [created] = await tx
        .insert(workflowDefinitions)
        .values({
          key,
          name: input.name,
          description: input.description ?? null,
          triggerKey: input.triggerKey,
          draft,
          createdBy: auth.user?.id ?? null,
          updatedBy: auth.user?.id ?? null,
        })
        .returning();
      await this.ctx.audit.record(
        {
          action: 'core.workflow-definition.created',
          entityType: 'workflow_definition',
          entityId: created!.id,
          entityLabel: created!.name,
          metadata: { triggerKey: input.triggerKey, copiedFrom: input.copyFromId ?? null },
        },
        { tx },
      );
      return created!;
    });
    return this.get(row.id);
  }

  async update(id: string, input: z.output<typeof updateWorkflowSchema>, auth: AuthContext) {
    const before = await this.find(id);
    if (before.archivedAt)
      throw new HttpError(409, ErrorCodes.INVALID_STATE, 'Restore the workflow before editing it');
    if (input.draft) {
      // Step fields may only newly offer record types the editor may pick from (as form fields).
      const had = stepFieldsOf(before.draft);
      for (const [stepId, fields] of stepFieldsOf(input.draft))
        assertRecordFieldTypes(
          fields,
          had.get(stepId) ?? [],
          auth,
          (i) => `draft.steps.${stepId}.fields.${i}.record.types`,
        );
    }
    const changes = this.ctx.audit.diff(
      { name: before.name, description: before.description },
      { name: input.name, description: input.description },
    );
    const graphChanged =
      input.draft !== undefined && canonicalJson(input.draft) !== canonicalJson(before.draft);
    await this.ctx.transaction(async (tx) => {
      await tx
        .update(workflowDefinitions)
        .set({
          name: input.name,
          description: input.description,
          draft: input.draft,
          updatedBy: auth.user?.id ?? null,
        })
        .where(eq(workflowDefinitions.id, id));
      if (Object.keys(changes).length || graphChanged)
        await this.ctx.audit.record(
          {
            action: 'core.workflow-definition.updated',
            entityType: 'workflow_definition',
            entityId: id,
            entityLabel: input.name ?? before.name,
            changes,
            metadata: { draftChanged: graphChanged },
          },
          { tx },
        );
    });
    return this.get(id);
  }

  async publish(id: string, auth: AuthContext) {
    const d = await this.find(id);
    if (d.archivedAt)
      throw new HttpError(409, ErrorCodes.INVALID_STATE, 'Archived workflows cannot be published');
    const issues = await this.issues(d.draft);
    if (issues.length)
      throw new HttpError(409, ErrorCodes.WORKFLOW_INVALID, 'Fix the highlighted steps before publishing', {
        issues,
      });
    const version = (d.publishedVersion ?? 0) + 1;
    await this.ctx.transaction(async (tx) => {
      await tx
        .insert(workflowVersions)
        .values({ definitionId: id, version, graph: d.draft, publishedBy: auth.user?.id ?? null });
      // The first published definition of a trigger becomes its default automatically.
      const [current] = await tx
        .select({ id: workflowDefinitions.id })
        .from(workflowDefinitions)
        .where(
          and(
            eq(workflowDefinitions.triggerKey, d.triggerKey),
            eq(workflowDefinitions.isDefault, true),
            isNull(workflowDefinitions.archivedAt),
          ),
        );
      await tx
        .update(workflowDefinitions)
        .set({
          publishedVersion: version,
          updatedBy: auth.user?.id ?? null,
          ...(current ? {} : { isDefault: true }),
        })
        .where(eq(workflowDefinitions.id, id));
      await this.ctx.audit.record(
        {
          action: 'core.workflow-definition.published',
          entityType: 'workflow_definition',
          entityId: id,
          entityLabel: d.name,
          metadata: { version, triggerKey: d.triggerKey },
        },
        { tx },
      );
    });
    return this.get(id);
  }

  async makeDefault(id: string) {
    const d = await this.find(id);
    if (d.archivedAt || d.publishedVersion === null)
      throw new HttpError(409, ErrorCodes.INVALID_STATE, 'Publish the workflow before making it the default');
    if (d.isDefault) return this.get(id);
    await this.ctx.transaction(async (tx) => {
      await tx
        .update(workflowDefinitions)
        .set({ isDefault: false })
        .where(and(eq(workflowDefinitions.triggerKey, d.triggerKey), ne(workflowDefinitions.id, id)));
      await tx.update(workflowDefinitions).set({ isDefault: true }).where(eq(workflowDefinitions.id, id));
      await this.ctx.audit.record(
        {
          action: 'core.workflow-definition.default_changed',
          entityType: 'workflow_definition',
          entityId: id,
          entityLabel: d.name,
          metadata: { triggerKey: d.triggerKey },
        },
        { tx },
      );
    });
    return this.get(id);
  }

  /** Turns approval off for an optional trigger (no default definition). */
  async clearDefault(id: string) {
    const d = await this.find(id);
    if (this.engine.trigger(d.triggerKey)?.def.required)
      throw new HttpError(
        409,
        ErrorCodes.IN_USE,
        'This trigger always needs a workflow; make another one the default',
      );
    await this.ctx.transaction(async (tx) => {
      await tx.update(workflowDefinitions).set({ isDefault: false }).where(eq(workflowDefinitions.id, id));
      await this.ctx.audit.record(
        {
          action: 'core.workflow-definition.default_changed',
          entityType: 'workflow_definition',
          entityId: id,
          entityLabel: d.name,
          metadata: { triggerKey: d.triggerKey, isDefault: false },
        },
        { tx },
      );
    });
    return this.get(id);
  }

  async archive(id: string) {
    const d = await this.find(id);
    const detail = await this.get(id);
    if (detail.usedBy.forms.length || detail.usedBy.roles.length)
      throw new HttpError(
        409,
        ErrorCodes.IN_USE,
        'Detach the workflow from its forms and roles first',
        detail.usedBy,
      );
    if (d.isDefault && this.engine.trigger(d.triggerKey)?.def.required)
      throw new HttpError(409, ErrorCodes.IN_USE, 'Make another workflow the default for this trigger first');
    await this.ctx.transaction(async (tx) => {
      await tx
        .update(workflowDefinitions)
        .set({ archivedAt: new Date(), isDefault: false })
        .where(eq(workflowDefinitions.id, id));
      await this.ctx.audit.record(
        {
          action: 'core.workflow-definition.archived',
          entityType: 'workflow_definition',
          entityId: id,
          entityLabel: d.name,
        },
        { tx },
      );
    });
  }

  async restore(id: string) {
    const d = await this.find(id);
    await this.ctx.transaction(async (tx) => {
      await tx.update(workflowDefinitions).set({ archivedAt: null }).where(eq(workflowDefinitions.id, id));
      await this.ctx.audit.record(
        {
          action: 'core.workflow-definition.restored',
          entityType: 'workflow_definition',
          entityId: id,
          entityLabel: d.name,
        },
        { tx },
      );
    });
    return this.get(id);
  }

  async instances(q: z.output<typeof instanceQuerySchema>) {
    const where = and(
      q.status ? eq(workflowInstances.status, q.status) : undefined,
      q.triggerKey ? eq(workflowInstances.triggerKey, q.triggerKey) : undefined,
      q.definitionId ? eq(workflowInstances.definitionId, q.definitionId) : undefined,
      q.q ? sql`${workflowInstances.subjectLabel}::text ilike ${likePattern(q.q)}` : undefined,
    );
    const [rows, [total]] = await Promise.all([
      this.db
        .select()
        .from(workflowInstances)
        .where(where)
        .orderBy(desc(workflowInstances.startedAt), desc(workflowInstances.id))
        .limit(q.pageSize)
        .offset(pageOffset(q.page, q.pageSize)),
      this.db.select({ n: count() }).from(workflowInstances).where(where),
    ]);
    const summaries = await this.views.summaries(rows);
    return {
      items: rows.map((r) => summaries.get(r.id)!),
      total: total!.n,
      page: q.page,
      pageSize: q.pageSize,
    };
  }
}

/* ───────────────────────────── approvals inbox ───────────────────────────── */

export class ApprovalService {
  readonly views: InstanceViews;

  constructor(private readonly ctx: ModuleContext) {
    this.views = new InstanceViews(ctx);
  }

  private get engine() {
    return getKernel().workflows;
  }

  async inbox(auth: AuthContext, q: z.output<typeof approvalQuerySchema>) {
    const me = auth.user!.id;
    const where = and(
      eq(approvalTasks.assigneeId, me),
      q.status === 'pending'
        ? and(eq(approvalTasks.status, 'pending'), eq(workflowInstances.status, 'running'))
        : inArray(approvalTasks.status, ['approved', 'rejected', 'delegated']),
      q.q ? sql`${workflowInstances.subjectLabel}::text ilike ${likePattern(q.q)}` : undefined,
    );
    const order =
      q.status === 'pending'
        ? [sql`${approvalTasks.dueAt} asc nulls last`, desc(approvalTasks.createdAt)]
        : [desc(approvalTasks.decidedAt)];
    const [rows, [total]] = await Promise.all([
      this.ctx.db
        .select({ t: approvalTasks, i: workflowInstances })
        .from(approvalTasks)
        .innerJoin(workflowInstances, eq(workflowInstances.id, approvalTasks.instanceId))
        .where(where)
        .orderBy(...order)
        .limit(q.pageSize)
        .offset(pageOffset(q.page, q.pageSize)),
      this.ctx.db
        .select({ n: count() })
        .from(approvalTasks)
        .innerJoin(workflowInstances, eq(workflowInstances.id, approvalTasks.instanceId))
        .where(where),
    ]);
    const summaries = await this.views.summaries([...new Map(rows.map((r) => [r.i.id, r.i])).values()]);
    const people = await peopleById(
      this.ctx.db,
      rows.flatMap((r) => [r.t.assigneeId, r.t.delegatedFromId, r.t.decidedById]),
    );
    const items = [];
    for (const r of rows) {
      const graph = await this.engine.graph(r.i.definitionId, r.i.version);
      const step = walkSteps(graph.steps).find((s) => s.step.id === r.t.stepId)?.step;
      const trigger = this.engine.trigger(r.i.triggerKey);
      items.push({
        task: this.views.taskDto(r.t, people),
        instance: summaries.get(r.i.id)!,
        step: {
          id: r.t.stepId,
          name: step?.name ?? { en: r.t.stepId },
          instructions: step?.type === 'approval' ? (step.instructions ?? null) : null,
          mode: step?.type === 'approval' ? step.mode : ('any' as const),
          allowDelegation: step?.type === 'approval' ? step.allowDelegation !== false : false,
          fields: step?.type === 'approval' ? (step.fields ?? []) : [],
          fieldsRequiredOn: step?.type === 'approval' ? (step.fieldsRequiredOn ?? 'approve') : 'approve',
        },
        trigger: { key: r.i.triggerKey, name: trigger?.def.name ?? r.i.triggerKey, moduleId: r.i.moduleId },
      });
    }
    return { items, total: total!.n, page: q.page, pageSize: q.pageSize };
  }

  decide(
    taskId: string,
    decision: 'approve' | 'reject',
    comment: string | null | undefined,
    auth: AuthContext,
    data?: Record<string, unknown> | null,
  ) {
    return this.engine.decide(taskId, decision, comment ?? null, auth, data);
  }

  delegate(taskId: string, userId: string, comment: string | null | undefined, auth: AuthContext) {
    return this.engine.delegate(taskId, userId, comment ?? null, auth, {
      asAdmin: auth.can('core.workflows.manage'),
    });
  }

  /* ───────────── out-of-office delegations ───────────── */

  async delegations(userId: string) {
    const rows = await this.ctx.db
      .select()
      .from(approvalDelegations)
      .where(and(eq(approvalDelegations.userId, userId), gt(approvalDelegations.endsAt, new Date())))
      .orderBy(asc(approvalDelegations.startsAt));
    const people = await peopleById(
      this.ctx.db,
      rows.map((r) => r.delegateId),
    );
    const now = Date.now();
    return rows.map((r) => ({
      id: r.id,
      delegate: ref(people, r.delegateId)!,
      startsAt: r.startsAt,
      endsAt: r.endsAt,
      reason: r.reason,
      active: r.startsAt.getTime() <= now && r.endsAt.getTime() > now,
    }));
  }

  async createDelegation(userId: string, input: z.output<typeof createDelegationSchema>) {
    if (input.delegateId === userId)
      throw new HttpError(409, ErrorCodes.INVALID_DELEGATE, 'Choose someone else');
    const [delegate] = await this.ctx.db
      .select({ id: users.id, status: users.status, name: users.displayName })
      .from(users)
      .where(eq(users.id, input.delegateId));
    if (!delegate || delegate.status !== 'active')
      throw new HttpError(409, ErrorCodes.INVALID_DELEGATE, 'The delegate must be an active person');
    const [overlap] = await this.ctx.db
      .select({ id: approvalDelegations.id })
      .from(approvalDelegations)
      .where(
        and(
          eq(approvalDelegations.userId, userId),
          sql`${approvalDelegations.startsAt} < ${input.endsAt} and ${approvalDelegations.endsAt} > ${input.startsAt}`,
        ),
      );
    if (overlap)
      throw new HttpError(409, ErrorCodes.CONFLICT, 'You already delegate during part of this period');
    return this.ctx.transaction(async (tx) => {
      const [row] = await tx
        .insert(approvalDelegations)
        .values({
          userId,
          delegateId: input.delegateId,
          startsAt: input.startsAt,
          endsAt: input.endsAt,
          reason: input.reason ?? null,
        })
        .returning();
      await this.ctx.audit.record(
        {
          action: 'core.approval-delegation.created',
          entityType: 'user',
          entityId: userId,
          metadata: {
            delegateId: input.delegateId,
            delegate: delegate.name,
            startsAt: input.startsAt.toISOString(),
            endsAt: input.endsAt.toISOString(),
          },
        },
        { tx },
      );
      return row!;
    });
  }

  async deleteDelegation(userId: string, id: string) {
    const [row] = await this.ctx.db
      .select()
      .from(approvalDelegations)
      .where(and(eq(approvalDelegations.id, id), eq(approvalDelegations.userId, userId)));
    if (!row) throw httpErrors.notFound('Delegation not found');
    await this.ctx.transaction(async (tx) => {
      await tx.delete(approvalDelegations).where(eq(approvalDelegations.id, id));
      await this.ctx.audit.record(
        {
          action: 'core.approval-delegation.deleted',
          entityType: 'user',
          entityId: userId,
          metadata: { delegateId: row.delegateId },
        },
        { tx },
      );
    });
  }
}
