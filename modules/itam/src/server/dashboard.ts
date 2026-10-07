/**
 * The overview dashboard and the "Asset attention" counts, aggregated in SQL. Hardware figures follow
 * the caller's hardware reach (department readers see their departments); software and contract figures
 * appear only for people who may read them. Money totals are in the default currency.
 */
import type { AuthContext, ModuleContext } from '@isbp/sdk/server';
import { and, asc, eq, gte, inArray, isNotNull, lte, ne, notInArray, sql } from 'drizzle-orm';
import { addDays, addMonths, type AssetCategory, type AssetStatus, DEFAULT_LIFESPAN_MONTHS } from '../model';
import { all, canReadContracts, canReadSoftware, hardwareFilter } from './access';
import { type AssetItemRow, selectAssetItems, toAssetItem } from './assets';
import { annualSpendSql } from './catalog';
import type { ContractService } from './contract-service';
import type { LicenseService } from './licenses';
import { assets, contracts, licenses, models, vendors } from './schema';
import { companyToday, itamConfig } from './support';

const lifespanCase = sql.join(
  [
    sql`case ${assets.category}`,
    // Constants from the model (not user input), inlined so Postgres types the CASE as integer.
    ...Object.entries(DEFAULT_LIFESPAN_MONTHS).map(([category, months]) =>
      sql.raw(`when '${category}' then ${Number(months)}`),
    ),
    sql`else 48 end`,
  ],
  sql` `,
);

/** Months since purchase, as Postgres `age()` counts them (whole months, like the model's `monthsBetween`). */
const ageMonths = (today: string) =>
  sql`(extract(year from age(${today}::date, ${assets.purchaseDate})) * 12 + extract(month from age(${today}::date, ${assets.purchaseDate})))`;

/** Straight-line book value per asset (0 once fully depreciated). */
export const bookValueSql = (today: string) =>
  sql`(${assets.purchaseCost} * greatest(0, 1 - ${ageMonths(today)} / coalesce(${models.lifespanMonths}, ${lifespanCase})::numeric))`;

/** Assets that still count in the estate's value (not gone). */
const IN_ESTATE: AssetStatus[] = ['ordered', 'in_stock', 'deployed', 'in_repair', 'retired'];

export class DashboardService {
  constructor(
    private readonly ctx: ModuleContext,
    private readonly deps: { contracts: ContractService; licenses: LicenseService },
  ) {}

  async overview(auth: AuthContext) {
    const db = this.ctx.db;
    const today = companyToday();
    const cfg = await itamConfig(this.ctx);
    const scope = hardwareFilter(auth);
    const software = canReadSoftware(auth);
    const contractsReadable = canReadContracts(auth);
    const in30 = addDays(today, 30);
    const in90 = addDays(today, 90);
    const warrantyWindow = addDays(today, cfg.warrantyDays);
    const live = notInArray(assets.status, ['retired', 'disposed', 'lost']);

    const [counts, [money], [warranties], [other]] = await Promise.all([
      db
        .select({
          category: assets.category,
          status: assets.status,
          n: sql<number>`count(*)`.mapWith(Number),
        })
        .from(assets)
        .where(scope)
        .groupBy(assets.category, assets.status),
      db
        .select({
          purchaseCost: sql<number>`coalesce(sum(${assets.purchaseCost}), 0)`.mapWith(Number),
          // Book value needs the purchase date (no date: nothing to depreciate from, counted as 0).
          bookValue:
            sql<number>`coalesce(sum(${bookValueSql(today)}) filter (where ${assets.purchaseDate} is not null), 0)`.mapWith(
              Number,
            ),
        })
        .from(assets)
        .leftJoin(models, eq(models.id, assets.modelId))
        .where(
          all(
            scope,
            inArray(assets.status, IN_ESTATE),
            eq(assets.currency, cfg.currency),
            isNotNull(assets.purchaseCost),
          ),
        ),
      db
        .select({
          expiring30:
            sql<number>`count(*) filter (where ${assets.warrantyEnd} between ${today}::date and ${in30}::date)`.mapWith(
              Number,
            ),
          expiring90:
            sql<number>`count(*) filter (where ${assets.warrantyEnd} between ${today}::date and ${in90}::date)`.mapWith(
              Number,
            ),
          expired:
            sql<number>`count(*) filter (where ${assets.warrantyEnd} < ${today}::date and ${assets.status} = 'deployed')`.mapWith(
              Number,
            ),
        })
        .from(assets)
        .where(all(scope, live)),
      db
        .select({ n: sql<number>`count(*)`.mapWith(Number) })
        .from(assets)
        .where(
          all(
            scope,
            inArray(assets.status, IN_ESTATE),
            ne(assets.currency, cfg.currency),
            isNotNull(assets.purchaseCost),
          ),
        ),
    ]);

    const byStatus: Record<string, number> = {};
    const byCategoryMap = new Map<AssetCategory, { total: number; byStatus: Record<string, number> }>();
    let total = 0;
    for (const r of counts) {
      byStatus[r.status] = (byStatus[r.status] ?? 0) + r.n;
      const c = byCategoryMap.get(r.category) ?? { total: 0, byStatus: {} };
      c.total += r.n;
      c.byStatus[r.status] = (c.byStatus[r.status] ?? 0) + r.n;
      byCategoryMap.set(r.category, c);
      total += r.n;
    }

    const attentionWarranties = (await selectAssetItems(db)
      .where(
        all(
          scope,
          eq(assets.status, 'deployed'),
          gte(assets.warrantyEnd, today),
          lte(assets.warrantyEnd, warrantyWindow),
        ),
      )
      .orderBy(asc(assets.warrantyEnd), asc(assets.number))
      .limit(6)) as AssetItemRow[];

    const softwareBlock = software
      ? await db
          .select({ state: licenses.complianceState, n: sql<number>`count(*)`.mapWith(Number) })
          .from(licenses)
          .groupBy(licenses.complianceState)
      : null;

    const contractBlock = contractsReadable
      ? (
          await db
            .select({
              active:
                sql<number>`count(*) filter (where ${contracts.status} in ('active', 'expiring'))`.mapWith(
                  Number,
                ),
              renewing90:
                sql<number>`count(*) filter (where ${contracts.status} in ('active', 'expiring') and ${contracts.endDate} between ${today}::date and ${in90}::date)`.mapWith(
                  Number,
                ),
              renewing90AnnualCost:
                sql<number>`coalesce(sum(case ${contracts.billing} when 'monthly' then ${contracts.cost} * 12 when 'quarterly' then ${contracts.cost} * 4 when 'annual' then ${contracts.cost} else 0 end) filter (where ${contracts.status} in ('active', 'expiring') and ${contracts.endDate} between ${today}::date and ${in90}::date and ${contracts.currency} = ${cfg.currency}), 0)`.mapWith(
                  Number,
                ),
            })
            .from(contracts)
        )[0]!
      : null;

    let spendByVendor: { vendor: { id: string; name: string }; amount: number }[] | null = null;
    if (contractsReadable) {
      const spend = annualSpendSql(cfg.currency);
      const since = addMonths(today, -12);
      const hardware = sql`(select coalesce(sum(a.purchase_cost), 0) from ${assets} a
        where a.vendor_id = ${vendors.id} and a.purchase_date >= ${since}::date and a.currency = ${cfg.currency})`;
      const amount = sql<number>`(${spend.contracts} + ${software ? spend.licenses : sql`0`} + ${hardware})`;
      const rows = await db
        .select({ id: vendors.id, name: vendors.name, amount: amount.mapWith(Number) })
        .from(vendors)
        .orderBy(sql`3 desc`, asc(vendors.name))
        .limit(10);
      spendByVendor = rows
        .filter((r) => r.amount > 0)
        .map((r) => ({ vendor: { id: r.id, name: r.name }, amount: Math.round(r.amount * 100) / 100 }));
    }

    const [attentionContracts, attentionLicenses] = await Promise.all([
      contractsReadable
        ? this.deps.contracts.itemsWhere(
            and(
              inArray(contracts.status, ['active', 'expiring']),
              gte(contracts.endDate, today),
              lte(contracts.endDate, in90),
            ),
            6,
          )
        : Promise.resolve(null),
      software
        ? this.deps.licenses.itemsWhere(
            inArray(licenses.complianceState, ['over_deployed', 'expired']),
            6,
            sql`case ${licenses.complianceState} when 'over_deployed' then 0 else 1 end, ${licenses.product}`,
          )
        : Promise.resolve(null),
    ]);

    const byState = Object.fromEntries((softwareBlock ?? []).map((r) => [r.state, r.n]));
    return {
      currency: cfg.currency,
      today,
      assets: {
        total,
        byStatus,
        byCategory: [...byCategoryMap.entries()]
          .map(([category, v]) => ({ category, ...v }))
          .sort((a, b) => b.total - a.total),
        purchaseCost: Math.round((money?.purchaseCost ?? 0) * 100) / 100,
        bookValue: Math.round((money?.bookValue ?? 0) * 100) / 100,
      },
      warranties: {
        expiring30: warranties?.expiring30 ?? 0,
        expiring90: warranties?.expiring90 ?? 0,
        expired: warranties?.expired ?? 0,
      },
      software: softwareBlock
        ? {
            total: softwareBlock.reduce((n, r) => n + r.n, 0),
            byState,
            nonCompliant: (byState.over_deployed ?? 0) + (byState.expired ?? 0),
          }
        : null,
      contracts: contractBlock,
      spendByVendor,
      attention: {
        warranties: attentionWarranties.map((r) => toAssetItem(r, today, cfg.warrantyDays)),
        contracts: attentionContracts,
        licenses: attentionLicenses,
      },
      otherCurrencies: other?.n ?? 0,
    };
  }

  /** "Asset attention" on the home dashboard: what an asset manager should look at today. */
  async attention(auth: AuthContext) {
    const db = this.ctx.db;
    const today = companyToday();
    const cfg = await itamConfig(this.ctx);
    const hardware = auth.permissions.hasAny('itam.hardware.read');
    const [lic, con, war] = await Promise.all([
      canReadSoftware(auth)
        ? db
            .select({ n: sql<number>`count(*)`.mapWith(Number) })
            .from(licenses)
            .where(inArray(licenses.complianceState, ['over_deployed', 'expired']))
        : Promise.resolve(null),
      canReadContracts(auth)
        ? db
            .select({ n: sql<number>`count(*)`.mapWith(Number) })
            .from(contracts)
            .where(
              and(
                inArray(contracts.status, ['active', 'expiring']),
                gte(contracts.endDate, today),
                lte(contracts.endDate, addDays(today, 30)),
              ),
            )
        : Promise.resolve(null),
      hardware
        ? db
            .select({ n: sql<number>`count(*)`.mapWith(Number) })
            .from(assets)
            .where(
              all(
                hardwareFilter(auth),
                eq(assets.status, 'deployed'),
                gte(assets.warrantyEnd, today),
                lte(assets.warrantyEnd, addDays(today, cfg.warrantyDays)),
              ),
            )
        : Promise.resolve(null),
    ]);
    return {
      nonCompliantLicenses: lic?.[0]?.n ?? null,
      contractsRenewing30: con?.[0]?.n ?? null,
      warrantiesExpiring30: war?.[0]?.n ?? null,
    };
  }
}
