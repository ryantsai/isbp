/**
 * Software licence rules: entitlements versus seats in use, unlicensed installs, the stored compliance
 * state (recomputed in the same transaction as every assignment or quantity change, and nightly),
 * sealed licence keys and the coverage of discovered installs (reports themselves: `discovery.ts`).
 */
import { users } from '@isbp/db/schema';
import { type AuthContext, type Db, httpErrors, likePattern, type ModuleContext } from '@isbp/sdk/server';
import { and, asc, count, eq, ilike, inArray, notInArray, or, type SQL, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { z } from 'zod';
import type {
  assignmentQuerySchema,
  createAssignmentSchema,
  createLicenseSchema,
  licenseQuerySchema,
  updateLicenseSchema,
} from '../contracts';
import {
  annualCost,
  type AssetStatus,
  complianceState,
  type ComplianceState,
  formatAssetTag,
  formatContractRef,
  formatLicenseRef,
  licenseUsage,
  NON_COMPLIANT,
  parseRef,
  termMonths,
} from '../model';
import { all, canManageSoftware, canReadContracts, LICENSES_REVEAL, SOFTWARE_MANAGE } from './access';
import { approvalSql } from './approved-software';
import {
  approvedSoftware,
  assets,
  contracts,
  type LicenseRow,
  licenseAssignments,
  licenses,
  softwareInstallations,
  softwareTitleRules,
  vendors,
} from './schema';
import {
  actingUserId,
  companyToday,
  invalidField,
  itamConfig,
  peopleByIds,
  personRef,
  pgCode,
  roleHolders,
  UNIQUE_VIOLATION,
} from './support';

export type CreateLicenseData = z.output<typeof createLicenseSchema>;
export type UpdateLicenseData = z.output<typeof updateLicenseSchema>;
export type LicenseQueryData = z.output<typeof licenseQuerySchema>;
type AssignmentData = z.output<typeof createAssignmentSchema>;

export const LICENSE_ENTITY = 'itam.license';
/** A seat whose product no device of its holder has reported for this long is a reclaim candidate. */
export const RECLAIM_DAYS = 90;
export const licenseHref = (reference: string) => `/itam/software/${reference}`;
const auditLabel = (l: { number: number; product: string }) => `${formatLicenseRef(l.number)} ${l.product}`;

/** Devices whose installs count: not retired, disposed or lost. */
export const INACTIVE_DEVICE: AssetStatus[] = ['retired', 'disposed', 'lost'];

/**
 * An install is licensed when a licence of the same product (case-insensitive) is assigned to the device,
 * or to the device's assignee.
 */
const licensedExpr = sql<boolean>`exists (
  select 1 from ${licenseAssignments} la
    join ${licenses} l on l.id = la.license_id
   where lower(l.product) = lower(${softwareInstallations.product})
     and (la.asset_id = ${softwareInstallations.assetId}
          or (${assets.assignedTo} is not null and la.user_id = ${assets.assignedTo})))`;

const managedExpr = sql<boolean>`exists (
  select 1 from ${licenses} l2 where lower(l2.product) = lower(${softwareInstallations.product}))`;

/**
 * One install per device and product: a device that reports a mapped title and the licence's product (or two titles
 * mapped to one product) has two rows; lists of a product's installs show the reported product first.
 */
const firstOfProduct = sql<boolean>`not exists (
  select 1 from ${softwareInstallations} j
   where j.asset_id = ${softwareInstallations.assetId}
     and lower(j.product) = lower(${softwareInstallations.product})
     and ((j.reported_as is not null), j.id) < ((${softwareInstallations.reportedAs} is not null), ${softwareInstallations.id}))`;

const COMPLIANCE_RANK = sql`case ${licenses.complianceState} when 'over_deployed' then 0 when 'expired' then 1 when 'expiring' then 2 when 'under_used' then 3 else 4 end`;
const ASSIGNED_COUNT = sql`(select count(*) from ${licenseAssignments} la where la.license_id = ${licenses.id})`;

const SORTABLE: Record<string, SQL> = {
  number: sql`${licenses.number}`,
  product: sql`${licenses.product}`,
  publisher: sql`${licenses.publisher}`,
  type: sql`${licenses.licenseType}`,
  endDate: sql`${licenses.endDate}`,
  compliance: COMPLIANCE_RANK,
  usage: sql`(${ASSIGNED_COUNT})::float / nullif(${licenses.quantity}, 0)`,
};

const listColumns = {
  license: licenses,
  vendorName: vendors.name,
  contractNumber: contracts.number,
  contractTitle: contracts.title,
  contractStatus: contracts.status,
};
type LicenseListRow = {
  license: LicenseRow;
  vendorName: string | null;
  contractNumber: number | null;
  contractTitle: string | null;
  contractStatus: string | null;
};

function selectLicenses(db: Db) {
  return db
    .select(listColumns)
    .from(licenses)
    .leftJoin(vendors, eq(vendors.id, licenses.vendorId))
    .leftJoin(contracts, eq(contracts.id, licenses.contractId));
}

/** Product, publisher or `LIC-00012`. */
export function licenseSearchCondition(term: string): SQL {
  const q = term.trim();
  const ref = parseRef('license', q);
  const text = or(ilike(licenses.product, likePattern(q)), ilike(licenses.publisher, likePattern(q)))!;
  if (ref && 'number' in ref) return or(text, eq(licenses.number, ref.number))!;
  if (ref && 'id' in ref) return or(text, eq(licenses.id, ref.id))!;
  return text;
}

export const lower = (s: string) => s.trim().toLowerCase();

export function toLicenseItem(r: LicenseListRow, assigned: number, unlicensed: number) {
  const l = r.license;
  return {
    id: l.id,
    number: l.number,
    reference: formatLicenseRef(l.number),
    product: l.product,
    publisher: l.publisher,
    vendor: l.vendorId && r.vendorName ? { id: l.vendorId, name: r.vendorName } : null,
    licenseType: l.licenseType,
    quantity: l.quantity,
    used: licenseUsage(l.licenseType, assigned, unlicensed),
    assigned,
    unlicensed,
    cost: l.cost,
    currency: l.currency,
    billing: l.billing,
    annualCost: annualCost(l.cost, l.billing, termMonths(l.startDate, l.endDate)),
    startDate: l.startDate,
    endDate: l.endDate,
    complianceState: l.complianceState,
    contract:
      l.contractId && r.contractNumber !== null
        ? {
            id: l.contractId,
            reference: formatContractRef(r.contractNumber),
            title: r.contractTitle ?? '',
            status: (r.contractStatus ?? 'active') as 'active',
          }
        : null,
    updatedAt: l.updatedAt,
  };
}
export type LicenseItem = ReturnType<typeof toLicenseItem>;

export class LicenseService {
  constructor(private readonly ctx: ModuleContext) {}

  /* ───────────── usage ───────────── */

  /** Seats per licence. */
  async assignedCounts(db: Db, ids: readonly string[]): Promise<Map<string, number>> {
    if (!ids.length) return new Map();
    const rows = await db
      .select({ id: licenseAssignments.licenseId, n: count() })
      .from(licenseAssignments)
      .where(inArray(licenseAssignments.licenseId, [...new Set(ids)]))
      .groupBy(licenseAssignments.licenseId);
    return new Map(rows.map((r) => [r.id, r.n]));
  }

  /** Active devices running a product without a seat, per lower-cased product. */
  async unlicensedCounts(db: Db, products: readonly string[]): Promise<Map<string, number>> {
    const wanted = [...new Set(products.map(lower))];
    if (!wanted.length) return new Map();
    const rows = await db
      .select({
        product: sql<string>`lower(${softwareInstallations.product})`,
        n: sql<number>`count(distinct ${softwareInstallations.assetId})::int`,
      })
      .from(softwareInstallations)
      .innerJoin(assets, eq(assets.id, softwareInstallations.assetId))
      .where(
        and(
          inArray(sql`lower(${softwareInstallations.product})`, wanted),
          notInArray(assets.status, INACTIVE_DEVICE),
          sql`not ${licensedExpr}`,
        ),
      )
      .groupBy(sql`lower(${softwareInstallations.product})`);
    return new Map(rows.map((r) => [r.product, r.n]));
  }

  private async items(db: Db, rows: LicenseListRow[]) {
    const [assigned, unlicensed] = await Promise.all([
      this.assignedCounts(
        db,
        rows.map((r) => r.license.id),
      ),
      this.unlicensedCounts(
        db,
        rows.map((r) => r.license.product),
      ),
    ]);
    return rows.map((r) =>
      toLicenseItem(r, assigned.get(r.license.id) ?? 0, unlicensed.get(lower(r.license.product)) ?? 0),
    );
  }

  /**
   * Recomputes the stored compliance state of every licence of these products (siblings share installs).
   * Entering `over_deployed` or `expired` notifies the asset managers.
   */
  async recomputeProducts(tx: Db, products: readonly string[], today = companyToday()) {
    return this.recomputeRows(tx, await this.lockProducts(tx, products), today);
  }

  /**
   * Locks the licences of these products (in number order) for the rest of the transaction. `for no key update`:
   * a seat insert holds a key-share lock on its licence (the foreign key), which `for update` would wait on, so two
   * seat changes at once deadlocked. Call it before writing seats so concurrent changes queue up instead.
   */
  async lockProducts(tx: Db, products: readonly string[]) {
    const wanted = [...new Set(products.map(lower))];
    if (!wanted.length) return [];
    return tx
      .select()
      .from(licenses)
      .where(inArray(sql`lower(${licenses.product})`, wanted))
      .orderBy(asc(licenses.number))
      .for('no key update');
  }

  async recomputeLicenses(tx: Db, licenseIds: readonly string[], today = companyToday()) {
    if (!licenseIds.length) return [];
    const products = await tx
      .selectDistinct({ product: licenses.product })
      .from(licenses)
      .where(inArray(licenses.id, [...new Set(licenseIds)]));
    return this.recomputeProducts(
      tx,
      products.map((p) => p.product),
      today,
    );
  }

  private async recomputeRows(tx: Db, rows: LicenseRow[], today: string) {
    if (!rows.length) return [];
    const cfg = await itamConfig(this.ctx);
    const [assigned, unlicensed] = await Promise.all([
      this.assignedCounts(
        tx,
        rows.map((r) => r.id),
      ),
      this.unlicensedCounts(
        tx,
        rows.map((r) => r.product),
      ),
    ]);
    const changed: { id: string; from: ComplianceState; to: ComplianceState }[] = [];
    let managers: string[] | null = null;
    for (const l of rows) {
      const used = licenseUsage(
        l.licenseType,
        assigned.get(l.id) ?? 0,
        unlicensed.get(lower(l.product)) ?? 0,
      );
      const state = complianceState({ quantity: l.quantity, used, endDate: l.endDate }, today, {
        underUsedPercent: cfg.underUsedPercent,
      });
      if (state === l.complianceState) continue;
      await tx.update(licenses).set({ complianceState: state }).where(eq(licenses.id, l.id));
      const reference = formatLicenseRef(l.number);
      await this.ctx.audit.record(
        {
          action: 'itam.license.compliance_changed',
          entityType: LICENSE_ENTITY,
          entityId: l.id,
          entityLabel: auditLabel(l),
          changes: { complianceState: [l.complianceState, state] },
          metadata: { used, quantity: l.quantity },
        },
        { tx },
      );
      await this.ctx.events.publish(
        'itam.license.compliance_changed',
        { licenseId: l.id, reference, product: l.product, from: l.complianceState, to: state },
        { tx },
      );
      if (NON_COMPLIANT.includes(state)) {
        managers ??= await roleHolders(tx, 'itam-asset-manager');
        await this.ctx.notifications.notify(
          {
            type: 'itam.license.non_compliant',
            recipients: managers,
            params: {
              reference,
              product: l.product,
              state,
              used,
              quantity: l.quantity ?? 0,
              endDate: l.endDate ?? '',
            },
            href: licenseHref(reference),
          },
          { tx },
        );
      }
      changed.push({ id: l.id, from: l.complianceState, to: state });
    }
    return changed;
  }

  /** Nightly: every licence (dates move on even when nothing else changes). */
  async recomputeAll(today = companyToday()) {
    let changed = 0;
    let after = 0;
    for (;;) {
      const batch = await this.ctx.db
        .select({ number: licenses.number, product: licenses.product })
        .from(licenses)
        .where(sql`${licenses.number} > ${after}`)
        .orderBy(asc(licenses.number))
        .limit(200);
      if (!batch.length) break;
      after = batch[batch.length - 1]!.number;
      const result = await this.ctx.transaction((tx) =>
        this.recomputeProducts(
          tx,
          batch.map((b) => b.product),
          today,
        ),
      );
      changed += result.length;
    }
    return changed;
  }

  /* ───────────── reading ───────────── */

  async resolve(ref: string, db: Db = this.ctx.db): Promise<LicenseRow> {
    const parsed = parseRef('license', ref);
    if (!parsed) throw httpErrors.notFound('Licence not found');
    const [row] = await db
      .select()
      .from(licenses)
      .where('id' in parsed ? eq(licenses.id, parsed.id) : eq(licenses.number, parsed.number));
    if (!row) throw httpErrors.notFound('Licence not found');
    return row;
  }

  async list(q: LicenseQueryData) {
    const where = all(
      q.q ? licenseSearchCondition(q.q) : undefined,
      q.type ? eq(licenses.licenseType, q.type) : undefined,
      q.compliance?.length ? inArray(licenses.complianceState, q.compliance) : undefined,
      q.vendor ? eq(licenses.vendorId, q.vendor) : undefined,
      q.contract ? eq(licenses.contractId, q.contract) : undefined,
    );
    const key = q.sort?.replace(/^-/, '') ?? 'product';
    const column = SORTABLE[key] ?? SORTABLE.product!;
    const order = q.sort?.startsWith('-') ? sql`${column} desc nulls last` : sql`${column} asc nulls last`;
    const [rows, [total]] = await Promise.all([
      selectLicenses(this.ctx.db)
        .where(where)
        .orderBy(order, asc(licenses.number))
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize),
      this.ctx.db.select({ n: count() }).from(licenses).where(where),
    ]);
    return {
      items: await this.items(this.ctx.db, rows as LicenseListRow[]),
      total: total!.n,
      page: q.page,
      pageSize: q.pageSize,
    };
  }

  /** List items for a filter (vendor page, dashboard), capped. */
  async itemsWhere(where: SQL | undefined, limit = 50, order: SQL = sql`${licenses.product} asc`) {
    const rows = await selectLicenses(this.ctx.db).where(where).orderBy(order).limit(limit);
    return this.items(this.ctx.db, rows as LicenseListRow[]);
  }

  async detail(ref: string, auth: AuthContext) {
    const l = await this.resolve(ref);
    return this.detailOf(l.id, auth);
  }

  async detailOf(id: string, auth: AuthContext) {
    const [row] = await selectLicenses(this.ctx.db).where(eq(licenses.id, id));
    if (!row) throw httpErrors.notFound('Licence not found');
    const [item] = await this.items(this.ctx.db, [row as LicenseListRow]);
    const l = row.license;
    let keyHint: string | null = null;
    if (l.licenseKeySealed) {
      try {
        const key = this.ctx.secrets.open(l.licenseKeySealed).replace(/[\s-]/g, '');
        keyHint = key.length > 8 ? key.slice(-4) : null;
      } catch {
        keyHint = null;
      }
    }
    return {
      ...item!,
      notes: l.notes,
      attributes: l.attributes,
      hasKey: Boolean(l.licenseKeySealed),
      keyHint,
      viewer: {
        canManage: canManageSoftware(auth),
        canReveal: auth.can(LICENSES_REVEAL) && Boolean(l.licenseKeySealed),
        canReadContracts: canReadContracts(auth),
      },
      createdAt: l.createdAt,
    };
  }

  async assignments(ref: string, q: z.output<typeof assignmentQuerySchema>) {
    const l = await this.resolve(ref);
    const person = alias(users, 'person');
    const product = lower(l.product);
    // Seats that could go back to the pool: the person left (or the device is gone), or — when inventory tools
    // report the product at all — nothing has reported it on their devices for RECLAIM_DAYS.
    const reported = sql`exists (select 1 from ${softwareInstallations} r where lower(r.product) = ${product})`;
    const seenSince = sql`now() - make_interval(days => ${RECLAIM_DAYS})`;
    const reclaim = sql<'left' | 'device_gone' | 'unused' | null>`case
      when ${licenseAssignments.userId} is not null and ${person.status} <> 'active' then 'left'
      when ${licenseAssignments.assetId} is not null and ${assets.status} in ('retired', 'disposed', 'lost')
        then 'device_gone'
      when ${reported} and ${licenseAssignments.userId} is not null and not exists (
        select 1 from ${softwareInstallations} i join ${assets} d on d.id = i.asset_id
         where lower(i.product) = ${product} and d.assigned_to = ${licenseAssignments.userId}
           and i.last_seen_at >= ${seenSince}) then 'unused'
      when ${reported} and ${licenseAssignments.assetId} is not null and not exists (
        select 1 from ${softwareInstallations} i
         where lower(i.product) = ${product} and i.asset_id = ${licenseAssignments.assetId}
           and i.last_seen_at >= ${seenSince}) then 'unused'
      else null end`;
    const where = all(
      eq(licenseAssignments.licenseId, l.id),
      q.reclaim ? sql`(${reclaim}) is not null` : undefined,
      q.target === 'user'
        ? sql`${licenseAssignments.userId} is not null`
        : q.target === 'asset'
          ? sql`${licenseAssignments.assetId} is not null`
          : undefined,
      q.q
        ? or(
            ilike(person.displayName, likePattern(q.q)),
            ilike(person.email, likePattern(q.q)),
            ilike(assets.name, likePattern(q.q)),
            ilike(assets.serialNumber, likePattern(q.q)),
          )
        : undefined,
    );
    const base = () =>
      this.ctx.db
        .select({
          a: licenseAssignments,
          personName: person.displayName,
          assetNumber: assets.number,
          assetName: assets.name,
          assetCategory: assets.category,
          assetStatus: assets.status,
          assetAssignee: assets.assignedTo,
          reclaim,
        })
        .from(licenseAssignments)
        .leftJoin(person, eq(person.id, licenseAssignments.userId))
        .leftJoin(assets, eq(assets.id, licenseAssignments.assetId));
    const [rows, [total]] = await Promise.all([
      base()
        .where(where)
        .orderBy(sql`coalesce(${person.displayName}, ${assets.name}) asc`, asc(licenseAssignments.id))
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize),
      this.ctx.db
        .select({ n: count() })
        .from(licenseAssignments)
        .leftJoin(person, eq(person.id, licenseAssignments.userId))
        .leftJoin(assets, eq(assets.id, licenseAssignments.assetId))
        .where(where),
    ]);
    const people = await peopleByIds(
      this.ctx.db,
      rows.flatMap((r) => [r.a.userId, r.a.assignedBy, r.assetAssignee]),
    );
    return {
      items: rows.map((r) => {
        const by = r.a.assignedBy ? people.get(r.a.assignedBy) : undefined;
        return {
          id: r.a.id,
          user: personRef(r.a.userId ? people.get(r.a.userId) : null),
          asset:
            r.a.assetId && r.assetNumber !== null
              ? {
                  id: r.a.assetId,
                  tag: formatAssetTag(r.assetNumber),
                  name: r.assetName ?? '',
                  category: r.assetCategory!,
                  status: r.assetStatus!,
                  assignee: personRef(r.assetAssignee ? people.get(r.assetAssignee) : null),
                }
              : null,
          assignedAt: r.a.assignedAt,
          assignedBy: by ? { id: by.id, displayName: by.displayName } : null,
          reclaim: r.reclaim ?? null,
        };
      }),
      total: total!.n,
      page: q.page,
      pageSize: q.pageSize,
    };
  }

  /** Installs with their coverage, for one product (licence page) or one device (asset page). */
  async installations(
    filter: { product?: string; assetId?: string },
    q: { page: number; pageSize: number; unlicensed?: boolean; q?: string },
  ) {
    const where = all(
      filter.product ? eq(sql`lower(${softwareInstallations.product})`, lower(filter.product)) : undefined,
      filter.assetId ? eq(softwareInstallations.assetId, filter.assetId) : undefined,
      filter.product ? notInArray(assets.status, INACTIVE_DEVICE) : undefined,
      filter.product ? firstOfProduct : undefined,
      q.unlicensed ? sql`not ${licensedExpr}` : undefined,
      q.q
        ? or(
            ilike(assets.name, likePattern(q.q)),
            ilike(assets.serialNumber, likePattern(q.q)),
            ilike(softwareInstallations.product, likePattern(q.q)),
          )
        : undefined,
    );
    const [allowList] = await this.ctx.db
      .select({ id: approvedSoftware.id })
      .from(approvedSoftware)
      .where(eq(approvedSoftware.status, 'allowed'))
      .limit(1);
    const [rows, [total]] = await Promise.all([
      this.ctx.db
        .select({
          i: softwareInstallations,
          assetNumber: assets.number,
          assetName: assets.name,
          assetCategory: assets.category,
          assetStatus: assets.status,
          assignedTo: assets.assignedTo,
          licensed: licensedExpr,
          managed: managedExpr,
          approval: approvalSql(companyToday(), Boolean(allowList)),
        })
        .from(softwareInstallations)
        .innerJoin(assets, eq(assets.id, softwareInstallations.assetId))
        .where(where)
        .orderBy(sql`${licensedExpr} asc`, asc(assets.number), asc(softwareInstallations.product))
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize),
      this.ctx.db
        .select({ n: count() })
        .from(softwareInstallations)
        .innerJoin(assets, eq(assets.id, softwareInstallations.assetId))
        .where(where),
    ]);
    const people = await peopleByIds(
      this.ctx.db,
      rows.map((r) => r.assignedTo),
    );
    return {
      items: rows.map((r) => ({
        id: r.i.id,
        asset: {
          id: r.i.assetId,
          tag: formatAssetTag(r.assetNumber),
          name: r.assetName,
          category: r.assetCategory,
          status: r.assetStatus,
          assignee: personRef(r.assignedTo ? people.get(r.assignedTo) : null),
        },
        product: r.i.product,
        reportedAs: r.i.reportedAs,
        publisher: r.i.publisher,
        version: r.i.version,
        source: r.i.source,
        firstSeenAt: r.i.firstSeenAt,
        lastSeenAt: r.i.lastSeenAt,
        licensed: Boolean(r.licensed),
        managed: Boolean(r.managed),
        approval: r.approval,
      })),
      total: total!.n,
      page: q.page,
      pageSize: q.pageSize,
    };
  }

  /* ───────────── mutations ───────────── */

  private async assertRefs(input: { vendorId?: string | null; contractId?: string | null }) {
    if (input.vendorId) {
      const [v] = await this.ctx.db
        .select({ id: vendors.id })
        .from(vendors)
        .where(eq(vendors.id, input.vendorId));
      if (!v) throw invalidField('vendorId', 'Unknown vendor');
    }
    if (input.contractId) {
      const [c] = await this.ctx.db
        .select({ id: contracts.id })
        .from(contracts)
        .where(eq(contracts.id, input.contractId));
      if (!c) throw invalidField('contractId', 'Unknown contract');
    }
  }

  private checkDates(start: string | null | undefined, end: string | null | undefined) {
    if (start && end && end < start) throw invalidField('endDate', 'The end date is before the start date');
  }

  async create(input: CreateLicenseData, auth: AuthContext) {
    auth.require(SOFTWARE_MANAGE);
    await this.assertRefs(input);
    this.checkDates(input.startDate, input.endDate);
    const cfg = await itamConfig(this.ctx);
    return this.ctx.transaction(async (tx) => {
      const [row] = await tx
        .insert(licenses)
        .values({
          product: input.product,
          publisher: input.publisher,
          vendorId: input.vendorId ?? null,
          licenseType: input.licenseType,
          quantity: input.licenseType === 'site' ? (input.quantity ?? null) : (input.quantity ?? null),
          cost: input.cost ?? null,
          currency: input.currency ?? cfg.currency,
          billing: input.billing ?? 'annual',
          startDate: input.startDate ?? null,
          endDate: input.endDate ?? null,
          contractId: input.contractId ?? null,
          licenseKeySealed: input.licenseKey ? this.ctx.secrets.seal(input.licenseKey) : null,
          notes: input.notes,
          attributes: input.attributes ?? {},
        })
        .returning();
      const l = row!;
      const reference = formatLicenseRef(l.number);
      await this.ctx.audit.record(
        {
          action: 'itam.license.created',
          entityType: LICENSE_ENTITY,
          entityId: l.id,
          entityLabel: auditLabel(l),
          metadata: { licenseType: l.licenseType, quantity: l.quantity, hasKey: Boolean(input.licenseKey) },
        },
        { tx },
      );
      await this.ctx.events.publish(
        'itam.license.created',
        { licenseId: l.id, reference, product: l.product },
        { tx },
      );
      await this.recomputeProducts(tx, [l.product]);
      return l;
    });
  }

  async update(ref: string, input: UpdateLicenseData, auth: AuthContext) {
    auth.require(SOFTWARE_MANAGE);
    const before = await this.resolve(ref);
    await this.assertRefs(input);
    this.checkDates(
      input.startDate === undefined ? before.startDate : input.startDate,
      input.endDate === undefined ? before.endDate : input.endDate,
    );
    const patch: Partial<typeof licenses.$inferInsert> = {};
    const fields = [
      'product',
      'publisher',
      'vendorId',
      'licenseType',
      'quantity',
      'cost',
      'currency',
      'billing',
      'startDate',
      'endDate',
      'contractId',
      'notes',
    ] as const;
    for (const f of fields) {
      const v = input[f];
      if (v !== undefined && v !== before[f]) (patch as Record<string, unknown>)[f] = v;
    }
    if (
      input.attributes !== undefined &&
      JSON.stringify(input.attributes) !== JSON.stringify(before.attributes)
    )
      patch.attributes = input.attributes;
    const keyChanged = input.licenseKey !== undefined;
    if (keyChanged)
      patch.licenseKeySealed = input.licenseKey ? this.ctx.secrets.seal(input.licenseKey) : null;
    const changed = Object.keys(patch).map((k) => (k === 'licenseKeySealed' ? 'licenseKey' : k));
    if (!changed.length) return before;
    const { licenseKeySealed: _sealed, ...visible } = patch;
    const changes = this.ctx.audit.diff(
      before as unknown as Record<string, unknown>,
      visible as Record<string, unknown>,
    );
    if (keyChanged) changes.licenseKey = ['[redacted]', '[redacted]'];
    return this.ctx.transaction(async (tx) => {
      const [row] = await tx.update(licenses).set(patch).where(eq(licenses.id, before.id)).returning();
      const l = row!;
      if (patch.product !== undefined)
        // Titles mapped to this licence count as its new product name.
        await tx
          .update(softwareInstallations)
          .set({ product: l.product })
          .where(
            inArray(
              sql`lower(${softwareInstallations.reportedAs})`,
              tx
                .select({ title: sql`lower(${softwareTitleRules.title})` })
                .from(softwareTitleRules)
                .where(eq(softwareTitleRules.licenseId, l.id)),
            ),
          );
      await this.ctx.audit.record(
        {
          action: 'itam.license.updated',
          entityType: LICENSE_ENTITY,
          entityId: l.id,
          entityLabel: auditLabel(l),
          changes,
        },
        { tx },
      );
      await this.ctx.events.publish(
        'itam.license.updated',
        { licenseId: l.id, reference: formatLicenseRef(l.number), product: l.product, changes: changed },
        { tx },
      );
      await this.recomputeProducts(tx, [before.product, l.product]);
      return l;
    });
  }

  /** Gives a seat to a person or a device; usage and compliance update in the same transaction. */
  async assign(ref: string, input: AssignmentData, auth: AuthContext) {
    auth.require(SOFTWARE_MANAGE);
    const l = await this.resolve(ref);
    if (l.licenseType === 'per_device' && !input.assetId)
      throw invalidField('assetId', 'Per-device licences are assigned to devices');
    if (l.licenseType === 'per_user' && !input.userId)
      throw invalidField('userId', 'Per-user licences are assigned to people');
    if (input.userId) {
      const [u] = await this.ctx.db
        .select({ status: users.status })
        .from(users)
        .where(eq(users.id, input.userId));
      if (!u || u.status !== 'active') throw invalidField('userId', 'Choose an active person');
    }
    let assetLabel: string | null = null;
    if (input.assetId) {
      const [a] = await this.ctx.db.select().from(assets).where(eq(assets.id, input.assetId));
      if (!a || a.status === 'disposed') throw invalidField('assetId', 'Choose a device that is in use');
      assetLabel = `${formatAssetTag(a.number)} ${a.name}`;
    }
    try {
      return await this.ctx.transaction(async (tx) => {
        await this.lockProducts(tx, [l.product]);
        const [row] = await tx
          .insert(licenseAssignments)
          .values({
            licenseId: l.id,
            userId: input.userId ?? null,
            assetId: input.assetId ?? null,
            assignedBy: actingUserId(auth),
          })
          .returning();
        await this.ctx.audit.record(
          {
            action: 'itam.license.assigned',
            entityType: LICENSE_ENTITY,
            entityId: l.id,
            entityLabel: auditLabel(l),
            metadata: {
              assignmentId: row!.id,
              userId: input.userId ?? null,
              assetId: input.assetId ?? null,
              asset: assetLabel,
            },
          },
          { tx },
        );
        await this.recomputeProducts(tx, [l.product]);
        return row!;
      });
    } catch (err) {
      if (pgCode(err) === UNIQUE_VIOLATION)
        throw httpErrors.conflict(
          input.userId ? 'This person already has a seat' : 'This device already has a seat',
          { field: input.userId ? 'userId' : 'assetId' },
        );
      throw err;
    }
  }

  async unassign(ref: string, assignmentId: string, auth: AuthContext, reason: string | null = null) {
    auth.require(SOFTWARE_MANAGE);
    const l = await this.resolve(ref);
    await this.ctx.transaction(async (tx) => {
      await this.lockProducts(tx, [l.product]);
      const [row] = await tx
        .delete(licenseAssignments)
        .where(and(eq(licenseAssignments.id, assignmentId), eq(licenseAssignments.licenseId, l.id)))
        .returning();
      if (!row) throw httpErrors.notFound('Assignment not found');
      await this.ctx.audit.record(
        {
          action: 'itam.license.unassigned',
          entityType: LICENSE_ENTITY,
          entityId: l.id,
          entityLabel: auditLabel(l),
          metadata: { assignmentId, userId: row.userId, assetId: row.assetId, reason },
        },
        { tx },
      );
      await this.recomputeProducts(tx, [l.product]);
    });
  }

  /** People leave: their seats go back to the pool (each audited), compliance follows. */
  async reclaimSeats(userId: string): Promise<number> {
    return this.ctx.transaction(async (tx) => {
      const rows = await tx
        .delete(licenseAssignments)
        .where(eq(licenseAssignments.userId, userId))
        .returning();
      if (!rows.length) return 0;
      const list = await tx
        .select()
        .from(licenses)
        .where(
          inArray(
            licenses.id,
            rows.map((r) => r.licenseId),
          ),
        );
      const byId = new Map(list.map((l) => [l.id, l]));
      for (const r of rows) {
        const l = byId.get(r.licenseId)!;
        await this.ctx.audit.record(
          {
            action: 'itam.license.unassigned',
            entityType: LICENSE_ENTITY,
            entityId: l.id,
            entityLabel: auditLabel(l),
            metadata: { assignmentId: r.id, userId, reason: 'offboarded' },
          },
          { tx },
        );
      }
      await this.recomputeProducts(
        tx,
        list.map((l) => l.product),
      );
      return rows.length;
    });
  }

  /** Reveals the licence key to a permitted person; always audited (security). */
  async revealKey(ref: string, auth: AuthContext) {
    auth.require(LICENSES_REVEAL);
    const l = await this.resolve(ref);
    if (!l.licenseKeySealed) throw httpErrors.notFound('This licence has no key');
    const key = this.ctx.secrets.open(l.licenseKeySealed);
    await this.ctx.audit.record({
      action: 'itam.license.key_revealed',
      category: 'security',
      entityType: LICENSE_ENTITY,
      entityId: l.id,
      entityLabel: auditLabel(l),
    });
    return { key };
  }

  /** Seats a person holds, and seats on the devices assigned to them. */
  async heldBy(userId: string) {
    const rows = await this.ctx.db
      .select({
        assignmentId: licenseAssignments.id,
        assignedAt: licenseAssignments.assignedAt,
        id: licenses.id,
        number: licenses.number,
        product: licenses.product,
        publisher: licenses.publisher,
        licenseType: licenses.licenseType,
        endDate: licenses.endDate,
        assetId: assets.id,
        assetNumber: assets.number,
        assetName: assets.name,
        assetCategory: assets.category,
        assetStatus: assets.status,
      })
      .from(licenseAssignments)
      .innerJoin(licenses, eq(licenses.id, licenseAssignments.licenseId))
      .leftJoin(assets, eq(assets.id, licenseAssignments.assetId))
      .where(
        or(
          eq(licenseAssignments.userId, userId),
          and(eq(assets.assignedTo, userId), sql`${assets.status} <> 'disposed'`),
        ),
      )
      .orderBy(asc(licenses.product))
      .limit(200);
    return rows.map((r) => ({
      license: {
        id: r.id,
        reference: formatLicenseRef(r.number),
        product: r.product,
        licenseType: r.licenseType,
        publisher: r.publisher,
      },
      device:
        r.assetId && r.assetNumber !== null
          ? {
              id: r.assetId,
              tag: formatAssetTag(r.assetNumber),
              name: r.assetName ?? '',
              category: r.assetCategory!,
              status: r.assetStatus!,
            }
          : null,
      assignedAt: r.assignedAt,
      endDate: r.endDate,
    }));
  }
}
