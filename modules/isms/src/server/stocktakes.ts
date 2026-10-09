/**
 * Stocktakes (asset inventories): a campaign snapshots the in-scope assets as items assigned to each asset's
 * manager (a person, or the members of the managing group). They record each item as confirmed, changed (the
 * corrections are applied to the asset at once), missing or disposed. A security officer signs the campaign off when
 * every item is recorded: missing and disposed assets change status then, the others are marked verified. A recurring
 * (quarterly or yearly) campaign schedules its successor at sign-off. The daily job opens scheduled campaigns and sends reminders.
 */
import { users } from '@isbp/db/schema';
import {
  type AuthContext,
  type Db,
  httpErrors,
  likePattern,
  localize,
  type ModuleContext,
} from '@isbp/sdk/server';
import { and, asc, count, desc, eq, ilike, inArray, isNull, lte, or, type SQL, sql } from 'drizzle-orm';
import type { z } from 'zod';
import type {
  createStocktakeSchema,
  ItemSnapshot,
  recordItemSchema,
  StocktakeScope,
  stocktakeItemQuerySchema,
  stocktakeQuerySchema,
} from '../contracts';
import {
  addMonths,
  daysBetween,
  formatRef,
  isUuid,
  parseRef,
  recurrenceMonths,
  STOCKTAKE_EDITABLE,
  STOCKTAKE_RESULTS,
  type StocktakeResult,
  stocktakeProgress,
  statusAfterStocktake,
  toCsv,
} from '../model';
import { canManageStocktakes, canReadAllStocktakes, canRecordItem, canSignOffStocktakes, P } from './access';
import { type AssetService, selectAssets } from './assets';
import {
  assets,
  classes,
  sites,
  type StocktakeItemRow,
  stocktakeItems,
  type StocktakeRow,
  stocktakes,
} from './schema';
import {
  actingUserId,
  CATALOGS,
  companyToday,
  groupIdsOf,
  groupsByIds,
  invalidField,
  invalidState,
  ismsConfig,
  LOCALES,
  membersOfGroups,
  peopleByIds,
  personRef,
} from './support';

type CreateData = z.output<typeof createStocktakeSchema>;
type RecordData = z.output<typeof recordItemSchema>;
type ListQuery = z.output<typeof stocktakeQuerySchema>;
type ItemQuery = z.output<typeof stocktakeItemQuerySchema>;

export const STOCKTAKE_ENTITY = 'isms.stocktake';
export const stocktakeHref = (reference: string) => `/isms/stocktakes/${reference}`;

export class StocktakeService {
  constructor(
    private readonly ctx: ModuleContext,
    private readonly assetsSvc: AssetService,
  ) {}

  private get db() {
    return this.ctx.db;
  }

  /* ───────────── reads ───────────── */

  async row(ref: string, db: Db = this.db): Promise<StocktakeRow> {
    const n = isUuid(ref) ? null : parseRef('stocktake', ref);
    const [row] = await db
      .select()
      .from(stocktakes)
      .where(isUuid(ref) ? eq(stocktakes.id, ref) : eq(stocktakes.number, n ?? -1));
    if (!row) throw httpErrors.notFound('Stocktake not found');
    return row;
  }

  /** Items assigned to the caller (as the person, or through a group). */
  private mineCondition(userId: string | null, groupIds: readonly string[]): SQL {
    if (!userId) return sql`false`;
    return or(
      eq(stocktakeItems.assigneeId, userId),
      groupIds.length ? inArray(stocktakeItems.assigneeGroupId, [...groupIds]) : undefined,
    )!;
  }

  /** The stocktake, if the caller may see it (readers, or someone with items in it). */
  async readable(ref: string, auth: AuthContext) {
    const row = await this.row(ref);
    const groupIds = await groupIdsOf(this.db, auth.user?.id ?? null);
    if (canReadAllStocktakes(auth)) return { row, groupIds, all: true };
    if (!auth.can(P.self)) auth.require(P.assetsRead);
    const [mine] = await this.db
      .select({ n: count() })
      .from(stocktakeItems)
      .where(
        and(eq(stocktakeItems.stocktakeId, row.id), this.mineCondition(auth.user?.id ?? null, groupIds)),
      );
    if (!mine!.n) throw httpErrors.notFound('Stocktake not found');
    return { row, groupIds, all: false };
  }

  private async progressOf(ids: readonly string[]) {
    if (!ids.length) return new Map<string, ReturnType<typeof stocktakeProgress>>();
    const rows = await this.db
      .select({ id: stocktakeItems.stocktakeId, result: stocktakeItems.result, n: count() })
      .from(stocktakeItems)
      .where(inArray(stocktakeItems.stocktakeId, [...ids]))
      .groupBy(stocktakeItems.stocktakeId, stocktakeItems.result);
    const out = new Map<string, ReturnType<typeof stocktakeProgress>>();
    for (const id of ids) {
      const results: (StocktakeResult | null)[] = [];
      for (const r of rows.filter((x) => x.id === id)) for (let i = 0; i < r.n; i++) results.push(r.result);
      out.set(id, stocktakeProgress(results));
    }
    return out;
  }

  private async dtos(rows: StocktakeRow[], auth: AuthContext, groupIds: readonly string[]) {
    const ids = rows.map((r) => r.id);
    const [progress, people, pending] = await Promise.all([
      this.progressOf(ids),
      peopleByIds(
        this.db,
        rows.flatMap((r) => [r.createdBy, r.signedOffBy, ...r.scope.managerIds]),
      ),
      ids.length && auth.user
        ? this.db
            .select({
              id: stocktakeItems.stocktakeId,
              n: sql<number>`count(*) filter (where ${stocktakeItems.result} is null)`.mapWith(Number),
              all: count(),
            })
            .from(stocktakeItems)
            .where(and(inArray(stocktakeItems.stocktakeId, ids), this.mineCondition(auth.user.id, groupIds)))
            .groupBy(stocktakeItems.stocktakeId)
        : Promise.resolve([] as { id: string; n: number; all: number }[]),
    ]);
    const scopeClassIds = [...new Set(rows.flatMap((r) => r.scope.classIds))];
    const scopeSiteIds = [...new Set(rows.flatMap((r) => r.scope.siteIds))];
    const [cls, sts, grps] = await Promise.all([
      scopeClassIds.length
        ? this.db
            .select({ id: classes.id, code: classes.code, name: classes.name })
            .from(classes)
            .where(inArray(classes.id, scopeClassIds))
        : [],
      scopeSiteIds.length
        ? this.db
            .select({ id: sites.id, code: sites.code, name: sites.name })
            .from(sites)
            .where(inArray(sites.id, scopeSiteIds))
        : [],
      groupsByIds(
        this.db,
        rows.flatMap((r) => r.scope.managerGroupIds),
      ),
    ]);
    const mine = new Map(pending.map((p) => [p.id, p]));
    const today = companyToday();
    return rows.map((r) => ({
      id: r.id,
      reference: formatRef('stocktake', r.number),
      name: r.name,
      status: r.status,
      startOn: r.startOn,
      dueOn: r.dueOn,
      overdue: r.status === 'open' && r.dueOn < today,
      recurrence: r.recurrence,
      scope: {
        classes: cls.filter((c) => r.scope.classIds.includes(c.id)),
        sites: sts.filter((s) => r.scope.siteIds.includes(s.id)),
        managers: r.scope.managerIds.map((id) => personRef(people.get(id))).filter((p) => p !== null),
        managerGroups: r.scope.managerGroupIds.map((id) => grps.get(id)).filter((g) => g !== undefined),
      },
      progress: progress.get(r.id) ?? stocktakeProgress([]),
      createdBy: personRef(r.createdBy ? people.get(r.createdBy) : null),
      signedOffBy: personRef(r.signedOffBy ? people.get(r.signedOffBy) : null),
      signedOffAt: r.signedOffAt,
      signOffNote: r.signOffNote,
      createdAt: r.createdAt,
      viewer: {
        canManage: canManageStocktakes(auth),
        canSignOff: canSignOffStocktakes(auth),
        pendingForMe: mine.get(r.id)?.n ?? 0,
        mineTotal: mine.get(r.id)?.all ?? 0,
      },
    }));
  }

  async list(q: ListQuery, auth: AuthContext) {
    const all = canReadAllStocktakes(auth);
    if (!all) auth.require(P.self);
    const groupIds = await groupIdsOf(this.db, auth.user?.id ?? null);
    const mineOnly = q.mine || !all;
    const where = and(
      q.status ? eq(stocktakes.status, q.status) : undefined,
      q.q ? ilike(stocktakes.name, likePattern(q.q)) : undefined,
      mineOnly
        ? inArray(
            stocktakes.id,
            this.db
              .selectDistinct({ id: stocktakeItems.stocktakeId })
              .from(stocktakeItems)
              .where(this.mineCondition(auth.user?.id ?? null, groupIds)),
          )
        : undefined,
    );
    const sortKey = q.sort?.replace(/^-/, '') ?? 'createdAt';
    const column =
      sortKey === 'dueOn'
        ? stocktakes.dueOn
        : sortKey === 'name'
          ? stocktakes.name
          : sortKey === 'number'
            ? stocktakes.number
            : stocktakes.createdAt;
    const dir = q.sort ? (q.sort.startsWith('-') ? desc : asc) : desc;
    const [rows, [total]] = await Promise.all([
      this.db
        .select()
        .from(stocktakes)
        .where(where)
        .orderBy(dir(column), desc(stocktakes.number))
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize),
      this.db.select({ n: count() }).from(stocktakes).where(where),
    ]);
    return {
      items: await this.dtos(rows, auth, groupIds),
      total: total!.n,
      page: q.page,
      pageSize: q.pageSize,
    };
  }

  async detail(ref: string, auth: AuthContext) {
    const { row, groupIds } = await this.readable(ref, auth);
    return (await this.dtos([row], auth, groupIds))[0]!;
  }

  private async itemDtos(
    rows: StocktakeItemRow[],
    auth: AuthContext,
    groupIds: readonly string[],
    open: boolean,
  ) {
    const assetIds = [...new Set(rows.map((i) => i.assetId).filter((v): v is string => Boolean(v)))];
    const [people, grps, verified] = await Promise.all([
      peopleByIds(
        this.db,
        rows.flatMap((i) => [i.assigneeId, i.decidedBy]),
      ),
      groupsByIds(
        this.db,
        rows.map((i) => i.assigneeGroupId),
      ),
      // When the register was last confirmed, so the person checking sees how old it is.
      assetIds.length
        ? this.db
            .select({ id: assets.id, on: assets.lastVerifiedOn })
            .from(assets)
            .where(inArray(assets.id, assetIds))
            .then((r) => new Map(r.map((a) => [a.id, a.on])))
        : Promise.resolve(new Map<string, string | null>()),
    ]);
    return rows.map((i) => ({
      id: i.id,
      assetId: i.assetId,
      snapshot: i.snapshot,
      lastVerifiedOn: (i.assetId ? verified.get(i.assetId) : null) ?? null,
      assignee: personRef(i.assigneeId ? people.get(i.assigneeId) : null),
      assigneeGroup: i.assigneeGroupId ? (grps.get(i.assigneeGroupId) ?? null) : null,
      result: i.result,
      changes: i.changes ?? null,
      note: i.note,
      decidedBy: personRef(i.decidedBy ? people.get(i.decidedBy) : null),
      decidedAt: i.decidedAt,
      canRecord: open && i.assetId !== null && canRecordItem(auth, i, groupIds),
    }));
  }

  async items(ref: string, q: ItemQuery, auth: AuthContext) {
    const { row, groupIds, all } = await this.readable(ref, auth);
    const where = and(
      eq(stocktakeItems.stocktakeId, row.id),
      q.mine || !all ? this.mineCondition(auth.user?.id ?? null, groupIds) : undefined,
      q.view === 'pending'
        ? isNull(stocktakeItems.result)
        : q.view === 'done'
          ? sql`${stocktakeItems.result} is not null`
          : (STOCKTAKE_RESULTS as readonly string[]).includes(q.view)
            ? eq(stocktakeItems.result, q.view as StocktakeResult)
            : undefined,
      q.q
        ? sql`(${stocktakeItems.snapshot}->>'number' ilike ${likePattern(q.q)} or ${stocktakeItems.snapshot}->>'name' ilike ${likePattern(q.q)})`
        : undefined,
    );
    const [rows, [total]] = await Promise.all([
      this.db
        .select()
        .from(stocktakeItems)
        .where(where)
        .orderBy(sql`${stocktakeItems.snapshot}->>'number'`)
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize),
      this.db.select({ n: count() }).from(stocktakeItems).where(where),
    ]);
    return {
      items: await this.itemDtos(rows, auth, groupIds, row.status === 'open'),
      total: total!.n,
      page: q.page,
      pageSize: q.pageSize,
    };
  }

  /** Pending items assigned to the caller in open stocktakes (the dashboard and "My items"). */
  async myItems(auth: AuthContext, limit = 100) {
    auth.require(P.self);
    const groupIds = await groupIdsOf(this.db, auth.user?.id ?? null);
    const rows = await this.db
      .select({ item: stocktakeItems, st: stocktakes })
      .from(stocktakeItems)
      .innerJoin(stocktakes, eq(stocktakes.id, stocktakeItems.stocktakeId))
      .where(
        and(
          eq(stocktakes.status, 'open'),
          isNull(stocktakeItems.result),
          this.mineCondition(auth.user?.id ?? null, groupIds),
        ),
      )
      .orderBy(asc(stocktakes.dueOn), sql`${stocktakeItems.snapshot}->>'number'`)
      .limit(limit);
    const dtos = await this.itemDtos(
      rows.map((r) => r.item),
      auth,
      groupIds,
      true,
    );
    return {
      items: dtos.map((d, i) => ({
        ...d,
        stocktake: {
          id: rows[i]!.st.id,
          reference: formatRef('stocktake', rows[i]!.st.number),
          name: rows[i]!.st.name,
          dueOn: rows[i]!.st.dueOn,
        },
      })),
    };
  }

  /* ───────────── mutations ───────────── */

  private async checkScope(scope: StocktakeScope) {
    const check = async (ids: string[], table: typeof classes | typeof sites, path: string) => {
      if (!ids.length) return;
      const found = await this.db.select({ id: table.id }).from(table).where(inArray(table.id, ids));
      if (found.length !== new Set(ids).size) throw invalidField(path, 'Unknown entry in the scope');
    };
    await check(scope.classIds, classes, 'scope.classIds');
    await check(scope.siteIds, sites, 'scope.siteIds');
    if (scope.managerIds.length) {
      const people = await peopleByIds(this.db, scope.managerIds);
      if (people.size !== new Set(scope.managerIds).size)
        throw invalidField('scope.managerIds', 'Unknown person in the scope');
    }
    if (scope.managerGroupIds.length) {
      const grps = await groupsByIds(this.db, scope.managerGroupIds);
      if (grps.size !== new Set(scope.managerGroupIds).size)
        throw invalidField('scope.managerGroupIds', 'Unknown group in the scope');
    }
  }

  async create(input: CreateData, auth: AuthContext, opts: { previousId?: string; at?: Date } = {}) {
    auth.require(P.stocktakesManage);
    const today = companyToday();
    const startOn = input.startOn && input.startOn > today ? input.startOn : today;
    if (input.dueOn < startOn)
      throw invalidField('dueOn', 'The due date is before the start', 'dueBeforeStart');
    await this.checkScope(input.scope);
    const open = startOn <= today;
    const row = await this.ctx.transaction(async (tx) => {
      const [r] = await tx
        .insert(stocktakes)
        .values({
          name: input.name,
          status: open ? 'open' : 'scheduled',
          scope: input.scope,
          startOn,
          dueOn: input.dueOn,
          recurrence: input.recurrence,
          previousId: opts.previousId ?? null,
          createdBy: actingUserId(auth),
          ...(opts.at ? { createdAt: opts.at } : {}),
        })
        .returning();
      const reference = formatRef('stocktake', r!.number);
      await this.ctx.audit.record(
        {
          action: 'isms.stocktake.created',
          entityType: STOCKTAKE_ENTITY,
          entityId: r!.id,
          entityLabel: `${reference} ${r!.name}`,
          metadata: { scope: input.scope, dueOn: input.dueOn, startOn, recurrence: input.recurrence },
        },
        { tx },
      );
      await this.ctx.events.publish(
        'isms.stocktake.created',
        {
          stocktakeId: r!.id,
          reference,
          name: r!.name,
          status: r!.status as 'open' | 'scheduled',
          dueOn: r!.dueOn,
        },
        { tx },
      );
      if (open) await this.start(tx, r!);
      return r!;
    });
    return this.detail(row.id, auth);
  }

  /** Snapshots the in-scope assets (active or missing) as items and tells their managers. */
  async start(tx: Db, st: StocktakeRow) {
    const s = st.scope;
    const managerScope =
      s.managerIds.length || s.managerGroupIds.length
        ? or(
            s.managerIds.length ? inArray(assets.managerId, s.managerIds) : undefined,
            s.managerGroupIds.length ? inArray(assets.managerGroupId, s.managerGroupIds) : undefined,
          )
        : undefined;
    const rows = await selectAssets(tx).where(
      and(
        inArray(assets.status, ['active', 'missing']),
        s.classIds.length ? inArray(assets.classId, s.classIds) : undefined,
        s.siteIds.length ? inArray(assets.siteId, s.siteIds) : undefined,
        managerScope,
      ),
    );
    const reference = formatRef('stocktake', st.number);
    if (rows.length)
      for (let i = 0; i < rows.length; i += 500)
        await tx.insert(stocktakeItems).values(
          rows.slice(i, i + 500).map((r) => {
            const a = r.asset;
            const snapshot: ItemSnapshot = {
              number: a.number,
              name: a.name,
              classCode: r.cls.code,
              className: r.cls.name,
              subclassName: r.sub?.id ? r.sub.name : null,
              siteCode: r.site.code,
              location: a.location,
              usersText: a.usersText,
              brand: a.brand,
              model: a.model,
              version: a.version,
              quantity: a.quantity,
              value: a.value,
            };
            return {
              stocktakeId: st.id,
              assetId: a.id,
              snapshot,
              assigneeId: a.managerId,
              assigneeGroupId: a.managerGroupId,
            };
          }),
        );
    if (st.status !== 'open')
      await tx.update(stocktakes).set({ status: 'open' }).where(eq(stocktakes.id, st.id));
    await this.ctx.audit.record(
      {
        action: 'isms.stocktake.started',
        entityType: STOCKTAKE_ENTITY,
        entityId: st.id,
        entityLabel: `${reference} ${st.name}`,
        metadata: { items: rows.length },
      },
      { tx },
    );
    await this.ctx.events.publish(
      'isms.stocktake.started',
      { stocktakeId: st.id, reference, name: st.name, items: rows.length, dueOn: st.dueOn },
      { tx },
    );
    // Each manager (or member of a managing group) hears how many items are theirs.
    const perPerson = new Map<string, number>();
    const groupItems = new Map<string, number>();
    for (const r of rows) {
      if (r.asset.managerId) perPerson.set(r.asset.managerId, (perPerson.get(r.asset.managerId) ?? 0) + 1);
      else if (r.asset.managerGroupId)
        groupItems.set(r.asset.managerGroupId, (groupItems.get(r.asset.managerGroupId) ?? 0) + 1);
    }
    const members = await membersOfGroups(tx, [...groupItems.keys()]);
    for (const [g, n] of groupItems)
      for (const u of members.get(g) ?? []) perPerson.set(u, (perPerson.get(u) ?? 0) + n);
    for (const [userId, n] of perPerson)
      await this.ctx.notifications.notify(
        {
          type: 'isms.stocktake.assigned',
          recipients: [userId],
          params: { name: st.name, count: n, due: st.dueOn },
          href: `${stocktakeHref(reference)}?mine=true`,
        },
        { tx },
      );
  }

  async recordItem(ref: string, itemId: string, input: RecordData, auth: AuthContext) {
    const { row, groupIds } = await this.readable(ref, auth);
    if (row.status !== 'open') throw invalidState('The stocktake is not open', 'stocktakeClosed');
    const [item] = await this.db
      .select()
      .from(stocktakeItems)
      .where(and(eq(stocktakeItems.id, itemId), eq(stocktakeItems.stocktakeId, row.id)));
    if (!item) throw httpErrors.notFound('Item not found');
    if (!canRecordItem(auth, item, groupIds)) auth.require(P.stocktakesManage);
    if (!item.assetId) throw invalidState('The asset was deleted', 'assetDeleted');
    const changes = Object.fromEntries(
      Object.entries(input.changes ?? {}).filter(
        ([k, v]) => (STOCKTAKE_EDITABLE as readonly string[]).includes(k) && v !== undefined,
      ),
    );
    if (input.result === 'changed' && !Object.keys(changes).length)
      throw invalidField('changes', 'Say what changed', 'changesRequired');
    if ((input.result === 'missing' || input.result === 'disposed') && !input.note)
      throw invalidField('note', 'Add a note', 'noteRequired');
    const reference = formatRef('stocktake', row.number);
    await this.ctx.transaction(async (tx) => {
      // Checked again under a lock: the stocktake may have been signed off or cancelled meanwhile, and the same item
      // recorded twice at once is recorded one after the other.
      // `key share`: items are recorded side by side (and may mark the stocktake ready), while sign-off and cancel
      // (`update`) wait for them.
      const [open] = await tx.select().from(stocktakes).where(eq(stocktakes.id, row.id)).for('key share');
      if (open?.status !== 'open') throw invalidState('The stocktake is not open', 'stocktakeClosed');
      const [current] = await tx
        .select({ result: stocktakeItems.result })
        .from(stocktakeItems)
        .where(eq(stocktakeItems.id, item.id))
        .for('update');
      if (!current) throw httpErrors.notFound('Item not found');
      let diff: Record<string, [unknown, unknown]> | null = null;
      if (input.result === 'changed') {
        const before = await this.assetsSvc.row(item.assetId!, tx);
        const after = await this.assetsSvc.update(item.assetId!, changes, auth, {
          tx,
          allowed: true,
          kind: 'stocktake',
          note: reference,
          metadata: { stocktake: reference, itemId: item.id },
        });
        diff = this.ctx.audit.diff(
          before as unknown as Record<string, unknown>,
          Object.fromEntries(Object.keys(changes).map((k) => [k, (after as Record<string, unknown>)[k]])),
        );
      }
      await tx
        .update(stocktakeItems)
        .set({
          result: input.result,
          changes: diff && Object.keys(diff).length ? diff : input.result === 'changed' ? item.changes : null,
          note: input.note ?? null,
          decidedBy: actingUserId(auth),
          decidedAt: new Date(),
        })
        .where(eq(stocktakeItems.id, item.id));
      await this.ctx.audit.record(
        {
          action: 'isms.stocktake.item_recorded',
          entityType: STOCKTAKE_ENTITY,
          entityId: row.id,
          entityLabel: `${reference} ${item.snapshot.number}`,
          metadata: {
            itemId: item.id,
            assetId: item.assetId,
            result: input.result,
            previous: current.result,
          },
        },
        { tx },
      );
      await this.ctx.events.publish(
        'isms.stocktake.item_recorded',
        {
          stocktakeId: row.id,
          reference,
          name: row.name,
          itemId: item.id,
          assetId: item.assetId,
          result: input.result,
        },
        { tx },
      );
      await this.notifyWhenReady(tx, row);
    });
    const [after] = await this.db.select().from(stocktakeItems).where(eq(stocktakeItems.id, item.id));
    return (await this.itemDtos([after!], auth, groupIds, true))[0]!;
  }

  /** Once every item is recorded, the creator hears it can be signed off (once). */
  private async notifyWhenReady(tx: Db, st: StocktakeRow) {
    if (st.readyNotifiedAt) return;
    const [pending] = await tx
      .select({ n: count() })
      .from(stocktakeItems)
      .where(and(eq(stocktakeItems.stocktakeId, st.id), isNull(stocktakeItems.result)));
    if (pending!.n) return;
    const done = await tx
      .update(stocktakes)
      .set({ readyNotifiedAt: new Date() })
      .where(and(eq(stocktakes.id, st.id), isNull(stocktakes.readyNotifiedAt)))
      .returning({ id: stocktakes.id });
    if (!done.length) return;
    const reference = formatRef('stocktake', st.number);
    await this.ctx.notifications.notify(
      {
        type: 'isms.stocktake.ready',
        recipients: [st.createdBy],
        params: { name: st.name, reference },
        href: stocktakeHref(reference),
      },
      { tx },
    );
  }

  async signOff(ref: string, note: string | null | undefined, auth: AuthContext) {
    auth.require(P.stocktakesSignoff);
    const row = await this.row(ref);
    if (row.status !== 'open')
      throw invalidState('Only an open stocktake can be signed off', 'stocktakeClosed');
    const reference = formatRef('stocktake', row.number);
    const today = companyToday();
    await this.ctx.transaction(async (tx) => {
      const [locked] = await tx.select().from(stocktakes).where(eq(stocktakes.id, row.id)).for('update');
      if (locked!.status !== 'open')
        throw invalidState('Only an open stocktake can be signed off', 'stocktakeClosed');
      const [pending] = await tx
        .select({ n: count() })
        .from(stocktakeItems)
        .where(and(eq(stocktakeItems.stocktakeId, row.id), isNull(stocktakeItems.result)));
      if (pending!.n)
        throw invalidState('Some items are not recorded yet', 'itemsPending', { pending: pending!.n });
      const items = await tx.select().from(stocktakeItems).where(eq(stocktakeItems.stocktakeId, row.id));
      const counts: Record<string, number> = {};
      for (const i of items) {
        if (!i.assetId || !i.result) continue;
        counts[i.result] = (counts[i.result] ?? 0) + 1;
        const asset = await tx.select().from(assets).where(eq(assets.id, i.assetId));
        if (!asset[0]) continue;
        const status = statusAfterStocktake(i.result);
        if (status && status !== asset[0].status)
          await this.assetsSvc.update(i.assetId, { status }, auth, {
            tx,
            allowed: true,
            kind: 'stocktake',
            note: reference,
            metadata: { stocktake: reference },
          });
        if (i.result === 'confirmed' || i.result === 'changed')
          await tx.update(assets).set({ lastVerifiedOn: today }).where(eq(assets.id, i.assetId));
      }
      await tx
        .update(stocktakes)
        .set({
          status: 'signed_off',
          signedOffBy: actingUserId(auth),
          signedOffAt: new Date(),
          signOffNote: note ?? null,
        })
        .where(eq(stocktakes.id, row.id));
      await this.ctx.audit.record(
        {
          action: 'isms.stocktake.signed_off',
          entityType: STOCKTAKE_ENTITY,
          entityId: row.id,
          entityLabel: `${reference} ${row.name}`,
          metadata: { results: counts, note: note ?? null },
        },
        { tx },
      );
      await this.ctx.events.publish(
        'isms.stocktake.signed_off',
        { stocktakeId: row.id, reference, name: row.name },
        { tx },
      );
      const months = recurrenceMonths(row.recurrence);
      if (months) {
        const [next] = await tx
          .insert(stocktakes)
          .values({
            name: row.name,
            status: 'scheduled',
            scope: row.scope,
            startOn: addMonths(row.startOn, months),
            dueOn: addMonths(row.dueOn, months),
            recurrence: row.recurrence,
            previousId: row.id,
            createdBy: row.createdBy,
          })
          .onConflictDoNothing()
          .returning();
        if (next) {
          const nextRef = formatRef('stocktake', next.number);
          await this.ctx.audit.record(
            {
              action: 'isms.stocktake.created',
              entityType: STOCKTAKE_ENTITY,
              entityId: next.id,
              entityLabel: `${nextRef} ${next.name}`,
              metadata: { previous: reference, startOn: next.startOn, dueOn: next.dueOn },
            },
            { tx },
          );
          await this.ctx.events.publish(
            'isms.stocktake.created',
            {
              stocktakeId: next.id,
              reference: nextRef,
              name: next.name,
              status: 'scheduled',
              dueOn: next.dueOn,
            },
            { tx },
          );
        }
      }
    });
    return this.detail(row.id, auth);
  }

  async cancel(ref: string, auth: AuthContext) {
    auth.require(P.stocktakesManage);
    const row = await this.row(ref);
    if (row.status !== 'open' && row.status !== 'scheduled')
      throw invalidState('The stocktake is already closed', 'stocktakeClosed');
    const reference = formatRef('stocktake', row.number);
    await this.ctx.transaction(async (tx) => {
      const [locked] = await tx.select().from(stocktakes).where(eq(stocktakes.id, row.id)).for('update');
      if (locked?.status !== 'open' && locked?.status !== 'scheduled')
        throw invalidState('The stocktake is already closed', 'stocktakeClosed');
      await tx.update(stocktakes).set({ status: 'cancelled' }).where(eq(stocktakes.id, row.id));
      await this.ctx.audit.record(
        {
          action: 'isms.stocktake.cancelled',
          entityType: STOCKTAKE_ENTITY,
          entityId: row.id,
          entityLabel: `${reference} ${row.name}`,
        },
        { tx },
      );
      await this.ctx.events.publish(
        'isms.stocktake.cancelled',
        { stocktakeId: row.id, reference, name: row.name },
        { tx },
      );
    });
    return this.detail(row.id, auth);
  }

  /** The results as CSV (the register's numbers, the result, the corrections and notes). */
  async exportCsv(ref: string, auth: AuthContext, locale: string) {
    const { row, groupIds, all } = await this.readable(ref, auth);
    const catalog = CATALOGS[(LOCALES as readonly string[]).includes(locale) ? (locale as 'en') : 'en'];
    const items = await this.db
      .select()
      .from(stocktakeItems)
      .where(
        and(
          eq(stocktakeItems.stocktakeId, row.id),
          all ? undefined : this.mineCondition(auth.user?.id ?? null, groupIds),
        ),
      )
      .orderBy(sql`${stocktakeItems.snapshot}->>'number'`);
    const [people, grps] = await Promise.all([
      peopleByIds(
        this.db,
        items.flatMap((i) => [i.assigneeId, i.decidedBy]),
      ),
      groupsByIds(
        this.db,
        items.map((i) => i.assigneeGroupId),
      ),
    ]);
    const h = catalog.csv.stocktake;
    const fmtChanges = (c: Record<string, [unknown, unknown]> | null) =>
      c
        ? Object.entries(c)
            .map(([k, [a, b]]) => `${k}: ${a ?? ''} → ${b ?? ''}`)
            .join('; ')
        : '';
    const csv = toCsv([
      [
        h.number,
        h.name,
        h.class,
        h.site,
        h.location,
        h.value,
        h.assignee,
        h.result,
        h.changes,
        h.note,
        h.decidedBy,
        h.decidedAt,
      ],
      ...items.map((i) => [
        i.snapshot.number,
        i.snapshot.name,
        localize(i.snapshot.className, locale),
        i.snapshot.siteCode,
        i.snapshot.location,
        i.snapshot.value,
        (i.assigneeId ? people.get(i.assigneeId)?.displayName : null) ??
          (i.assigneeGroupId ? grps.get(i.assigneeGroupId)?.name : null) ??
          '',
        i.result ? catalog.stocktakeResult[i.result] : catalog.stocktakeResult.pending,
        fmtChanges(i.changes ?? null),
        i.note,
        i.decidedBy ? people.get(i.decidedBy)?.displayName : '',
        i.decidedAt ? i.decidedAt.toISOString() : '',
      ]),
    ]);
    const reference = formatRef('stocktake', row.number);
    await this.ctx.audit.record({
      action: 'isms.stocktake.exported',
      entityType: STOCKTAKE_ENTITY,
      entityId: row.id,
      entityLabel: reference,
      metadata: { rows: items.length },
    });
    return { filename: `${reference}.csv`, csv };
  }

  /* ───────────── schedule ───────────── */

  /** Daily: opens scheduled campaigns, reminds managers before the due date and tells them when it passed. */
  async daily(log: (m: string) => void = () => undefined) {
    const today = companyToday();
    const cfg = await ismsConfig(this.ctx);
    let started = 0;
    let reminded = 0;
    let overdue = 0;
    const due = await this.db
      .select()
      .from(stocktakes)
      .where(and(eq(stocktakes.status, 'scheduled'), lte(stocktakes.startOn, today)));
    for (const st of due) {
      await this.ctx.transaction(async (tx) => {
        const [locked] = await tx.select().from(stocktakes).where(eq(stocktakes.id, st.id)).for('update');
        if (locked?.status !== 'scheduled') return;
        await this.start(tx, locked);
        started++;
      });
    }
    const open = await this.db.select().from(stocktakes).where(eq(stocktakes.status, 'open'));
    for (const st of open) {
      const soon = st.dueOn >= today && daysBetween(today, st.dueOn) <= cfg.reminderDays && !st.remindedOn;
      const late = st.dueOn < today && !st.overdueNotifiedOn;
      if (!soon && !late) continue;
      const reference = formatRef('stocktake', st.number);
      const pending = await this.db
        .select({
          assigneeId: stocktakeItems.assigneeId,
          groupId: stocktakeItems.assigneeGroupId,
          n: count(),
        })
        .from(stocktakeItems)
        .where(and(eq(stocktakeItems.stocktakeId, st.id), isNull(stocktakeItems.result)))
        .groupBy(stocktakeItems.assigneeId, stocktakeItems.assigneeGroupId);
      const perPerson = new Map<string, number>();
      const members = await membersOfGroups(
        this.db,
        pending.filter((p) => !p.assigneeId && p.groupId).map((p) => p.groupId!),
      );
      for (const p of pending) {
        if (p.assigneeId) perPerson.set(p.assigneeId, (perPerson.get(p.assigneeId) ?? 0) + p.n);
        else if (p.groupId)
          for (const u of members.get(p.groupId) ?? []) perPerson.set(u, (perPerson.get(u) ?? 0) + p.n);
      }
      await this.ctx.transaction(async (tx) => {
        const type = late ? 'isms.stocktake.overdue' : 'isms.stocktake.reminder';
        for (const [userId, n] of perPerson)
          await this.ctx.notifications.notify(
            {
              type,
              recipients: [userId],
              params: { name: st.name, count: n, due: st.dueOn },
              href: `${stocktakeHref(reference)}?mine=true`,
            },
            { tx },
          );
        if (late && st.createdBy && !perPerson.has(st.createdBy) && perPerson.size)
          await this.ctx.notifications.notify(
            {
              type,
              recipients: [st.createdBy],
              params: {
                name: st.name,
                count: [...perPerson.values()].reduce((a, b) => a + b, 0),
                due: st.dueOn,
              },
              href: stocktakeHref(reference),
            },
            { tx },
          );
        await tx
          .update(stocktakes)
          .set(
            late ? { overdueNotifiedOn: today, remindedOn: st.remindedOn ?? today } : { remindedOn: today },
          )
          .where(eq(stocktakes.id, st.id));
      });
      if (late) overdue++;
      else reminded++;
    }
    log(`stocktakes: ${started} started, ${reminded} reminded, ${overdue} overdue`);
    return { started, reminded, overdue };
  }

  /** Open stocktakes with their progress (dashboard). */
  async openSummaries(auth: AuthContext) {
    const res = await this.list({ page: 1, pageSize: 5, status: 'open', mine: undefined }, auth);
    return res.items.map((s) => ({
      id: s.id,
      reference: s.reference,
      name: s.name,
      dueOn: s.dueOn,
      percent: s.progress.percent,
    }));
  }

  /** People (by id) with stocktakes waiting: used by tests and the seed. */
  async assigneesOf(stocktakeId: string) {
    const rows = await this.db
      .selectDistinct({ id: users.id })
      .from(stocktakeItems)
      .innerJoin(users, eq(users.id, stocktakeItems.assigneeId))
      .where(eq(stocktakeItems.stocktakeId, stocktakeId));
    return rows.map((r) => r.id);
  }
}
