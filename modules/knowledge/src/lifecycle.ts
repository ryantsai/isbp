import type { ArticleAction, ArticleAudience, ArticleStatus } from './contracts';

/**
 * Article lifecycle: `draft → in_review → published → retired`, plus `in_review → draft` (withdrawn or
 * rejected) and `retired → draft` (restored). Anything else is refused with `INVALID_TRANSITION`.
 */
export const TRANSITIONS: Readonly<Record<ArticleStatus, readonly ArticleStatus[]>> = {
  draft: ['in_review'],
  in_review: ['published', 'draft'],
  published: ['retired'],
  retired: ['draft'],
};

export function canTransition(from: ArticleStatus, to: ArticleStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** Target status of each user-facing action. */
export const ACTION_TARGET: Readonly<Record<ArticleAction, ArticleStatus>> = {
  submit: 'in_review',
  withdraw: 'draft',
  publish: 'published',
  retire: 'retired',
  restore: 'draft',
};

/** What the caller holds (global grants) — the inputs of every visibility and edit rule. */
export interface Viewer {
  userId: string | null;
  read: boolean;
  readInternal: boolean;
  write: boolean;
  publish: boolean;
  /**
   * A sync keeping the article in step with another system (Integrations Hub): it acts as the author of
   * the articles it writes (edits drafts, submits and withdraws them). Publishing, retiring, restoring and
   * editing what is live still need `publish`.
   */
  syncAuthor?: boolean;
}

export const PERMISSIONS = {
  read: 'knowledge.articles.read',
  readInternal: 'knowledge.articles.read-internal',
  write: 'knowledge.articles.write',
  publish: 'knowledge.articles.publish',
  manageCategories: 'knowledge.categories.manage',
} as const;

/** Index ACL / permission needed to read a published article of this audience. */
export const audiencePermission = (audience: ArticleAudience) =>
  audience === 'everyone' ? PERMISSIONS.read : PERMISSIONS.readInternal;

interface ArticleFacts {
  status: ArticleStatus;
  audience: ArticleAudience;
  ownerId: string | null;
  /** A review workflow is running. */
  reviewInstanceId: string | null;
}

const isOwner = (a: ArticleFacts, v: Viewer) =>
  Boolean(v.syncAuthor) || Boolean(v.userId && a.ownerId === v.userId);
const audienceOk = (a: ArticleFacts, v: Viewer) =>
  a.audience === 'everyone' ? v.read || v.readInternal : v.readInternal;

/** Published articles by audience; other statuses only for their author (with write) and publishers. */
export function canView(a: ArticleFacts, v: Viewer): boolean {
  if (v.publish) return true;
  if (isOwner(a, v) && (v.write || a.status === 'published')) return true;
  return a.status === 'published' && audienceOk(a, v);
}

/**
 * Authors edit their own drafts; publishers edit any draft, articles in review (unless an approval
 * workflow is deciding) and published articles (a new version goes live). Retired articles are
 * restored to a draft first.
 */
export function canEdit(a: ArticleFacts, v: Viewer): boolean {
  switch (a.status) {
    case 'draft':
      return v.publish || (v.write && isOwner(a, v));
    case 'in_review':
      return v.publish && !a.reviewInstanceId;
    case 'published':
      return v.publish;
    case 'retired':
      return false;
  }
}

/** Drafts can be deleted by their author; publishers can delete anything. */
export function canDelete(a: ArticleFacts, v: Viewer): boolean {
  return v.publish || (a.status === 'draft' && v.write && isOwner(a, v));
}

/** Lifecycle actions the viewer may trigger on the article now. */
export function availableActions(a: ArticleFacts, v: Viewer): ArticleAction[] {
  const author = v.publish || (v.write && isOwner(a, v));
  const out: ArticleAction[] = [];
  if (a.status === 'draft' && author) out.push('submit');
  if (a.status === 'in_review' && author) out.push('withdraw');
  if (a.status === 'in_review' && v.publish && !a.reviewInstanceId) out.push('publish');
  if (a.status === 'published' && v.publish) out.push('retire');
  if (a.status === 'retired' && v.publish) out.push('restore');
  return out;
}
