/**
 * Hardware business rules — shared by the REST routes, the AI tools, the record resolvers, event
 * handlers, jobs, the seed and (Phase 5) a sync adapter. Every mutation runs in one transaction with its
 * timeline entry (`asset_events`), audit row, outbox events and notifications.
 */
import { departments, users } from '@isbp/db/schema';
import { ciClasses, cis } from '@isbp/module-cmdb/schema';
import {
  type AuthContext,
  type Db,
  ErrorCodes,
  HttpError,
  httpErrors,
  likePattern,
  type ModuleContext,
  type WorkflowCompletion,
} from '@isbp/sdk/server';
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNotNull,
  lt,
  lte,
  ne,
  or,
  type SQL,
  sql,
} from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { z } from 'zod';
import type {
  assetQuerySchema,
  assetStatusChangeSchema,
  assignAssetSchema,
  createAssetSchema,
  disposeAssetSchema,
  returnAssetSchema,
  updateAssetSchema,
} from '../contracts';
import {
  addDays,
  ASSIGNABLE_STATUSES,
  type AssetCategory,
  type AssetStatus,
  canAssign,
  canTransition,
  defaultRetireOn,
  DEFAULT_LIFESPAN_MONTHS,
  depreciation,
  disposalFacts,
  formatAssetTag,
  HARDWARE_VIEWS,
  manualTransitions,
  parseRef,
  warrantyState,
} from '../model';
import {
  all,
  canManageHardware,
  canReadContracts,
  canReadHardware,
  canReadSoftware,
  HARDWARE_MANAGE,
  hardwareFilter,
  isOwnAsset,
} from './access';
import {
  assetEvents,
  type AssetEventKind,
  type AssetRow,
  assets,
  licenseAssignments,
  licenses,
  models,
  vendors,
} from './schema';
import {
  type Actor,
  actingUserId,
  actorOf,
  companyToday,
  invalidField,
  type ItamConfig,
  itamConfig,
  peopleByIds,
  personRef,
  pgCode,
  pgConstraint,
  roleHolders,
  UNIQUE_VIOLATION,
} from './support';

export type CreateAssetData = z.output<typeof createAssetSchema>;
export type UpdateAssetData = z.output<typeof updateAssetSchema>;
export type AssetQueryData = z.output<typeof assetQuerySchema>;
type AssignData = z.output<typeof assignAssetSchema>;
type ReturnData = z.output<typeof returnAssetSchema>;
type StatusData = z.output<typeof assetStatusChangeSchema>;
type DisposeData = z.output<typeof disposeAssetSchema>;

export const ASSET_ENTITY = 'itam.asset';
export const assetHref = (tag: string) => `/itam/hardware/${tag}`;
export const auditLabel = (a: { number: number; name: string }) => `${formatAssetTag(a.number)} ${a.name}`;

const assignee = alias(users, 'assignee');

/** Columns of a list row: the asset with its model, assignee, department and CI. */
const itemColumns = {
  asset: assets,
  modelCategory: models.category,
  modelManufacturer: models.manufacturer,
  modelName: models.name,
  modelLifespan: models.lifespanMonths,
  assigneeName: assignee.displayName,
  assigneeAvatar: assignee.avatarUrl,
  assigneeEmail: assignee.email,
  assigneeDepartmentId: assignee.departmentId,
  departmentName: departments.name,
  ciNumber: cis.number,
  ciName: cis.name,
};

export type AssetItemRow = {
  asset: AssetRow;
  modelCategory: AssetCategory | null;
  modelManufacturer: string | null;
  modelName: string | null;
  modelLifespan: number | null;
  assigneeName: string | null;
  assigneeAvatar: string | null;
  assigneeEmail: string | null;
  assigneeDepartmentId: string | null;
  departmentName: string | null;
  ciNumber: number | null;
  ciName: string | null;
};

export function selectAssetItems(db: Db) {
  return db
    .select(itemColumns)
    .from(assets)
    .leftJoin(models, eq(models.id, assets.modelId))
    .leftJoin(assignee, eq(assignee.id, assets.assignedTo))
    .leftJoin(departments, eq(departments.id, assets.departmentId))
    .leftJoin(cis, eq(cis.id, assets.ciId));
}

const formatCi = (n: number) => `CI-${String(n).padStart(5, '0')}`;

/** Lifespan for depreciation: the model's, else the category default. */
export const lifespanOf = (r: { modelLifespan: number | null; asset: { category: AssetCategory } }) =>
  r.modelLifespan ?? DEFAULT_LIFESPAN_MONTHS[r.asset.category];

export function toAssetItem(r: AssetItemRow, today: string, warrantyDays: number) {
  const a = r.asset;
  const dep = depreciation(
    {
      cost: a.purchaseCost,
      purchaseDate: a.purchaseDate,
      lifespanMonths: lifespanOf(r),
      category: a.category,
    },
    today,
  );
  return {
    id: a.id,
    number: a.number,
    tag: formatAssetTag(a.number),
    name: a.name,
    category: a.category,
    status: a.status,
    model:
      a.modelId && r.modelName
        ? {
            id: a.modelId,
            category: r.modelCategory ?? a.category,
            manufacturer: r.modelManufacturer ?? '',
            name: r.modelName,
          }
        : null,
    serialNumber: a.serialNumber,
    assignee: a.assignedTo
      ? {
          id: a.assignedTo,
          displayName: r.assigneeName ?? '—',
          avatarUrl: r.assigneeAvatar,
          email: r.assigneeEmail,
        }
      : null,
    assignedAt: a.assignedAt,
    location: a.location,
    department: a.departmentId ? { id: a.departmentId, name: r.departmentName ?? '—' } : null,
    warrantyEnd: a.warrantyEnd,
    warrantyState: warrantyState(a.warrantyEnd, today, warrantyDays),
    purchaseCost: a.purchaseCost,
    currency: a.currency,
    bookValue: dep?.bookValue ?? null,
    ci:
      a.ciId && r.ciNumber !== null
        ? { id: a.ciId, reference: formatCi(r.ciNumber), name: r.ciName ?? '' }
        : null,
    updatedAt: a.updatedAt,
  };
}
export type AssetItem = ReturnType<typeof toAssetItem>;

const STATUS_RANK = sql`case ${assets.status} when 'deployed' then 0 when 'in_stock' then 1 when 'in_repair' then 2 when 'ordered' then 3 when 'lost' then 4 when 'retired' then 5 else 6 end`;

const SORTABLE: Record<string, SQL> = {
  number: sql`${assets.number}`,
  name: sql`${assets.name}`,
  category: sql`${assets.category}`,
  status: STATUS_RANK,
  assignee: sql`${assignee.displayName}`,
  location: sql`${assets.location}`,
  warrantyEnd: sql`${assets.warrantyEnd}`,
  purchaseDate: sql`${assets.purchaseDate}`,
  updatedAt: sql`${assets.updatedAt}`,
};

/** Tag (`AST-00042`, `42`), serial number or name. */
export function assetSearchCondition(term: string): SQL {
  const q = term.trim();
  const ref = parseRef('asset', q) ?? (/^\d{1,12}$/.test(q) ? { number: Number(q) } : null);
  const text = or(ilike(assets.name, likePattern(q)), ilike(assets.serialNumber, likePattern(q)))!;
  if (ref && 'number' in ref) return or(text, eq(assets.number, ref.number))!;
  if (ref && 'id' in ref) return or(text, eq(assets.id, ref.id))!;
  return text;
}

export class AssetService {
  constructor(private readonly ctx: ModuleContext) {}

  /* ───────────── reading ───────────── */

  /** An asset by uuid or tag (`AST-00042`); 404 otherwise. */
  async resolve(ref: string, db: Db = this.ctx.db): Promise<AssetRow> {
    const parsed = parseRef('asset', ref);
    if (!parsed) throw httpErrors.notFound('Asset not found');
    const [row] = await db
      .select()
      .from(assets)
      .where('id' in parsed ? eq(assets.id, parsed.id) : eq(assets.number, parsed.number));
    if (!row) throw httpErrors.notFound('Asset not found');
    return row;
  }

  async itemRow(id: string, db: Db = this.ctx.db): Promise<AssetItemRow | null> {
    const [row] = await selectAssetItems(db).where(eq(assets.id, id));
    return (row as AssetItemRow | undefined) ?? null;
  }

  /** The asset when the caller may read it as a hardware reader (404 otherwise, so ids can't be probed). */
  async readable(ref: string, auth: AuthContext): Promise<AssetItemRow> {
    const a = await this.resolve(ref);
    const row = await this.itemRow(a.id);
    if (!row || !canReadHardware(auth, scopeOf(row))) throw httpErrors.notFound('Asset not found');
    return row;
  }

  async list(q: AssetQueryData, auth: AuthContext) {
    const today = companyToday();
    const cfg = await itamConfig(this.ctx);
    const statuses = q.status?.length ? q.status : q.view ? [...HARDWARE_VIEWS[q.view]] : null;
    const where = all(
      hardwareFilter(auth),
      statuses ? inArray(assets.status, statuses) : undefined,
      q.category ? eq(assets.category, q.category) : undefined,
      q.assignee ? eq(assets.assignedTo, q.assignee) : undefined,
      q.department ? eq(assets.departmentId, q.department) : undefined,
      q.location ? ilike(assets.location, likePattern(q.location)) : undefined,
      q.model ? eq(assets.modelId, q.model) : undefined,
      q.vendor ? eq(assets.vendorId, q.vendor) : undefined,
      q.ci ? eq(assets.ciId, q.ci) : undefined,
      q.warranty === 'expired'
        ? and(lt(assets.warrantyEnd, today), ne(assets.status, 'disposed'))
        : q.warranty === 'expiring'
          ? and(
              gte(assets.warrantyEnd, today),
              lte(assets.warrantyEnd, addDays(today, cfg.warrantyDays)),
              ne(assets.status, 'disposed'),
            )
          : undefined,
      q.q ? assetSearchCondition(q.q) : undefined,
    );
    const key = q.sort?.replace(/^-/, '') ?? 'number';
    const column = SORTABLE[key] ?? SORTABLE.number!;
    const descending = q.sort ? q.sort.startsWith('-') : true;
    const order = descending ? sql`${column} desc nulls last` : sql`${column} asc nulls last`;
    const [rows, [total]] = await Promise.all([
      selectAssetItems(this.ctx.db)
        .where(where)
        .orderBy(order, desc(assets.number))
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize),
      this.ctx.db.select({ n: count() }).from(assets).where(where),
    ]);
    return {
      items: (rows as AssetItemRow[]).map((r) => toAssetItem(r, today, cfg.warrantyDays)),
      total: total!.n,
      page: q.page,
      pageSize: q.pageSize,
    };
  }

  viewer(row: AssetRow, auth: AuthContext) {
    const manage = canManageHardware(auth);
    return {
      canManage: manage,
      transitions: manage && !row.disposalInstanceId ? manualTransitions(row.status) : [],
      canAssign: manage && canAssign(row.status) && !row.disposalInstanceId,
      canReturn: manage && Boolean(row.assignedTo),
      canDispose: manage && row.status === 'retired' && !row.disposalInstanceId,
      canReadContracts: canReadContracts(auth),
      canReadSoftware: canReadSoftware(auth) || manage,
    };
  }

  async detail(ref: string, auth: AuthContext) {
    const row = await this.readable(ref, auth);
    return this.detailOf(row, auth);
  }

  async detailOf(row: AssetItemRow, auth: AuthContext) {
    const a = row.asset;
    const today = companyToday();
    const cfg = await itamConfig(this.ctx);
    const [[vendor], [ci]] = await Promise.all([
      a.vendorId
        ? this.ctx.db
            .select({ id: vendors.id, name: vendors.name })
            .from(vendors)
            .where(eq(vendors.id, a.vendorId))
        : Promise.resolve([]),
      a.ciId
        ? this.ctx.db
            .select({
              id: cis.id,
              number: cis.number,
              name: cis.name,
              status: cis.status,
              className: ciClasses.name,
            })
            .from(cis)
            .innerJoin(ciClasses, eq(ciClasses.key, cis.classKey))
            .where(eq(cis.id, a.ciId))
        : Promise.resolve([]),
    ]);
    return {
      ...toAssetItem(row, today, cfg.warrantyDays),
      vendor: vendor ?? null,
      purchaseDate: a.purchaseDate,
      invoiceNumber: a.invoiceNumber,
      retireOn: a.retireOn,
      notes: a.notes,
      attributes: a.attributes,
      depreciation: depreciation(
        {
          cost: a.purchaseCost,
          purchaseDate: a.purchaseDate,
          lifespanMonths: lifespanOf(row),
          category: a.category,
        },
        today,
      ),
      ciDetail: ci
        ? {
            id: ci.id,
            reference: formatCi(ci.number),
            name: ci.name,
            status: ci.status,
            className: ci.className as Record<string, string>,
          }
        : null,
      disposedAt: a.disposedAt,
      disposalNote: a.disposalNote,
      disposalInstanceId: a.disposalInstanceId,
      viewer: this.viewer(a, auth),
      createdAt: a.createdAt,
    };
  }

  async detailById(id: string, auth: AuthContext) {
    const row = await this.itemRow(id);
    if (!row) throw httpErrors.notFound('Asset not found');
    return this.detailOf(row, auth);
  }

  /** Timeline, newest first. */
  async events(ref: string, q: { page: number; pageSize: number }, auth: AuthContext) {
    const row = await this.readable(ref, auth);
    const where = eq(assetEvents.assetId, row.asset.id);
    const [rows, [total]] = await Promise.all([
      this.ctx.db
        .select()
        .from(assetEvents)
        .where(where)
        .orderBy(desc(assetEvents.createdAt), desc(assetEvents.id))
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize),
      this.ctx.db.select({ n: count() }).from(assetEvents).where(where),
    ]);
    const people = await peopleByIds(
      this.ctx.db,
      rows.flatMap((e) => [e.userId, e.actorId]),
    );
    return {
      items: rows.map((e) => {
        const actor = e.actorId ? people.get(e.actorId) : undefined;
        return {
          id: e.id,
          kind: e.kind,
          fromValue: e.fromValue,
          toValue: e.toValue,
          user: personRef(e.userId ? people.get(e.userId) : null),
          actor: actor
            ? { id: actor.id, displayName: actor.displayName, avatarUrl: actor.avatarUrl }
            : e.actorName
              ? { id: null, displayName: e.actorName, avatarUrl: null }
              : null,
          note: e.note,
          createdAt: e.createdAt,
        };
      }),
      total: total!.n,
      page: q.page,
      pageSize: q.pageSize,
    };
  }

  /* ───────────── validation ───────────── */

  private async model(id: string | null | undefined) {
    if (!id) return null;
    const [m] = await this.ctx.db.select().from(models).where(eq(models.id, id));
    if (!m) throw invalidField('modelId', 'Unknown model');
    return m;
  }

  private async assertRefs(input: {
    vendorId?: string | null;
    departmentId?: string | null;
    ciId?: string | null;
  }) {
    const checks: Promise<void>[] = [];
    if (input.vendorId)
      checks.push(
        this.ctx.db
          .select({ id: vendors.id })
          .from(vendors)
          .where(eq(vendors.id, input.vendorId))
          .then((r) => {
            if (!r.length) throw invalidField('vendorId', 'Unknown vendor');
          }),
      );
    if (input.departmentId)
      checks.push(
        this.ctx.db
          .select({ id: departments.id })
          .from(departments)
          .where(eq(departments.id, input.departmentId))
          .then((r) => {
            if (!r.length) throw invalidField('departmentId', 'Unknown department');
          }),
      );
    if (input.ciId)
      checks.push(
        this.ctx.db
          .select({ id: cis.id })
          .from(cis)
          .where(eq(cis.id, input.ciId))
          .then((r) => {
            if (!r.length) throw invalidField('ciId', 'Unknown configuration item');
          }),
      );
    await Promise.all(checks);
  }

  private async activePerson(userId: string, path = 'userId') {
    const [u] = await this.ctx.db
      .select({ id: users.id, status: users.status, displayName: users.displayName })
      .from(users)
      .where(eq(users.id, userId));
    if (!u || u.status !== 'active') throw invalidField(path, 'Choose an active person');
    return u;
  }

  private conflict(err: unknown): never {
    if (pgCode(err) === UNIQUE_VIOLATION && pgConstraint(err) === 'assets_serial_uq')
      throw httpErrors.conflict('Another asset already has this serial number', { field: 'serialNumber' });
    throw err;
  }

  /* ───────────── timeline, audit, events ───────────── */

  async event(
    tx: Db,
    assetId: string,
    kind: AssetEventKind,
    actor: Actor,
    data: {
      from?: string | null;
      to?: string | null;
      userId?: string | null;
      note?: string | null;
      at?: Date;
    } = {},
  ) {
    await tx.insert(assetEvents).values({
      assetId,
      kind,
      fromValue: data.from ?? null,
      toValue: data.to ?? null,
      userId: data.userId ?? null,
      actorId: actor.actorId,
      actorName: actor.actorName,
      note: data.note ?? null,
      ...(data.at ? { createdAt: data.at } : {}),
    });
  }

  private ref(a: AssetRow) {
    return { assetId: a.id, tag: formatAssetTag(a.number), name: a.name };
  }

  /* ───────────── mutations ───────────── */

  async create(input: CreateAssetData, auth: AuthContext, opts: { at?: Date; quiet?: boolean } = {}) {
    auth.require(HARDWARE_MANAGE);
    const model = await this.model(input.modelId);
    if (model && model.category !== input.category)
      throw invalidField('category', `The model is a ${model.category}`);
    await this.assertRefs(input);
    const person = input.assigneeId ? await this.activePerson(input.assigneeId, 'assigneeId') : null;
    const cfg = await itamConfig(this.ctx);
    const attributes = input.attributes ? await this.ctx.fields.validate(ASSET_ENTITY, input.attributes) : {};
    const lifespan = model?.lifespanMonths ?? DEFAULT_LIFESPAN_MONTHS[input.category];
    const actor = actorOf(auth);
    const at = opts.at ?? new Date();
    try {
      return await this.ctx.transaction(async (tx) => {
        const [row] = await tx
          .insert(assets)
          .values({
            name: input.name,
            category: input.category,
            modelId: model?.id ?? null,
            serialNumber: input.serialNumber,
            status: person ? 'deployed' : (input.status ?? 'in_stock'),
            assignedTo: person?.id ?? null,
            assignedAt: person ? at : null,
            location: input.location,
            departmentId: input.departmentId ?? null,
            ciId: input.ciId ?? null,
            vendorId: input.vendorId ?? null,
            purchaseDate: input.purchaseDate ?? null,
            purchaseCost: input.purchaseCost ?? null,
            currency: input.currency ?? cfg.currency,
            invoiceNumber: input.invoiceNumber,
            warrantyEnd: input.warrantyEnd ?? null,
            retireOn: input.retireOn ?? defaultRetireOn(input.purchaseDate ?? null, lifespan, input.category),
            notes: input.notes,
            attributes,
            createdAt: at,
            updatedAt: at,
          })
          .returning();
        const a = row!;
        await this.event(tx, a.id, 'created', actor, { to: a.status, at });
        if (person)
          await this.event(tx, a.id, 'assigned', actor, { userId: person.id, to: person.displayName, at });
        if (!opts.quiet) {
          await this.ctx.audit.record(
            {
              action: 'itam.asset.created',
              entityType: ASSET_ENTITY,
              entityId: a.id,
              entityLabel: auditLabel(a),
              metadata: { category: a.category, status: a.status, serialNumber: a.serialNumber },
            },
            { tx },
          );
          await this.ctx.events.publish(
            'itam.asset.created',
            { ...this.ref(a), category: a.category, status: a.status },
            { tx },
          );
          if (person) await this.announceAssignment(tx, a, person.id, null);
        }
        return a;
      });
    } catch (err) {
      this.conflict(err);
    }
  }

  async update(ref: string, input: UpdateAssetData, auth: AuthContext) {
    auth.require(HARDWARE_MANAGE);
    const before = await this.resolve(ref);
    const modelId = input.modelId === undefined ? before.modelId : input.modelId;
    const category = input.category ?? before.category;
    const model = await this.model(modelId);
    if (model && model.category !== category)
      throw invalidField('category', `The model is a ${model.category}`);
    await this.assertRefs(input);
    const attributes =
      input.attributes !== undefined
        ? await this.ctx.fields.validate(ASSET_ENTITY, input.attributes, before.attributes)
        : before.attributes;
    const patch: Partial<typeof assets.$inferInsert> = {};
    const fields = [
      'name',
      'category',
      'modelId',
      'serialNumber',
      'location',
      'departmentId',
      'ciId',
      'vendorId',
      'purchaseDate',
      'purchaseCost',
      'currency',
      'invoiceNumber',
      'warrantyEnd',
      'retireOn',
      'notes',
    ] as const;
    for (const f of fields) {
      const v = input[f];
      if (v !== undefined && v !== before[f]) (patch as Record<string, unknown>)[f] = v;
    }
    if (JSON.stringify(attributes) !== JSON.stringify(before.attributes)) patch.attributes = attributes;
    const changed = Object.keys(patch);
    if (!changed.length) return before;
    const changes = this.ctx.audit.diff(
      before as unknown as Record<string, unknown>,
      patch as Record<string, unknown>,
    );
    try {
      return await this.ctx.transaction(async (tx) => {
        const [row] = await tx.update(assets).set(patch).where(eq(assets.id, before.id)).returning();
        const a = row!;
        await this.event(tx, a.id, 'updated', actorOf(auth), { note: changed.join(', ') });
        await this.ctx.audit.record(
          {
            action: 'itam.asset.updated',
            entityType: ASSET_ENTITY,
            entityId: a.id,
            entityLabel: auditLabel(a),
            changes,
          },
          { tx },
        );
        await this.ctx.events.publish('itam.asset.updated', { ...this.ref(a), changes: changed }, { tx });
        return a;
      });
    } catch (err) {
      this.conflict(err);
    }
  }

  private async lock(tx: Db, id: string) {
    const [row] = await tx.select().from(assets).where(eq(assets.id, id)).for('update');
    if (!row) throw httpErrors.notFound('Asset not found');
    return row;
  }

  private transitionError(
    from: AssetStatus,
    to: AssetStatus,
    allowed: AssetStatus[] = manualTransitions(from),
  ) {
    return new HttpError(409, ErrorCodes.INVALID_TRANSITION, `An asset can't go from ${from} to ${to}`, {
      from,
      to,
      allowed,
    });
  }

  private async announceAssignment(tx: Db, a: AssetRow, userId: string, previousUserId: string | null) {
    await this.ctx.events.publish('itam.asset.assigned', { ...this.ref(a), userId, previousUserId }, { tx });
    const [model] = a.modelId
      ? await tx
          .select({ manufacturer: models.manufacturer, name: models.name })
          .from(models)
          .where(eq(models.id, a.modelId))
      : [];
    await this.ctx.notifications.notify(
      {
        type: 'itam.asset.assigned',
        recipients: [userId],
        params: {
          tag: formatAssetTag(a.number),
          name: a.name,
          model: model ? `${model.manufacturer} ${model.name}` : a.name,
          location: a.location ?? '',
        },
        href: '/itam/mine',
      },
      { tx },
    );
  }

  /** Hands the asset to a person: it becomes `deployed` (in stock, in repair or reassigned). */
  async assign(ref: string, input: AssignData, auth: AuthContext) {
    auth.require(HARDWARE_MANAGE);
    const target = await this.resolve(ref);
    const person = await this.activePerson(input.userId);
    const actor = actorOf(auth);
    return this.ctx.transaction(async (tx) => {
      const a = await this.lock(tx, target.id);
      if (a.disposalInstanceId)
        throw new HttpError(409, ErrorCodes.INVALID_STATE, 'A disposal request is pending for this asset');
      if (!canAssign(a.status)) throw this.transitionError(a.status, 'deployed');
      if (a.assignedTo === person.id && a.status === 'deployed') return a;
      const previous = a.assignedTo ? (await peopleByIds(tx, [a.assignedTo])).get(a.assignedTo) : undefined;
      const now = new Date();
      const [row] = await tx
        .update(assets)
        .set({ status: 'deployed', assignedTo: person.id, assignedAt: now })
        .where(eq(assets.id, a.id))
        .returning();
      const updated = row!;
      if (previous)
        await this.event(tx, a.id, 'returned', actor, {
          userId: previous.id,
          from: previous.displayName,
          to: a.status,
        });
      await this.event(tx, a.id, 'assigned', actor, {
        userId: person.id,
        from: a.status === 'deployed' ? null : a.status,
        to: person.displayName,
        note: input.note,
      });
      await this.ctx.audit.record(
        {
          action: 'itam.asset.assigned',
          entityType: ASSET_ENTITY,
          entityId: a.id,
          entityLabel: auditLabel(a),
          changes: {
            assignedTo: [a.assignedTo, person.id],
            ...(a.status !== 'deployed' ? { status: [a.status, 'deployed'] } : {}),
          },
          metadata: { note: input.note },
        },
        { tx },
      );
      if (a.status !== 'deployed')
        await this.ctx.events.publish(
          'itam.asset.status_changed',
          { ...this.ref(updated), from: a.status, to: 'deployed' },
          { tx },
        );
      await this.announceAssignment(tx, updated, person.id, a.assignedTo);
      return updated;
    });
  }

  /** Takes the asset back from its assignee: `in_stock` (default) or `in_repair`. */
  async returnAsset(ref: string, input: ReturnData, auth: AuthContext) {
    auth.require(HARDWARE_MANAGE);
    const target = await this.resolve(ref);
    const actor = actorOf(auth);
    return this.ctx.transaction(async (tx) => {
      const a = await this.lock(tx, target.id);
      if (!a.assignedTo)
        throw new HttpError(409, ErrorCodes.INVALID_STATE, 'The asset is not assigned to anyone');
      const to = input.toStatus;
      if (a.status !== to && !canTransition(a.status, to))
        throw this.transitionError(
          a.status,
          to,
          (['in_stock', 'in_repair'] as AssetStatus[]).filter((s) => canTransition(a.status, s)),
        );
      const holder = (await peopleByIds(tx, [a.assignedTo])).get(a.assignedTo);
      const [row] = await tx
        .update(assets)
        .set({ status: to, assignedTo: null, assignedAt: null })
        .where(eq(assets.id, a.id))
        .returning();
      const updated = row!;
      await this.event(tx, a.id, 'returned', actor, {
        userId: a.assignedTo,
        from: holder?.displayName ?? null,
        to,
        note: input.note,
      });
      await this.ctx.audit.record(
        {
          action: 'itam.asset.returned',
          entityType: ASSET_ENTITY,
          entityId: a.id,
          entityLabel: auditLabel(a),
          changes: {
            assignedTo: [a.assignedTo, null],
            ...(a.status !== to ? { status: [a.status, to] } : {}),
          },
          metadata: { note: input.note },
        },
        { tx },
      );
      await this.ctx.events.publish(
        'itam.asset.returned',
        { ...this.ref(updated), userId: a.assignedTo, toStatus: to },
        { tx },
      );
      if (a.status !== to)
        await this.ctx.events.publish(
          'itam.asset.status_changed',
          { ...this.ref(updated), from: a.status, to },
          { tx },
        );
      return updated;
    });
  }

  /** Lifecycle step (not disposal). Leaving deployed/in repair/lost for a pool status releases the assignee. */
  async changeStatus(ref: string, input: StatusData, auth: AuthContext) {
    auth.require(HARDWARE_MANAGE);
    const target = await this.resolve(ref);
    const actor = actorOf(auth);
    return this.ctx.transaction(async (tx) => {
      const a = await this.lock(tx, target.id);
      if (a.status === input.status) return a;
      if (a.disposalInstanceId)
        throw new HttpError(409, ErrorCodes.INVALID_STATE, 'A disposal request is pending for this asset');
      if (input.status === 'disposed' || !canTransition(a.status, input.status))
        throw this.transitionError(a.status, input.status);
      const release = a.assignedTo !== null && !ASSIGNABLE_STATUSES.includes(input.status);
      const [row] = await tx
        .update(assets)
        .set({ status: input.status, ...(release ? { assignedTo: null, assignedAt: null } : {}) })
        .where(eq(assets.id, a.id))
        .returning();
      const updated = row!;
      await this.event(tx, a.id, 'status_changed', actor, {
        from: a.status,
        to: input.status,
        note: input.note,
      });
      if (release) {
        const holder = (await peopleByIds(tx, [a.assignedTo])).get(a.assignedTo!);
        await this.event(tx, a.id, 'returned', actor, {
          userId: a.assignedTo,
          from: holder?.displayName ?? null,
          to: input.status,
        });
      }
      await this.ctx.audit.record(
        {
          action: 'itam.asset.status_changed',
          entityType: ASSET_ENTITY,
          entityId: a.id,
          entityLabel: auditLabel(a),
          changes: {
            status: [a.status, input.status],
            ...(release ? { assignedTo: [a.assignedTo, null] } : {}),
          },
          metadata: { note: input.note },
        },
        { tx },
      );
      await this.ctx.events.publish(
        'itam.asset.status_changed',
        { ...this.ref(updated), from: a.status, to: input.status },
        { tx },
      );
      if (release)
        await this.ctx.events.publish(
          'itam.asset.returned',
          { ...this.ref(updated), userId: a.assignedTo, toStatus: input.status },
          { tx },
        );
      return updated;
    });
  }

  /** "Request disposal": starts the required `itam.disposal` approval for a retired asset. */
  async requestDisposal(ref: string, input: DisposeData, auth: AuthContext) {
    auth.require(HARDWARE_MANAGE);
    const target = await this.resolve(ref);
    const row = await this.itemRow(target.id);
    const today = companyToday();
    const actor = actorOf(auth);
    return this.ctx.transaction(async (tx) => {
      const a = await this.lock(tx, target.id);
      if (a.status !== 'retired')
        throw new HttpError(409, ErrorCodes.INVALID_TRANSITION, 'Only retired assets can be disposed of', {
          from: a.status,
          to: 'disposed',
          allowed: [],
        });
      if (a.disposalInstanceId)
        throw new HttpError(409, ErrorCodes.INVALID_STATE, 'A disposal request is already pending');
      const tag = formatAssetTag(a.number);
      const facts = disposalFacts(
        {
          category: a.category,
          purchaseCost: a.purchaseCost,
          purchaseDate: a.purchaseDate,
          lifespanMonths: row ? lifespanOf(row) : null,
        },
        today,
      );
      const started = await this.ctx.workflows.start(
        'itam.disposal',
        {
          subject: { type: 'asset', id: a.id, label: `${tag} ${a.name}`, href: assetHref(tag) },
          facts: facts as unknown as Record<string, unknown>,
          requesterId: actingUserId(auth),
        },
        { tx },
      );
      await this.event(tx, a.id, 'disposal_requested', actor, { note: input.note });
      await this.ctx.audit.record(
        {
          action: 'itam.asset.disposal_requested',
          entityType: ASSET_ENTITY,
          entityId: a.id,
          entityLabel: auditLabel(a),
          metadata: { note: input.note, instanceId: started?.instanceId ?? null, ...facts.asset },
        },
        { tx },
      );
      const [updated] = await tx
        .update(assets)
        .set({ disposalInstanceId: started?.instanceId ?? null, disposalNote: input.note })
        .where(eq(assets.id, a.id))
        .returning();
      if (!started || started.status === 'approved')
        return this.markDisposed(tx, updated!, started?.instanceId ?? null);
      if (started.status === 'rejected') return this.disposalDeclined(tx, updated!, 'rejected', null);
      return updated!;
    });
  }

  private async markDisposed(tx: Db, a: AssetRow, instanceId: string | null) {
    const system: Actor = { actorId: null, actorName: null };
    const [row] = await tx
      .update(assets)
      .set({
        status: 'disposed',
        disposedAt: new Date(),
        disposalInstanceId: null,
        assignedTo: null,
        assignedAt: null,
      })
      .where(eq(assets.id, a.id))
      .returning();
    const updated = row!;
    await this.event(tx, a.id, 'disposed', system, { from: a.status, to: 'disposed', note: a.disposalNote });
    // A device that is gone frees its seats.
    const seats = await tx
      .delete(licenseAssignments)
      .where(eq(licenseAssignments.assetId, a.id))
      .returning({ licenseId: licenseAssignments.licenseId });
    await this.ctx.audit.record(
      {
        action: 'itam.asset.disposed',
        entityType: ASSET_ENTITY,
        entityId: a.id,
        entityLabel: auditLabel(a),
        changes: { status: [a.status, 'disposed'] },
        metadata: { instanceId, note: a.disposalNote, seatsReleased: seats.length },
      },
      { tx },
    );
    await this.ctx.events.publish('itam.asset.disposed', { ...this.ref(updated), instanceId }, { tx });
    await this.ctx.events.publish(
      'itam.asset.status_changed',
      { ...this.ref(updated), from: a.status, to: 'disposed' },
      { tx },
    );
    if (seats.length)
      await this.onSeatsChanged?.(
        tx,
        seats.map((s) => s.licenseId),
      );
    return updated;
  }

  private async disposalDeclined(
    tx: Db,
    a: AssetRow,
    outcome: 'rejected' | 'cancelled',
    comment: string | null,
  ) {
    const [row] = await tx
      .update(assets)
      .set({ disposalInstanceId: null })
      .where(eq(assets.id, a.id))
      .returning();
    await this.event(
      tx,
      a.id,
      'note',
      { actorId: null, actorName: null },
      {
        to: outcome === 'rejected' ? 'disposal_rejected' : 'disposal_cancelled',
        note: comment,
      },
    );
    await this.ctx.audit.record(
      {
        action: `itam.asset.disposal_${outcome}`,
        entityType: ASSET_ENTITY,
        entityId: a.id,
        entityLabel: auditLabel(a),
        metadata: { comment },
      },
      { tx },
    );
    return row!;
  }

  /** Recomputes licence compliance after seats changed (wired by the services container). */
  onSeatsChanged?: (tx: Db, licenseIds: string[]) => Promise<void>;

  /** The disposal workflow finished (outbox, at-least-once): dispose or stay retired, once. */
  async onDisposalCompleted(result: WorkflowCompletion) {
    await this.ctx.transaction(async (tx) => {
      const [a] = await tx.select().from(assets).where(eq(assets.id, result.subjectId)).for('update');
      if (!a || a.disposalInstanceId !== result.instanceId) return;
      if (result.outcome === 'approved') await this.markDisposed(tx, a, result.instanceId);
      else await this.disposalDeclined(tx, a, result.outcome, result.comment);
    });
  }

  /* ───────────── people ───────────── */

  /** "My devices": assets assigned to the caller. */
  async mine(me: string) {
    const today = companyToday();
    const cfg = await itamConfig(this.ctx);
    const rows = (await selectAssetItems(this.ctx.db)
      .where(and(eq(assets.assignedTo, me), ne(assets.status, 'disposed')))
      .orderBy(asc(assets.category), asc(assets.number))) as AssetItemRow[];
    return rows.map((r) => ({ ...toAssetItem(r, today, cfg.warrantyDays), since: r.asset.assignedAt }));
  }

  /** A person's assets as a hardware reader sees them (the person page in Administration). */
  async heldBy(userId: string, auth: AuthContext) {
    const today = companyToday();
    const cfg = await itamConfig(this.ctx);
    const rows = (await selectAssetItems(this.ctx.db)
      .where(all(eq(assets.assignedTo, userId), ne(assets.status, 'disposed'), hardwareFilter(auth)))
      .orderBy(asc(assets.category), asc(assets.number))
      .limit(100)) as AssetItemRow[];
    return rows.map((r) => toAssetItem(r, today, cfg.warrantyDays));
  }

  /**
   * Someone left: their devices stay deployed until they are returned, but each gets a
   * `return_requested` entry (once) and the asset managers get the list.
   */
  async requestReturns(userId: string): Promise<{ tag: string; name: string }[]> {
    const held = await this.ctx.db
      .select()
      .from(assets)
      .where(and(eq(assets.assignedTo, userId), ne(assets.status, 'disposed')))
      .orderBy(asc(assets.number));
    if (!held.length) return [];
    const requested: { tag: string; name: string }[] = [];
    const system: Actor = { actorId: null, actorName: null };
    await this.ctx.transaction(async (tx) => {
      for (const a of held) {
        const [already] = await tx
          .select({ id: assetEvents.id })
          .from(assetEvents)
          .where(
            and(
              eq(assetEvents.assetId, a.id),
              eq(assetEvents.kind, 'return_requested'),
              eq(assetEvents.userId, userId),
              a.assignedAt ? gte(assetEvents.createdAt, a.assignedAt) : undefined,
            ),
          )
          .limit(1);
        if (already) continue;
        await this.event(tx, a.id, 'return_requested', system, { userId });
        await this.ctx.audit.record(
          {
            action: 'itam.asset.return_requested',
            entityType: ASSET_ENTITY,
            entityId: a.id,
            entityLabel: auditLabel(a),
            metadata: { userId, reason: 'offboarded' },
          },
          { tx },
        );
        requested.push({ tag: formatAssetTag(a.number), name: a.name });
      }
      if (!requested.length) return;
      const person = (await peopleByIds(tx, [userId])).get(userId);
      await this.ctx.notifications.notify(
        {
          type: 'itam.offboarding.return',
          recipients: await roleHolders(tx, 'itam-asset-manager'),
          params: {
            name: person?.displayName ?? '—',
            count: requested.length,
            tags: requested
              .slice(0, 8)
              .map((r) => r.tag)
              .join(', '),
          },
          href: `/itam/hardware?assignee=${userId}`,
        },
        { tx },
      );
    });
    return requested;
  }

  /** Daily: one digest to the asset managers about deployed assets whose warranty ends soon (once per asset). */
  async warrantyDigest(today: string = companyToday()): Promise<number> {
    const cfg: ItamConfig = await itamConfig(this.ctx);
    const until = addDays(today, cfg.warrantyDays);
    const due = await this.ctx.db
      .select({ id: assets.id, number: assets.number, warrantyEnd: assets.warrantyEnd })
      .from(assets)
      .where(
        and(
          eq(assets.status, 'deployed'),
          isNotNull(assets.warrantyEnd),
          gte(assets.warrantyEnd, today),
          lte(assets.warrantyEnd, until),
          sql`${assets.warrantyNotifiedFor} is distinct from ${assets.warrantyEnd}`,
        ),
      )
      .orderBy(asc(assets.warrantyEnd))
      .limit(500);
    if (!due.length) return 0;
    await this.ctx.transaction(async (tx) => {
      await tx
        .update(assets)
        .set({ warrantyNotifiedFor: sql`${assets.warrantyEnd}` })
        .where(
          inArray(
            assets.id,
            due.map((d) => d.id),
          ),
        );
      await this.ctx.notifications.notify(
        {
          type: 'itam.warranty.expiring',
          recipients: await roleHolders(tx, 'itam-asset-manager'),
          params: {
            count: due.length,
            days: cfg.warrantyDays,
            tags: due
              .slice(0, 8)
              .map((d) => formatAssetTag(d.number))
              .join(', '),
          },
          href: '/itam/hardware?warranty=expiring',
        },
        { tx },
      );
    });
    return due.length;
  }

  /** The asset's scope for permission checks. */
  scope(row: AssetItemRow) {
    return scopeOf(row);
  }

  isOwn(row: AssetItemRow, auth: AuthContext) {
    return isOwnAsset(auth, row.asset);
  }
}

export function scopeOf(row: AssetItemRow) {
  return {
    departmentId: row.asset.departmentId,
    assigneeDepartmentId: row.assigneeDepartmentId,
    assignedTo: row.asset.assignedTo,
  };
}

/** Licences of the device and of its assignee (asset page, Software tab). */
export async function seatsOf(db: Db, assetId: string, assignedTo: string | null) {
  const [deviceSeats, userSeats] = await Promise.all([
    db
      .select({
        assignmentId: licenseAssignments.id,
        assignedAt: licenseAssignments.assignedAt,
        id: licenses.id,
        number: licenses.number,
        product: licenses.product,
        licenseType: licenses.licenseType,
      })
      .from(licenseAssignments)
      .innerJoin(licenses, eq(licenses.id, licenseAssignments.licenseId))
      .where(eq(licenseAssignments.assetId, assetId))
      .orderBy(asc(licenses.product)),
    assignedTo
      ? db
          .select({
            id: licenses.id,
            number: licenses.number,
            product: licenses.product,
            licenseType: licenses.licenseType,
          })
          .from(licenseAssignments)
          .innerJoin(licenses, eq(licenses.id, licenseAssignments.licenseId))
          .where(eq(licenseAssignments.userId, assignedTo))
          .orderBy(asc(licenses.product))
      : Promise.resolve([]),
  ]);
  return { deviceSeats, userSeats };
}
