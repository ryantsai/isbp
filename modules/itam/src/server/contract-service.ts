/**
 * Contract rules: terms and their stored status (kept current by the daily job and by renew/cancel),
 * renewal reminders that never repeat for the same end date, covered items and the history (audit).
 */
import { auditLogs, users } from '@isbp/db/schema';
import {
  type AuthContext,
  type Db,
  ErrorCodes,
  HttpError,
  httpErrors,
  likePattern,
  type ModuleContext,
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
  lte,
  or,
  type SQL,
  sql,
} from 'drizzle-orm';
import type { z } from 'zod';
import type {
  cancelContractSchema,
  contractItemsInputSchema,
  contractQuerySchema,
  createContractSchema,
  renewContractSchema,
  updateContractSchema,
} from '../contracts';
import {
  addDays,
  annualCost,
  contractStatusFor,
  type ContractStatus,
  daysBetween,
  formatAssetTag,
  formatContractRef,
  formatLicenseRef,
  nextTerm,
  noticeDate,
  parseRef,
  reminderDue,
  termMonths,
} from '../model';
import { all, canManageContracts, CONTRACTS_MANAGE } from './access';
import { assets, contractItems, type ContractRow, contracts, licenses, models, vendors } from './schema';
import { companyToday, invalidField, itamConfig, peopleByIds, personRef, roleHolders } from './support';

export type CreateContractData = z.output<typeof createContractSchema>;
export type UpdateContractData = z.output<typeof updateContractSchema>;
export type ContractQueryData = z.output<typeof contractQuerySchema>;
type RenewData = z.output<typeof renewContractSchema>;
type CancelData = z.output<typeof cancelContractSchema>;
type ItemsData = z.output<typeof contractItemsInputSchema>;

export const CONTRACT_ENTITY = 'itam.contract';
export const contractHref = (reference: string) => `/itam/contracts/${reference}`;
const auditLabel = (c: { number: number; title: string }) => `${formatContractRef(c.number)} ${c.title}`;
const ref = (c: ContractRow) => ({
  contractId: c.id,
  reference: formatContractRef(c.number),
  title: c.title,
});

/** The default renewal window of the "Renewing soon" tab and the dashboard. */
export const RENEWAL_WINDOW_DAYS = 90;

const STATUS_RANK = sql`case ${contracts.status} when 'expiring' then 0 when 'active' then 1 when 'draft' then 2 when 'expired' then 3 else 4 end`;
const ANNUAL_COST = sql`(case ${contracts.billing} when 'monthly' then ${contracts.cost} * 12 when 'quarterly' then ${contracts.cost} * 4 else ${contracts.cost} end)`;

const SORTABLE: Record<string, SQL> = {
  number: sql`${contracts.number}`,
  title: sql`${contracts.title}`,
  kind: sql`${contracts.kind}`,
  status: STATUS_RANK,
  endDate: sql`${contracts.endDate}`,
  cost: ANNUAL_COST,
  updatedAt: sql`${contracts.updatedAt}`,
};

const ITEM_COUNT =
  sql<number>`(select count(*) from ${contractItems} ci where ci.contract_id = ${contracts.id})`.mapWith(
    Number,
  );

type ContractListRow = { contract: ContractRow; vendorName: string | null; itemCount: number };

function selectContracts(db: Db) {
  return db
    .select({ contract: contracts, vendorName: vendors.name, itemCount: ITEM_COUNT })
    .from(contracts)
    .leftJoin(vendors, eq(vendors.id, contracts.vendorId));
}

/** Number (`CTR-00007`) or title. */
export function contractSearchCondition(term: string): SQL {
  const q = term.trim();
  const parsed = parseRef('contract', q);
  const text = ilike(contracts.title, likePattern(q));
  if (parsed && 'number' in parsed) return or(text, eq(contracts.number, parsed.number))!;
  if (parsed && 'id' in parsed) return or(text, eq(contracts.id, parsed.id))!;
  return text;
}

export function toContractItem(r: ContractListRow, owner: ReturnType<typeof personRef>, today: string) {
  const c = r.contract;
  return {
    id: c.id,
    number: c.number,
    reference: formatContractRef(c.number),
    title: c.title,
    vendor: c.vendorId && r.vendorName ? { id: c.vendorId, name: r.vendorName } : null,
    kind: c.kind,
    status: c.status,
    startDate: c.startDate,
    endDate: c.endDate,
    autoRenew: c.autoRenew,
    noticeDays: c.noticeDays,
    noticeDate: noticeDate(c.endDate, c.noticeDays),
    daysToEnd: c.endDate ? daysBetween(today, c.endDate) : null,
    cost: c.cost,
    currency: c.currency,
    billing: c.billing,
    annualCost: annualCost(c.cost, c.billing, termMonths(c.startDate, c.endDate)),
    owner,
    itemCount: r.itemCount,
    updatedAt: c.updatedAt,
  };
}
export type ContractItemDto = ReturnType<typeof toContractItem>;

export class ContractService {
  constructor(private readonly ctx: ModuleContext) {}

  /* ───────────── reading ───────────── */

  async resolve(reference: string, db: Db = this.ctx.db): Promise<ContractRow> {
    const parsed = parseRef('contract', reference);
    if (!parsed) throw httpErrors.notFound('Contract not found');
    const [row] = await db
      .select()
      .from(contracts)
      .where('id' in parsed ? eq(contracts.id, parsed.id) : eq(contracts.number, parsed.number));
    if (!row) throw httpErrors.notFound('Contract not found');
    return row;
  }

  async items(rows: ContractListRow[], today = companyToday()) {
    const people = await peopleByIds(
      this.ctx.db,
      rows.map((r) => r.contract.ownerId),
    );
    return rows.map((r) =>
      toContractItem(r, personRef(r.contract.ownerId ? people.get(r.contract.ownerId) : null), today),
    );
  }

  viewWhere(view: ContractQueryData['view'], today: string): SQL | undefined {
    switch (view) {
      case 'active':
        return inArray(contracts.status, ['active', 'expiring']);
      case 'renewing':
        return and(
          inArray(contracts.status, ['active', 'expiring']),
          lte(contracts.endDate, addDays(today, RENEWAL_WINDOW_DAYS)),
        );
      case 'expired':
        return eq(contracts.status, 'expired');
      default:
        return undefined;
    }
  }

  async list(q: ContractQueryData) {
    const today = companyToday();
    const where = all(
      this.viewWhere(q.view, today),
      q.status?.length ? inArray(contracts.status, q.status) : undefined,
      q.kind ? eq(contracts.kind, q.kind) : undefined,
      q.vendor ? eq(contracts.vendorId, q.vendor) : undefined,
      q.owner ? eq(contracts.ownerId, q.owner) : undefined,
      q.renewal !== undefined
        ? and(
            inArray(contracts.status, ['active', 'expiring']),
            gte(contracts.endDate, today),
            lte(contracts.endDate, addDays(today, q.renewal)),
          )
        : undefined,
      q.q ? contractSearchCondition(q.q) : undefined,
    );
    const key = q.sort?.replace(/^-/, '') ?? 'endDate';
    const column = SORTABLE[key] ?? SORTABLE.endDate!;
    const order = q.sort?.startsWith('-') ? sql`${column} desc nulls last` : sql`${column} asc nulls last`;
    const [rows, [total]] = await Promise.all([
      selectContracts(this.ctx.db)
        .where(where)
        .orderBy(order, asc(contracts.number))
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize),
      this.ctx.db.select({ n: count() }).from(contracts).where(where),
    ]);
    return { items: await this.items(rows, today), total: total!.n, page: q.page, pageSize: q.pageSize };
  }

  async itemsWhere(
    where: SQL | undefined,
    limit = 50,
    order: SQL = sql`${contracts.endDate} asc nulls last`,
  ) {
    const rows = await selectContracts(this.ctx.db).where(where).orderBy(order).limit(limit);
    return this.items(rows);
  }

  async detail(reference: string, auth: AuthContext) {
    const c = await this.resolve(reference);
    return this.detailOf(c.id, auth);
  }

  async detailOf(id: string, auth: AuthContext) {
    const today = companyToday();
    const [row] = await selectContracts(this.ctx.db).where(eq(contracts.id, id));
    if (!row) throw httpErrors.notFound('Contract not found');
    const [item] = await this.items([row], today);
    const [covered, linkedLicenses] = await Promise.all([
      this.ctx.db
        .select({
          id: contractItems.id,
          assetId: assets.id,
          assetNumber: assets.number,
          assetName: assets.name,
          assetCategory: assets.category,
          assetStatus: assets.status,
          modelName: sql<string | null>`${models.manufacturer} || ' ' || ${models.name}`,
          licenseId: licenses.id,
          licenseNumber: licenses.number,
          licenseProduct: licenses.product,
          licenseType: licenses.licenseType,
        })
        .from(contractItems)
        .leftJoin(assets, eq(assets.id, contractItems.assetId))
        .leftJoin(models, eq(models.id, assets.modelId))
        .leftJoin(licenses, eq(licenses.id, contractItems.licenseId))
        .where(eq(contractItems.contractId, id))
        .orderBy(sql`coalesce(${assets.number}, 0)`, sql`coalesce(${licenses.number}, 0)`),
      this.ctx.db
        .select({ id: licenses.id, number: licenses.number, product: licenses.product })
        .from(licenses)
        .where(eq(licenses.contractId, id))
        .orderBy(asc(licenses.product)),
    ]);
    const c = row.contract;
    return {
      ...item!,
      notes: c.notes,
      attributes: c.attributes,
      items: covered.map((i) => ({
        id: i.id,
        asset:
          i.assetId && i.assetNumber !== null
            ? {
                id: i.assetId,
                tag: formatAssetTag(i.assetNumber),
                name: i.assetName ?? '',
                category: i.assetCategory!,
                status: i.assetStatus!,
                model: i.modelName,
              }
            : null,
        license:
          i.licenseId && i.licenseNumber !== null
            ? {
                id: i.licenseId,
                reference: formatLicenseRef(i.licenseNumber),
                product: i.licenseProduct ?? '',
                licenseType: i.licenseType!,
              }
            : null,
      })),
      licenses: linkedLicenses.map((l) => ({
        id: l.id,
        reference: formatLicenseRef(l.number),
        product: l.product,
      })),
      lastReminderFor: c.lastReminderFor,
      today,
      viewer: { canManage: canManageContracts(auth) },
      createdAt: c.createdAt,
    };
  }

  /** Contracts covering an asset (asset page). */
  async coveringAsset(assetId: string) {
    const rows = await selectContracts(this.ctx.db)
      .innerJoin(contractItems, eq(contractItems.contractId, contracts.id))
      .where(eq(contractItems.assetId, assetId))
      .orderBy(desc(contracts.endDate));
    return this.items(
      rows.map((r) => ({ contract: r.contract, vendorName: r.vendorName, itemCount: r.itemCount })),
    );
  }

  /** The contract's history: its audit trail, newest first. */
  async history(reference: string) {
    const c = await this.resolve(reference);
    const rows = await this.ctx.db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.entityType, CONTRACT_ENTITY), eq(auditLogs.entityId, c.id)))
      .orderBy(desc(auditLogs.occurredAt))
      .limit(100);
    const people = await peopleByIds(
      this.ctx.db,
      rows.map((r) => r.actorId),
    );
    return {
      items: rows.map((r) => ({
        id: String(r.seq),
        action: r.action,
        actor: (r.actorId && people.get(r.actorId)?.displayName) || r.actorName || null,
        occurredAt: r.occurredAt,
        changes: r.changes ?? null,
        metadata: r.metadata ?? null,
      })),
    };
  }

  /* ───────────── mutations ───────────── */

  private async assertRefs(input: { vendorId?: string | null; ownerId?: string | null }) {
    if (input.vendorId) {
      const [v] = await this.ctx.db
        .select({ id: vendors.id })
        .from(vendors)
        .where(eq(vendors.id, input.vendorId));
      if (!v) throw invalidField('vendorId', 'Unknown vendor');
    }
    if (input.ownerId) {
      const [u] = await this.ctx.db
        .select({ status: users.status })
        .from(users)
        .where(eq(users.id, input.ownerId));
      if (!u || u.status !== 'active') throw invalidField('ownerId', 'Choose an active person');
    }
  }

  private checkDates(start: string | null | undefined, end: string | null | undefined) {
    if (start && end && end < start) throw invalidField('endDate', 'The end date is before the start date');
  }

  async create(input: CreateContractData, auth: AuthContext) {
    auth.require(CONTRACTS_MANAGE);
    await this.assertRefs(input);
    this.checkDates(input.startDate, input.endDate);
    const cfg = await itamConfig(this.ctx);
    const attributes = input.attributes
      ? await this.ctx.fields.validate(CONTRACT_ENTITY, input.attributes)
      : {};
    const today = companyToday();
    const noticeDays = input.noticeDays ?? 60;
    const status: ContractStatus = input.draft
      ? 'draft'
      : contractStatusFor(
          {
            status: 'active',
            startDate: input.startDate ?? null,
            endDate: input.endDate ?? null,
            noticeDays,
          },
          today,
        );
    return this.ctx.transaction(async (tx) => {
      const [row] = await tx
        .insert(contracts)
        .values({
          title: input.title,
          vendorId: input.vendorId ?? null,
          kind: input.kind,
          status,
          startDate: input.startDate ?? null,
          endDate: input.endDate ?? null,
          autoRenew: input.autoRenew ?? false,
          noticeDays,
          cost: input.cost ?? null,
          currency: input.currency ?? cfg.currency,
          billing: input.billing ?? 'annual',
          ownerId: input.ownerId ?? null,
          notes: input.notes,
          attributes,
        })
        .returning();
      const c = row!;
      await this.ctx.audit.record(
        {
          action: 'itam.contract.created',
          entityType: CONTRACT_ENTITY,
          entityId: c.id,
          entityLabel: auditLabel(c),
          metadata: { kind: c.kind, status: c.status, endDate: c.endDate },
        },
        { tx },
      );
      await this.ctx.events.publish('itam.contract.created', ref(c), { tx });
      return c;
    });
  }

  async update(reference: string, input: UpdateContractData, auth: AuthContext) {
    auth.require(CONTRACTS_MANAGE);
    const before = await this.resolve(reference);
    await this.assertRefs(input);
    const start = input.startDate === undefined ? before.startDate : input.startDate;
    const end = input.endDate === undefined ? before.endDate : input.endDate;
    this.checkDates(start, end);
    const attributes =
      input.attributes !== undefined
        ? await this.ctx.fields.validate(CONTRACT_ENTITY, input.attributes, before.attributes)
        : before.attributes;
    const patch: Partial<typeof contracts.$inferInsert> = {};
    const fields = [
      'title',
      'vendorId',
      'kind',
      'startDate',
      'endDate',
      'autoRenew',
      'noticeDays',
      'cost',
      'currency',
      'billing',
      'ownerId',
      'notes',
    ] as const;
    for (const f of fields) {
      const v = input[f];
      if (v !== undefined && v !== before[f]) (patch as Record<string, unknown>)[f] = v;
    }
    if (JSON.stringify(attributes) !== JSON.stringify(before.attributes)) patch.attributes = attributes;
    if (before.status === 'cancelled' && Object.keys(patch).some((k) => ['startDate', 'endDate'].includes(k)))
      throw new HttpError(
        409,
        ErrorCodes.INVALID_STATE,
        'Cancelled contracts are not renewed by editing; create a new one',
      );
    const baseStatus: ContractStatus = before.status === 'draft' && input.activate ? 'active' : before.status;
    const status = contractStatusFor(
      {
        status: baseStatus,
        startDate: start,
        endDate: end,
        noticeDays: input.noticeDays ?? before.noticeDays,
      },
      companyToday(),
    );
    if (status !== before.status) patch.status = status;
    const changed = Object.keys(patch);
    if (!changed.length) return before;
    const changes = this.ctx.audit.diff(
      before as unknown as Record<string, unknown>,
      patch as Record<string, unknown>,
    );
    return this.ctx.transaction(async (tx) => {
      const [row] = await tx.update(contracts).set(patch).where(eq(contracts.id, before.id)).returning();
      const c = row!;
      await this.ctx.audit.record(
        {
          action: 'itam.contract.updated',
          entityType: CONTRACT_ENTITY,
          entityId: c.id,
          entityLabel: auditLabel(c),
          changes,
        },
        { tx },
      );
      await this.ctx.events.publish('itam.contract.updated', { ...ref(c), changes: changed }, { tx });
      if (c.status === 'expired' && before.status !== 'expired')
        await this.ctx.events.publish(
          'itam.contract.expired',
          { ...ref(c), endDate: c.endDate ?? '' },
          { tx },
        );
      return c;
    });
  }

  /** Extends the term (new start/end, optionally a new cost); the history keeps the old term. */
  async renew(reference: string, input: RenewData, auth: AuthContext) {
    auth.require(CONTRACTS_MANAGE);
    const c = await this.resolve(reference);
    if (c.status === 'cancelled')
      throw new HttpError(409, ErrorCodes.INVALID_STATE, 'Cancelled contracts cannot be renewed');
    const today = companyToday();
    const startDate = input.startDate ?? (c.endDate ? addDays(c.endDate, 1) : today);
    if (input.endDate <= startDate) throw invalidField('endDate', 'The new end date must be after the start');
    if (c.endDate && input.endDate <= c.endDate)
      throw invalidField('endDate', 'The new end date must be after the current one');
    return this.applyRenewal(
      c,
      { startDate, endDate: input.endDate, cost: input.cost, note: input.note },
      false,
    );
  }

  private async applyRenewal(
    c: ContractRow,
    term: { startDate: string; endDate: string; cost?: number | null; note?: string | null },
    automatic: boolean,
    today = companyToday(),
  ) {
    const status = contractStatusFor(
      { status: 'active', startDate: term.startDate, endDate: term.endDate, noticeDays: c.noticeDays },
      today,
    );
    const patch: Partial<typeof contracts.$inferInsert> = {
      startDate: term.startDate,
      endDate: term.endDate,
      status,
      ...(term.cost !== undefined && term.cost !== c.cost ? { cost: term.cost } : {}),
    };
    return this.ctx.transaction(async (tx) => {
      const [row] = await tx.update(contracts).set(patch).where(eq(contracts.id, c.id)).returning();
      const updated = row!;
      await this.ctx.audit.record(
        {
          action: 'itam.contract.renewed',
          entityType: CONTRACT_ENTITY,
          entityId: c.id,
          entityLabel: auditLabel(c),
          changes: this.ctx.audit.diff(
            c as unknown as Record<string, unknown>,
            patch as Record<string, unknown>,
          ),
          metadata: { note: term.note ?? null, automatic },
        },
        { tx },
      );
      await this.ctx.events.publish(
        'itam.contract.renewed',
        { ...ref(updated), startDate: updated.startDate, endDate: updated.endDate!, automatic },
        { tx },
      );
      return updated;
    });
  }

  async cancel(reference: string, input: CancelData, auth: AuthContext) {
    auth.require(CONTRACTS_MANAGE);
    const c = await this.resolve(reference);
    if (c.status === 'cancelled') return c;
    return this.ctx.transaction(async (tx) => {
      const [row] = await tx
        .update(contracts)
        .set({ status: 'cancelled', autoRenew: false })
        .where(eq(contracts.id, c.id))
        .returning();
      const updated = row!;
      await this.ctx.audit.record(
        {
          action: 'itam.contract.cancelled',
          entityType: CONTRACT_ENTITY,
          entityId: c.id,
          entityLabel: auditLabel(c),
          changes: { status: [c.status, 'cancelled'] },
          metadata: { note: input.note },
        },
        { tx },
      );
      await this.ctx.events.publish(
        'itam.contract.updated',
        { ...ref(updated), changes: ['status'] },
        { tx },
      );
      return updated;
    });
  }

  /** Replaces what the contract covers. */
  async setItems(reference: string, input: ItemsData, auth: AuthContext) {
    auth.require(CONTRACTS_MANAGE);
    const c = await this.resolve(reference);
    const assetIds = [...new Set(input.assetIds)];
    const licenseIds = [...new Set(input.licenseIds)];
    if (assetIds.length) {
      const found = await this.ctx.db
        .select({ id: assets.id })
        .from(assets)
        .where(inArray(assets.id, assetIds));
      if (found.length !== assetIds.length) throw invalidField('assetIds', 'Unknown asset');
    }
    if (licenseIds.length) {
      const found = await this.ctx.db
        .select({ id: licenses.id })
        .from(licenses)
        .where(inArray(licenses.id, licenseIds));
      if (found.length !== licenseIds.length) throw invalidField('licenseIds', 'Unknown licence');
    }
    return this.ctx.transaction(async (tx) => {
      const existing = await tx.select().from(contractItems).where(eq(contractItems.contractId, c.id));
      const haveAssets = new Set(existing.filter((e) => e.assetId).map((e) => e.assetId!));
      const haveLicenses = new Set(existing.filter((e) => e.licenseId).map((e) => e.licenseId!));
      const wantAssets = new Set(assetIds);
      const wantLicenses = new Set(licenseIds);
      const removed = existing.filter(
        (e) => (e.assetId && !wantAssets.has(e.assetId)) || (e.licenseId && !wantLicenses.has(e.licenseId)),
      );
      if (removed.length)
        await tx.delete(contractItems).where(
          inArray(
            contractItems.id,
            removed.map((r) => r.id),
          ),
        );
      const added = [
        ...assetIds.filter((a) => !haveAssets.has(a)).map((assetId) => ({ contractId: c.id, assetId })),
        ...licenseIds
          .filter((l) => !haveLicenses.has(l))
          .map((licenseId) => ({ contractId: c.id, licenseId })),
      ];
      if (added.length) await tx.insert(contractItems).values(added);
      if (added.length || removed.length) {
        await tx.update(contracts).set({ updatedAt: new Date() }).where(eq(contracts.id, c.id));
        await this.ctx.audit.record(
          {
            action: 'itam.contract.items_updated',
            entityType: CONTRACT_ENTITY,
            entityId: c.id,
            entityLabel: auditLabel(c),
            metadata: {
              added: added.length,
              removed: removed.length,
              assets: assetIds.length,
              licenses: licenseIds.length,
            },
          },
          { tx },
        );
        await this.ctx.events.publish('itam.contract.updated', { ...ref(c), changes: ['items'] }, { tx });
      }
      return c;
    });
  }

  /* ───────────── daily job ───────────── */

  /**
   * Keeps statuses current (auto-renewing contracts roll over to their next term, others become
   * `expiring` / `expired`) and sends renewal reminders: once the notice period starts, and again a week
   * before the end — never twice for the same end date.
   */
  async daily(today: string = companyToday()) {
    const result = { renewed: 0, statusChanged: 0, expired: 0, reminders: 0 };
    const live = await this.ctx.db
      .select()
      .from(contracts)
      .where(and(inArray(contracts.status, ['active', 'expiring', 'expired']), isNotNull(contracts.endDate)))
      .orderBy(asc(contracts.number));
    for (const c of live) {
      if (c.autoRenew && c.status !== 'expired' && daysBetween(today, c.endDate!) < 0) {
        let term = nextTerm(c.startDate, c.endDate!);
        while (daysBetween(today, term.endDate) < 0) term = nextTerm(term.startDate, term.endDate);
        await this.applyRenewal(c, term, true, today);
        result.renewed++;
        continue;
      }
      const status = contractStatusFor(c, today);
      if (status === c.status) continue;
      await this.ctx.transaction(async (tx) => {
        const [row] = await tx
          .update(contracts)
          .set({ status })
          .where(and(eq(contracts.id, c.id), eq(contracts.status, c.status)))
          .returning();
        if (!row) return;
        await this.ctx.audit.record(
          {
            action: status === 'expired' ? 'itam.contract.expired' : 'itam.contract.status_changed',
            entityType: CONTRACT_ENTITY,
            entityId: c.id,
            entityLabel: auditLabel(c),
            changes: { status: [c.status, status] },
          },
          { tx },
        );
        if (status === 'expired') {
          await this.ctx.events.publish(
            'itam.contract.expired',
            { ...ref(row), endDate: c.endDate! },
            { tx },
          );
          result.expired++;
        } else
          await this.ctx.events.publish(
            'itam.contract.updated',
            { ...ref(row), changes: ['status'] },
            { tx },
          );
        result.statusChanged++;
      });
    }

    const candidates = await this.ctx.db
      .select()
      .from(contracts)
      .where(
        and(
          inArray(contracts.status, ['active', 'expiring']),
          isNotNull(contracts.endDate),
          gte(contracts.endDate, today),
          sql`${contracts.endDate} - ${contracts.noticeDays} <= ${today}::date`,
        ),
      )
      .orderBy(asc(contracts.endDate));
    let managers: string[] | null = null;
    for (const c of candidates) {
      const due = reminderDue(c, today);
      if (!due) continue;
      managers ??= await roleHolders(this.ctx.db, 'itam-contract-manager');
      const recipients = [c.ownerId, ...managers];
      await this.ctx.transaction(async (tx) => {
        const [row] = await tx
          .update(contracts)
          .set({ lastReminderFor: c.endDate, lastRemindedOn: today })
          .where(
            and(
              eq(contracts.id, c.id),
              sql`${contracts.lastReminderFor} is not distinct from ${c.lastReminderFor}`,
              sql`${contracts.lastRemindedOn} is not distinct from ${c.lastRemindedOn}`,
            ),
          )
          .returning();
        if (!row) return;
        const reference = formatContractRef(c.number);
        const [vendor] = c.vendorId
          ? await tx.select({ name: vendors.name }).from(vendors).where(eq(vendors.id, c.vendorId))
          : [];
        await this.ctx.notifications.notify(
          {
            type: 'itam.contract.renewal_due',
            recipients,
            params: {
              reference,
              title: c.title,
              vendor: vendor?.name ?? '—',
              endDate: c.endDate!,
              days: daysBetween(today, c.endDate!),
              autoRenew: c.autoRenew ? 'yes' : 'no',
              stage: due,
            },
            href: contractHref(reference),
          },
          { tx },
        );
        await this.ctx.audit.record(
          {
            action: 'itam.contract.reminder_sent',
            entityType: CONTRACT_ENTITY,
            entityId: c.id,
            entityLabel: auditLabel(c),
            metadata: { stage: due, endDate: c.endDate, recipients: recipients.filter(Boolean).length },
          },
          { tx },
        );
        result.reminders++;
      });
    }
    return result;
  }
}
