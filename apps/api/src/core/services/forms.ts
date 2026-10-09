import type {
  createCustomFieldSchema,
  createFormSchema,
  formBuilderPreviewInputSchema,
  formListQuerySchema,
  processChecksInputSchema,
  submissionQuerySchema,
  updateCustomFieldSchema,
  updateFormSchema,
} from '@isbp/contracts';
import { formatRequestNumber } from '@isbp/contracts';
import {
  applications,
  customFields,
  type FormAudience,
  formSubmissions,
  formVersions,
  forms,
  groupMembers,
  groups,
  roleAssignments,
  rolePermissions,
  roles,
  users,
  workflowDefinitions,
} from '@isbp/db/schema';
import {
  type AuthContext,
  ErrorCodes,
  expandRowFields,
  type FieldDef,
  formFields,
  type FormSchema,
  HttpError,
  httpErrors,
  isField,
  localize,
  type ModuleContext,
  PermissionSet,
  validateFields,
  validateForm,
  type WorkflowCompletion,
} from '@isbp/sdk/server';
import {
  and,
  asc,
  count,
  countDistinct,
  desc,
  eq,
  gt,
  ilike,
  inArray,
  isNull,
  max,
  or,
  sql,
} from 'drizzle-orm';
import type { z } from 'zod';
import { canonicalJson } from '../../kernel/crypto';
import { EVERYONE_GROUP_KEY, PLATFORM_APP_KEY } from '../../kernel/rbac';
import {
  fieldValidationError,
  recordFieldFacts,
  verifyRecordFields,
  verifyUserFields,
} from '../../kernel/fields';
import { maskFormSecrets, publicFormSchema } from '../../kernel/process-actions';
import { getKernel } from '../kernel-ref';
import { likePattern, pageOffset } from '../util';
import { approverFields } from './approval-preview';
import { FormAssignmentService } from './form-assignments';
import { peopleById, ref } from './people';
import { accessOf } from './request-access';
import { NO_APPROVAL_PATH, requestPath } from './request-path';
import { InstanceViews } from './workflows';

export const FORM_SUBMISSION_TRIGGER = 'core.form-submission';
/** `source.type` of the reminders a request's actions schedule (`source.id` is the submission). */
export const REMINDER_SOURCE = 'form-submission';
type FormRow = typeof forms.$inferSelect;
type SubmissionRow = typeof formSubmissions.$inferSelect;

/**
 * Record fields may only offer declared record types; types a field newly offers must be ones the editor may pick
 * from themselves (types already on the field stay, whoever edits it). Paths are relative to `prefix`.
 */
export function assertRecordFieldTypes(
  fields: readonly FieldDef[],
  before: readonly FieldDef[],
  auth: AuthContext | null,
  path: (index: number) => string,
) {
  const records = getKernel().records;
  const pickable = auth ? new Set(records.types(auth).map((t) => t.type)) : null;
  const check = (f: FieldDef, was: readonly FieldDef[], at: string) => {
    if (f.type !== 'record') return;
    const had = new Set(was.find((b) => b.key === f.key && b.type === 'record')?.record?.types ?? []);
    for (const type of f.record?.types ?? []) {
      const known = Boolean(records.entry(type));
      if (known && (had.has(type) || !pickable || pickable.has(type))) continue;
      throw new HttpError(400, ErrorCodes.VALIDATION_FAILED, `Record type "${type}" can't be offered here`, {
        issues: [{ path: at, message: known ? 'Record type not available to you' : 'Unknown record type' }],
      });
    }
  };
  fields.forEach((f, i) => {
    if (f.type !== 'rows') return check(f, before, path(i));
    // A table's record columns, compared with the same table's columns before.
    const was = before.find((b) => b.key === f.key && b.type === 'rows')?.rows?.fields ?? [];
    f.rows?.fields.forEach((c, j) =>
      check(c, was, path(i).replace(/record\.types$/, `rows.fields.${j}.record.types`)),
    );
  });
}

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
    assertRecordFieldTypes([input.field], [], auth, () => 'field.record.types');
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

  async update(id: string, input: z.output<typeof updateCustomFieldSchema>, auth?: AuthContext) {
    const before = await this.find(id);
    if (input.field.key !== before.key || input.field.type !== before.field.type)
      throw new HttpError(409, ErrorCodes.INVALID_STATE, 'The key and type of a field cannot change');
    assertRecordFieldTypes([input.field], [before.field], auth ?? null, () => 'field.record.types');
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
      // Secrets in process actions never leave the server (the builder sees `{ set: true }`).
      draft: maskFormSecrets(f.draft),
      published: summary!.published ? maskFormSecrets(summary!.published) : null,
      versions: versions.map((v) => ({
        version: v.version,
        publishedAt: v.publishedAt,
        publishedBy: ref(people, v.publishedBy),
      })),
    };
  }

  /** Creates the form (audited) and returns its row, without reading the view back (`create` does). */
  async createRow(input: z.output<typeof createFormSchema>, auth: AuthContext): Promise<FormRow> {
    return this.ctx.transaction(async (tx) => {
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
  }

  async create(input: z.output<typeof createFormSchema>, auth: AuthContext) {
    const row = await this.createRow(input, auth);
    return this.get(row.id);
  }

  /**
   * The draft to store: its process actions checked against their types (fields, permissions, the handler's own
   * rules) and their secrets sealed. Like the rest of the draft, `actions` is the whole list (left out: none).
   */
  private async withActions(next: FormSchema, current: FormSchema, auth: AuthContext): Promise<FormSchema> {
    if (!next.actions) return next;
    const actions = await getKernel().processActions.prepare(next, current.actions, auth, { db: this.db });
    return { ...next, actions };
  }

  private async assertWorkflow(id: string | null | undefined) {
    if (!id) return;
    const [w] = await this.db.select().from(workflowDefinitions).where(eq(workflowDefinitions.id, id));
    if (!w || w.archivedAt || w.triggerKey !== FORM_SUBMISSION_TRIGGER)
      throw httpErrors.badRequest('Choose a form-submission workflow');
  }

  /** Saves the form's details and draft (audited), without reading the view back (`update` does). */
  async updateRow(id: string, input: z.output<typeof updateFormSchema>, auth: AuthContext): Promise<void> {
    const before = await this.find(id);
    await this.assertWorkflow(input.workflowDefinitionId);
    // The workflow a form names applies at once (it isn't versioned with the form): a live form may only switch to
    // one that can run, or every new request would fail.
    if (
      input.workflowDefinitionId &&
      input.workflowDefinitionId !== before.workflowDefinitionId &&
      before.publishedVersion !== null
    ) {
      const [w] = await this.db
        .select({ v: workflowDefinitions.publishedVersion })
        .from(workflowDefinitions)
        .where(eq(workflowDefinitions.id, input.workflowDefinitionId));
      if (!w || w.v === null)
        throw new HttpError(
          409,
          ErrorCodes.WORKFLOW_NOT_CONFIGURED,
          'Publish the workflow before a live form uses it',
        );
    }
    if (input.draft) {
      const elements = input.draft.elements;
      assertRecordFieldTypes(
        elements.filter(isField),
        formFields(before.draft),
        auth,
        (i) => `draft.elements.${elements.indexOf(elements.filter(isField)[i]!)}.record.types`,
      );
    }
    const draft = input.draft ? await this.withActions(input.draft, before.draft, auth) : undefined;
    const patch = {
      name: input.name,
      description: input.description,
      icon: input.icon,
      category: input.category,
      draft,
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
    const draftChanged = draft !== undefined && canonicalJson(draft) !== canonicalJson(before.draft);
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
  }

  async update(id: string, input: z.output<typeof updateFormSchema>, auth: AuthContext) {
    await this.updateRow(id, input, auth);
    return this.get(id);
  }

  async publish(id: string, auth: AuthContext) {
    await this.publishRow(id, auth);
    return this.get(id);
  }

  /** Publishes the draft as the next version (audited), without reading the view back (`publish` does). */
  async publishRow(id: string, auth: AuthContext): Promise<void> {
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
    // Actions going live are checked again: configs against today's data, permissions for what is new since the
    // published version (someone else may have added it to the draft).
    const live = await this.publishedSchema(f);
    const actions = f.draft.actions
      ? await getKernel().processActions.prepare(maskFormSecrets(f.draft), live?.actions, auth, {
          sealedFrom: f.draft.actions,
          db: this.db,
        })
      : undefined;
    const schema: FormSchema = actions ? { ...f.draft, actions } : f.draft;
    const version = (f.publishedVersion ?? 0) + 1;
    await this.ctx.transaction(async (tx) => {
      await tx
        .insert(formVersions)
        .values({ formId: id, version, schema, publishedBy: auth.user?.id ?? null });
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

  /* ───────────── building a process ───────────── */

  /**
   * "Before you publish": whether the audience can see the records the form's record fields offer (through the
   * audience itself — Everyone or its groups), and how many people the approval's groups and roles hold.
   */
  async processChecks(input: z.output<typeof processChecksInputSchema>) {
    const records = getKernel().records;
    const audienceKeys = input.audience.type === 'groups' ? input.audience.groupKeys : [];
    const now = new Date();
    const live = or(isNull(roleAssignments.expiresAt), gt(roleAssignments.expiresAt, now));
    const [granted, platformRoles] = await Promise.all([
      this.db
        .select({ groupKey: groups.key, permission: rolePermissions.permission })
        .from(roleAssignments)
        .innerJoin(groups, eq(groups.id, roleAssignments.groupId))
        .innerJoin(roles, eq(roles.id, roleAssignments.roleId))
        .innerJoin(
          applications,
          and(eq(applications.id, roles.applicationId), eq(applications.key, PLATFORM_APP_KEY)),
        )
        .innerJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
        .where(and(inArray(groups.key, [EVERYONE_GROUP_KEY, ...audienceKeys]), live)),
      this.db
        .select({
          key: roles.key,
          name: roles.name,
          moduleId: roles.moduleId,
          permission: rolePermissions.permission,
        })
        .from(roles)
        .innerJoin(
          applications,
          and(eq(applications.id, roles.applicationId), eq(applications.key, PLATFORM_APP_KEY)),
        )
        .innerJoin(rolePermissions, eq(rolePermissions.roleId, roles.id)),
    ]);
    const permsOf = (key: string) =>
      new PermissionSet(
        granted.filter((g) => g.groupKey === key).map((g) => ({ p: g.permission, s: 'g' as const })),
      );
    const everyone = permsOf(EVERYONE_GROUP_KEY);
    const audienceGroups = audienceKeys.length
      ? await this.db
          .select({ key: groups.key, name: groups.name })
          .from(groups)
          .where(inArray(groups.key, audienceKeys))
      : [];
    // The narrowest roles first: those naming the permission itself before wildcards (`alm.*`, then `*`), then the
    // ones with fewer permissions — the role to give people is usually a viewer role.
    const size = new Map<string, number>();
    for (const r of platformRoles) size.set(r.key, (size.get(r.key) ?? 0) + 1);
    const rolesWith = (permission: string) => {
      const out = new Map<string, { key: string; name: string; moduleId: string | null; rank: number }>();
      for (const r of platformRoles) {
        if (!new PermissionSet([{ p: r.permission, s: 'g' }]).hasAny(permission)) continue;
        const rank = r.permission === permission ? 0 : r.permission === '*' ? 2 : 1;
        const had = out.get(r.key);
        if (!had || rank < had.rank) out.set(r.key, { key: r.key, name: r.name, moduleId: r.moduleId, rank });
      }
      return [...out.values()]
        .sort(
          (a, b) =>
            a.rank - b.rank ||
            (size.get(a.key) ?? 0) - (size.get(b.key) ?? 0) ||
            a.name.localeCompare(b.name),
        )
        .map(({ rank: _rank, ...role }) => role);
    };
    const recordChecks = [...new Set(input.recordTypes)].flatMap((type) => {
      const entry = records.entry(type);
      if (!entry) return [];
      const permission = entry.def.permission;
      const helps = rolesWith(permission);
      const viaEveryone = everyone.hasAny(permission);
      const groupsWithout = viaEveryone
        ? []
        : audienceGroups.filter((g) => !permsOf(g.key).hasAny(permission));
      const covered =
        viaEveryone ||
        (input.audience.type === 'groups' && audienceGroups.length > 0 && !groupsWithout.length);
      return [
        {
          type,
          reach: covered ? ('all' as const) : helps.length ? ('some' as const) : ('none' as const),
          groupsWithout: input.audience.type === 'groups' ? groupsWithout : [],
          roles: helps,
        },
      ];
    });

    const groupKeys = [...new Set(input.groupKeys)];
    const roleKeys = [...new Set(input.roleKeys)];
    const [groupRows, roleRows] = await Promise.all([
      groupKeys.length
        ? this.db
            .select({ key: groups.key, name: groups.name, members: countDistinct(users.id) })
            .from(groups)
            .leftJoin(groupMembers, eq(groupMembers.groupId, groups.id))
            .leftJoin(users, and(eq(users.id, groupMembers.userId), eq(users.status, 'active')))
            .where(inArray(groups.key, groupKeys))
            .groupBy(groups.key, groups.name)
        : Promise.resolve([]),
      roleKeys.length
        ? this.db
            .select({
              key: roles.key,
              name: roles.name,
              moduleId: roles.moduleId,
              holders: sql<number>`count(distinct coalesce(${roleAssignments.userId}::text, ${groupMembers.userId}::text))::int`,
            })
            .from(roles)
            .innerJoin(
              applications,
              and(eq(applications.id, roles.applicationId), eq(applications.key, PLATFORM_APP_KEY)),
            )
            .leftJoin(roleAssignments, and(eq(roleAssignments.roleId, roles.id), live))
            .leftJoin(groupMembers, eq(groupMembers.groupId, roleAssignments.groupId))
            .where(inArray(roles.key, roleKeys))
            .groupBy(roles.key, roles.name, roles.moduleId)
        : Promise.resolve([]),
    ]);
    return {
      records: recordChecks,
      groups: groupRows.map((g) => ({ key: g.key, name: g.name, members: Number(g.members) })),
      roles: roleRows.map((r) => ({
        key: r.key,
        name: r.name,
        moduleId: r.moduleId,
        holders: Number(r.holders),
      })),
    };
  }

  /**
   * "Who will approve this?" while building: the unsaved questions and approval, answered with sample values, as
   * `asUserId` (default: you). Answers that aren't valid yet are left out, and so are records you can't read.
   */
  async builderPreview(id: string, input: z.output<typeof formBuilderPreviewInputSchema>, auth: AuthContext) {
    const f = await this.find(id);
    if (!input.graph?.steps.length) return { steps: [] };
    const schema = input.draft;
    const { values } = validateFields(formFields(schema), input.data);
    for (const k of Object.keys(await this.referenceErrors(schema, values, auth))) delete values[k];
    const facts = await this.workflowFacts(
      { ...f, category: input.category === undefined ? f.category : input.category },
      schema,
      values,
    );
    const result = await getKernel().workflows.preview(
      FORM_SUBMISSION_TRIGGER,
      { facts, requesterId: input.asUserId ?? auth.user!.id },
      { graph: input.graph },
    );
    if (!result) return { steps: [] };
    const people = await peopleById(
      this.db,
      result.steps.flatMap((s) => [...s.people, ...(s.counted ?? []).map((c) => c.id)]),
    );
    return {
      steps: result.steps.map((s) => ({
        id: s.id,
        name: s.name,
        type: s.type,
        outcome: s.outcome,
        people: s.people.map((pid) => ref(people, pid)!),
        ...(s.counted
          ? { counted: s.counted.map((c) => ({ person: ref(people, c.id)!, approvedAt: c.approvedAt })) }
          : {}),
      })),
    };
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

  /** `assignedFormId`: the form of an open assignment of the person — it is theirs to fill in, whatever its audience. */
  private async available(key: string, auth: AuthContext, assignedFormId?: string) {
    const [f] = await this.db.select().from(forms).where(eq(forms.key, key));
    const schema = f ? await this.publishedSchema(f) : null;
    if (
      !f ||
      !schema ||
      f.archivedAt ||
      !f.active ||
      (f.id !== assignedFormId && !this.audienceAllows(f.audience, await this.memberGroupKeys(auth.user!.id)))
    )
      throw new HttpError(404, ErrorCodes.FORM_NOT_AVAILABLE, 'This form is not available');
    return { form: f, schema };
  }

  async published(key: string, auth: AuthContext, assignmentId?: string) {
    const assigned = await new FormAssignmentService(this.ctx).openFormIdFor(assignmentId, auth);
    const { form, schema } = await this.available(key, auth, assigned);
    return {
      id: form.id,
      key: form.key,
      name: form.name,
      description: form.description,
      icon: form.icon,
      version: form.publishedVersion!,
      schema: publicFormSchema(schema),
      hasApproval: Boolean(form.workflowDefinitionId),
    };
  }

  /** People and records the answers refer to must exist; records must be readable by `auth` and match `where`. */
  private async referenceErrors(schema: FormSchema, values: Record<string, unknown>, auth: AuthContext) {
    const fields = formFields(schema);
    const records = getKernel().records;
    const [people, picked] = await Promise.all([
      verifyUserFields(this.db, fields, values),
      verifyRecordFields(records, fields, values, auth),
    ]);
    return { ...people, ...picked };
  }

  /** Workflow facts of a submission: the form, the answers (`data`) and the picked records' facts (`records`). */
  private async workflowFacts(form: FormRow, schema: FormSchema, values: Record<string, unknown>) {
    const records = getKernel().records;
    return {
      form: { key: form.key, category: form.category },
      data: values,
      records: await recordFieldFacts(formFields(schema), values, (refs) => records.facts(refs)),
    };
  }

  /**
   * "Who will approve this?" for the answers so far (nothing is saved): the steps of the attached workflow with the
   * people they would ask, using the same facts a submission would. Answers that aren't valid yet are left out, and
   * so are records the person can't read.
   */
  async preview(key: string, data: Record<string, unknown>, auth: AuthContext, assignmentId?: string) {
    const assigned = await new FormAssignmentService(this.ctx).openFormIdFor(assignmentId, auth);
    const { form, schema } = await this.available(key, auth, assigned);
    if (!form.workflowDefinitionId) return { steps: [] };
    const { values } = validateFields(formFields(schema), data);
    for (const k of Object.keys(await this.referenceErrors(schema, values, auth))) delete values[k];
    const result = await getKernel().workflows.preview(FORM_SUBMISSION_TRIGGER, {
      facts: await this.workflowFacts(form, schema, values),
      requesterId: auth.user!.id,
      definitionId: form.workflowDefinitionId,
    });
    if (!result) return { steps: [] };
    const people = await peopleById(
      this.db,
      result.steps.flatMap((s) => [...s.people, ...(s.counted ?? []).map((c) => c.id)]),
    );
    const dependsOn = await approverFields(this.ctx, result.definition.id);
    return {
      steps: result.steps.map((s) => ({
        id: s.id,
        name: s.name,
        type: s.type,
        outcome: s.outcome,
        people: s.people.map((id) => ref(people, id)!),
        ...(s.counted
          ? { counted: s.counted.map((c) => ({ person: ref(people, c.id)!, approvedAt: c.approvedAt })) }
          : {}),
        dependsOn: dependsOn.get(s.id) ?? [],
      })),
    };
  }

  /**
   * `assignmentId`: the person's open assignment this submission completes (in the same transaction; one submission
   * per assignment). 404 unknown, 403 not theirs, 409 `ASSIGNMENT_CLOSED`, 400 for another form.
   */
  async submit(
    key: string,
    data: Record<string, unknown>,
    auth: AuthContext,
    opts: { assignmentId?: string } = {},
  ) {
    const assignments = new FormAssignmentService(this.ctx);
    const assignment = opts.assignmentId ? await assignments.forSubmission(opts.assignmentId, auth) : null;
    if (assignment && !(await assignments.isFor(assignment, key)))
      throw new HttpError(400, ErrorCodes.BAD_REQUEST, 'This assignment is for another form');
    const { form, schema } = await this.available(key, auth, assignment?.formId);
    // Fields, then the form's rules (the same `validateForm` the browser runs), then what the answers refer to.
    const result = validateForm(schema, data);
    const fieldsOk = Object.values(result.errors).every((e) => e.code === 'rule');
    const errors = {
      ...result.errors,
      ...(fieldsOk ? await this.referenceErrors(schema, result.values, auth) : {}),
    };
    if (Object.keys(errors).length) throw fieldValidationError(errors, 'data');
    const facts = form.workflowDefinitionId ? await this.workflowFacts(form, schema, result.values) : null;
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
              facts: facts ?? undefined,
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
      // The version's process actions for "sent" run after commit; without an approval, so do the "approved" ones.
      await getKernel().processActions.queue(
        tx,
        sub!,
        schema,
        started ? ['submitted'] : ['submitted', 'approved'],
      );
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
      if (assignment) await assignments.complete(tx, assignment, sub!, form);
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
      // Delivered at least once: only the first delivery moves the submission on.
      const [moved] = await tx
        .update(formSubmissions)
        .set({ status, completedAt: new Date() })
        .where(and(eq(formSubmissions.id, sub.id), eq(formSubmissions.status, 'pending')))
        .returning({ id: formSubmissions.id });
      if (!moved) return;
      if (status !== 'cancelled') {
        const [v] = await tx
          .select({ schema: formVersions.schema })
          .from(formVersions)
          .where(and(eq(formVersions.formId, sub.formId), eq(formVersions.version, sub.version)));
        if (v)
          await getKernel().processActions.queue(tx, sub, v.schema, [status], result.decidedBy?.id ?? null);
      } else await getKernel().reminders.cancelFor({ type: REMINDER_SOURCE, id: sub.id }, tx);
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

  /** The requester, its approvers, form administrators and workflow readers (`request-access.ts`). */
  private async canView(sub: SubmissionRow, auth: AuthContext) {
    return (await accessOf(this.db, sub, auth)).view;
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
    // People picked in the answers, table cells included.
    const flat = expandRowFields(formFields(schema), sub.data);
    const userIds = flat.fields
      .filter((f) => f.type === 'user')
      .map((f) => flat.values[f.key])
      .filter((x): x is string => typeof x === 'string');
    // Each decision with what its approver filled in (step fields); people named there get names too.
    const decisions = await this.views.decisions(sub.workflowInstanceId);
    userIds.push(...decisions.userIds);
    const people = await peopleById(this.db, [sub.submittedBy, ...userIds]);
    const workflow = await this.views.summaryOf(sub.workflowInstanceId);
    // Administrators see what the request set off, with errors, and can retry; others see status and results.
    const admin = auth.can('core.forms.manage');
    const actions = await getKernel().processActions.runsOf(sub.id, schema, {
      withErrors: admin,
      canRetry: admin,
    });
    const reminders = await this.remindersOf(sub.id, actions);
    return {
      id: sub.id,
      number: sub.number,
      reference: formatRequestNumber(sub.number),
      form: { id: form!.id, key: form!.key, name: form!.name, icon: form!.icon },
      version: sub.version,
      schema: admin ? maskFormSecrets(schema) : publicFormSchema(schema),
      actions,
      reminders,
      data: sub.data,
      people: Object.fromEntries(userIds.map((id) => [id, people.get(id)?.displayName ?? '?'])),
      status: sub.status,
      submittedBy: ref(people, sub.submittedBy),
      createdAt: sub.createdAt,
      completedAt: sub.completedAt,
      workflow,
      decisions: decisions.items,
      canCancel: sub.status === 'pending' && sub.submittedBy === auth.user?.id,
      fulfilment: sub.fulfilment
        ? {
            moduleId: sub.fulfilment.moduleId,
            reference: sub.fulfilment.reference,
            href: sub.fulfilment.href,
            state: sub.fulfilment.state,
            statusKey: sub.fulfilment.statusKey,
            tone: sub.fulfilment.tone ?? null,
            updatedAt: new Date(sub.fulfilment.updatedAt),
          }
        : null,
    };
  }

  /** Reminders the request's `core.remind` actions scheduled (pending, sent or cancelled), by due date. */
  private async remindersOf(submissionId: string, runs: readonly { id: string; actionId: string }[]) {
    const rows = await getKernel().reminders.listFor({ type: REMINDER_SOURCE, id: submissionId });
    const actionOf = new Map(runs.map((r) => [r.id, r.actionId]));
    return rows.map((r) => ({
      id: r.id,
      actionId: (r.source?.runId && actionOf.get(r.source.runId)) || null,
      title: typeof r.params.title === 'string' ? r.params.title : '',
      dueAt: r.dueAt,
      status: r.status,
      sentAt: r.sentAt,
    }));
  }

  /**
   * The process actions a form builder offers: every action type of the enabled modules with its configuration
   * fields for this draft (`allowed` when the caller may add it). `draft` is the builder's unsaved draft; without
   * it the form's saved draft is used.
   */
  async actionCatalog(input: { formId?: string; draft?: FormSchema }, auth: AuthContext) {
    const draft = input.draft ?? (input.formId ? (await this.find(input.formId)).draft : { elements: [] });
    const locale = auth.user?.locale ?? 'en';
    const items = await getKernel().processActions.describe(publicFormSchema(draft), auth, locale);
    return {
      items: items.map((i) => ({ ...i, fields: i.fields as (FieldDef & Record<string, unknown>)[] })),
    };
  }

  /** An administrator runs a failed (or skipped) action of a request again. */
  async retryAction(id: string, runId: string, auth: AuthContext) {
    const [sub] = await this.db.select().from(formSubmissions).where(eq(formSubmissions.id, id));
    if (!sub) throw httpErrors.notFound('Submission not found');
    await this.ctx.transaction(async (tx) => {
      const run = await getKernel().processActions.retry(id, runId, { tx });
      await this.ctx.audit.record(
        {
          action: 'core.process-action.retried',
          entityType: 'form_submission',
          entityId: id,
          entityLabel: formatRequestNumber(sub.number),
          metadata: { runId, action: run.actionId, type: run.type },
        },
        { tx },
      );
    });
    return this.submission(id, auth);
  }

  async byNumber(number: number, auth: AuthContext) {
    const [sub] = await this.db
      .select({ id: formSubmissions.id })
      .from(formSubmissions)
      .where(eq(formSubmissions.number, number));
    return sub ? this.submission(sub.id, auth) : null;
  }

  /** The approval path of a request by its number, as the requester sees it; null when the viewer can't see it. */
  async pathByNumber(number: number, auth: AuthContext) {
    const sub = await this.byNumber(number, auth);
    if (!sub) return null;
    return sub.workflow ? requestPath(this.ctx, sub.workflow.id, auth) : NO_APPROVAL_PATH;
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
      // Reminders its actions set (on "sent") are of no use for a withdrawn request.
      const reminders = await getKernel().reminders.cancelFor({ type: REMINDER_SOURCE, id }, tx);
      await this.ctx.audit.record(
        {
          action: 'core.form-submission.cancelled',
          entityType: 'form_submission',
          entityId: id,
          entityLabel: formatRequestNumber(sub.number),
          metadata: { reason: reason ?? null, ...(reminders ? { remindersCancelled: reminders } : {}) },
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
