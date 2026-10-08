/**
 * Service-desk configuration: categories, business calendars, SLA policies, the service catalog
 * (form → fulfilment mapping) and the group/agent lookups used by pickers and AI triage.
 */
import { forms, groupMembers, groups, users } from '@isbp/db/schema';
import { ErrorCodes, HttpError, httpErrors, type LocalizedText, type ModuleContext } from '@isbp/sdk/server';
import { and, asc, count, eq, inArray, isNotNull, isNull, ne, sql } from 'drizzle-orm';
import type { z } from 'zod';
import type {
  TicketType,
  upsertCalendarSchema,
  upsertCatalogItemSchema,
  upsertCategorySchema,
  upsertSlaPolicySchema,
} from '../contracts';
import { isValidTimeZone } from './business-time';
import {
  calendarMap,
  categoryMap,
  categoryRef,
  type CategoryInfo,
  groupsByIds,
  invalidateLookups,
} from './lookups';
import { businessCalendars, catalogItems, categories, slaPolicies, tickets, ticketSlas } from './schema';

type CategoryInput = z.output<typeof upsertCategorySchema>;
type CalendarInput = z.output<typeof upsertCalendarSchema>;
type PolicyInput = z.output<typeof upsertSlaPolicySchema>;

const EVERYONE = 'everyone';

const invalid = (field: string, message: string) =>
  new HttpError(400, ErrorCodes.VALIDATION_FAILED, message, { fields: { [field]: message } });

export class ConfigService {
  constructor(private readonly ctx: ModuleContext) {}

  private async audit(
    action: string,
    entityId: string,
    entityLabel: string,
    metadata?: Record<string, unknown>,
  ) {
    await this.ctx.audit.record({
      action,
      entityType: action.split('.').slice(0, 2).join('.'),
      entityId,
      entityLabel,
      metadata,
    });
  }

  /* ───────────────────────────── groups ───────────────────────────── */

  async groups() {
    const rows = await this.ctx.db
      .select({
        id: groups.id,
        key: groups.key,
        name: groups.name,
        memberCount:
          sql<number>`(select count(*) from ${groupMembers} where ${groupMembers.groupId} = ${groups.id})`.mapWith(
            Number,
          ),
      })
      .from(groups)
      .where(ne(groups.key, EVERYONE))
      .orderBy(asc(groups.name));
    return { items: rows };
  }

  /** Active members of a group who can work tickets. */
  async groupAgents(groupId: string) {
    const [g] = await this.ctx.db.select({ id: groups.id }).from(groups).where(eq(groups.id, groupId));
    if (!g) throw httpErrors.notFound('Group not found');
    const members = await this.ctx.db
      .select({ id: users.id, displayName: users.displayName, avatarUrl: users.avatarUrl })
      .from(groupMembers)
      .innerJoin(users, eq(users.id, groupMembers.userId))
      .where(and(eq(groupMembers.groupId, groupId), eq(users.status, 'active')))
      .orderBy(asc(users.displayName))
      .limit(500);
    const out = [];
    for (const m of members) {
      const perms = await this.ctx.rbac.permissionsFor(m.id);
      if (perms.hasAny('itsm.tickets.work')) out.push(m);
    }
    return { items: out };
  }

  /* ───────────────────────────── categories ───────────────────────────── */

  private async categoryDto(c: CategoryInfo, counts: Map<string, number>) {
    const groupMap = await groupsByIds(this.ctx.db, [c.defaultGroupId]);
    return {
      id: c.id,
      key: c.key,
      name: c.name,
      path: c.path,
      ancestors: c.ancestors,
      parentId: c.parentId,
      ticketTypes: c.ticketTypes,
      defaultGroup: (c.defaultGroupId && groupMap.get(c.defaultGroupId)) || null,
      active: c.active,
      sortOrder: c.sortOrder,
      ticketCount: counts.get(c.id) ?? 0,
    };
  }

  async categories(q: { type?: TicketType; includeInactive: boolean }) {
    const all = [...(await categoryMap(this.ctx.db)).values()];
    const counts = new Map(
      (
        await this.ctx.db
          .select({ id: tickets.categoryId, n: count() })
          .from(tickets)
          .where(isNotNull(tickets.categoryId))
          .groupBy(tickets.categoryId)
      ).map((r) => [r.id!, r.n]),
    );
    const groupMap = await groupsByIds(
      this.ctx.db,
      all.map((c) => c.defaultGroupId),
    );
    const items = all
      .filter((c) => (q.includeInactive || c.active) && (!q.type || c.ticketTypes.includes(q.type)))
      .sort((a, b) => a.path.localeCompare(b.path))
      .map((c) => ({
        id: c.id,
        key: c.key,
        name: c.name,
        path: c.path,
        ancestors: c.ancestors,
        parentId: c.parentId,
        ticketTypes: c.ticketTypes,
        defaultGroup: (c.defaultGroupId && groupMap.get(c.defaultGroupId)) || null,
        active: c.active,
        sortOrder: c.sortOrder,
        ticketCount: counts.get(c.id) ?? 0,
      }));
    return { items };
  }

  private async categoryById(id: string) {
    const c = (await categoryMap(this.ctx.db)).get(id);
    if (!c) throw httpErrors.notFound('Category not found');
    return c;
  }

  private async assertParent(id: string | null | undefined, self?: string) {
    if (!id) return;
    const cats = await categoryMap(this.ctx.db);
    const parent = cats.get(id);
    if (!parent) throw new HttpError(400, ErrorCodes.INVALID_PARENT, 'Unknown parent category');
    if (self && (parent.id === self || parent.ancestors.some((a) => a.id === self)))
      throw new HttpError(400, ErrorCodes.INVALID_PARENT, 'A category cannot be moved under itself');
  }

  private async assertGroup(id: string | null | undefined) {
    if (!id) return;
    const [g] = await this.ctx.db.select({ id: groups.id }).from(groups).where(eq(groups.id, id));
    if (!g) throw invalid('defaultGroupId', 'Unknown group');
  }

  async createCategory(input: CategoryInput) {
    await this.assertParent(input.parentId);
    await this.assertGroup(input.defaultGroupId);
    const [dup] = await this.ctx.db
      .select({ id: categories.id })
      .from(categories)
      .where(eq(categories.key, input.key));
    if (dup) throw httpErrors.conflict('A category with this key exists', { field: 'key' });
    const [row] = await this.ctx.db
      .insert(categories)
      .values({
        key: input.key,
        name: input.name as LocalizedText,
        parentId: input.parentId ?? null,
        ticketTypes: input.ticketTypes,
        defaultGroupId: input.defaultGroupId ?? null,
        active: input.active,
        sortOrder: input.sortOrder,
      })
      .returning();
    invalidateLookups();
    await this.audit('itsm.category.created', row!.id, row!.key);
    return this.categoryDto(await this.categoryById(row!.id), new Map());
  }

  async updateCategory(id: string, input: Partial<CategoryInput>) {
    const before = await this.categoryById(id);
    if (input.parentId !== undefined) await this.assertParent(input.parentId, id);
    if (input.defaultGroupId !== undefined) await this.assertGroup(input.defaultGroupId);
    if (input.key && input.key !== before.key) {
      const [dup] = await this.ctx.db
        .select({ id: categories.id })
        .from(categories)
        .where(eq(categories.key, input.key));
      if (dup) throw httpErrors.conflict('A category with this key exists', { field: 'key' });
    }
    const set = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
    if (Object.keys(set).length) await this.ctx.db.update(categories).set(set).where(eq(categories.id, id));
    invalidateLookups();
    await this.audit('itsm.category.updated', id, input.key ?? before.key, { fields: Object.keys(set) });
    const [n] = await this.ctx.db.select({ n: count() }).from(tickets).where(eq(tickets.categoryId, id));
    return this.categoryDto(await this.categoryById(id), new Map([[id, n!.n]]));
  }

  async deleteCategory(id: string) {
    const c = await this.categoryById(id);
    const [child] = await this.ctx.db
      .select({ id: categories.id })
      .from(categories)
      .where(eq(categories.parentId, id))
      .limit(1);
    if (child) throw new HttpError(409, ErrorCodes.HAS_CHILDREN, 'Move or delete the subcategories first');
    const [used] = await this.ctx.db.select({ n: count() }).from(tickets).where(eq(tickets.categoryId, id));
    if (used!.n > 0)
      throw new HttpError(409, ErrorCodes.IN_USE, 'Tickets use this category — deactivate it instead', {
        tickets: used!.n,
      });
    await this.ctx.db.delete(categories).where(eq(categories.id, id));
    invalidateLookups();
    await this.audit('itsm.category.deleted', id, c.key);
  }

  /* ───────────────────────────── calendars ───────────────────────────── */

  async calendars() {
    const [cals, counts] = await Promise.all([
      this.ctx.db.select().from(businessCalendars).orderBy(asc(businessCalendars.name)),
      this.ctx.db
        .select({ id: slaPolicies.calendarId, n: count() })
        .from(slaPolicies)
        .groupBy(slaPolicies.calendarId),
    ]);
    const by = new Map(counts.map((c) => [c.id, c.n]));
    return {
      items: cals.map((c) => ({
        id: c.id,
        name: c.name,
        timezone: c.timezone,
        hours: c.hours,
        holidays: c.holidays,
        alwaysOpen: c.alwaysOpen,
        policyCount: by.get(c.id) ?? 0,
      })),
    };
  }

  private async calendarDto(id: string) {
    const item = (await this.calendars()).items.find((c) => c.id === id);
    if (!item) throw httpErrors.notFound('Calendar not found');
    return item;
  }

  private checkCalendar(input: Partial<CalendarInput>) {
    if (input.timezone !== undefined && !isValidTimeZone(input.timezone))
      throw invalid('timezone', 'Unknown time zone');
  }

  async createCalendar(input: CalendarInput) {
    this.checkCalendar(input);
    const [row] = await this.ctx.db.insert(businessCalendars).values(input).returning();
    invalidateLookups();
    await this.audit('itsm.calendar.created', row!.id, row!.name);
    return this.calendarDto(row!.id);
  }

  async updateCalendar(id: string, input: Partial<CalendarInput>) {
    this.checkCalendar(input);
    const set = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
    const [row] = await this.ctx.db
      .update(businessCalendars)
      .set({ ...set, updatedAt: new Date() })
      .where(eq(businessCalendars.id, id))
      .returning();
    if (!row) throw httpErrors.notFound('Calendar not found');
    invalidateLookups();
    await this.audit('itsm.calendar.updated', id, row.name, { fields: Object.keys(set) });
    return this.calendarDto(id);
  }

  async deleteCalendar(id: string) {
    const [used] = await this.ctx.db
      .select({ n: count() })
      .from(slaPolicies)
      .where(eq(slaPolicies.calendarId, id));
    if (used!.n > 0)
      throw new HttpError(409, ErrorCodes.IN_USE, 'SLA policies use this calendar', { policies: used!.n });
    const [row] = await this.ctx.db.delete(businessCalendars).where(eq(businessCalendars.id, id)).returning();
    if (!row) throw httpErrors.notFound('Calendar not found');
    invalidateLookups();
    await this.audit('itsm.calendar.deleted', id, row.name);
  }

  /* ───────────────────────────── SLA policies ───────────────────────────── */

  async policies() {
    const [rows, cals] = await Promise.all([
      this.ctx.db.select().from(slaPolicies).orderBy(asc(slaPolicies.sortOrder), asc(slaPolicies.createdAt)),
      calendarMap(this.ctx.db),
    ]);
    return {
      items: rows.map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        ticketTypes: p.ticketTypes,
        condition: p.condition ?? null,
        targets: p.targets as Record<
          '1' | '2' | '3' | '4',
          { responseMinutes: number; resolutionMinutes: number }
        >,
        calendar: { id: p.calendarId, name: cals.get(p.calendarId)?.name ?? '—' },
        pauseStatuses: p.pauseStatuses,
        warnAt: p.warnAt,
        sortOrder: p.sortOrder,
        active: p.active,
      })),
    };
  }

  private async policyDto(id: string) {
    const item = (await this.policies()).items.find((p) => p.id === id);
    if (!item) throw httpErrors.notFound('SLA policy not found');
    return item;
  }

  private async assertCalendar(id: string | undefined) {
    if (!id) return;
    const [c] = await this.ctx.db
      .select({ id: businessCalendars.id })
      .from(businessCalendars)
      .where(eq(businessCalendars.id, id));
    if (!c) throw invalid('calendarId', 'Unknown calendar');
  }

  async createPolicy(input: PolicyInput) {
    await this.assertCalendar(input.calendarId);
    const [row] = await this.ctx.db
      .insert(slaPolicies)
      .values({
        name: input.name,
        description: input.description ?? null,
        ticketTypes: input.ticketTypes,
        condition: input.condition ?? null,
        targets: input.targets,
        calendarId: input.calendarId,
        pauseStatuses: input.pauseStatuses,
        warnAt: input.warnAt,
        sortOrder: input.sortOrder,
        active: input.active,
      })
      .returning();
    invalidateLookups();
    await this.audit('itsm.sla_policy.created', row!.id, row!.name);
    return this.policyDto(row!.id);
  }

  /** Changes apply to tickets raised afterwards; running timers keep their targets. */
  async updatePolicy(id: string, input: Partial<PolicyInput>) {
    await this.assertCalendar(input.calendarId);
    const set = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
    const [row] = await this.ctx.db
      .update(slaPolicies)
      .set({ ...set, updatedAt: new Date() })
      .where(eq(slaPolicies.id, id))
      .returning();
    if (!row) throw httpErrors.notFound('SLA policy not found');
    invalidateLookups();
    await this.audit('itsm.sla_policy.updated', id, row.name, { fields: Object.keys(set) });
    return this.policyDto(id);
  }

  async deletePolicy(id: string) {
    const [used] = await this.ctx.db
      .select({ n: count() })
      .from(ticketSlas)
      .where(eq(ticketSlas.policyId, id));
    if (used!.n > 0)
      throw new HttpError(
        409,
        ErrorCodes.IN_USE,
        'Tickets have timers from this policy — deactivate it instead',
        {
          tickets: used!.n,
        },
      );
    const [row] = await this.ctx.db.delete(slaPolicies).where(eq(slaPolicies.id, id)).returning();
    if (!row) throw httpErrors.notFound('SLA policy not found');
    invalidateLookups();
    await this.audit('itsm.sla_policy.deleted', id, row.name);
  }

  /* ───────────────────────────── catalog ───────────────────────────── */

  async catalog() {
    const [forms, mappings, cats, counts] = await Promise.all([
      this.ctx.forms.published(),
      this.ctx.db.select().from(catalogItems),
      categoryMap(this.ctx.db),
      this.ctx.db
        .select({ key: sql<string>`${tickets.source}->>'formKey'`, n: count() })
        .from(tickets)
        .where(and(eq(tickets.channel, 'form'), isNotNull(tickets.source)))
        .groupBy(sql`${tickets.source}->>'formKey'`),
    ]);
    const byKey = new Map(mappings.map((m) => [m.formKey, m]));
    const countBy = new Map(counts.map((c) => [c.key, c.n]));
    const groupMap = await groupsByIds(
      this.ctx.db,
      mappings.map((m) => m.groupId),
    );
    return {
      items: forms
        .map((f) => {
          const m = byKey.get(f.key);
          return {
            formKey: f.key,
            formName: f.name,
            formIcon: f.icon,
            formCategory: f.category,
            hasApproval: f.hasApproval,
            fulfilment: m
              ? {
                  active: m.active,
                  category: categoryRef(m.categoryId ? cats.get(m.categoryId) : null),
                  group: (m.groupId && groupMap.get(m.groupId)) || null,
                  priority: m.priority,
                  fulfilOn: m.fulfilOn,
                  ticketCount: countBy.get(f.key) ?? 0,
                }
              : null,
          };
        })
        .sort((a, b) => a.formKey.localeCompare(b.formKey)),
    };
  }

  /**
   * Whether a published, active form has this key. Read through `ctx.db`, so a change set that publishes the
   * form and adds it to the catalog in one transaction sees it.
   */
  async isPublishedForm(formKey: string): Promise<boolean> {
    const [form] = await this.ctx.db
      .select({ id: forms.id })
      .from(forms)
      .where(
        and(
          eq(forms.key, formKey),
          isNotNull(forms.publishedVersion),
          isNull(forms.archivedAt),
          eq(forms.active, true),
        ),
      );
    return Boolean(form);
  }

  async upsertCatalogItem(formKey: string, input: z.output<typeof upsertCatalogItemSchema>) {
    if (!(await this.isPublishedForm(formKey))) throw httpErrors.notFound('No published form with this key');
    if (input.categoryId && !(await categoryMap(this.ctx.db)).get(input.categoryId))
      throw invalid('categoryId', 'Unknown category');
    if (input.groupId)
      await this.assertGroup(input.groupId).catch(() => {
        throw invalid('groupId', 'Unknown group');
      });
    const values = {
      active: input.active,
      categoryId: input.categoryId ?? null,
      groupId: input.groupId ?? null,
      priority: input.priority,
      fulfilOn: input.fulfilOn,
    };
    await this.ctx.db
      .insert(catalogItems)
      .values({ formKey, ...values })
      .onConflictDoUpdate({ target: catalogItems.formKey, set: { ...values, updatedAt: new Date() } });
    await this.audit('itsm.catalog_item.updated', formKey, formKey, values);
    return (await this.catalog()).items.find((i) => i.formKey === formKey)!;
  }

  async deleteCatalogItem(formKey: string) {
    const [row] = await this.ctx.db.delete(catalogItems).where(eq(catalogItems.formKey, formKey)).returning();
    if (!row) throw httpErrors.notFound('This form is not in the catalog');
    await this.audit('itsm.catalog_item.deleted', formKey, formKey);
  }

  /* ───────────────────────────── AI triage options ───────────────────────────── */

  async triageOptions() {
    const cats = [...(await categoryMap(this.ctx.db)).values()].filter((c) => c.active);
    const groupList = await this.ctx.db
      .select({ id: groups.id, key: groups.key, name: groups.name })
      .from(groups)
      .where(and(ne(groups.key, EVERYONE), inArray(groups.source, ['local', 'oidc', 'saml', 'ldap'])))
      .orderBy(asc(groups.name));
    return {
      categories: cats
        .sort((a, b) => a.path.localeCompare(b.path))
        .map((c) => ({
          id: c.id,
          key: c.key,
          path: c.path,
          ticketTypes: c.ticketTypes,
          defaultGroupId: c.defaultGroupId,
        })),
      groups: groupList,
    };
  }
}
