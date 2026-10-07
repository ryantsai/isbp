import { describe, expect, it } from 'vitest';
import { ARTICLE_STATUSES, type ArticleStatus } from '../src/contracts';
import {
  availableActions,
  canDelete,
  canEdit,
  canTransition,
  canView,
  TRANSITIONS,
  type Viewer,
} from '../src/lifecycle';
import { keywordTerms, rankDocuments, termCoverage } from '../src/rank';

const reader: Viewer = { userId: 'r', read: true, readInternal: false, write: false, publish: false };
const agent: Viewer = { userId: 'a', read: true, readInternal: true, write: true, publish: false };
const editor: Viewer = { userId: 'e', read: true, readInternal: true, write: true, publish: true };
const article = (status: ArticleStatus, extra: Partial<Parameters<typeof canView>[0]> = {}) => ({
  status,
  audience: 'everyone' as const,
  ownerId: 'a',
  reviewInstanceId: null,
  ...extra,
});

describe('status transitions', () => {
  it('allows exactly draft → in_review → published → retired, plus the two ways back to draft', () => {
    const allowed = ARTICLE_STATUSES.flatMap((from) =>
      ARTICLE_STATUSES.filter((to) => canTransition(from, to)).map((to) => `${from}→${to}`),
    );
    expect(allowed.sort()).toEqual(
      [
        'draft→in_review',
        'in_review→draft',
        'in_review→published',
        'published→retired',
        'retired→draft',
      ].sort(),
    );
  });

  it('never allows staying in place or skipping review', () => {
    for (const s of ARTICLE_STATUSES) expect(canTransition(s, s)).toBe(false);
    expect(canTransition('draft', 'published')).toBe(false);
    expect(canTransition('retired', 'published')).toBe(false);
    expect(canTransition('published', 'draft')).toBe(false);
  });

  it('offers only actions whose transition exists', () => {
    for (const status of ARTICLE_STATUSES)
      for (const v of [reader, agent, editor])
        for (const action of availableActions(article(status), v)) {
          const target = {
            submit: 'in_review',
            withdraw: 'draft',
            publish: 'published',
            retire: 'retired',
            restore: 'draft',
          }[action] as ArticleStatus;
          expect(TRANSITIONS[status]).toContain(target);
        }
  });
});

describe('who may do what', () => {
  it('hides drafts from readers and other authors; agents-only articles from readers', () => {
    expect(canView(article('draft'), reader)).toBe(false);
    expect(canView(article('draft'), { ...agent, userId: 'someone-else' })).toBe(false);
    expect(canView(article('draft'), agent)).toBe(true);
    expect(canView(article('draft'), editor)).toBe(true);
    expect(canView(article('published'), reader)).toBe(true);
    expect(canView(article('published', { audience: 'agents' }), reader)).toBe(false);
    expect(canView(article('published', { audience: 'agents' }), agent)).toBe(true);
    expect(canView(article('retired'), reader)).toBe(false);
  });

  it('authors edit their drafts; editors edit published articles; nobody edits while a workflow decides', () => {
    expect(canEdit(article('draft'), agent)).toBe(true);
    expect(canEdit(article('draft'), { ...agent, userId: 'x' })).toBe(false);
    expect(canEdit(article('published'), agent)).toBe(false);
    expect(canEdit(article('published'), editor)).toBe(true);
    expect(canEdit(article('in_review'), editor)).toBe(true);
    expect(canEdit(article('in_review', { reviewInstanceId: 'wf' }), editor)).toBe(false);
    expect(canEdit(article('retired'), editor)).toBe(false);
  });

  it('authors delete only drafts; editors delete anything', () => {
    expect(canDelete(article('draft'), agent)).toBe(true);
    expect(canDelete(article('published'), agent)).toBe(false);
    expect(canDelete(article('published'), editor)).toBe(true);
    expect(canDelete(article('draft'), reader)).toBe(false);
  });

  it('lets only publishers publish, retire and restore', () => {
    expect(availableActions(article('draft'), agent)).toEqual(['submit']);
    expect(availableActions(article('in_review'), agent)).toEqual(['withdraw']);
    expect(availableActions(article('in_review'), editor)).toEqual(['withdraw', 'publish']);
    expect(availableActions(article('in_review', { reviewInstanceId: 'wf' }), editor)).toEqual(['withdraw']);
    expect(availableActions(article('published'), agent)).toEqual([]);
    expect(availableActions(article('published'), editor)).toEqual(['retire']);
    expect(availableActions(article('retired'), editor)).toEqual(['restore']);
    expect(availableActions(article('published'), reader)).toEqual([]);
  });

  it('lets a sync act as the author of the articles it writes, but never publish without the permission', () => {
    const sync: Viewer = {
      userId: null,
      read: true,
      readInternal: true,
      write: true,
      publish: false,
      syncAuthor: true,
    };
    const someoneElses = article('draft', { ownerId: 'x' });
    expect(canView(someoneElses, sync)).toBe(true);
    expect(canEdit(someoneElses, sync)).toBe(true);
    expect(availableActions(article('draft', { ownerId: null }), sync)).toEqual(['submit']);
    expect(availableActions(article('in_review'), sync)).toEqual(['withdraw']);
    expect(canEdit(article('published'), sync)).toBe(false);
    expect(availableActions(article('published'), sync)).toEqual([]);
    expect(availableActions(article('retired'), sync)).toEqual([]);
    const publishing = { ...sync, publish: true };
    expect(availableActions(article('in_review', { reviewInstanceId: 'wf' }), publishing)).toEqual([
      'withdraw',
    ]);
    expect(availableActions(article('in_review'), publishing)).toEqual(['withdraw', 'publish']);
  });
});

describe('search ranking', () => {
  it('extracts Latin words and CJK bigrams', () => {
    expect(keywordTerms('VPN keeps dropping')).toEqual(['vpn', 'keeps', 'dropping']);
    expect(keywordTerms('VPN 斷線了')).toEqual(['vpn', '斷線', '線了']);
  });

  it('weights title matches above body matches', () => {
    const terms = keywordTerms('printer queue');
    const doc = { summary: '', tags: [], body: '' };
    expect(termCoverage(terms, { ...doc, title: 'Clear a printer queue' })).toBe(1);
    expect(termCoverage(terms, { ...doc, title: 'Other', body: 'printer queue' })).toBe(0.5);
  });

  it('ranks per article, so a short exact match beats a long loosely related one', () => {
    const ranked = rankDocuments('zephyr gateway failover', [
      {
        id: 'long',
        title: 'Install software',
        summary: '',
        body: 'licenses '.repeat(500),
        tags: [],
        similarity: 0.11,
      },
      {
        id: 'exact',
        title: 'Zephyr gateway failover runbook',
        summary: '',
        body: '',
        tags: [],
        similarity: 0.62,
      },
    ]);
    expect(ranked.map((r) => r.id)).toEqual(['exact', 'long']);
    expect(ranked[0]!.score).toBe(1);
  });
});
