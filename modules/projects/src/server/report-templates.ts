/**
 * Status report templates (Phase 11, `docs/architecture.md` §17.3): configuration the PMO edits (and the customisation
 * kind `projects.report-template`). Two built-in templates are created the first time anyone needs one, with names
 * from the catalogs in three languages.
 */
import type { AuthContext, Db, ModuleContext } from '@isbp/sdk/server';
import { and, asc, count, eq, isNull, ne } from 'drizzle-orm';
import type { z } from 'zod';
import type { ReportSection, reportTemplateInputSchema } from '../contracts';
import { DEFAULT_REPORT_TEMPLATES, isUuid, PERMISSIONS } from '../model';
import { isAdmin } from './access';
import { reportTemplates, type ReportTemplateRow } from './schema';
import { actorOf, forbidden, invalid, pgCode } from './shared';
import { localized } from './text';

export type TemplateInput = z.output<typeof reportTemplateInputSchema>;

export const TEMPLATE_ENTITY = 'projects.report-template';

const ensured = new WeakSet<Db>();

/** Creates the built-in templates when there are none (idempotent, safe to race: unique keys). */
export async function ensureTemplates(ctx: ModuleContext): Promise<void> {
  if (ensured.has(ctx.db)) return;
  const [row] = await ctx.db.select({ n: count() }).from(reportTemplates);
  if (!row?.n) {
    await ctx.transaction(async (tx) => {
      const created = await tx
        .insert(reportTemplates)
        .values(
          DEFAULT_REPORT_TEMPLATES.map((t, i) => ({
            key: t.key,
            name: localized(`reportTemplates.defaults.${t.key}.name`),
            description: localized(`reportTemplates.defaults.${t.key}.description`),
            sections: t.sections as unknown as ReportSection[],
            sortOrder: (i + 1) * 10,
          })),
        )
        .onConflictDoNothing()
        .returning({ key: reportTemplates.key });
      if (created.length)
        await ctx.audit.record(
          {
            action: 'projects.report-template.defaults_created',
            entityType: TEMPLATE_ENTITY,
            metadata: { created: created.map((c) => c.key) },
          },
          { tx },
        );
    });
  }
  ensured.add(ctx.db);
}

export const canManageTemplates = (auth: AuthContext) => auth.can(PERMISSIONS.reporting) || isAdmin(auth);

export function templateDto(row: ReportTemplateRow) {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    description: row.description,
    sections: row.sections,
    sortOrder: row.sortOrder,
    archived: Boolean(row.archivedAt),
    updatedAt: row.updatedAt,
  };
}

export class ReportTemplateService {
  constructor(private readonly ctx: ModuleContext) {}

  async list(opts: { archived?: boolean } = {}) {
    await ensureTemplates(this.ctx);
    const rows = await this.ctx.db
      .select()
      .from(reportTemplates)
      .where(opts.archived ? undefined : isNull(reportTemplates.archivedAt))
      .orderBy(asc(reportTemplates.sortOrder), asc(reportTemplates.key));
    return rows.map(templateDto);
  }

  /** A template by id or key; with `liveOnly`, archived ones are not found. */
  async find(ref: string, opts: { liveOnly?: boolean } = {}): Promise<ReportTemplateRow | null> {
    await ensureTemplates(this.ctx);
    const [row] = await this.ctx.db
      .select()
      .from(reportTemplates)
      .where(
        and(
          isUuid(ref) ? eq(reportTemplates.id, ref) : eq(reportTemplates.key, ref),
          opts.liveOnly ? isNull(reportTemplates.archivedAt) : undefined,
        ),
      );
    return row ?? null;
  }

  async get(ref: string) {
    const row = await this.find(ref);
    if (!row) throw invalid('template', `There is no report template ${ref}`);
    return templateDto(row);
  }

  /** The template a report uses: the one asked for (live), else the first. */
  async pick(ref: string | undefined): Promise<ReportTemplateRow> {
    await ensureTemplates(this.ctx);
    if (ref) {
      const row = await this.find(ref, { liveOnly: true });
      if (row) return row;
    }
    const [first] = await this.ctx.db
      .select()
      .from(reportTemplates)
      .where(isNull(reportTemplates.archivedAt))
      .orderBy(asc(reportTemplates.sortOrder), asc(reportTemplates.key))
      .limit(1);
    if (first) return first;
    // Every template archived: use the first one anyway, so reports keep working.
    const [any] = await this.ctx.db
      .select()
      .from(reportTemplates)
      .orderBy(asc(reportTemplates.sortOrder))
      .limit(1);
    if (!any) throw invalid('template', 'There are no report templates');
    return any;
  }

  /** The value as the admin page and the customisation kind write it. */
  valueOf(row: ReportTemplateRow): TemplateInput {
    return {
      key: row.key,
      name: row.name,
      description: row.description,
      sections: row.sections as TemplateInput['sections'],
      sortOrder: row.sortOrder,
    };
  }

  private require(auth: AuthContext) {
    if (!canManageTemplates(auth)) throw forbidden('Only the PMO can change report templates');
  }

  async keyTaken(key: string, exceptId: string | null, db: Db = this.ctx.db) {
    const [row] = await db
      .select({ id: reportTemplates.id })
      .from(reportTemplates)
      .where(and(eq(reportTemplates.key, key), exceptId ? ne(reportTemplates.id, exceptId) : undefined));
    return Boolean(row);
  }

  async create(input: TemplateInput, auth: AuthContext) {
    this.require(auth);
    await ensureTemplates(this.ctx);
    try {
      return await this.ctx.transaction(async (tx) => {
        if (await this.keyTaken(input.key, null, tx))
          throw invalid('key', `The key ${input.key} is taken`, { code: 'duplicate' });
        const [row] = await tx
          .insert(reportTemplates)
          .values({
            key: input.key,
            name: input.name,
            description: input.description ?? null,
            sections: input.sections as ReportSection[],
            sortOrder: input.sortOrder ?? 100,
            createdBy: actorOf(auth),
          })
          .returning();
        await this.ctx.audit.record(
          {
            action: 'projects.report-template.created',
            entityType: TEMPLATE_ENTITY,
            entityId: row!.id,
            entityLabel: row!.key,
            metadata: { sections: input.sections.map((s) => s.type) },
          },
          { tx },
        );
        await this.ctx.events.publish(
          'projects.report-template.created',
          { templateId: row!.id, key: row!.key },
          { tx },
        );
        return templateDto(row!);
      });
    } catch (err) {
      if (pgCode(err) === '23505')
        throw invalid('key', `The key ${input.key} is taken`, { code: 'duplicate' });
      throw err;
    }
  }

  /** Replaces a template's value (its key never changes). */
  async update(ref: string, input: TemplateInput, auth: AuthContext) {
    this.require(auth);
    const current = await this.find(ref);
    if (!current) throw invalid('template', `There is no report template ${ref}`);
    if (input.key !== current.key)
      throw invalid('key', 'The key of a template cannot change', { code: 'immutable' });
    return this.ctx.transaction(async (tx) => {
      const [row] = await tx
        .update(reportTemplates)
        .set({
          name: input.name,
          description: input.description ?? null,
          sections: input.sections as ReportSection[],
          sortOrder: input.sortOrder ?? current.sortOrder,
        })
        .where(eq(reportTemplates.id, current.id))
        .returning();
      const changes = this.ctx.audit.diff(this.valueOf(current), this.valueOf(row!));
      await this.ctx.audit.record(
        {
          action: 'projects.report-template.updated',
          entityType: TEMPLATE_ENTITY,
          entityId: row!.id,
          entityLabel: row!.key,
          changes,
        },
        { tx },
      );
      await this.ctx.events.publish(
        'projects.report-template.updated',
        { templateId: row!.id, key: row!.key },
        { tx },
      );
      return templateDto(row!);
    });
  }

  /** Archives (hides from the picker) or restores a template; reports and scheduled jobs naming it fall back. */
  async setArchived(ref: string, archived: boolean, auth: AuthContext) {
    this.require(auth);
    const current = await this.find(ref);
    if (!current) throw invalid('template', `There is no report template ${ref}`);
    if (Boolean(current.archivedAt) === archived) return templateDto(current);
    return this.ctx.transaction(async (tx) => {
      const [row] = await tx
        .update(reportTemplates)
        .set({ archivedAt: archived ? new Date() : null })
        .where(eq(reportTemplates.id, current.id))
        .returning();
      const action = archived ? 'projects.report-template.archived' : 'projects.report-template.restored';
      await this.ctx.audit.record(
        { action, entityType: TEMPLATE_ENTITY, entityId: row!.id, entityLabel: row!.key },
        { tx },
      );
      await this.ctx.events.publish(action, { templateId: row!.id, key: row!.key }, { tx });
      return templateDto(row!);
    });
  }
}
