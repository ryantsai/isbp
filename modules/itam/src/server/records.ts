/**
 * Record resolvers (`itam.asset`, `itam.license`, `itam.contract`) for links and attachments, and the
 * command-palette search. Both apply the same visibility as the module's pages:
 * - assets: hardware readers within their reach, plus the caller's own devices (read-only), so
 *   "Report a problem" on My devices can link the incident to the laptop;
 * - licences and contracts: `itam.software.read` / `itam.contracts.read`.
 */
import type {
  AuthContext,
  ModuleContext,
  RecordResolver,
  RecordSummary,
  SearchHit,
  StatusTone,
} from '@isbp/sdk/server';
import { desc, eq, inArray, sql } from 'drizzle-orm';
import {
  type AssetStatus,
  type ComplianceState,
  type ContractStatus,
  formatAssetTag,
  formatContractRef,
  formatLicenseRef,
  isUuid,
} from '../model';
import {
  all,
  canManageContracts,
  canManageHardware,
  canManageSoftware,
  canReadContracts,
  canReadHardware,
  canReadSoftware,
  hardwareFilter,
  isOwnAsset,
  visibleAssetsFilter,
} from './access';
import { type AssetItemRow, assetHref, assetSearchCondition, scopeOf, selectAssetItems } from './assets';
import { contractHref, contractSearchCondition } from './contract-service';
import { licenseHref, licenseSearchCondition } from './licenses';
import { assets, contracts, licenses, vendors } from './schema';

export const ASSET_TONE: Record<AssetStatus, StatusTone> = {
  ordered: 'neutral',
  in_stock: 'info',
  deployed: 'success',
  in_repair: 'warning',
  retired: 'neutral',
  disposed: 'neutral',
  lost: 'danger',
};

export const COMPLIANCE_TONE: Record<ComplianceState, StatusTone> = {
  compliant: 'success',
  over_deployed: 'danger',
  under_used: 'info',
  expiring: 'warning',
  expired: 'danger',
};

export const CONTRACT_TONE: Record<ContractStatus, StatusTone> = {
  draft: 'neutral',
  active: 'success',
  expiring: 'warning',
  expired: 'danger',
  cancelled: 'neutral',
};

const uuids = (ids: readonly string[]) => [...new Set(ids.filter(isUuid))];

function assetSummary(r: AssetItemRow, auth: AuthContext, hardware: boolean): RecordSummary {
  const a = r.asset;
  const tag = formatAssetTag(a.number);
  const model = r.modelName ? `${r.modelManufacturer ?? ''} ${r.modelName}`.trim() : null;
  return {
    id: a.id,
    reference: tag,
    title: a.name,
    subtitle: [model, r.assigneeName].filter(Boolean).join(' · ') || null,
    status: { key: `itam.status.${a.status}`, tone: ASSET_TONE[a.status] },
    href: hardware ? assetHref(tag) : '/itam/mine',
    editable: hardware && canManageHardware(auth),
  };
}

const assetResolver: RecordResolver = {
  async resolve(ids, ctx, auth) {
    const wanted = uuids(ids);
    if (!wanted.length) return [];
    const rows = (await selectAssetItems(ctx.db).where(inArray(assets.id, wanted))) as AssetItemRow[];
    return rows.flatMap((r) => {
      const hardware = canReadHardware(auth, scopeOf(r));
      if (!hardware && !isOwnAsset(auth, r.asset)) return [];
      return [assetSummary(r, auth, hardware)];
    });
  },
  async search(query, ctx, auth, limit) {
    const rows = (await selectAssetItems(ctx.db)
      .where(all(visibleAssetsFilter(auth), query ? assetSearchCondition(query) : undefined))
      .orderBy(query ? sql`${assets.number}` : desc(assets.updatedAt))
      .limit(limit)) as AssetItemRow[];
    return rows.map((r) => assetSummary(r, auth, canReadHardware(auth, scopeOf(r))));
  },
};

async function licenseSummaries(
  ctx: ModuleContext,
  auth: AuthContext,
  where: ReturnType<typeof all>,
  limit: number,
) {
  const rows = await ctx.db
    .select({ license: licenses, vendorName: vendors.name })
    .from(licenses)
    .leftJoin(vendors, eq(vendors.id, licenses.vendorId))
    .where(where)
    .orderBy(licenses.product)
    .limit(limit);
  return rows.map(({ license: l, vendorName }): RecordSummary => {
    const reference = formatLicenseRef(l.number);
    return {
      id: l.id,
      reference,
      title: l.product,
      subtitle: l.publisher ?? vendorName ?? null,
      status: { key: `itam.compliance.${l.complianceState}`, tone: COMPLIANCE_TONE[l.complianceState] },
      href: licenseHref(reference),
      editable: canManageSoftware(auth),
    };
  });
}

const licenseResolver: RecordResolver = {
  async resolve(ids, ctx, auth) {
    const wanted = uuids(ids);
    if (!wanted.length || !canReadSoftware(auth)) return [];
    return licenseSummaries(ctx, auth, inArray(licenses.id, wanted), wanted.length);
  },
  async search(query, ctx, auth, limit) {
    if (!canReadSoftware(auth)) return [];
    return licenseSummaries(ctx, auth, query ? licenseSearchCondition(query) : undefined, limit);
  },
};

async function contractSummaries(
  ctx: ModuleContext,
  auth: AuthContext,
  where: ReturnType<typeof all>,
  limit: number,
) {
  const rows = await ctx.db
    .select({ contract: contracts, vendorName: vendors.name })
    .from(contracts)
    .leftJoin(vendors, eq(vendors.id, contracts.vendorId))
    .where(where)
    .orderBy(sql`${contracts.endDate} asc nulls last`)
    .limit(limit);
  return rows.map(({ contract: c, vendorName }): RecordSummary => {
    const reference = formatContractRef(c.number);
    return {
      id: c.id,
      reference,
      title: c.title,
      subtitle: [vendorName, c.endDate].filter(Boolean).join(' · ') || null,
      status: { key: `itam.contractStatus.${c.status}`, tone: CONTRACT_TONE[c.status] },
      href: contractHref(reference),
      editable: canManageContracts(auth),
    };
  });
}

const contractResolver: RecordResolver = {
  async resolve(ids, ctx, auth) {
    const wanted = uuids(ids);
    if (!wanted.length || !canReadContracts(auth)) return [];
    return contractSummaries(ctx, auth, inArray(contracts.id, wanted), wanted.length);
  },
  async search(query, ctx, auth, limit) {
    if (!canReadContracts(auth)) return [];
    return contractSummaries(ctx, auth, query ? contractSearchCondition(query) : undefined, limit);
  },
};

export const recordResolvers = { asset: assetResolver, license: licenseResolver, contract: contractResolver };

/** Command palette: assets (tag, serial, name), licences (product) and contracts (number, title). */
export async function searchItam(
  query: string,
  ctx: ModuleContext,
  auth: AuthContext,
  limit: number,
): Promise<SearchHit[]> {
  const q = query.trim();
  if (!q) return [];
  const hits: SearchHit[] = [];
  if (auth.permissions.hasAny('itam.hardware.read')) {
    const rows = (await selectAssetItems(ctx.db)
      .where(all(hardwareFilter(auth), assetSearchCondition(q)))
      .orderBy(assets.number)
      .limit(limit)) as AssetItemRow[];
    for (const r of rows) {
      const tag = formatAssetTag(r.asset.number);
      hits.push({
        id: r.asset.id,
        type: 'asset',
        title: `${tag} ${r.asset.name}`,
        subtitle: [
          r.modelName ? `${r.modelManufacturer ?? ''} ${r.modelName}`.trim() : null,
          r.asset.serialNumber,
          r.assigneeName,
        ]
          .filter(Boolean)
          .join(' · '),
        href: assetHref(tag),
        icon: 'laptop',
      });
    }
  }
  if (canReadSoftware(auth))
    for (const s of await licenseSummaries(ctx, auth, licenseSearchCondition(q), limit))
      hits.push({
        id: s.id,
        type: 'license',
        title: s.title,
        subtitle: s.reference,
        href: s.href,
        icon: 'key-round',
      });
  if (canReadContracts(auth))
    for (const s of await contractSummaries(ctx, auth, contractSearchCondition(q), limit))
      hits.push({
        id: s.id,
        type: 'contract',
        title: `${s.reference} ${s.title}`,
        subtitle: s.subtitle,
        href: s.href,
        icon: 'file-text',
      });
  return hits.slice(0, limit);
}
