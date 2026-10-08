/**
 * Who may see and change what. Routes, record resolvers, the AI tool, global search, the process action and the
 * `viewer` blocks of the DTOs all use these functions, so the UI and the API can't disagree.
 *
 * - The register is read with `isms.assets.read` and changed with `isms.assets.manage` (global).
 * - Stocktakes are read by register readers and stocktake managers; each item is recorded by the asset's manager
 *   (the person, or a member of the managing group) or a stocktake manager. Signing off needs
 *   `isms.stocktakes.signoff`.
 * - Shared accounts are read with `isms.accounts.read`; the custodian and the members see their own accounts (with
 *   `isms.self.use`). The custodian records password changes and the yearly review; `isms.accounts.manage` does
 *   everything.
 * - Account reviews are read with `isms.reviews.read`; the reviewer sees and decides their own reviews (with
 *   `isms.self.use`). Signing off needs `isms.reviews.signoff`.
 */
import type { AuthContext } from '@isbp/sdk/server';

export const P = {
  assetsRead: 'isms.assets.read',
  assetsManage: 'isms.assets.manage',
  configManage: 'isms.config.manage',
  stocktakesManage: 'isms.stocktakes.manage',
  stocktakesSignoff: 'isms.stocktakes.signoff',
  accountsRead: 'isms.accounts.read',
  accountsManage: 'isms.accounts.manage',
  reviewsRead: 'isms.reviews.read',
  reviewsManage: 'isms.reviews.manage',
  reviewsSignoff: 'isms.reviews.signoff',
  self: 'isms.self.use',
} as const;

const me = (auth: AuthContext) => auth.user?.id ?? null;
const self = (auth: AuthContext) => auth.can(P.self);

/* register */
export const canReadAssets = (auth: AuthContext) => auth.can(P.assetsRead);
export const canManageAssets = (auth: AuthContext) => auth.can(P.assetsManage);
export const canConfigure = (auth: AuthContext) => auth.can(P.configManage);

/* stocktakes */
export const canManageStocktakes = (auth: AuthContext) => auth.can(P.stocktakesManage);
export const canSignOffStocktakes = (auth: AuthContext) => auth.can(P.stocktakesSignoff);
/** Sees every stocktake (others see the ones with items assigned to them). */
export const canReadAllStocktakes = (auth: AuthContext) =>
  canReadAssets(auth) || canManageStocktakes(auth) || canSignOffStocktakes(auth);

/** The item is the caller's to record: they manage the asset, or are in its managing group. */
export function isItemAssignee(
  auth: AuthContext,
  item: { assigneeId: string | null; assigneeGroupId: string | null },
  myGroupIds: readonly string[],
): boolean {
  const id = me(auth);
  if (!id || !self(auth)) return false;
  return (
    item.assigneeId === id || (item.assigneeGroupId !== null && myGroupIds.includes(item.assigneeGroupId))
  );
}

export const canRecordItem = (
  auth: AuthContext,
  item: { assigneeId: string | null; assigneeGroupId: string | null },
  myGroupIds: readonly string[],
) => canManageStocktakes(auth) || isItemAssignee(auth, item, myGroupIds);

/* shared accounts */
export const canReadAllAccounts = (auth: AuthContext) =>
  auth.can(P.accountsRead) || auth.can(P.accountsManage);
export const canManageAccounts = (auth: AuthContext) => auth.can(P.accountsManage);
export const isCustodian = (auth: AuthContext, a: { custodianId: string | null }) =>
  Boolean(me(auth) && self(auth) && a.custodianId === me(auth));

export function canReadAccount(
  auth: AuthContext,
  a: { custodianId: string | null },
  memberIds: readonly string[],
) {
  if (canReadAllAccounts(auth) || isCustodian(auth, a)) return true;
  const id = me(auth);
  return Boolean(id && self(auth) && memberIds.includes(id));
}

/** Password changes and the yearly review: the custodian, or an account manager. */
export const canTendAccount = (auth: AuthContext, a: { custodianId: string | null }) =>
  canManageAccounts(auth) || isCustodian(auth, a);

/* account reviews */
export const canReadAllReviews = (auth: AuthContext) =>
  auth.can(P.reviewsRead) || auth.can(P.reviewsManage) || auth.can(P.reviewsSignoff);
export const canManageReviews = (auth: AuthContext) => auth.can(P.reviewsManage);
export const canSignOffReviews = (auth: AuthContext) => auth.can(P.reviewsSignoff);
export const isReviewer = (auth: AuthContext, r: { reviewerId: string | null }) =>
  Boolean(me(auth) && self(auth) && r.reviewerId === me(auth));
export const canReadReview = (auth: AuthContext, r: { reviewerId: string | null }) =>
  canReadAllReviews(auth) || isReviewer(auth, r);
export const canDecideReview = (auth: AuthContext, r: { reviewerId: string | null }) =>
  canManageReviews(auth) || isReviewer(auth, r);
