/**
 * Handlers of the manifest's AI tools. They run as the caller (`auth`) through the same services and
 * visibility rules as the routes, and return compact, model-friendly JSON with web links.
 */
import { users } from '@isbp/db/schema';
import { type AiToolHandler, httpErrors, likePattern, type ModuleContext } from '@isbp/sdk/server';
import { and, eq, gte, ilike, inArray, lte, or, sql } from 'drizzle-orm';
import type { z } from 'zod';
import type {
  aiExpiringContractsInput,
  aiFindAssetsInput,
  aiGetAssetInput,
  aiLicenseComplianceInput,
} from '../contracts';
import { addDays, isUuid, parseRef } from '../model';
import { canReadHardware } from './access';
import {
  type AssetItem,
  type AssetItemRow,
  assetHref,
  scopeOf,
  selectAssetItems,
  toAssetItem,
} from './assets';
import { contractHref } from './contract-service';
import { licenseHref } from './licenses';
import { assets, contracts, licenses } from './schema';
import { services } from './services';
import { companyToday, itamConfig } from './support';

const compact = (a: AssetItem) => ({
  id: a.id,
  tag: a.tag,
  name: a.name,
  category: a.category,
  status: a.status,
  model: a.model ? `${a.model.manufacturer} ${a.model.name}` : null,
  serialNumber: a.serialNumber,
  assignee: a.assignee?.displayName ?? null,
  location: a.location,
  warrantyEnd: a.warrantyEnd,
  warrantyState: a.warrantyState,
  href: assetHref(a.tag),
});

async function personId(ctx: ModuleContext, value: string): Promise<string | null> {
  const v = value.trim();
  if (isUuid(v)) return v.toLowerCase();
  const [u] = await ctx.db
    .select({ id: users.id })
    .from(users)
    .where(
      or(eq(sql`lower(${users.email})`, v.toLowerCase()), eq(sql`lower(${users.username})`, v.toLowerCase())),
    )
    .limit(1);
  return u?.id ?? null;
}

const findAssets: AiToolHandler = async (input, ctx, auth) => {
  const q = input as z.output<typeof aiFindAssetsInput>;
  const owner = q.assignee ? await personId(ctx, q.assignee) : undefined;
  if (q.assignee && !owner) return { items: [], total: 0, note: 'No person matches the assignee' };
  const page = await services(ctx).assets.list(
    {
      page: 1,
      pageSize: q.limit,
      q: q.query,
      status: q.status ? [q.status] : undefined,
      assignee: owner ?? undefined,
    },
    auth,
  );
  return { items: page.items.map(compact), total: page.total };
};

const getAsset: AiToolHandler = async (input, ctx, auth) => {
  const q = input as z.output<typeof aiGetAssetInput>;
  const today = companyToday();
  const cfg = await itamConfig(ctx);
  let where;
  if (q.id) where = eq(assets.id, q.id);
  else if (q.serial) where = eq(sql`lower(${assets.serialNumber})`, q.serial.toLowerCase());
  else {
    const parsed = parseRef('asset', q.reference!);
    if (!parsed) throw httpErrors.notFound('Asset not found');
    where = 'id' in parsed ? eq(assets.id, parsed.id) : eq(assets.number, parsed.number);
  }
  const [row] = (await selectAssetItems(ctx.db).where(where)) as AssetItemRow[];
  if (!row || !canReadHardware(auth, scopeOf(row))) throw httpErrors.notFound('Asset not found');
  const svc = services(ctx).assets;
  const detail = await svc.detailOf(row, auth);
  const history = await svc.events(row.asset.id, { page: 1, pageSize: 10 }, auth);
  return {
    ...compact(toAssetItem(row, today, cfg.warrantyDays)),
    vendor: detail.vendor?.name ?? null,
    purchaseDate: detail.purchaseDate,
    purchaseCost: detail.purchaseCost,
    currency: detail.currency,
    bookValue: detail.depreciation?.bookValue ?? null,
    department: detail.department?.name ?? null,
    ci: detail.ciDetail ? { reference: detail.ciDetail.reference, name: detail.ciDetail.name } : null,
    notes: detail.notes,
    history: history.items.map((e) => ({
      kind: e.kind,
      from: e.fromValue,
      to: e.toValue,
      person: e.user?.displayName ?? null,
      by: e.actor?.displayName ?? null,
      note: e.note,
      at: e.createdAt.toISOString(),
    })),
  };
};

const myAssets: AiToolHandler = async (_input, ctx, auth) => {
  const me = auth.user?.id ?? auth.principal.onBehalfOf?.id;
  if (!me) return { devices: [], software: [] };
  const [devices, software] = await Promise.all([
    services(ctx).assets.mine(me),
    services(ctx).licenses.heldBy(me),
  ]);
  return {
    devices: devices.map((d) => ({ ...compact(d), since: d.since?.toISOString() ?? null })),
    software: software.map((s) => ({
      product: s.license.product,
      reference: s.license.reference,
      type: s.license.licenseType,
      device: s.device?.tag ?? null,
      endDate: s.endDate,
    })),
  };
};

const licenseCompliance: AiToolHandler = async (input, ctx) => {
  const q = input as z.output<typeof aiLicenseComplianceInput>;
  const items = await services(ctx).licenses.itemsWhere(
    q.product ? ilike(licenses.product, likePattern(q.product)) : undefined,
    50,
    sql`case ${licenses.complianceState} when 'over_deployed' then 0 when 'expired' then 1 when 'expiring' then 2 when 'under_used' then 3 else 4 end, ${licenses.product}`,
  );
  return {
    items: items.map((l) => ({
      reference: l.reference,
      product: l.product,
      publisher: l.publisher,
      type: l.licenseType,
      quantity: l.quantity,
      used: l.used,
      assigned: l.assigned,
      unlicensedInstalls: l.unlicensed,
      state: l.complianceState,
      endDate: l.endDate,
      href: licenseHref(l.reference),
    })),
  };
};

const expiringContracts: AiToolHandler = async (input, ctx) => {
  const q = input as z.output<typeof aiExpiringContractsInput>;
  const today = companyToday();
  const items = await services(ctx).contracts.itemsWhere(
    and(
      inArray(contracts.status, ['active', 'expiring']),
      gte(contracts.endDate, today),
      lte(contracts.endDate, addDays(today, q.days)),
    ),
    50,
    sql`${contracts.endDate} asc`,
  );
  return {
    today,
    items: items.map((c) => ({
      reference: c.reference,
      title: c.title,
      vendor: c.vendor?.name ?? null,
      kind: c.kind,
      endDate: c.endDate,
      daysToEnd: c.daysToEnd,
      noticeDate: c.noticeDate,
      autoRenew: c.autoRenew,
      annualCost: c.annualCost,
      currency: c.currency,
      owner: c.owner?.displayName ?? null,
      href: contractHref(c.reference),
    })),
  };
};

export const aiTools: Record<string, AiToolHandler> = {
  'itam.find_assets': findAssets,
  'itam.get_asset': getAsset,
  'itam.my_assets': myAssets,
  'itam.license_compliance': licenseCompliance,
  'itam.expiring_contracts': expiringContracts,
};
