/**
 * Service-desk configuration: categories, business calendars, SLA policies, the service catalog
 * (form → fulfilment mapping) and the group/agent lookups used by pickers and AI triage.
 */
import { forms, groupMembers, groups, roleAssignments, rolePermissions, users } from '@isbp/db/schema';
import { localize, matchPermission } from '@isbp/sdk';
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
import { type CoverageContext, type CoveragePolicy, placementFor, policyReach } from '../sla-coverage';
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
type PolicyRow = typeof slaPolicies.$inferSelect;

const EVERYONE = 'everyone';
/** Gap between neighbours when an order is renumbered. */
const ORDER_STEP = 10;
/** Where "last" starts, so the end of a short list matches the order new policies always had. */
const LAST_ORDER = 100;

/** A policy's name in every language (policies saved before names were localized have English only). */
export const policyLabel = (p: Pick<PolicyRow, 'name' | 'label'>): LocalizedText => p.label ?? { en: p.name };

/** Name input (plain text = English, or per language) → the stored label and plain name. */
function policyName(input: string | LocalizedText): { label: LocalizedText; name: string } {
  const label = typeof input === 'string' ? { en: input.trim() } : input;
  return { label, name: localize(label, 'en').slice(0, 200) };
}

const invalid = (field: string, message: string) =>
  new HttpError(400, ErrorCodes.VALIDATION_FAILED, message, { fields: { [field]: message } });

const asCoverage = (p: PolicyRow): CoveragePolicy => ({
  id: p.id,
  ticketTypes: p.ticketTypes,
  condition: p.condition ?? null,
  active: p.active,
});

const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && new Set(a).size === a.length && b.every((x) => a.includes(x));

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
    const roleIds = await this.agentRoleIds();
    const roleList = roleIds.length
      ? sql.join(
          roleIds.map((r) => sql`${r}`),
          sql`, `,
        )
      : null;
    // Qualified: inside the subqueries a bare "id" would be the subquery table's own.
    const gid = sql`"groups"."id"`;
    const rows = await this.ctx.db
      .select({
        id: groups.id,
        key: groups.key,
        name: groups.name,
        memberCount:
          sql<number>`(select count(*) from ${groupMembers} where ${groupMembers.groupId} = ${gid})`.mapWith(
            Number,
          ),
        worksTickets: sql<boolean>`(${
          roleList
            ? sql`exists (select 1 from ${roleAssignments} ra where ra.group_id = ${gid} and ra.role_id in (${roleList}) and (ra.expires_at is null or ra.expires_at > now())) or `
            : sql``
        }exists (select 1 from ${tickets} t where t.assignment_group_id = ${gid})
          or exists (select 1 from ${categories} c where c.default_group_id = ${gid})
          or exists (select 1 from ${catalogItems} ci where ci.group_id = ${gid}))`.mapWith(Boolean),
      })
      .from(groups)
      .where(ne(groups.key, EVERYONE))
      .orderBy(asc(groups.name));
    const agents = await this.agentCounts(roleIds);
    return { items: rows.map((g) => ({ ...g, agentCount: agents.get(g.id) ?? 0 })) };
  }

  /** Roles that let their holders work tickets (`itsm.tickets.work`, wildcards included). */
  private async agentRoleIds(): Promise<string[]> {
    const perms = await this.ctx.db
      .selectDistinct({ roleId: rolePermissions.roleId, permission: rolePermissions.permission })
      .from(rolePermissions);
    return [
      ...new Set(
        perms.filter((p) => matchPermission(p.permission, 'itsm.tickets.work')).map((p) => p.roleId),
      ),
    ];
  }

  /**
   * Active members per group who may work tickets (`itsm.tickets.work` at any scope): through a role of their own, of
   * one of their groups or of Everyone.
   */
  private async agentCounts(roleIds: readonly string[]): Promise<Map<string, number>> {
    if (!roleIds.length) return new Map();
    const res = await this.ctx.db.execute<{ group_id: string; n: number }>(sql`
      select gm.group_id, count(distinct gm.user_id)::int as n
        from ${groupMembers} gm
        join ${users} u on u.id = gm.user_id and u.status = 'active'
       where exists (
         select 1 from ${roleAssignments} ra
          where ra.role_id in (${sql.join(
            roleIds.map((r) => sql`${r}`),
            sql`, `,
          )})
            and (ra.expires_at is null or ra.expires_at > now())
            and (ra.user_id = gm.user_id
                 or ra.group_id in (select g2.group_id from ${groupMembers} g2 where g2.user_id = gm.user_id)
                 or ra.group_id in (select e.id from ${groups} e where e.key = ${EVERYONE})))
       group by gm.group_id`);
    return new Map(res.rows.map((r) => [r.group_id, Number(r.n)]));
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

  /** The order after the last child of `parentId` (null = the top level). */
  private async endOfSiblings(parentId: string | null, except?: string) {
    const [row] = await this.ctx.db
      .select({ max: sql<number | null>`max(${categories.sortOrder})` })
      .from(categories)
      .where(
        and(
          parentId ? eq(categories.parentId, parentId) : isNull(categories.parentId),
          except ? ne(categories.id, except) : undefined,
        ),
      );
    return row?.max === null || row?.max === undefined ? ORDER_STEP : Number(row.max) + ORDER_STEP;
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
        sortOrder: input.sortOrder ?? (await this.endOfSiblings(input.parentId ?? null)),
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
    const set: Record<string, unknown> = Object.fromEntries(
      Object.entries(input).filter(([, v]) => v !== undefined),
    );
    // Moved under another parent without an order: after its new siblings.
    if (
      input.parentId !== undefined &&
      (input.parentId ?? null) !== before.parentId &&
      input.sortOrder === undefined
    )
      set.sortOrder = await this.endOfSiblings(input.parentId ?? null, id);
    if (Object.keys(set).length) await this.ctx.db.update(categories).set(set).where(eq(categories.id, id));
    invalidateLookups();
    await this.audit('itsm.category.updated', id, input.key ?? before.key, { fields: Object.keys(set) });
    const [n] = await this.ctx.db.select({ n: count() }).from(tickets).where(eq(tickets.categoryId, id));
    return this.categoryDto(await this.categoryById(id), new Map([[id, n!.n]]));
  }

  /** Puts one level of the tree in a new order (every child of `parentId`, once). */
  async orderCategories(parentId: string | null, ids: readonly string[]) {
    const siblings = await this.ctx.db
      .select({ id: categories.id, key: categories.key, sortOrder: categories.sortOrder })
      .from(categories)
      .where(parentId ? eq(categories.parentId, parentId) : isNull(categories.parentId));
    if (
      !sameSet(
        ids,
        siblings.map((c) => c.id),
      )
    )
      throw httpErrors.conflict('The categories changed meanwhile: reload and try again');
    const before = new Map(siblings.map((c) => [c.id, c]));
    for (const [i, cid] of ids.entries()) {
      const c = before.get(cid)!;
      const sortOrder = (i + 1) * ORDER_STEP;
      if (c.sortOrder === sortOrder) continue;
      await this.ctx.db.update(categories).set({ sortOrder }).where(eq(categories.id, cid));
      await this.audit('itsm.category.updated', cid, c.key, { fields: ['sortOrder'] });
    }
    invalidateLookups();
    return this.categories({ includeInactive: true });
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

  /** Every policy in evaluation order (the order tickets are matched in). */
  private async policyRows(): Promise<PolicyRow[]> {
    return this.ctx.db
      .select()
      .from(slaPolicies)
      .orderBy(asc(slaPolicies.sortOrder), asc(slaPolicies.createdAt));
  }

  /** Categories for the coverage analysis, read fresh: a category saved a moment ago counts. */
  private async coverageContext(): Promise<CoverageContext> {
    const rows = await this.ctx.db
      .select({ id: categories.id, key: categories.key, parentId: categories.parentId })
      .from(categories);
    return { categories: rows };
  }

  async policies() {
    const [rows, cals, coverage] = await Promise.all([
      this.policyRows(),
      calendarMap(this.ctx.db),
      this.coverageContext(),
    ]);
    const reach = policyReach(rows.map(asCoverage), coverage);
    return {
      items: rows.map((p) => ({
        id: p.id,
        name: policyLabel(p),
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
        reach: reach.get(p.id) ?? null,
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

  /**
   * The order number that puts a policy just before `beforeId` (null: last) among `ordered` (itself left out):
   * between its neighbours when there is room, otherwise the others are renumbered to make room.
   */
  private async orderBefore(ordered: readonly PolicyRow[], beforeId: string | null, self?: string) {
    const list = ordered.filter((p) => p.id !== self);
    if (beforeId === null) return Math.max(LAST_ORDER, (list.at(-1)?.sortOrder ?? 0) + ORDER_STEP);
    const at = list.findIndex((p) => p.id === beforeId);
    if (at < 0) throw invalid('placeBefore', 'Unknown SLA policy');
    const next = list[at]!;
    const prev = list[at - 1];
    if (!prev) return next.sortOrder - ORDER_STEP;
    if (next.sortOrder - prev.sortOrder >= 2) return Math.floor((prev.sortOrder + next.sortOrder) / 2);
    // No room: renumber everything, leaving a slot at `at`.
    for (const [i, p] of list.entries()) {
      const sortOrder = (i < at ? i + 1 : i + 2) * ORDER_STEP;
      if (p.sortOrder === sortOrder) continue;
      await this.ctx.db.update(slaPolicies).set({ sortOrder }).where(eq(slaPolicies.id, p.id));
      await this.audit('itsm.sla_policy.updated', p.id, p.name, { fields: ['sortOrder'] });
    }
    return (at + 1) * ORDER_STEP;
  }

  /**
   * New policies (without an explicit order) go just before the first policy that would otherwise take every ticket
   * they match, so a category-specific policy isn't silently shadowed by a general one; otherwise last.
   */
  async createPolicy(input: PolicyInput) {
    await this.assertCalendar(input.calendarId);
    const { label, name } = policyName(input.name);
    const ordered = await this.policyRows();
    const before =
      input.placeBefore !== undefined
        ? input.placeBefore
        : input.sortOrder === undefined
          ? placementFor(
              { ticketTypes: input.ticketTypes, condition: input.condition ?? null },
              ordered.map(asCoverage),
              await this.coverageContext(),
            )
          : undefined;
    const sortOrder = before === undefined ? input.sortOrder! : await this.orderBefore(ordered, before);
    const [row] = await this.ctx.db
      .insert(slaPolicies)
      .values({
        name,
        label,
        description: input.description ?? null,
        ticketTypes: input.ticketTypes,
        condition: input.condition ?? null,
        targets: input.targets,
        calendarId: input.calendarId,
        pauseStatuses: input.pauseStatuses,
        warnAt: input.warnAt,
        sortOrder,
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
    const { placeBefore, name: nameInput, ...rest } = input;
    const set: Record<string, unknown> = Object.fromEntries(
      Object.entries(rest).filter(([, v]) => v !== undefined),
    );
    if (nameInput !== undefined) Object.assign(set, policyName(nameInput));
    if (placeBefore !== undefined) {
      if (placeBefore === id) throw invalid('placeBefore', 'A policy cannot be placed before itself');
      const ordered = await this.policyRows();
      if (!ordered.some((p) => p.id === id)) throw httpErrors.notFound('SLA policy not found');
      set.sortOrder = await this.orderBefore(ordered, placeBefore, id);
    }
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

  /** Puts every policy in a new evaluation order (Move up / Move down / "Check it first"). */
  async orderPolicies(ids: readonly string[]) {
    const rows = await this.policyRows();
    if (
      !sameSet(
        ids,
        rows.map((p) => p.id),
      )
    )
      throw httpErrors.conflict('The SLA policies changed meanwhile: reload and try again');
    const byId = new Map(rows.map((p) => [p.id, p]));
    for (const [i, pid] of ids.entries()) {
      const p = byId.get(pid)!;
      const sortOrder = (i + 1) * ORDER_STEP;
      if (p.sortOrder === sortOrder) continue;
      await this.ctx.db
        .update(slaPolicies)
        .set({ sortOrder, updatedAt: new Date() })
        .where(eq(slaPolicies.id, pid));
      await this.audit('itsm.sla_policy.updated', pid, p.name, { fields: ['sortOrder'] });
    }
    invalidateLookups();
    return this.policies();
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
        .where(
          and(
            eq(tickets.channel, 'form'),
            isNotNull(tickets.source),
            // Catalog fulfilment only (process actions raise tickets of their own).
            sql`${tickets.source}->>'type' = 'form-submission'`,
          ),
        )
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
