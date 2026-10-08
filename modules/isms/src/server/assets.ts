/**
 * The information asset register — shared by the routes, the AI tool, the record resolver, stocktakes, the seed and
 * the import. Every change runs in one transaction with its history entry, audit row and outbox event.
 *
 * Numbers are `<site code><class code><4-digit sequence>` (`HQ01HW0001`), one sequence per site and class, taken
 * from `number_counters` with an atomic upsert (imported numbers move the counter past them). A number never
 * changes, even when the asset moves to another site or class later.
 */
import { groups, users } from '@isbp/db/schema';
import {
  type AuthContext,
  type Db,
  formatRecordRef,
  httpErrors,
  likePattern,
  localize,
  type ModuleContext,
  parseRecordRef,
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
  ne,
  or,
  type SQL,
  sql,
} from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import type { z } from 'zod';
import type {
  assetExportQuerySchema,
  assetQuerySchema,
  createAssetSchema,
  createFromRecordsSchema,
  ImportIssue,
  updateAssetSchema,
} from '../contracts';
import {
  ASSET_NUMBER_RE,
  ASSET_STATUSES,
  type AssetStatus,
  assetValue,
  formatAssetNumber,
  isUuid,
  normalizeName,
  numberPrefix,
  parseLevel,
  readCsvTable,
  REGISTER_COLUMNS,
  REGISTER_IMPORT_MAX_ROWS,
  type RegisterColumn,
  sequenceOf,
  toCsv,
} from '../model';
import { canManageAssets, P } from './access';
import {
  type AssetEventKind,
  assetEvents,
  type AssetRow,
  assets,
  classes,
  labels,
  numberCounters,
  sites,
  subclasses,
} from './schema';
import {
  type Actor,
  actingUserId,
  activePeople,
  actorOf,
  CATALOGS,
  groupsByIds,
  invalidField,
  LOCALES,
  peopleByIds,
  personRef,
  pgCode,
  pgConstraint,
  UNIQUE_VIOLATION,
} from './support';
import { ensureDefaults } from './taxonomy';

export type CreateAssetData = z.output<typeof createAssetSchema>;
export type UpdateAssetData = z.output<typeof updateAssetSchema>;
type AssetQueryData = z.output<typeof assetQuerySchema>;
type ExportQueryData = z.output<typeof assetExportQuerySchema>;
type FromRecordsData = z.output<typeof createFromRecordsSchema>;

export const ASSET_ENTITY = 'isms.asset';
export const assetHref = (number: string) => `/isms/assets/${number}`;
export const auditLabel = (a: { number: string; name: string }) => `${a.number} ${a.name}`;

const manager = {
  id: users.id,
  displayName: users.displayName,
  email: users.email,
  avatarUrl: users.avatarUrl,
};
const group = { id: groups.id, key: groups.key, name: groups.name };

export function selectAssets(db: Db) {
  return db
    .select({
      asset: assets,
      cls: { id: classes.id, code: classes.code, name: classes.name },
      sub: { id: subclasses.id, key: subclasses.key, name: subclasses.name },
      site: { id: sites.id, code: sites.code, name: sites.name },
      label: { id: labels.id, key: labels.key, name: labels.name, rank: labels.rank },
      manager,
      group,
    })
    .from(assets)
    .innerJoin(classes, eq(classes.id, assets.classId))
    .innerJoin(sites, eq(sites.id, assets.siteId))
    .leftJoin(subclasses, eq(subclasses.id, assets.subclassId))
    .leftJoin(labels, eq(labels.id, assets.labelId))
    .leftJoin(users, eq(users.id, assets.managerId))
    .leftJoin(groups, eq(groups.id, assets.managerGroupId))
    .$dynamic();
}
export type AssetJoinRow = Awaited<ReturnType<ReturnType<typeof selectAssets>['execute']>>[number];

export function toListItem(r: AssetJoinRow) {
  const a = r.asset;
  return {
    id: a.id,
    number: a.number,
    name: a.name,
    class: r.cls,
    subclass: r.sub?.id ? r.sub : null,
    site: r.site,
    manager: r.manager?.id ? r.manager : null,
    managerGroup: r.group?.id ? r.group : null,
    location: a.location,
    confidentiality: a.confidentiality,
    integrity: a.integrity,
    availability: a.availability,
    value: a.value,
    classification: r.label?.id ? r.label : null,
    status: a.status,
    updatedAt: a.updatedAt,
  };
}

/** Number or name. */
export function assetSearchCondition(q: string): SQL {
  const pattern = likePattern(q);
  return or(ilike(assets.name, pattern), ilike(assets.number, pattern))!;
}

const SORTABLE: Record<string, SQL | AnyPgColumn> = {
  number: assets.number,
  name: assets.name,
  class: sql`${classes.code}`,
  site: sql`${sites.code}`,
  value: assets.value,
  status: assets.status,
  updatedAt: assets.updatedAt,
  location: assets.location,
};

/** Fields an update may change, in the order the history lists them. */
const FIELDS = [
  'name',
  'classId',
  'subclassId',
  'siteId',
  'managerId',
  'managerGroupId',
  'userIds',
  'usersText',
  'location',
  'brand',
  'model',
  'version',
  'quantity',
  'confidentiality',
  'integrity',
  'availability',
  'labelId',
  'status',
  'notes',
] as const;

interface Resolved {
  cls: typeof classes.$inferSelect;
  site: typeof sites.$inferSelect;
}

export class AssetService {
  constructor(private readonly ctx: ModuleContext) {}

  private get db() {
    return this.ctx.db;
  }

  /* ───────────── reads ───────────── */

  /** By id or number; 404 when missing. */
  async row(ref: string, db: Db = this.db): Promise<AssetRow> {
    const [row] = await db
      .select()
      .from(assets)
      .where(isUuid(ref) ? eq(assets.id, ref) : eq(assets.number, ref.toUpperCase()));
    if (!row) throw httpErrors.notFound('Asset not found');
    return row;
  }

  filters(q: Omit<ExportQueryData, 'sort'> & { sort?: string }, auth: AuthContext): SQL | undefined {
    const parts: (SQL | undefined)[] = [
      q.view === 'all' ? undefined : eq(assets.status, q.view as AssetStatus),
      q.q ? assetSearchCondition(q.q) : undefined,
      q.class ? eq(assets.classId, q.class) : undefined,
      q.subclass ? eq(assets.subclassId, q.subclass) : undefined,
      q.site ? eq(assets.siteId, q.site) : undefined,
      q.classification ? eq(assets.labelId, q.classification) : undefined,
      q.minValue ? gte(assets.value, q.minValue) : undefined,
      q.manager
        ? eq(
            assets.managerId,
            q.manager === 'me' ? (auth.user?.id ?? '00000000-0000-0000-0000-000000000000') : q.manager,
          )
        : undefined,
      q.managerGroup ? eq(assets.managerGroupId, q.managerGroup) : undefined,
    ];
    return and(...parts.filter((p): p is SQL => Boolean(p)));
  }

  private order(sort: string | undefined) {
    const key = sort?.replace(/^-/, '') ?? 'number';
    const column = SORTABLE[key] ?? assets.number;
    return sort?.startsWith('-') ? desc(column) : asc(column);
  }

  async list(q: AssetQueryData, auth: AuthContext) {
    auth.require(P.assetsRead);
    const where = this.filters(q, auth);
    const [rows, [total]] = await Promise.all([
      selectAssets(this.db)
        .where(where)
        .orderBy(this.order(q.sort), asc(assets.number))
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize),
      this.db
        .select({ n: count() })
        .from(assets)
        .innerJoin(classes, eq(classes.id, assets.classId))
        .innerJoin(sites, eq(sites.id, assets.siteId))
        .where(where),
    ]);
    return { items: rows.map(toListItem), total: total!.n, page: q.page, pageSize: q.pageSize };
  }

  async detail(ref: string, auth: AuthContext) {
    auth.require(P.assetsRead);
    const row = await this.row(ref);
    return this.detailOf(row.id, auth);
  }

  async detailOf(id: string, auth: AuthContext, db: Db = this.db) {
    const [r] = await selectAssets(db).where(eq(assets.id, id));
    if (!r) throw httpErrors.notFound('Asset not found');
    const people = await peopleByIds(db, r.asset.userIds);
    const a = r.asset;
    return {
      ...toListItem(r),
      users: a.userIds
        .map((u) => personRef(people.get(u)))
        .filter((p): p is NonNullable<typeof p> => Boolean(p)),
      usersText: a.usersText,
      brand: a.brand,
      model: a.model,
      version: a.version,
      quantity: a.quantity,
      notes: a.notes,
      attributes: a.attributes,
      sourceRef: a.sourceRef,
      lastVerifiedOn: a.lastVerifiedOn,
      createdAt: a.createdAt,
      viewer: { canManage: canManageAssets(auth) },
    };
  }

  async events(ref: string, q: { page: number; pageSize: number }, auth: AuthContext) {
    auth.require(P.assetsRead);
    const row = await this.row(ref);
    const where = eq(assetEvents.assetId, row.id);
    const [rows, [total]] = await Promise.all([
      this.db
        .select()
        .from(assetEvents)
        .where(where)
        .orderBy(desc(assetEvents.createdAt), desc(assetEvents.id))
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize),
      this.db.select({ n: count() }).from(assetEvents).where(where),
    ]);
    const people = await peopleByIds(
      this.db,
      rows.map((e) => e.actorId),
    );
    return {
      items: rows.map((e) => {
        const actor = e.actorId ? people.get(e.actorId) : undefined;
        return {
          id: e.id,
          kind: e.kind,
          changes: e.changes ?? null,
          note: e.note,
          actor: actor
            ? { id: actor.id, displayName: actor.displayName }
            : e.actorName
              ? { id: null, displayName: e.actorName }
              : null,
          createdAt: e.createdAt,
        };
      }),
      total: total!.n,
      page: q.page,
      pageSize: q.pageSize,
    };
  }

  /* ───────────── validation ───────────── */

  private async resolveRefs(
    input: {
      classId?: string;
      subclassId?: string | null;
      siteId?: string;
      labelId?: string | null;
      managerId?: string | null;
      managerGroupId?: string | null;
      userIds?: string[];
    },
    before: AssetRow | null,
  ): Promise<Resolved> {
    const classId = input.classId ?? before!.classId;
    const siteId = input.siteId ?? before!.siteId;
    const [[cls], [site]] = await Promise.all([
      this.db.select().from(classes).where(eq(classes.id, classId)),
      this.db.select().from(sites).where(eq(sites.id, siteId)),
    ]);
    if (!cls || (cls.archived && cls.id !== before?.classId))
      throw invalidField('classId', 'Choose an active class', 'unknownClass');
    if (!site || (site.archived && site.id !== before?.siteId))
      throw invalidField('siteId', 'Choose an active site', 'unknownSite');
    const subclassId = input.subclassId === undefined ? (before?.subclassId ?? null) : input.subclassId;
    if (subclassId) {
      const [sub] = await this.db.select().from(subclasses).where(eq(subclasses.id, subclassId));
      if (!sub || sub.classId !== cls.id || (sub.archived && sub.id !== before?.subclassId))
        throw invalidField('subclassId', 'Choose a sub-class of the class', 'unknownSubclass');
    }
    if (input.labelId) {
      const [label] = await this.db.select().from(labels).where(eq(labels.id, input.labelId));
      if (!label || (label.archived && label.id !== before?.labelId))
        throw invalidField('classificationId', 'Choose an active classification', 'unknownLabel');
    }
    if (input.managerId && input.managerId !== before?.managerId)
      await activePeople(this.db, [input.managerId], 'managerId');
    if (input.managerGroupId) {
      const [g] = await this.db
        .select({ id: groups.id })
        .from(groups)
        .where(eq(groups.id, input.managerGroupId));
      if (!g) throw invalidField('managerGroupId', 'Choose a group', 'unknownGroup');
    }
    if (input.userIds?.length) {
      const fresh = input.userIds.filter((u) => !before?.userIds.includes(u));
      await activePeople(this.db, fresh, 'userIds');
    }
    return { cls, site };
  }

  /* ───────────── numbering ───────────── */

  /** The next free number of the `<site><class>` series (counter row locked until the transaction ends). */
  async nextNumber(tx: Db, siteCode: string, classCode: string): Promise<string> {
    const prefix = numberPrefix(siteCode, classCode);
    for (;;) {
      const [row] = await tx
        .insert(numberCounters)
        .values({ prefix, last: 1 })
        .onConflictDoUpdate({ target: numberCounters.prefix, set: { last: sql`${numberCounters.last} + 1` } })
        .returning({ last: numberCounters.last });
      const number = formatAssetNumber(siteCode, classCode, row!.last);
      const [taken] = await tx.select({ id: assets.id }).from(assets).where(eq(assets.number, number));
      if (!taken) return number;
    }
  }

  /** Moves the series' counter past a number given by hand (import). */
  private async claimNumber(tx: Db, number: string, siteCode: string, classCode: string) {
    const prefix = numberPrefix(siteCode, classCode);
    const seq = sequenceOf(number, prefix);
    if (seq === null) return;
    await tx
      .insert(numberCounters)
      .values({ prefix, last: seq })
      .onConflictDoUpdate({
        target: numberCounters.prefix,
        set: { last: sql`greatest(${numberCounters.last}, excluded.last)` },
      });
  }

  /* ───────────── history, audit, events ───────────── */

  async event(
    tx: Db,
    assetId: string,
    kind: AssetEventKind,
    actor: Actor,
    data: { changes?: Record<string, [unknown, unknown]> | null; note?: string | null; at?: Date } = {},
  ) {
    await tx.insert(assetEvents).values({
      assetId,
      kind,
      changes: data.changes ?? null,
      note: data.note ?? null,
      actorId: actor.actorId,
      actorName: actor.actorName,
      ...(data.at ? { createdAt: data.at } : {}),
    });
  }

  private ref(a: AssetRow) {
    return { assetId: a.id, number: a.number, name: a.name };
  }

  private conflict(err: unknown): never {
    if (pgCode(err) === UNIQUE_VIOLATION && pgConstraint(err) === 'assets_number_uq')
      throw httpErrors.conflict('Another asset has this number', { field: 'number' });
    if (pgCode(err) === UNIQUE_VIOLATION && pgConstraint(err) === 'assets_source_uq')
      throw httpErrors.conflict('This record is already registered', { field: 'sourceRef' });
    throw err;
  }

  /* ───────────── mutations ───────────── */

  async create(
    input: CreateAssetData,
    auth: AuthContext,
    opts: {
      tx?: Db;
      number?: string;
      sourceRef?: string;
      kind?: AssetEventKind;
      at?: Date;
      note?: string;
    } = {},
  ): Promise<AssetRow> {
    auth.require(P.assetsManage);
    await ensureDefaults(this.ctx);
    const { cls, site } = await this.resolveRefs({ ...input, labelId: input.classificationId ?? null }, null);
    const attributes = input.attributes ? await this.ctx.fields.validate(ASSET_ENTITY, input.attributes) : {};
    const work = async (tx: Db) => {
      let number = opts.number;
      if (number) await this.claimNumber(tx, number, site.code, cls.code);
      else number = await this.nextNumber(tx, site.code, cls.code);
      const value = assetValue(input.confidentiality, input.integrity, input.availability);
      const [row] = await tx
        .insert(assets)
        .values({
          number,
          name: input.name,
          classId: cls.id,
          subclassId: input.subclassId ?? null,
          siteId: site.id,
          managerId: input.managerId ?? null,
          managerGroupId: input.managerGroupId ?? null,
          userIds: [...new Set(input.userIds ?? [])],
          usersText: input.usersText ?? null,
          location: input.location ?? null,
          brand: input.brand ?? null,
          model: input.model ?? null,
          version: input.version ?? null,
          quantity: input.quantity ?? 1,
          confidentiality: input.confidentiality,
          integrity: input.integrity,
          availability: input.availability,
          value,
          labelId: input.classificationId ?? null,
          notes: input.notes ?? null,
          attributes,
          sourceRef: opts.sourceRef ?? null,
          createdBy: actingUserId(auth),
          ...(opts.at ? { createdAt: opts.at, updatedAt: opts.at } : {}),
        })
        .returning();
      const a = row!;
      await this.event(tx, a.id, opts.kind ?? 'created', actorOf(auth), {
        note: opts.note ?? null,
        at: opts.at,
      });
      await this.ctx.audit.record(
        {
          action: 'isms.asset.created',
          entityType: ASSET_ENTITY,
          entityId: a.id,
          entityLabel: auditLabel(a),
          metadata: {
            classCode: cls.code,
            siteCode: site.code,
            value,
            ...(opts.kind === 'imported' ? { source: 'import' } : {}),
            ...(opts.sourceRef ? { sourceRef: opts.sourceRef } : {}),
          },
        },
        { tx },
      );
      await this.ctx.events.publish(
        'isms.asset.created',
        { ...this.ref(a), classCode: cls.code, value },
        { tx },
      );
      return a;
    };
    try {
      return opts.tx ? await work(opts.tx) : await this.ctx.transaction(work);
    } catch (err) {
      this.conflict(err);
    }
  }

  /**
   * Applies a patch; `opts.allowed` lets stocktakes record corrections by the asset's manager (who may not hold
   * `isms.assets.manage`), with the stocktake noted in the history and audit.
   */
  async update(
    ref: string,
    input: UpdateAssetData,
    auth: AuthContext,
    opts: {
      tx?: Db;
      kind?: AssetEventKind;
      note?: string;
      allowed?: boolean;
      metadata?: Record<string, unknown>;
    } = {},
  ): Promise<AssetRow> {
    if (!opts.allowed) auth.require(P.assetsManage);
    const before = await this.row(ref, opts.tx ?? this.db);
    await this.resolveRefs(
      {
        classId: input.classId,
        subclassId: input.subclassId,
        siteId: input.siteId,
        labelId: input.classificationId,
        managerId: input.managerId,
        managerGroupId: input.managerGroupId,
        userIds: input.userIds,
      },
      before,
    );
    const attributes =
      input.attributes !== undefined
        ? await this.ctx.fields.validate(ASSET_ENTITY, input.attributes, before.attributes)
        : before.attributes;
    const next: Record<string, unknown> = {
      ...input,
      labelId: input.classificationId,
      userIds: input.userIds ? [...new Set(input.userIds)] : undefined,
    };
    // A new class without a sub-class choice drops a sub-class of the old class.
    if (input.classId && input.classId !== before.classId && input.subclassId === undefined)
      next.subclassId = null;
    const patch: Partial<typeof assets.$inferInsert> = {};
    for (const f of FIELDS) {
      const v = next[f];
      if (v === undefined) continue;
      const same = JSON.stringify(v) === JSON.stringify(before[f]);
      if (!same) (patch as Record<string, unknown>)[f] = v;
    }
    if (JSON.stringify(attributes) !== JSON.stringify(before.attributes)) patch.attributes = attributes;
    const c = patch.confidentiality ?? before.confidentiality;
    const i = patch.integrity ?? before.integrity;
    const av = patch.availability ?? before.availability;
    if (assetValue(c, i, av) !== before.value) patch.value = assetValue(c, i, av);
    const changed = Object.keys(patch);
    if (!changed.length) return before;
    const changes = this.ctx.audit.diff(
      before as unknown as Record<string, unknown>,
      patch as Record<string, unknown>,
    );
    const work = async (tx: Db) => {
      const [row] = await tx.update(assets).set(patch).where(eq(assets.id, before.id)).returning();
      const a = row!;
      await this.event(tx, a.id, opts.kind ?? (patch.status ? 'status_changed' : 'updated'), actorOf(auth), {
        changes,
        note: opts.note ?? null,
      });
      await this.ctx.audit.record(
        {
          action: 'isms.asset.updated',
          entityType: ASSET_ENTITY,
          entityId: a.id,
          entityLabel: auditLabel(a),
          changes,
          metadata: opts.metadata,
        },
        { tx },
      );
      await this.ctx.events.publish('isms.asset.updated', { ...this.ref(a), changes: changed }, { tx });
      return a;
    };
    try {
      return opts.tx ? await work(opts.tx) : await this.ctx.transaction(work);
    } catch (err) {
      this.conflict(err);
    }
  }

  async remove(ref: string, auth: AuthContext) {
    auth.require(P.assetsManage);
    const a = await this.row(ref);
    await this.ctx.transaction(async (tx) => {
      await tx.delete(assets).where(eq(assets.id, a.id));
      await this.ctx.records.forget({ type: ASSET_ENTITY, id: a.id }, { tx });
      await this.ctx.audit.record(
        {
          action: 'isms.asset.deleted',
          entityType: ASSET_ENTITY,
          entityId: a.id,
          entityLabel: auditLabel(a),
        },
        { tx },
      );
      await this.ctx.events.publish('isms.asset.deleted', this.ref(a), { tx });
    });
  }

  /* ───────────── record facts ───────────── */

  async facts(ids: readonly string[]) {
    const wanted = [...new Set(ids.filter(isUuid))];
    if (!wanted.length) return new Map<string, Record<string, unknown>>();
    const rows = await selectAssets(this.db).where(inArray(assets.id, wanted));
    return new Map(
      rows.map((r): [string, Record<string, unknown>] => [
        r.asset.id,
        {
          classCode: r.cls.code,
          subClass: r.sub?.key ?? null,
          confidentiality: r.asset.confidentiality,
          integrity: r.asset.integrity,
          availability: r.asset.availability,
          value: r.asset.value,
          classification: r.label?.key ?? null,
          managerId: r.asset.managerId,
          managerGroup: r.group?.key ?? null,
          siteCode: r.site.code,
          status: r.asset.status,
        },
      ]),
    );
  }

  /* ───────────── create from other records ───────────── */

  /** Records of another module the caller can read, with the asset already registered from each. */
  async sourceSearch(q: { type: string; q: string; limit: number }, auth: AuthContext) {
    auth.require(P.assetsManage);
    const found = await this.ctx.records.search(q.q, { auth, types: [q.type], limit: q.limit });
    const refs = found.map((r) => formatRecordRef({ type: r.type, id: r.id }));
    const registered = refs.length
      ? await this.db
          .select({ id: assets.id, number: assets.number, sourceRef: assets.sourceRef })
          .from(assets)
          .where(inArray(assets.sourceRef, refs))
      : [];
    const by = new Map(registered.map((r) => [r.sourceRef!, { id: r.id, number: r.number }]));
    return {
      items: found.map((r) => {
        const ref = formatRecordRef({ type: r.type, id: r.id });
        return {
          ref,
          reference: r.reference,
          title: r.title,
          subtitle: r.subtitle,
          href: r.href,
          registered: by.get(ref) ?? null,
        };
      }),
    };
  }

  /**
   * Registers one asset per picked record the caller can read (name from its title), linked to it. Records already
   * registered are skipped.
   */
  async createFromRecords(input: FromRecordsData, auth: AuthContext) {
    auth.require(P.assetsManage);
    const refs = [...new Set(input.refs)]
      .map((r) => parseRecordRef(r))
      .filter((r): r is NonNullable<typeof r> => Boolean(r));
    const visible = await this.ctx.records.resolve(refs, auth);
    const strings = refs.map((r) => formatRecordRef(r));
    const registered = new Set(
      (
        await this.db
          .select({ sourceRef: assets.sourceRef })
          .from(assets)
          .where(
            and(isNotNull(assets.sourceRef), inArray(assets.sourceRef, strings.length ? strings : ['-'])),
          )
      ).map((r) => r.sourceRef!),
    );
    const created: { id: string; number: string; name: string }[] = [];
    const skipped: { ref: string; reason: 'registered' | 'hidden' }[] = [];
    await this.ctx.transaction(async (tx) => {
      for (const ref of refs) {
        const key = formatRecordRef(ref);
        const record = visible.get(key);
        if (!record) {
          skipped.push({ ref: key, reason: 'hidden' });
          continue;
        }
        if (registered.has(key)) {
          skipped.push({ ref: key, reason: 'registered' });
          continue;
        }
        const a = await this.create(
          {
            name: record.title.slice(0, 200),
            classId: input.classId,
            subclassId: input.subclassId ?? null,
            siteId: input.siteId,
            managerId: input.managerId ?? null,
            managerGroupId: input.managerGroupId ?? null,
            userIds: [],
            quantity: 1,
            confidentiality: input.confidentiality,
            integrity: input.integrity,
            availability: input.availability,
            classificationId: input.classificationId ?? null,
          },
          auth,
          { tx, sourceRef: key, note: record.reference ?? record.title },
        );
        await this.ctx.records.link({ type: ASSET_ENTITY, id: a.id }, ref, { tx });
        registered.add(key);
        created.push({ id: a.id, number: a.number, name: a.name });
      }
    });
    return { created, skipped };
  }

  /* ───────────── CSV export ───────────── */

  /** The register as CSV (UTF-8 with BOM, the paper register's column order), headers in `locale`. */
  async exportCsv(q: ExportQueryData, auth: AuthContext, locale: string) {
    auth.require(P.assetsRead);
    const catalog = CATALOGS[(LOCALES as readonly string[]).includes(locale) ? (locale as 'en') : 'en'];
    const rows = await selectAssets(this.db)
      .where(this.filters(q, auth))
      .orderBy(this.order(q.sort), asc(assets.number))
      .limit(20_000);
    const people = await peopleByIds(
      this.db,
      rows.flatMap((r) => r.asset.userIds),
    );
    const body = rows.map((r) => {
      const a = r.asset;
      const userNames = a.userIds.map((u) => people.get(u)?.displayName).filter(Boolean);
      const cells: Record<RegisterColumn, unknown> = {
        number: a.number,
        name: a.name,
        class: localize(r.cls.name, locale),
        subclass: r.sub?.id ? localize(r.sub.name, locale) : '',
        manager: [r.manager?.id ? r.manager.displayName : null, r.group?.id ? r.group.name : null]
          .filter(Boolean)
          .join(', '),
        users: [...userNames, a.usersText].filter(Boolean).join(', '),
        location: a.location,
        brand: a.brand,
        model: a.model,
        version: a.version,
        quantity: a.quantity,
        confidentiality: a.confidentiality,
        integrity: a.integrity,
        availability: a.availability,
        value: a.value,
        classification: r.label?.id ? localize(r.label.name, locale) : '',
        site: r.site.code,
        status: catalog.assetStatus[a.status],
        notes: a.notes,
      };
      return REGISTER_COLUMNS.map((c) => cells[c]);
    });
    const csv = toCsv([REGISTER_COLUMNS.map((c) => catalog.csv.columns[c]), ...body]);
    await this.ctx.audit.record({
      action: 'isms.asset.exported',
      entityType: ASSET_ENTITY,
      metadata: {
        rows: rows.length,
        filters: Object.fromEntries(Object.entries(q).filter(([, v]) => v !== undefined)),
      },
    });
    return { filename: `information-assets-${new Date().toISOString().slice(0, 10)}.csv`, csv };
  }

  /* ───────────── CSV import ───────────── */

  /**
   * Imports the register from CSV (the export's columns, in any language, any order). Rows with a known number update
   * that asset (empty cells keep the current value); other rows create assets (numbered unless the file gives an
   * unused number of the right series). Invalid rows are reported and skipped; the rest is applied in one
   * transaction. A dry run only reports.
   */
  async importCsv(csv: string, dryRun: boolean, auth: AuthContext) {
    auth.require(P.assetsManage);
    await ensureDefaults(this.ctx);
    const aliases = Object.fromEntries(
      REGISTER_COLUMNS.map((c) => [c, [c, ...LOCALES.map((l) => CATALOGS[l].csv.columns[c])]]),
    ) as Record<RegisterColumn, string[]>;
    const report = {
      dryRun,
      error: null as 'empty' | 'tooManyRows' | 'missingColumns' | null,
      missing: [] as string[],
      rows: 0,
      created: 0,
      updated: 0,
      unchanged: 0,
      skipped: 0,
      issues: [] as ImportIssue[],
      items: [] as { line: number; number: string | null; action: 'create' | 'update' | 'none' }[],
    };
    const table = readCsvTable(csv, aliases, ['name'], REGISTER_IMPORT_MAX_ROWS);
    if (!table.ok) {
      report.error = table.error;
      if (table.error === 'missingColumns') report.missing = table.missing;
      return report;
    }
    report.rows = table.rows.length;

    const [cls, subs, sts, lbls] = await Promise.all([
      this.db.select().from(classes),
      this.db.select().from(subclasses),
      this.db.select().from(sites),
      this.db.select().from(labels),
    ]);
    const names = (t: Record<string, string | undefined> | null | undefined) =>
      t
        ? Object.values(t)
            .filter((v): v is string => Boolean(v))
            .map(normalizeName)
        : [];
    const findClass = (v: string) =>
      cls.find(
        (c) => !c.archived && (c.code === v.toUpperCase() || names(c.name).includes(normalizeName(v))),
      );
    const findSub = (classId: string, v: string) =>
      subs.find(
        (s) =>
          s.classId === classId &&
          !s.archived &&
          (s.key === v.toLowerCase() || names(s.name).includes(normalizeName(v))),
      );
    const activeSites = sts.filter((s) => !s.archived);
    const findSite = (v: string) =>
      activeSites.find((s) => s.code === v.toUpperCase() || normalizeName(s.name) === normalizeName(v));
    const findLabel = (v: string) =>
      lbls.find(
        (l) => !l.archived && (l.key === v.toLowerCase() || names(l.name).includes(normalizeName(v))),
      );
    const statusOf = (v: string): AssetStatus | null =>
      (ASSET_STATUSES as readonly string[]).includes(v.toLowerCase())
        ? (v.toLowerCase() as AssetStatus)
        : (ASSET_STATUSES.find((s) =>
            LOCALES.some((l) => normalizeName(CATALOGS[l].assetStatus[s]) === normalizeName(v)),
          ) ?? null);

    // Managers: people by email, username or display name (unique), else groups by key or name.
    const managerNames = [
      ...new Set(table.rows.map((r) => r.values.manager).filter((v): v is string => Boolean(v))),
    ];
    const managerOf = await this.matchManagers(managerNames);

    const numbers = table.rows
      .map((r) => r.values.number?.toUpperCase())
      .filter((n): n is string => Boolean(n));
    const existing = numbers.length
      ? await this.db
          .select()
          .from(assets)
          .where(inArray(assets.number, [...new Set(numbers)]))
      : [];
    const byNumber = new Map(existing.map((a) => [a.number, a]));
    // How the export shows each existing asset's manager and users: a file exported, edited and imported again leaves
    // them alone unless the cell was changed.
    const [shownPeople, shownGroups] = await Promise.all([
      peopleByIds(
        this.db,
        existing.flatMap((a) => [a.managerId, ...a.userIds]),
      ),
      groupsByIds(
        this.db,
        existing.map((a) => a.managerGroupId),
      ),
    ]);
    const shown = new Map(
      existing.map((a) => [
        a.id,
        {
          manager: [
            a.managerId ? shownPeople.get(a.managerId)?.displayName : null,
            a.managerGroupId ? shownGroups.get(a.managerGroupId)?.name : null,
          ]
            .filter(Boolean)
            .join(', '),
          users: [...a.userIds.map((u) => shownPeople.get(u)?.displayName), a.usersText]
            .filter(Boolean)
            .join(', '),
        },
      ]),
    );
    const seen = new Set<string>();

    type Planned =
      | { line: number; action: 'create'; input: CreateAssetData; number?: string }
      | { line: number; action: 'update'; number: string; input: UpdateAssetData };
    const planned: Planned[] = [];

    for (const { line, values } of table.rows) {
      const issues: ImportIssue[] = [];
      const issue = (column: RegisterColumn | null, code: ImportIssue['code'], value?: string) =>
        issues.push({ line, column, code, value: value ?? null });
      const v = values;
      const number = v.number?.toUpperCase();
      if (number) {
        if (seen.has(number)) issue('number', 'duplicate', number);
        seen.add(number);
      }
      const current = number ? byNumber.get(number) : undefined;
      for (const [col, max] of [
        ['name', 200],
        ['location', 200],
        ['brand', 100],
        ['model', 100],
        ['version', 100],
        ['users', 500],
        ['notes', 5000],
      ] as const)
        if ((v[col]?.length ?? 0) > max) issue(col, 'tooLong', v[col]!.slice(0, 40));
      const klass = v.class ? findClass(v.class) : undefined;
      if (v.class && !klass) issue('class', 'unknownClass', v.class);
      const classId = klass?.id ?? current?.classId;
      const sub = v.subclass && classId ? findSub(classId, v.subclass) : undefined;
      if (v.subclass && classId && !sub) issue('subclass', 'unknownSubclass', v.subclass);
      const site = v.site
        ? findSite(v.site)
        : !current && activeSites.length === 1
          ? activeSites[0]
          : undefined;
      if (v.site && !site) issue('site', 'unknownSite', v.site);
      const label = v.classification ? findLabel(v.classification) : undefined;
      if (v.classification && !label) issue('classification', 'unknownLabel', v.classification);
      const before = current ? shown.get(current.id) : undefined;
      const same = (cell: string | undefined, was: string | undefined) =>
        Boolean(cell && was !== undefined && normalizeName(cell) === normalizeName(was));
      const managerKept = same(v.manager, before?.manager);
      const usersKept = same(v.users, before?.users);
      const mgr = v.manager && !managerKept ? managerOf.get(normalizeName(v.manager)) : undefined;
      if (v.manager && !managerKept && !mgr) issue('manager', 'unknownManager', v.manager);
      const levels = {
        confidentiality: parseLevel(v.confidentiality),
        integrity: parseLevel(v.integrity),
        availability: parseLevel(v.availability),
      };
      for (const k of ['confidentiality', 'integrity', 'availability'] as const)
        if (v[k] && levels[k] === null) issue(k, 'badLevel', v[k]);
      let quantity: number | undefined;
      if (v.quantity) {
        const n = Number(v.quantity.replace(/,/g, ''));
        if (!Number.isInteger(n) || n < 0 || n > 1_000_000) issue('quantity', 'badQuantity', v.quantity);
        else quantity = n;
      }
      const status = v.status ? statusOf(v.status) : null;
      if (v.status && !status) issue('status', 'badStatus', v.status);

      if (!current) {
        if (!v.name) issue('name', 'required');
        if (!v.class) issue('class', 'required');
        if (!site && !v.site) issue('site', 'required');
        for (const k of ['confidentiality', 'integrity', 'availability'] as const)
          if (!v[k]) issue(k, 'required');
        if (
          number &&
          klass &&
          site &&
          (!ASSET_NUMBER_RE.test(number) || sequenceOf(number, numberPrefix(site.code, klass.code)) === null)
        )
          issue('number', 'badNumber', number);
      }
      if (issues.length) {
        report.issues.push(...issues);
        report.skipped++;
        continue;
      }
      const common = {
        ...(v.name ? { name: v.name } : {}),
        ...(sub ? { subclassId: sub.id } : {}),
        ...(mgr?.kind === 'user' ? { managerId: mgr.id } : {}),
        ...(mgr?.kind === 'group' ? { managerGroupId: mgr.id } : {}),
        ...(v.users && !usersKept ? { usersText: v.users } : {}),
        ...(v.location ? { location: v.location } : {}),
        ...(v.brand ? { brand: v.brand } : {}),
        ...(v.model ? { model: v.model } : {}),
        ...(v.version ? { version: v.version } : {}),
        ...(quantity !== undefined ? { quantity } : {}),
        ...(levels.confidentiality ? { confidentiality: levels.confidentiality } : {}),
        ...(levels.integrity ? { integrity: levels.integrity } : {}),
        ...(levels.availability ? { availability: levels.availability } : {}),
        ...(label ? { classificationId: label.id } : {}),
        ...(v.notes ? { notes: v.notes } : {}),
      };
      if (current) {
        const input: UpdateAssetData = {
          ...common,
          ...(klass && klass.id !== current.classId ? { classId: klass.id } : {}),
          ...(site && site.id !== current.siteId ? { siteId: site.id } : {}),
          ...(status ? { status } : {}),
        };
        planned.push({ line, action: 'update', number: current.number, input });
      } else {
        planned.push({
          line,
          action: 'create',
          number,
          input: {
            userIds: [],
            quantity: 1,
            ...common,
            name: v.name!,
            classId: klass!.id,
            siteId: site!.id,
            confidentiality: levels.confidentiality!,
            integrity: levels.integrity!,
            availability: levels.availability!,
          },
        });
      }
    }

    const apply = async (tx: Db | null) => {
      for (const p of planned) {
        if (p.action === 'create') {
          let number = p.number ?? null;
          if (tx) {
            const a = await this.create(p.input, auth, { tx, number: p.number, kind: 'imported' });
            number = a.number;
          }
          report.created++;
          report.items.push({ line: p.line, number, action: 'create' });
        } else {
          const before = byNumber.get(p.number)!;
          const changed = this.wouldChange(before, p.input);
          if (changed && tx)
            await this.update(p.number, p.input, auth, {
              tx,
              kind: 'imported',
              metadata: { source: 'import' },
            });
          if (changed) report.updated++;
          else report.unchanged++;
          report.items.push({ line: p.line, number: p.number, action: changed ? 'update' : 'none' });
        }
      }
    };
    if (dryRun) await apply(null);
    else
      await this.ctx.transaction(async (tx) => {
        await apply(tx);
        await this.ctx.audit.record(
          {
            action: 'isms.asset.imported',
            entityType: ASSET_ENTITY,
            metadata: {
              rows: report.rows,
              created: report.created,
              updated: report.updated,
              skipped: report.skipped,
            },
          },
          { tx },
        );
      });
    report.items = report.items.slice(0, 500);
    report.issues = report.issues.slice(0, 1000);
    return report;
  }

  private wouldChange(before: AssetRow, input: UpdateAssetData): boolean {
    const next: Record<string, unknown> = { ...input, labelId: input.classificationId };
    return FIELDS.some((f) => next[f] !== undefined && JSON.stringify(next[f]) !== JSON.stringify(before[f]));
  }

  /** Resolves manager cells: a person (email, username or unique display name) or a group (key or name). */
  async matchManagers(values: readonly string[]) {
    const out = new Map<string, { kind: 'user' | 'group'; id: string }>();
    if (!values.length) return out;
    const wanted = [...new Set(values.map(normalizeName))];
    const [people, grps] = await Promise.all([
      this.db
        .select({
          id: users.id,
          email: users.email,
          username: users.username,
          displayName: users.displayName,
        })
        .from(users)
        .where(
          and(
            ne(users.status, 'offboarded'),
            or(
              inArray(sql`lower(${users.email})`, wanted),
              inArray(sql`lower(${users.username})`, wanted),
              inArray(sql`lower(${users.displayName})`, wanted),
            ),
          ),
        ),
      this.db
        .select({ id: groups.id, key: groups.key, name: groups.name })
        .from(groups)
        .where(or(inArray(sql`lower(${groups.key})`, wanted), inArray(sql`lower(${groups.name})`, wanted))),
    ]);
    for (const w of wanted) {
      const exact = people.filter((p) => p.email.toLowerCase() === w || p.username.toLowerCase() === w);
      const byName = people.filter((p) => normalizeName(p.displayName) === w);
      const person = exact.length === 1 ? exact[0] : byName.length === 1 ? byName[0] : undefined;
      if (person) {
        out.set(w, { kind: 'user', id: person.id });
        continue;
      }
      const g = grps.filter((x) => x.key.toLowerCase() === w || normalizeName(x.name) === w);
      if (g.length === 1) out.set(w, { kind: 'group', id: g[0]!.id });
    }
    return out;
  }

  /* ───────────── dashboard ───────────── */

  async byValue() {
    const rows = await this.db
      .select({ value: assets.value, n: count() })
      .from(assets)
      .where(eq(assets.status, 'active'))
      .groupBy(assets.value);
    const map = new Map(rows.map((r) => [r.value, r.n]));
    const byValue = [1, 2, 3, 4].map((value) => ({ value, count: map.get(value) ?? 0 }));
    return {
      total: byValue.reduce((s, v) => s + v.count, 0),
      byValue,
      highValue: (map.get(3) ?? 0) + (map.get(4) ?? 0),
    };
  }
}
