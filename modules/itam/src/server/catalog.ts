/**
 * Vendors and the hardware model catalogue (`itam.config.manage`). Names are unique case-insensitively;
 * vendors report what the company spends with them.
 */
import { type AuthContext, type Db, httpErrors, likePattern, type ModuleContext } from '@isbp/sdk/server';
import { and, asc, count, eq, gte, ilike, inArray, or, sql } from 'drizzle-orm';
import type { z } from 'zod';
import type {
  createModelSchema,
  createVendorSchema,
  modelQuerySchema,
  updateModelSchema,
  updateVendorSchema,
  vendorQuerySchema,
} from '../contracts';
import { addMonths, DEFAULT_LIFESPAN_MONTHS } from '../model';
import { all, CONFIG_MANAGE } from './access';
import type { ContractService } from './contract-service';
import type { LicenseService } from './licenses';
import { assets, contracts, licenses, type ModelRow, models, type VendorRow, vendors } from './schema';
import { companyToday, itamConfig, pgCode, UNIQUE_VIOLATION } from './support';

type VendorQuery = z.output<typeof vendorQuerySchema>;
type ModelQuery = z.output<typeof modelQuerySchema>;
type CreateVendor = z.output<typeof createVendorSchema>;
type UpdateVendor = z.output<typeof updateVendorSchema>;
type CreateModel = z.output<typeof createModelSchema>;
type UpdateModel = z.output<typeof updateModelSchema>;

/**
 * Annualised recurring cost per vendor in `currency`: active contracts and licences (monthly × 12,
 * quarterly × 4, annual; one-time charges spread over their term).
 */
export function annualSpendSql(currency: string) {
  const contractCost = sql`coalesce(sum(case c.billing
      when 'monthly' then c.cost * 12 when 'quarterly' then c.cost * 4 when 'annual' then c.cost
      else case when c.start_date is not null and c.end_date is not null
        then c.cost * 12 / greatest(12, (c.end_date - c.start_date) / 30.4375) else 0 end end), 0)`;
  const licenseCost = sql`coalesce(sum(case l.billing
      when 'monthly' then l.cost * 12 when 'annual' then l.cost
      else case when l.start_date is not null and l.end_date is not null
        then l.cost * 12 / greatest(12, (l.end_date - l.start_date) / 30.4375) else 0 end end), 0)`;
  return {
    contracts: sql`(select ${contractCost} from ${contracts} c
      where c.vendor_id = ${vendors.id} and c.status in ('active', 'expiring') and c.currency = ${currency})`,
    licenses: sql`(select ${licenseCost} from ${licenses} l
      where l.vendor_id = ${vendors.id} and (l.end_date is null or l.end_date >= current_date) and l.currency = ${currency})`,
  };
}

export class CatalogService {
  constructor(
    private readonly ctx: ModuleContext,
    private readonly deps: { contracts: ContractService; licenses: LicenseService },
  ) {}

  /* ───────────── vendors ───────────── */

  private async vendorRows(
    where: ReturnType<typeof all>,
    q: { page: number; pageSize: number; sort?: string },
  ) {
    const cfg = await itamConfig(this.ctx);
    const spend = annualSpendSql(cfg.currency);
    const order =
      q.sort === 'spend' || q.sort === '-spend'
        ? sql`(${spend.contracts} + ${spend.licenses}) ${q.sort.startsWith('-') ? sql`desc` : sql`asc`}`
        : q.sort === '-name'
          ? sql`lower(${vendors.name}) desc`
          : sql`lower(${vendors.name}) asc`;
    const rows = await this.ctx.db
      .select({
        vendor: vendors,
        assets:
          sql<number>`(select count(*) from ${assets} a where a.vendor_id = ${vendors.id} and a.status <> 'disposed')`.mapWith(
            Number,
          ),
        licenses: sql<number>`(select count(*) from ${licenses} l where l.vendor_id = ${vendors.id})`.mapWith(
          Number,
        ),
        contracts:
          sql<number>`(select count(*) from ${contracts} c where c.vendor_id = ${vendors.id})`.mapWith(
            Number,
          ),
        spend: sql<number>`(${spend.contracts} + ${spend.licenses})`.mapWith(Number),
      })
      .from(vendors)
      .where(where)
      .orderBy(order)
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize);
    return rows.map((r) => this.toVendor(r.vendor, r));
  }

  private toVendor(v: VendorRow, c: { assets: number; licenses: number; contracts: number; spend: number }) {
    return {
      id: v.id,
      name: v.name,
      website: v.website,
      contactName: v.contactName,
      contactEmail: v.contactEmail,
      phone: v.phone,
      notes: v.notes,
      active: v.active,
      counts: { assets: c.assets, licenses: c.licenses, contracts: c.contracts },
      annualSpend: Math.round(c.spend * 100) / 100,
      updatedAt: v.updatedAt,
    };
  }

  async listVendors(q: VendorQuery) {
    const where = all(
      q.q
        ? or(ilike(vendors.name, likePattern(q.q)), ilike(vendors.contactName, likePattern(q.q)))
        : undefined,
      q.active !== undefined ? eq(vendors.active, q.active) : undefined,
    );
    const [items, [total]] = await Promise.all([
      this.vendorRows(where, q),
      this.ctx.db.select({ n: count() }).from(vendors).where(where),
    ]);
    return { items, total: total!.n, page: q.page, pageSize: q.pageSize };
  }

  async vendor(id: string) {
    const [item] = await this.vendorRows(eq(vendors.id, id), { page: 1, pageSize: 1 });
    if (!item) throw httpErrors.notFound('Vendor not found');
    const cfg = await itamConfig(this.ctx);
    const since = addMonths(companyToday(), -12);
    const [contractItems, licenseItems, [hardware]] = await Promise.all([
      this.deps.contracts.itemsWhere(eq(contracts.vendorId, id), 100),
      this.deps.licenses.itemsWhere(eq(licenses.vendorId, id), 100),
      this.ctx.db
        .select({ total: sql<number>`coalesce(sum(${assets.purchaseCost}), 0)`.mapWith(Number) })
        .from(assets)
        .where(
          and(eq(assets.vendorId, id), gte(assets.purchaseDate, since), eq(assets.currency, cfg.currency)),
        ),
    ]);
    return {
      ...item,
      currency: cfg.currency,
      contracts: contractItems,
      licenses: licenseItems,
      hardwareSpend12m: hardware?.total ?? 0,
    };
  }

  private nameTaken(err: unknown): never {
    if (pgCode(err) === UNIQUE_VIOLATION)
      throw httpErrors.conflict('A vendor with this name already exists', { field: 'name' });
    throw err;
  }

  async createVendor(input: CreateVendor, auth: AuthContext) {
    auth.require(CONFIG_MANAGE);
    try {
      return await this.ctx.transaction(async (tx) => {
        const [row] = await tx
          .insert(vendors)
          .values({
            name: input.name,
            website: input.website ?? null,
            contactName: input.contactName,
            contactEmail: input.contactEmail ?? null,
            phone: input.phone,
            notes: input.notes,
            active: input.active ?? true,
          })
          .returning();
        await this.ctx.audit.record(
          {
            action: 'itam.vendor.created',
            entityType: 'itam.vendor',
            entityId: row!.id,
            entityLabel: row!.name,
          },
          { tx },
        );
        return row!;
      });
    } catch (err) {
      this.nameTaken(err);
    }
  }

  async updateVendor(id: string, input: UpdateVendor, auth: AuthContext) {
    auth.require(CONFIG_MANAGE);
    const [before] = await this.ctx.db.select().from(vendors).where(eq(vendors.id, id));
    if (!before) throw httpErrors.notFound('Vendor not found');
    const patch: Partial<typeof vendors.$inferInsert> = {};
    for (const f of ['name', 'website', 'contactName', 'contactEmail', 'phone', 'notes', 'active'] as const) {
      const v = input[f];
      if (v !== undefined && v !== before[f]) (patch as Record<string, unknown>)[f] = v;
    }
    if (!Object.keys(patch).length) return before;
    try {
      return await this.ctx.transaction(async (tx) => {
        const [row] = await tx.update(vendors).set(patch).where(eq(vendors.id, id)).returning();
        await this.ctx.audit.record(
          {
            action: 'itam.vendor.updated',
            entityType: 'itam.vendor',
            entityId: id,
            entityLabel: row!.name,
            changes: this.ctx.audit.diff(
              before as unknown as Record<string, unknown>,
              patch as Record<string, unknown>,
            ),
          },
          { tx },
        );
        return row!;
      });
    } catch (err) {
      this.nameTaken(err);
    }
  }

  /* ───────────── models ───────────── */

  private toModel(m: ModelRow, assetCount: number) {
    return {
      id: m.id,
      category: m.category,
      manufacturer: m.manufacturer,
      name: m.name,
      partNumber: m.partNumber,
      lifespanMonths: m.lifespanMonths,
      active: m.active,
      assetCount,
      updatedAt: m.updatedAt,
    };
  }

  async listModels(q: ModelQuery) {
    const where = all(
      q.q
        ? or(
            ilike(models.name, likePattern(q.q)),
            ilike(models.manufacturer, likePattern(q.q)),
            ilike(models.partNumber, likePattern(q.q)),
          )
        : undefined,
      q.category ? eq(models.category, q.category) : undefined,
      q.active !== undefined ? eq(models.active, q.active) : undefined,
    );
    const order =
      q.sort === 'assets' || q.sort === '-assets'
        ? sql`asset_count ${q.sort.startsWith('-') ? sql`desc` : sql`asc`}`
        : q.sort === 'category'
          ? sql`${models.category} asc, lower(${models.manufacturer}) asc, lower(${models.name}) asc`
          : sql`lower(${models.manufacturer}) asc, lower(${models.name}) asc`;
    const [rows, [total]] = await Promise.all([
      this.ctx.db
        .select({
          model: models,
          assetCount:
            sql<number>`(select count(*) from ${assets} a where a.model_id = ${models.id} and a.status <> 'disposed')`
              .mapWith(Number)
              .as('asset_count'),
        })
        .from(models)
        .where(where)
        .orderBy(order)
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize),
      this.ctx.db.select({ n: count() }).from(models).where(where),
    ]);
    return {
      items: rows.map((r) => this.toModel(r.model, r.assetCount)),
      total: total!.n,
      page: q.page,
      pageSize: q.pageSize,
    };
  }

  async model(id: string) {
    const [row] = await this.ctx.db
      .select({
        model: models,
        assetCount:
          sql<number>`(select count(*) from ${assets} a where a.model_id = ${models.id} and a.status <> 'disposed')`.mapWith(
            Number,
          ),
      })
      .from(models)
      .where(eq(models.id, id));
    if (!row) throw httpErrors.notFound('Model not found');
    return this.toModel(row.model, row.assetCount);
  }

  private modelTaken(err: unknown): never {
    if (pgCode(err) === UNIQUE_VIOLATION)
      throw httpErrors.conflict('This manufacturer already has a model with this name', { field: 'name' });
    throw err;
  }

  async createModel(input: CreateModel, auth: AuthContext) {
    auth.require(CONFIG_MANAGE);
    try {
      return await this.ctx.transaction(async (tx) => {
        const [row] = await tx
          .insert(models)
          .values({
            category: input.category,
            manufacturer: input.manufacturer,
            name: input.name,
            partNumber: input.partNumber,
            lifespanMonths: input.lifespanMonths ?? DEFAULT_LIFESPAN_MONTHS[input.category],
            active: input.active ?? true,
          })
          .returning();
        await this.ctx.audit.record(
          {
            action: 'itam.model.created',
            entityType: 'itam.model',
            entityId: row!.id,
            entityLabel: `${row!.manufacturer} ${row!.name}`,
          },
          { tx },
        );
        return row!;
      });
    } catch (err) {
      this.modelTaken(err);
    }
  }

  async updateModel(id: string, input: UpdateModel, auth: AuthContext) {
    auth.require(CONFIG_MANAGE);
    const [before] = await this.ctx.db.select().from(models).where(eq(models.id, id));
    if (!before) throw httpErrors.notFound('Model not found');
    const patch: Partial<typeof models.$inferInsert> = {};
    for (const f of ['category', 'manufacturer', 'name', 'partNumber', 'lifespanMonths', 'active'] as const) {
      const v = input[f];
      if (v !== undefined && v !== before[f]) (patch as Record<string, unknown>)[f] = v;
    }
    if (!Object.keys(patch).length) return before;
    if (patch.category) {
      const [used] = await this.ctx.db
        .select({ n: count() })
        .from(assets)
        .where(
          and(
            eq(assets.modelId, id),
            inArray(assets.status, ['ordered', 'in_stock', 'deployed', 'in_repair', 'retired', 'lost']),
          ),
        );
      if (used!.n > 0)
        throw httpErrors.conflict('Assets of this model exist; its category cannot change', {
          field: 'category',
        });
    }
    try {
      return await this.ctx.transaction(async (tx) => {
        const [row] = await tx.update(models).set(patch).where(eq(models.id, id)).returning();
        await this.ctx.audit.record(
          {
            action: 'itam.model.updated',
            entityType: 'itam.model',
            entityId: id,
            entityLabel: `${row!.manufacturer} ${row!.name}`,
            changes: this.ctx.audit.diff(
              before as unknown as Record<string, unknown>,
              patch as Record<string, unknown>,
            ),
          },
          { tx },
        );
        return row!;
      });
    } catch (err) {
      this.modelTaken(err);
    }
  }

  /** Every active model, for pickers (small catalogue). */
  async pickerModels(db: Db = this.ctx.db) {
    return db
      .select()
      .from(models)
      .where(eq(models.active, true))
      .orderBy(asc(models.manufacturer), asc(models.name));
  }
}
