/**
 * Record resolvers (`isms.asset`, `isms.account`) for links, attachments and record fields, with the asset's approval
 * facts, and the command-palette search. Same visibility as the pages: register readers see assets; shared accounts
 * are seen by account readers, their custodian and their members.
 */
import {
  type AuthContext,
  likePattern,
  type ModuleContext,
  type RecordResolver,
  type RecordSummary,
  type SearchHit,
  type StatusTone,
} from '@isbp/sdk/server';
import { desc, ilike, inArray, or } from 'drizzle-orm';
import { type AssetStatus, formatRef, isUuid } from '../model';
import { canManageAccounts, canManageAssets, canReadAssets } from './access';
import { accountHref } from './accounts';
import { assetHref, assetSearchCondition, selectAssets, type AssetJoinRow } from './assets';
import { assets, type SharedAccountRow, sharedAccounts } from './schema';
import { services } from './services';

export const ASSET_TONE: Record<AssetStatus, StatusTone> = {
  active: 'success',
  missing: 'danger',
  disposed: 'neutral',
};

const uuids = (ids: readonly string[]) => [...new Set(ids.filter(isUuid))];

function assetSummary(r: AssetJoinRow, auth: AuthContext): RecordSummary {
  const a = r.asset;
  return {
    id: a.id,
    reference: a.number,
    title: a.name,
    subtitle: [r.cls.code, a.location].filter(Boolean).join(' · ') || null,
    status: { key: `isms.assetStatus.${a.status}`, tone: ASSET_TONE[a.status] },
    href: assetHref(a.number),
    editable: canManageAssets(auth),
  };
}

const assetResolver: RecordResolver = {
  /** Approval facts (`assetFactsSchema`), not permission-filtered: they route approvals and filter pickers. */
  async facts(ids, ctx) {
    return services(ctx).assets.facts(ids);
  },
  async resolve(ids, ctx, auth) {
    const wanted = uuids(ids);
    if (!wanted.length || !canReadAssets(auth)) return [];
    const rows = await selectAssets(ctx.db).where(inArray(assets.id, wanted));
    return rows.map((r) => assetSummary(r, auth));
  },
  async search(query, ctx, auth, limit) {
    if (!canReadAssets(auth)) return [];
    const rows = await selectAssets(ctx.db)
      .where(query ? assetSearchCondition(query) : undefined)
      .orderBy(query ? assets.number : desc(assets.updatedAt))
      .limit(limit);
    return rows.map((r) => assetSummary(r, auth));
  },
};

function accountSummary(a: SharedAccountRow, auth: AuthContext): RecordSummary {
  return {
    id: a.id,
    reference: formatRef('account', a.number),
    title: a.accountName,
    subtitle: a.targetSystem,
    status:
      a.status === 'active' && a.passwordDueSince
        ? { key: 'isms.accounts.passwordDue', tone: 'danger' }
        : { key: `isms.accountStatus.${a.status}`, tone: a.status === 'active' ? 'success' : 'neutral' },
    href: accountHref(formatRef('account', a.number)),
    editable: canManageAccounts(auth),
  };
}

const accountCondition = (q: string) =>
  or(ilike(sharedAccounts.accountName, likePattern(q)), ilike(sharedAccounts.targetSystem, likePattern(q)));

const accountResolver: RecordResolver = {
  async resolve(ids, ctx, auth) {
    const wanted = uuids(ids);
    if (!wanted.length) return [];
    const rows = await services(ctx).accounts.readableRows(wanted, auth, undefined, wanted.length);
    return rows.map((a) => accountSummary(a, auth));
  },
  async search(query, ctx, auth, limit) {
    const rows = await services(ctx).accounts.readableRows(
      [],
      auth,
      query ? accountCondition(query) : undefined,
      limit,
    );
    return rows.map((a) => accountSummary(a, auth));
  },
};

export const recordResolvers = { asset: assetResolver, account: accountResolver };

/** Command palette: assets by number or name, shared accounts by name or system. */
export async function searchIsms(
  query: string,
  ctx: ModuleContext,
  auth: AuthContext,
  limit: number,
): Promise<SearchHit[]> {
  if (!query.trim()) return [];
  const [found, accounts] = await Promise.all([
    assetResolver.search(query, ctx, auth, limit),
    accountResolver.search(query, ctx, auth, limit),
  ]);
  return [
    ...found.map((r) => ({
      id: r.id,
      type: 'asset',
      title: `${r.reference} ${r.title}`,
      subtitle: r.subtitle ?? null,
      href: r.href,
      icon: 'shield-check',
    })),
    ...accounts.map((r) => ({
      id: r.id,
      type: 'account',
      title: r.title,
      subtitle: r.subtitle ?? null,
      href: r.href,
      icon: 'key-round',
    })),
  ].slice(0, limit);
}
