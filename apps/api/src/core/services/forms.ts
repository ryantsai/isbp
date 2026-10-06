import type {
  createCustomFieldSchema,
  createFormSchema,
  formListQuerySchema,
  submissionQuerySchema,
  updateCustomFieldSchema,
  updateFormSchema,
} from '@isbp/contracts';
import { formatRequestNumber } from '@isbp/contracts';
import {
  customFields,
  type FormAudience,
  formSubmissions,
  formVersions,
  forms,
  groupMembers,
  groups,
  workflowDefinitions,
} from '@isbp/db/schema';
import {
  type AuthContext,
  ErrorCodes,
  formFields,
  type FormSchema,
  HttpError,
  httpErrors,
  localize,
  type ModuleContext,
  validateFields,
  type WorkflowCompletion,
} from '@isbp/sdk/server';
import { and, asc, count, desc, eq, ilike, inArray, isNull, max, or, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { canonicalJson } from '../../kernel/crypto';
import { fieldValidationError, verifyUserFields } from '../../kernel/fields';
import { getKernel } from '../kernel-ref';
import { likePattern, pageOffset } from '../util';
import { peopleById, ref } from './people';
import { InstanceViews } from './workflows';

export const FORM_SUBMISSION_TRIGGER = 'core.form-submission';
type FormRow = typeof forms.$inferSelect;
type SubmissionRow = typeof formSubmissions.$inferSelect;

/* ───────────────────────────── custom fields (admin) ───────────────────────────── */

const ENTITY_TABLES: Record<string, string> = {
  'core.user': 'core.users',
  'core.group': 'core.groups',
  'core.department': 'core.departments',
};

export class CustomFieldAdminService {
  constructor(private readonly ctx: ModuleContext) {}

  private get registry() {
    return getKernel().fields;
  }

  private assertEntity(type: string) {
    if (!this.registry.isEntityType(type)) throw httpErrors.badRequest(`Unknown entity type "${type}"`);
  }

  async entities() {
    const counts = await this.ctx.db
      .select({ entityType: customFields.entityType, n: count() })
      .from(customFields)
      .where(isNull(customFields.archivedAt))
      .groupBy(customFields.entityType);
    return this.registry.entityTypes().map((e) => ({
      ...e,
      fieldCount: counts.find((c) => c.entityType === e.type)?.n ?? 0,
    }));
  }

  /** How many records hold a value for each key (only for core tables we know). */
  private async usage(entityType: string, keys: string[]): Promise<Map<string, number>> {
    const table = ENTITY_TABLES[entityType];
    const out = new Map<string, number>();
    if (!table || !keys.length) return out;
    const res = await this.ctx.db.execute<{ key: string; n: number }>(
      sql`select k as key, count(*)::int as n from ${sql.raw(table)}, jsonb_object_keys(attributes) k
           where k in (${sql.join(
             keys.map((k) => sql`${k}`),
             sql`, `,
           )}) group by k`,
    );
    for (const r of res.rows) out.set(r.key, r.n);
    return out;
  }

  async list(entityType: string, includeArchived: boolean) {
    this.assertEntity(entityType);
    const rows = await this.ctx.db
      .select()
      .from(customFields)
      .where(
        and(
          eq(customFields.entityType, entityType),
          includeArchived ? undefined : isNull(customFields.archivedAt),
        ),
      )
      .orderBy(asc(customFields.sortOrder), asc(customFields.createdAt));
    const usage = await this.usage(
      entityType,
      rows.map((r) => r.key),
    );
    return rows.map((r) => ({
      id: r.id,
      entityType: r.entityType,
      key: r.key,
      field: r.field,
      sortOrder: r.sortOrder,
      archived: Boolean(r.archivedAt),
      usage: usage.get(r.key) ?? 0,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));
  }

  private async find(id: string) {
    const [row] = await this.ctx.db.select().from(customFields).where(eq(customFields.id, id));
    if (!row) throw httpErrors.notFound('Custom field not found');
    return row;
  }

  async create(input: z.output<typeof createCustomFieldSchema>, auth: AuthContext) {
    this.assertEntity(input.entityType);
    const [{ last } = { last: null }] = await this.ctx.db
      .select({ last: max(customFields.sortOrder) })
      .from(customFields)
      .where(eq(customFields.entityType, input.entityType));
    const row = await this.ctx.transaction(async (tx) => {
      const [created] = await tx
        .insert(customFields)
        .values({
          entityType: input.entityType,
          key: input.field.key,
          field: input.field,
          sortOrder: (last ?? -1) + 1,
          createdBy: auth.user?.id ?? null,
        })
        .returning();
      await this.ctx.audit.record(
        {
          action: 'core.custom-field.created',
          entityType: 'custom_field',
          entityId: created!.id,
          entityLabel: `${input.entityType}.${input.field.key}`,
          metadata: { type: input.field.type, required: Boolean(input.field.required) },
        },
        { tx },
      );
      return created!;
    });
    this.registry.invalidate(input.entityType);
    return (await this.list(input.entityType, true)).find((f) => f.id === row.id)!;
  }

  async update(id: string, input: z.output<typeof updateCustomFieldSchema>) {
    const before = await this.find(id);
    if (input.field.key !== before.key || input.field.type !== before.field.type)
      throw new HttpError(409, ErrorCodes.INVALID_STATE, 'The key and type of a field cannot change');
    await this.ctx.transaction(async (tx) => {
      await tx.update(customFields).set({ field: input.field }).where(eq(customFields.id, id));
      await this.ctx.audit.record(
        {
          action: 'core.custom-field.updated',
          entityType: 'custom_field',
          entityId: id,
          entityLabel: `${before.entityType}.${before.key}`,
          changes: this.ctx.audit.diff(
            { definition: before.field as unknown as Record<string, unknown> },
            { definition: input.field as unknown as Record<string, unknown> },
          ),
        },
        { tx },
      );
    });
    this.registry.invalidate(before.entityType);
    return (await this.list(before.entityType, true)).find((f) => f.id === id)!;
  }

  async setArchived(id: string, archived: boolean) {
    const before = await this.find(id);
    await this.ctx.transaction(async (tx) => {
      await tx
        .update(customFields)
        .set({ archivedAt: archived ? new Date() : null })
        .where(eq(customFields.id, id));
      await this.ctx.audit.record(
        {
          action: archived ? 'core.custom-field.archived' : 'core.custom-field.restored',
          entityType: 'custom_field',
          entityId: id,
          entityLabel: `${before.entityType}.${before.key}`,
        },
        { tx },
      );
    });
    this.registry.invalidate(before.entityType);
  }

  async reorder(entityType: string, ids: string[]) {
    this.assertEntity(entityType);
    await this.ctx.transaction(async (tx) => {
      for (const [i, id] of ids.entries())
        await tx
          .update(customFields)
          .set({ sortOrder: i })
          .where(and(eq(customFields.id, id), eq(customFields.entityType, entityType)));
      await this.ctx.audit.record(
        {
          action: 'core.custom-field.reordered',
          entityType: 'custom_field',
          entityLabel: entityType,
          metadata: { order: ids },
        },
        { tx },
      );
    });
    this.registry.invalidate(entityType);
    return this.list(entityType, false);
  }
}

/* ───────────────────────────── forms ───────────────────────────── */

export class FormService {
  private readonly views: InstanceViews;

  constructor(private readonly ctx: ModuleContext) {
    this.views = new InstanceViews(ctx);
  }

  private get db() {
    return this.ctx.db;
  }

  private async find(id: string): Promise<FormRow> {
    const [f] = await this.db.select().from(forms).where(eq(forms.id, id));
    if (!f) throw httpErrors.notFound('Form not found');
    return f;
  }

  private async publishedSchema(f: FormRow): Promise<FormSchema | null> {
    if (f.publishedVersion === null) return null;
    const [v] = await this.db
      .select({ schema: formVersions.schema })
      .from(formVersions)
      .where(and(eq(formVersions.formId, f.id), eq(formVersions.version, f.publishedVersion)));
    return v?.schema ?? null;
  }

  private async summaries(rows: FormRow[]) {
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const [counts, wfs, versions] = await Promise.all([
      this.db
        .select({
          formId: formSubmissions.formId,
          n: count(),
          pending: sql<number>`count(*) filter (where ${formSubmissions.status} = 'pending')::int`,
        })
        .from(formSubmissions)
        .where(inArray(formSubmissions.formId, ids))
        .groupBy(formSubmissions.formId),
      this.db
        .select({ id: workflowDefinitions.id, name: workflowDefinitions.name })
        .from(workflowDefinitions)
        .where(
          inArray(
            workflowDefinitions.id,
            rows
              .map((r) => r.workflowDefinitionId)
              .filter((x): x is string => Boolean(x))
              .concat('00000000-0000-0000-0000-000000000000'),
          ),
        ),
      this.db
        .select({ formId: formVersions.formId, version: formVersions.version, schema: formVersions.schema })
        .from(formVersions)
        .where(inArray(formVersions.formId, ids)),
    ]);
    return rows.map((r) => {
      const c = counts.find((x) => x.formId === r.id);
      const pub = versions.find((v) => v.formId === r.id && v.version === r.publishedVersion);
      return {
        id: r.id,
        key: r.key,
        name: r.name,
        description: r.description,
        icon: r.icon,
        category: r.category,
        publishedVersion: r.publishedVersion,
        active: r.active,
        archived: Boolean(r.archivedAt),
        hasUnpublishedChanges: !pub || canonicalJson(pub.schema) !== canonicalJson(r.draft),
        fieldCount: formFields(r.draft).length,
        workflow: r.workflowDefinitionId
          ? {
              id: r.workflowDefinitionId,
              name: wfs.find((w) => w.id === r.workflowDefinitionId)?.name ?? '?',
            }
          : null,
        audience: r.audience,
        submissionCount: c?.n ?? 0,
        pendingCount: c?.pending ?? 0,
        updatedAt: r.updatedAt,
        published: pub?.schema ?? null,
      };
    });
  }

  async list(q: z.output<typeof formListQuerySchema>) {
    const like = q.q ? likePattern(q.q) : null;
    const rows = await this.db
      .select()
      .from(forms)
      .where(
        and(
          q.includeArchived ? undefined : isNull(forms.archivedAt),
          like
            ? or(
                ilike(forms.key, like),
                sql`${forms.name}->>'en' ilike ${like}`,
                sql`${forms.name}->>'zh-TW' ilike ${like}`,
                sql`${forms.name}->>'ja-JP' ilike ${like}`,
              )
            : undefined,
        ),
      )
      .orderBy(asc(forms.category), asc(forms.key));
    return (await this.summaries(rows)).map(({ published: _p, ...s }) => s);
  }

  async get(id: string) {
    const f = await this.find(id);
    const [summary] = await this.summaries([f]);
    const versions = await this.db
      .select()
      .from(formVersions)
      .where(eq(formVersions.formId, id))
      .orderBy(desc(formVersions.version));
    const people = await peopleById(
      this.db,
      versions.map((v) => v.publishedBy),
    );
    return {
      ...summary!,
      draft: f.draft,
      versions: versions.map((v) => ({
        version: v.version,
        publishedAt: v.publishedAt,
        publishedBy: ref(people, v.publishedBy),
      })),
    };
  }

  async create(input: z.output<typeof createFormSchema>, auth: AuthContext) {
    const row = await this.ctx.transaction(async (tx) => {
      const [f] = await tx
        .insert(forms)
        .values({
          key: input.key,
          name: input.name,
          description: input.description ?? null,
          icon: input.icon ?? 'file-text',
          category: input.category ?? null,
          draft: { elements: [] },
          createdBy: auth.user?.id ?? null,
          updatedBy: auth.user?.id ?? null,
        })
        .returning();
      await this.ctx.audit.record(
        { action: 'core.form.created', entityType: 'form', entityId: f!.id, entityLabel: input.key },
        { tx },
      );
      return f!;
    });
    return this.get(row.id);
  }

  private async assertWorkflow(id: string | null | undefined) {
    if (!id) return;
    const [w] = await this.db.select().from(workflowDefinitions).where(eq(workflowDefinitions.id, id));
    if (!w || w.archivedAt || w.triggerKey !== FORM_SUBMISSION_TRIGGER)
      throw httpErrors.badRequest('Choose a form-submission workflow');
  }

  async update(id: string, input: z.output<typeof updateFormSchema>, auth: AuthContext) {
    const before = await this.find(id);
    await this.assertWorkflow(input.workflowDefinitionId);
    const patch = {
      name: input.name,
      description: input.description,
      icon: input.icon,
      category: input.category,
      draft: input.draft,
      workflowDefinitionId: input.workflowDefinitionId,
      audience: input.audience as FormAudience | undefined,
      active: input.active,
      updatedBy: auth.user?.id ?? null,
    };
    const changes = this.ctx.audit.diff(
      {
        name: before.name,
        description: before.description,
        icon: before.icon,
        category: before.category,
        workflowDefinitionId: before.workflowDefinitionId,
        audience: before.audience,
        active: before.active,
      } as Record<string, unknown>,
      { ...patch, draft: undefined, updatedBy: undefined } as Record<string, unknown>,
    );
    const draftChanged =
      input.draft !== undefined && canonicalJson(input.draft) !== canonicalJson(before.draft);
    await this.ctx.transaction(async (tx) => {
      await tx.update(forms).set(patch).where(eq(forms.id, id));
      if (Object.keys(changes).length || draftChanged)
        await this.ctx.audit.record(
          {
            action: 'core.form.updated',
            entityType: 'form',
            entityId: id,
            entityLabel: before.key,
            changes,
            metadata: { draftChanged },
          },
          { tx },
        );
    });
    return this.get(id);
  }

  async publish(id: string, auth: AuthContext) {
    const f = await this.find(id);
    if (f.archivedAt)
      throw new HttpError(409, ErrorCodes.INVALID_STATE, 'Archived forms cannot be published');
    if (!formFields(f.draft).length)
      throw new HttpError(409, ErrorCodes.INVALID_STATE, 'Add at least one field before publishing');
    if (f.workflowDefinitionId) {
      const [w] = await this.db
        .select({ v: workflowDefinitions.publishedVersion })
        .from(workflowDefinitions)
        .where(eq(workflowDefinitions.id, f.workflowDefinitionId));
      if (!w || w.v === null)
        throw new HttpError(409, ErrorCodes.WORKFLOW_NOT_CONFIGURED, 'Publish the attached workflow first');
    }
    const version = (f.publishedVersion ?? 0) + 1;
    await this.ctx.transaction(async (tx) => {
      await tx
        .insert(formVersions)
        .values({ formId: id, version, schema: f.draft, publishedBy: auth.user?.id ?? null });
      await tx
        .update(forms)
        .set({ publishedVersion: version, updatedBy: auth.user?.id ?? null })
        .where(eq(forms.id, id));
      await this.ctx.audit.record(
        {
          action: 'core.form.published',
          entityType: 'form',
          entityId: id,
          entityLabel: f.key,
          metadata: { version },
        },
        { tx },
      );
    });
    return this.get(id);
  }

  async setArchived(id: string, archived: boolean) {
    const f = await this.find(id);
    await this.ctx.transaction(async (tx) => {
      await tx
        .update(forms)
        .set({ archivedAt: archived ? new Date() : null })
        .where(eq(forms.id, id));
      await this.ctx.audit.record(
        {
          action: archived ? 'core.form.archived' : 'core.form.restored',
          entityType: 'form',
          entityId: id,
          entityLabel: f.key,
        },
        { tx },
      );
    });
  }

  /* ───────────── portal side ───────────── */

  private async memberGroupKeys(userId: string): Promise<Set<string>> {
    const rows = await this.db
      .select({ key: groups.key })
      .from(groupMembers)
      .innerJoin(groups, eq(groups.id, groupMembers.groupId))
      .where(eq(groupMembers.userId, userId));
    return new Set(rows.map((r) => r.key));
  }

  private audienceAllows(audience: FormAudience, memberOf: Set<string>) {
    return audience.type === 'everyone' || audience.groupKeys.some((k) => memberOf.has(k));
  }

  /** Forms the viewer can submit. */
  async catalog(auth: AuthContext) {
    const rows = await this.db
      .select()
      .from(forms)
      .where(
        and(isNull(forms.archivedAt), eq(forms.active, true), sql`${forms.publishedVersion} is not null`),
      )
      .orderBy(asc(forms.category), asc(forms.key));
    const memberOf = await this.memberGroupKeys(auth.user!.id);
    return rows
      .filter((f) => this.audienceAllows(f.audience, memberOf))
      .map((f) => ({
        id: f.id,
        key: f.key,
        name: f.name,
        description: f.description,
        icon: f.icon,
        category: f.category,
        hasApproval: Boolean(f.workflowDefinitionId),
      }));
  }

  private async available(key: string, auth: AuthContext) {
    const [f] = await this.db.select().from(forms).where(eq(forms.key, key));
    const schema = f ? await this.publishedSchema(f) : null;
    if (
      !f ||
      !schema ||
      f.archivedAt ||
      !f.active ||
      !this.audienceAllows(f.audience, await this.memberGroupKeys(auth.user!.id))
    )
      throw new HttpError(404, ErrorCodes.FORM_NOT_AVAILABLE, 'This form is not available');
    return { form: f, schema };
  }

  async published(key: string, auth: AuthContext) {
    const { form, schema } = await this.available(key, auth);
    return {
      id: form.id,
      key: form.key,
      name: form.name,
      description: form.description,
      icon: form.icon,
      version: form.publishedVersion!,
      schema,
      hasApproval: Boolean(form.workflowDefinitionId),
    };
  }

  async submit(key: string, data: Record<string, unknown>, auth: AuthContext) {
    const { form, schema } = await this.available(key, auth);
    const fields = formFields(schema);
    const result = validateFields(fields, data);
    const errors = {
      ...result.errors,
      ...(result.ok ? await verifyUserFields(this.db, fields, result.values) : {}),
    };
    if (Object.keys(errors).length) throw fieldValidationError(errors, 'data');
    const me = auth.user!;
    const created = await this.ctx.transaction(async (tx) => {
      const [sub] = await tx
        .insert(formSubmissions)
        .values({ formId: form.id, version: form.publishedVersion!, submittedBy: me.id, data: result.values })
        .returning();
      const reference = formatRequestNumber(sub!.number);
      const started = form.workflowDefinitionId
        ? await this.ctx.workflows.start(
            FORM_SUBMISSION_TRIGGER,
            {
              subject: {
                type: 'form-submission',
                id: sub!.id,
                label: Object.fromEntries(
                  (['en', 'zh-TW', 'ja-JP'] as const).map((l) => [
                    l,
                    `${reference} · ${localize(form.name, l)} — ${me.displayName}`,
                  ]),
                ),
                href: `/requests/${reference}`,
              },
              facts: { form: { key: form.key, category: form.category }, data: result.values },
              requesterId: me.id,
              definitionId: form.workflowDefinitionId,
            },
            { tx },
          )
        : null;
      if (started)
        await tx
          .update(formSubmissions)
          .set({ status: 'pending', workflowInstanceId: started.instanceId })
          .where(eq(formSubmissions.id, sub!.id));
      const evt = { submissionId: sub!.id, number: sub!.number, formId: form.id };
      await this.ctx.audit.record(
        {
          action: 'core.form-submission.created',
          entityType: 'form_submission',
          entityId: sub!.id,
          entityLabel: `${reference} ${form.key}`,
          metadata: { form: form.key, version: form.publishedVersion, approval: Boolean(started) },
        },
        { tx },
      );
      await this.ctx.events.publish('core.form-submission.created', evt, { tx });
      return sub!;
    });
    return this.submission(created.id, auth);
  }

  async onWorkflowCompleted(result: WorkflowCompletion) {
    const [sub] = await this.db
      .select()
      .from(formSubmissions)
      .where(eq(formSubmissions.id, result.subjectId));
    if (!sub || sub.status !== 'pending') return;
    const [form] = await this.db.select().from(forms).where(eq(forms.id, sub.formId));
    const status = result.outcome;
    const reference = formatRequestNumber(sub.number);
    await this.ctx.transaction(async (tx) => {
      await tx
        .update(formSubmissions)
        .set({ status, completedAt: new Date() })
        .where(eq(formSubmissions.id, sub.id));
      await this.ctx.audit.record(
        {
          action: 'core.form-submission.completed',
          entityType: 'form_submission',
          entityId: sub.id,
          entityLabel: `${reference} ${form?.key ?? ''}`,
          metadata: { status, comment: result.comment },
        },
        { tx },
      );
      await this.ctx.events.publish(
        'core.form-submission.completed',
        { submissionId: sub.id, number: sub.number, formId: sub.formId, status },
        { tx },
      );
      if (status !== 'cancelled')
        await this.ctx.notifications.notify(
          {
            type: status === 'approved' ? 'core.form-submission.approved' : 'core.form-submission.rejected',
            recipients: [sub.submittedBy],
            params: { reference, form: form?.name ?? { en: '?' }, comment: result.comment ?? '' },
            href: `/requests/${reference}`,
          },
          { tx },
        );
    });
  }

  private async canView(sub: SubmissionRow, auth: AuthContext) {
    const me = auth.user?.id;
    if (me && sub.submittedBy === me) return true;
    if (auth.can('core.forms.manage') || auth.can('core.workflows.read')) return true;
    return Boolean(
      me && sub.workflowInstanceId && (await getKernel().workflows.involves(sub.workflowInstanceId, me)),
    );
  }

  async submission(id: string, auth: AuthContext) {
    const [sub] = await this.db.select().from(formSubmissions).where(eq(formSubmissions.id, id));
    if (!sub || !(await this.canView(sub, auth))) throw httpErrors.notFound('Submission not found');
    const [form] = await this.db.select().from(forms).where(eq(forms.id, sub.formId));
    const [v] = await this.db
      .select({ schema: formVersions.schema })
      .from(formVersions)
      .where(and(eq(formVersions.formId, sub.formId), eq(formVersions.version, sub.version)));
    const schema = v?.schema ?? { elements: [] };
    const userIds = formFields(schema)
      .filter((f) => f.type === 'user')
      .map((f) => sub.data[f.key])
      .filter((x): x is string => typeof x === 'string');
    const people = await peopleById(this.db, [sub.submittedBy, ...userIds]);
    const workflow = await this.views.summaryOf(sub.workflowInstanceId);
    return {
      id: sub.id,
      number: sub.number,
      reference: formatRequestNumber(sub.number),
      form: { id: form!.id, key: form!.key, name: form!.name, icon: form!.icon },
      version: sub.version,
      schema,
      data: sub.data,
      people: Object.fromEntries(userIds.map((id) => [id, people.get(id)?.displayName ?? '?'])),
      status: sub.status,
      submittedBy: ref(people, sub.submittedBy),
      createdAt: sub.createdAt,
      completedAt: sub.completedAt,
      workflow,
      canCancel: sub.status === 'pending' && sub.submittedBy === auth.user?.id,
    };
  }

  async byNumber(number: number, auth: AuthContext) {
    const [sub] = await this.db
      .select({ id: formSubmissions.id })
      .from(formSubmissions)
      .where(eq(formSubmissions.number, number));
    return sub ? this.submission(sub.id, auth) : null;
  }

  async cancel(id: string, reason: string | null | undefined, auth: AuthContext) {
    const [sub] = await this.db.select().from(formSubmissions).where(eq(formSubmissions.id, id));
    if (!sub || sub.submittedBy !== auth.user?.id) throw httpErrors.notFound('Submission not found');
    if (sub.status !== 'pending')
      throw new HttpError(409, ErrorCodes.INVALID_STATE, 'Only pending submissions can be cancelled');
    await this.ctx.transaction(async (tx) => {
      await tx
        .update(formSubmissions)
        .set({ status: 'cancelled', completedAt: new Date() })
        .where(eq(formSubmissions.id, id));
      if (sub.workflowInstanceId)
        await this.ctx.workflows.cancel(sub.workflowInstanceId, reason ?? null, { tx });
      await this.ctx.audit.record(
        {
          action: 'core.form-submission.cancelled',
          entityType: 'form_submission',
          entityId: id,
          entityLabel: formatRequestNumber(sub.number),
          metadata: { reason: reason ?? null },
        },
        { tx },
      );
    });
    return this.submission(id, auth);
  }

  async submissions(formId: string, q: z.output<typeof submissionQuerySchema>) {
    await this.find(formId);
    const where = and(
      eq(formSubmissions.formId, formId),
      q.status ? eq(formSubmissions.status, q.status) : undefined,
    );
    const [rows, [total]] = await Promise.all([
      this.db
        .select()
        .from(formSubmissions)
        .where(where)
        .orderBy(desc(formSubmissions.createdAt))
        .limit(q.pageSize)
        .offset(pageOffset(q.page, q.pageSize)),
      this.db.select({ n: count() }).from(formSubmissions).where(where),
    ]);
    const people = await peopleById(
      this.db,
      rows.map((r) => r.submittedBy),
    );
    return {
      items: rows.map((r) => ({
        id: r.id,
        number: r.number,
        reference: formatRequestNumber(r.number),
        status: r.status,
        submittedBy: ref(people, r.submittedBy),
        createdAt: r.createdAt,
        completedAt: r.completedAt,
      })),
      total: total!.n,
      page: q.page,
      pageSize: q.pageSize,
    };
  }
}
