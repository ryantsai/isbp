'use client';

import type { Page } from '@isbp/sdk';
import { Slot, useCan, usePlatform } from '@isbp/sdk/web';
import { Button } from '@isbp/ui/button';
import { useListState } from '@isbp/ui/data-table';
import { EmptyState, ErrorState } from '@isbp/ui/empty-state';
import { Kbd } from '@isbp/ui/kbd';
import { distance, duration, ease, FadeIn } from '@isbp/ui/motion';
import { PageHeader } from '@isbp/ui/page-header';
import { useApiQuery } from '@isbp/ui/query';
import { RelativeTime } from '@isbp/ui/relative-time';
import { Skeleton } from '@isbp/ui/skeleton';
import {
  ArrowLeftIcon,
  FlameIcon,
  HistoryIcon,
  LifeBuoyIcon,
  PlusIcon,
  SearchIcon,
  SearchXIcon,
  XIcon,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useEffectEvent, useId, useRef, useState } from 'react';
import { localize } from '@isbp/sdk';
import type { ArticleListItem, Category, KnowledgeHomeAssistSlotProps, SearchResult } from '../../contracts';
import {
  ArticleHit,
  ArticleStats,
  CategoryIcon,
  ClassificationBadge,
  InternalBadge,
  KnowledgeSections,
  LocaleChip,
  LOCALE_LANG,
  useCategoryName,
} from '../parts';

/** Moves focus between the search box and the result links with the arrow keys. */
function focusHit(
  list: HTMLElement | null,
  from: Element | null,
  step: 1 | -1,
  input: HTMLInputElement | null,
) {
  const hits = Array.from(list?.querySelectorAll<HTMLAnchorElement>('a[data-hit]') ?? []);
  if (!hits.length) return;
  const at = hits.indexOf(from as HTMLAnchorElement);
  const next = at + step;
  if (next < 0) input?.focus();
  else hits[Math.min(next, hits.length - 1)]?.focus();
}

function SearchPanel({ query, onQuery }: { query: string; onQuery: (q: string) => void }) {
  const t = useTranslations('knowledge.home');
  const locale = useLocale();
  const { enabledModules } = usePlatform();
  const canReport = useCan('itsm.tickets.create') && enabledModules.includes('itsm');
  const [draft, setDraft] = useState(query);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const hintId = useId();
  // The last query this box sent: URL changes that echo it must not overwrite what is being typed.
  const sent = useRef(query);
  const emit = useEffectEvent((q: string) => {
    sent.current = q;
    onQuery(q);
  });
  useEffect(() => {
    if (query !== sent.current) {
      sent.current = query;
      setDraft(query);
    }
  }, [query]);
  const clear = () => {
    setDraft('');
    sent.current = '';
    onQuery('');
  };
  useEffect(() => {
    if (draft === query) return;
    const timer = setTimeout(() => emit(draft), 220);
    return () => clearTimeout(timer);
  }, [draft, query]);

  const q = query.trim();
  const { data, isFetching, isLoading, error, refetch } = useApiQuery<SearchResult>(
    q.length >= 2 ? '/knowledge/search' : null,
    { q, limit: 8, locale },
  );
  const items = data?.items ?? [];

  return (
    <section aria-labelledby="kb-search-label" className="grid gap-3">
      <div className="relative overflow-hidden rounded-2xl border bg-gradient-to-br from-primary/10 via-card to-card p-4 shadow-xs sm:p-6">
        <label
          id="kb-search-label"
          htmlFor="kb-search"
          className="mb-3 block text-lg font-semibold tracking-tight"
        >
          {t('searchLabel')}
        </label>
        <div className="relative">
          <SearchIcon
            className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <input
            ref={inputRef}
            id="kb-search"
            type="search"
            autoComplete="off"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                focusHit(listRef.current, null, 1, inputRef.current);
              } else if (e.key === 'Escape' && draft) {
                e.preventDefault();
                clear();
              }
            }}
            placeholder={t('searchPlaceholder')}
            aria-describedby={hintId}
            aria-controls="kb-search-results"
            className="h-12 w-full rounded-xl border border-input bg-background pr-11 pl-12 text-base shadow-xs outline-none transition-[box-shadow,border-color] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 motion-reduce:transition-none [&::-webkit-search-cancel-button]:hidden"
          />
          {draft && (
            <button
              type="button"
              onClick={() => {
                clear();
                inputRef.current?.focus();
              }}
              aria-label={t('clear')}
              className="absolute top-1/2 right-3 -translate-y-1/2 rounded-md p-1 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <XIcon className="size-4" />
            </button>
          )}
        </div>
        <p id={hintId} className="mt-2 hidden text-xs text-muted-foreground sm:block">
          <Kbd>↓</Kbd> <Kbd>↑</Kbd> {t('searchHintArrows')} · <Kbd>Esc</Kbd> {t('searchHintEscape')}
        </p>
      </div>

      <div id="kb-search-results" aria-busy={isFetching}>
        <p className="sr-only" role="status" aria-live="polite">
          {q.length >= 2 && !isLoading && !error ? t('resultCount', { count: items.length }) : ''}
        </p>
        {q.length >= 2 &&
          (isLoading ? (
            <div className="grid gap-2 rounded-xl border bg-card p-2">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-16 rounded-lg" />
              ))}
            </div>
          ) : error && !data ? (
            <ErrorState
              error={error}
              onRetry={() => refetch()}
              title={t('searchFailed')}
              className="rounded-xl border"
            />
          ) : items.length ? (
            <FadeIn className="rounded-xl border bg-card p-1.5 shadow-xs">
              <ul ref={listRef} aria-label={t('results')} className="grid gap-0.5">
                {items.map((item) => (
                  <li key={item.id}>
                    <ArticleHit
                      item={item}
                      query={q}
                      onKeyDown={(e) => {
                        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                          e.preventDefault();
                          focusHit(
                            listRef.current,
                            e.currentTarget,
                            e.key === 'ArrowDown' ? 1 : -1,
                            inputRef.current,
                          );
                        } else if (e.key === 'Escape') inputRef.current?.focus();
                      }}
                    />
                  </li>
                ))}
              </ul>
              {data?.mode === 'keyword' && (
                <p className="px-3 pt-1 pb-2 text-xs text-muted-foreground">{t('keywordMode')}</p>
              )}
            </FadeIn>
          ) : (
            <EmptyState
              icon={<SearchXIcon />}
              title={t('noResults', { query: q })}
              description={canReport ? t('noResultsHint') : t('noResultsHintOther')}
              className="rounded-xl border border-dashed"
              action={
                canReport ? (
                  <Button asChild variant="outline">
                    <Link href="/itsm/report">
                      <LifeBuoyIcon /> {t('reportIssue')}
                    </Link>
                  </Button>
                ) : undefined
              }
            />
          ))}
      </div>
    </section>
  );
}

function CategoryGrid({ onPick }: { onPick: (key: string) => void }) {
  const t = useTranslations('knowledge.home');
  const locale = useLocale();
  const { data, isLoading, error, refetch } = useApiQuery<{ items: Category[] }>('/knowledge/categories');
  const items = (data?.items ?? []).filter((c) => !c.parentId);
  return (
    <section aria-labelledby="kb-categories" className="grid gap-3">
      <h2 id="kb-categories" className="text-lg font-semibold">
        {t('categories')}
      </h2>
      {isLoading ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-28 rounded-xl" />
          ))}
        </div>
      ) : error && !data ? (
        <ErrorState error={error} onRetry={() => refetch()} className="rounded-xl border" />
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {items.map((c) => (
            <li key={c.id} className="min-w-0">
              <Link
                href={`/knowledge?category=${encodeURIComponent(c.key)}`}
                onClick={(e) => {
                  if (e.metaKey || e.ctrlKey || e.shiftKey) return;
                  e.preventDefault();
                  onPick(c.key);
                }}
                className="group flex h-full min-w-0 flex-col gap-3 rounded-xl border bg-card p-4 shadow-xs outline-none transition-[translate,box-shadow,border-color] duration-(--motion-fast) ease-move hover:-translate-y-0.5 hover:border-ring/40 hover:shadow-md focus-visible:ring-[3px] focus-visible:ring-ring/50 motion-reduce:transition-none motion-reduce:hover:translate-y-0"
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="grid size-10 place-items-center rounded-xl bg-primary/10 text-primary [&_svg]:size-5">
                    <CategoryIcon name={c.icon} />
                  </span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {t('articleCount', { count: c.articleCount })}
                  </span>
                </span>
                <span className="grid min-w-0 gap-1">
                  <span className="truncate font-medium">{localize(c.name, locale) || c.key}</span>
                  {c.description && (
                    <span className="line-clamp-2 text-sm text-muted-foreground">
                      {localize(c.description, locale)}
                    </span>
                  )}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ArticleRow({ a, rank }: { a: ArticleListItem; rank?: number }) {
  const categoryName = useCategoryName();
  return (
    <li>
      <Link
        href={a.href}
        className="group flex min-w-0 items-start gap-3 px-4 py-3 outline-none transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 motion-reduce:transition-none"
      >
        {rank !== undefined ? (
          <span className="mt-0.5 w-5 shrink-0 text-right text-sm font-semibold text-muted-foreground tabular-nums">
            {rank}
          </span>
        ) : (
          <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground [&_svg]:size-3.5">
            <CategoryIcon name={a.category?.icon} />
          </span>
        )}
        <span className="grid min-w-0 flex-1 gap-1">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate font-medium group-hover:underline" lang={LOCALE_LANG[a.locale]}>
              {a.title}
            </span>
            {a.audience === 'agents' && <InternalBadge className="shrink-0" />}
            {a.classification && <ClassificationBadge value={a.classification} className="shrink-0" />}
          </span>
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            {a.category && <span>{categoryName(a.category)}</span>}
            <LocaleChip locale={a.locale} foreignOnly />
            <RelativeTime date={a.updatedAt} />
            <ArticleStats views={a.views} helpful={a.helpfulCount} notHelpful={a.notHelpfulCount} />
          </span>
        </span>
      </Link>
    </li>
  );
}

function ArticleList({
  id,
  title,
  icon,
  sort,
  ranked,
}: {
  id: string;
  title: string;
  icon: React.ReactNode;
  sort: string;
  ranked?: boolean;
}) {
  const t = useTranslations('knowledge.home');
  const { data, isLoading, error, refetch } = useApiQuery<Page<ArticleListItem>>('/knowledge/articles', {
    status: 'published',
    collapse: true,
    sort,
    pageSize: 6,
  });
  return (
    <section aria-labelledby={id} className="grid min-w-0 content-start gap-3">
      <h2
        id={id}
        className="flex items-center gap-2 text-lg font-semibold [&_svg]:size-4.5 [&_svg]:text-muted-foreground"
      >
        {icon}
        {title}
      </h2>
      <div className="overflow-hidden rounded-xl border bg-card">
        {isLoading ? (
          <div className="grid gap-px">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-16 rounded-none" />
            ))}
          </div>
        ) : error && !data ? (
          <ErrorState error={error} onRetry={() => refetch()} kind="list" compact className="px-4" />
        ) : data?.items.length ? (
          <ul className="divide-y">
            {data.items.map((a, i) => (
              <ArticleRow key={a.id} a={a} rank={ranked ? i + 1 : undefined} />
            ))}
          </ul>
        ) : (
          <EmptyState title={t('empty')} />
        )}
      </div>
    </section>
  );
}

function CategoryView({ categoryKey, onBack }: { categoryKey: string; onBack: () => void }) {
  const t = useTranslations('knowledge.home');
  const locale = useLocale();
  const [state, set] = useListState({ pageSize: 20 });
  const cats = useApiQuery<{ items: Category[] }>('/knowledge/categories');
  const category = cats.data?.items.find((c) => c.key === categoryKey);
  const { data, isLoading, error, refetch } = useApiQuery<Page<ArticleListItem>>('/knowledge/articles', {
    status: 'published',
    collapse: true,
    category: categoryKey,
    sort: '-views',
    page: state.page,
    pageSize: state.pageSize,
  });
  const pages = Math.max(1, Math.ceil((data?.total ?? 0) / state.pageSize));
  return (
    <section aria-labelledby="kb-category-title" className="grid gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onBack} className="-ml-2 text-muted-foreground">
          <ArrowLeftIcon /> {t('allCategories')}
        </Button>
      </div>
      <div className="flex min-w-0 items-start gap-3">
        <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary [&_svg]:size-5">
          <CategoryIcon name={category?.icon} />
        </span>
        <div className="min-w-0">
          <h2 id="kb-category-title" className="text-xl font-semibold tracking-tight wrap-break-word">
            {category ? localize(category.name, locale) : categoryKey}
          </h2>
          {category?.description && (
            <p className="text-sm text-muted-foreground">{localize(category.description, locale)}</p>
          )}
        </div>
      </div>
      <div className="overflow-hidden rounded-xl border bg-card">
        {isLoading ? (
          <div className="grid gap-px">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-16 rounded-none" />
            ))}
          </div>
        ) : error && !data ? (
          <ErrorState error={error} onRetry={() => refetch()} kind="list" />
        ) : data?.items.length ? (
          <ul className="divide-y">
            {data.items.map((a) => (
              <ArticleRow key={a.id} a={a} />
            ))}
          </ul>
        ) : (
          <EmptyState title={t('emptyCategory')} />
        )}
      </div>
      {pages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={state.page <= 1}
            onClick={() => set({ page: state.page - 1 })}
          >
            {t('previous')}
          </Button>
          <span className="text-sm text-muted-foreground tabular-nums">
            {t('pageOf', { page: state.page, pages })}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={state.page >= pages}
            onClick={() => set({ page: state.page + 1 })}
          >
            {t('next')}
          </Button>
        </div>
      )}
    </section>
  );
}

const ASSIST_PROPS: KnowledgeHomeAssistSlotProps = {};

/**
 * Self-service home: search, Helpdesk AI's assist slot, categories, popular and recent articles. Writers and category
 * managers reach Manage and Categories through the section tabs under the header.
 */
export default function HomePage() {
  const t = useTranslations('knowledge');
  const canWrite = useCan('knowledge.articles.write');
  const [state, set] = useListState();
  const query = (state.q as string | undefined) ?? '';
  const category = state.category as string | undefined;
  const searching = query.trim().length >= 2;

  return (
    <div>
      <PageHeader
        title={t('meta.name')}
        description={t('home.description')}
        actions={
          canWrite && (
            <Button asChild>
              <Link href="/knowledge/new">
                <PlusIcon /> {t('newArticle')}
              </Link>
            </Button>
          )
        }
      />
      <KnowledgeSections />
      {/* A reading page: narrower than lists, but on the same left edge as every other page. */}
      <div className="grid max-w-6xl gap-8">
        <SearchPanel query={query} onQuery={(q) => set({ q: q || undefined, category: undefined })} />

        {/* Switching between the topics and one topic fades the new view in; the first view doesn't animate. */}
        <AnimatePresence mode="wait" initial={false}>
          {!searching && (
            <motion.div
              key={category ?? 'home'}
              initial={{ opacity: 0, y: distance.content }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, transition: { duration: 0 } }}
              transition={{ duration: duration.base, ease: ease.enter }}
              className="grid gap-8"
            >
              {category ? (
                <CategoryView categoryKey={category} onBack={() => set({ category: undefined })} />
              ) : (
                <>
                  <Slot<KnowledgeHomeAssistSlotProps> name="knowledge.home.assist" props={ASSIST_PROPS} />
                  <CategoryGrid onPick={(key) => set({ category: key })} />
                  <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                    <ArticleList
                      id="kb-popular"
                      title={t('home.popular')}
                      icon={<FlameIcon aria-hidden />}
                      sort="-views"
                      ranked
                    />
                    <ArticleList
                      id="kb-recent"
                      title={t('home.recent')}
                      icon={<HistoryIcon aria-hidden />}
                      sort="-updatedAt"
                    />
                  </div>
                </>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
