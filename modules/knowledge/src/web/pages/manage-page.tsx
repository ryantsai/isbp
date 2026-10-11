'use client';

import { Badge } from '@astryxdesign/core/Badge';
import { Button } from '@astryxdesign/core/Button';
import { Icon } from '@astryxdesign/core/Icon';
import { VStack } from '@astryxdesign/core/Layout';
import { Selector } from '@astryxdesign/core/Selector';
import { Tab, TabList } from '@astryxdesign/core/TabList';
import type { Page } from '@isbp/sdk';
import { localize } from '@isbp/sdk';
import { useCan } from '@isbp/sdk/web';
import { UserAvatar } from '@isbp/ui/avatar';
import { DataTable, type DataTableColumn, DataTableSummary, useListState } from '@isbp/ui/data-table';
import { EmptyState } from '@isbp/ui/empty-state';
import { type FilterDef, FilterBar } from '@isbp/ui/filter-bar';
import { AnimatedNumber } from '@isbp/ui/motion';
import { PageHeader } from '@isbp/ui/page-header';
import { useApiQuery } from '@isbp/ui/query';
import { RelativeTime } from '@isbp/ui/relative-time';
import { SearchInput } from '@isbp/ui/search-input';
import { Skeleton } from '@isbp/ui/skeleton';
import { LockIcon, NotebookPenIcon, PlusIcon } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { useId, useMemo, useState } from 'react';
import {
  ARTICLE_LOCALES,
  type ArticleCounts,
  type ArticleListItem,
  type ArticleQuery,
  type Category,
} from '../../contracts';
import {
  ArticleStats,
  ClassificationBadge,
  InternalBadge,
  KnowledgeSections,
  LOCALE_LABEL,
  LocaleChip,
  StatusBadge,
  useCategoryName,
  useClassifications,
} from '../parts';

/** Work first: what waits for a decision, then the author's drafts, then the library and its upkeep. */
const TABS = ['review', 'mine', 'published', 'due', 'retired'] as const;
type Tab = (typeof TABS)[number];
const ALL = '__all';
const FILTERS = ['category', 'audience', 'locale', 'classification'] as const;
type Filter = (typeof FILTERS)[number];

/** What each tab asks the API for. */
const TAB_QUERY: Record<Tab, Partial<ArticleQuery>> = {
  mine: { status: 'draft', owner: 'me' },
  review: { status: 'in_review' },
  published: { status: 'published' },
  retired: { status: 'retired' },
  due: { reviewDue: 'true' },
};

/**
 * The tab to open without one in the URL: the review queue when it has articles for an editor, else the author's
 * drafts when there are some, else the published library (never an empty "My drafts").
 */
function defaultTab(counts: ArticleCounts | undefined, canPublish: boolean): Tab {
  if (!counts) return 'published';
  if (canPublish && counts.review > 0) return 'review';
  if (counts.mine > 0) return 'mine';
  return 'published';
}

/** Agent workspace: the review queue, drafts, published and retired articles, and overdue reviews. */
export default function ManagePage() {
  const t = useTranslations('knowledge.manage');
  const tk = useTranslations('knowledge');
  const locale = useLocale();
  const format = useFormatter();
  const router = useRouter();
  const panelId = useId();
  const categoryName = useCategoryName();
  const classifications = useClassifications();
  const canWrite = useCan('knowledge.articles.write');
  const canPublish = useCan('knowledge.articles.publish');
  const [state, set] = useListState({ pageSize: 25 });
  const filters = {
    q: state.q,
    category: state.category as string | undefined,
    audience: state.audience as string | undefined,
    locale: state.locale as string | undefined,
    classification: state.classification as string | undefined,
  };
  const categories = useApiQuery<{ items: Category[] }>(canWrite ? '/knowledge/categories' : null);
  const counts = useApiQuery<ArticleCounts>(canWrite ? '/knowledge/articles/counts' : null, filters);

  // Without a tab in the URL, pick one once the counts are known, and keep it while the page is open (a refetch
  // that empties the review queue doesn't switch the table under the person).
  const [fallback, setFallback] = useState<Tab | null>(null);
  if (fallback === null && (counts.data || counts.error)) setFallback(defaultTab(counts.data, canPublish));
  const requested = (TABS as readonly string[]).includes(String(state.tab)) ? (state.tab as Tab) : null;
  const tab = requested ?? fallback;

  const { data, isLoading, isFetching, error, refetch } = useApiQuery<Page<ArticleListItem>>(
    canWrite && tab ? '/knowledge/articles' : null,
    tab
      ? {
          ...TAB_QUERY[tab],
          // Authors are reminded about their own articles; editors see every overdue review.
          ...(tab === 'due' && !canPublish ? { owner: 'me' } : {}),
          ...filters,
          sort: state.sort ?? (tab === 'due' ? 'reviewAt' : '-updatedAt'),
          page: state.page,
          pageSize: state.pageSize,
        }
      : undefined,
  );

  const columns = useMemo<DataTableColumn<ArticleListItem>[]>(
    () => [
      {
        id: 'article',
        header: t('columns.article'),
        meta: { sortKey: 'title', className: 'max-w-0 w-full' },
        cell: ({ row }) => {
          const a = row.original;
          return (
            <Link
              href={a.href}
              onClick={(e) => e.stopPropagation()}
              className="grid min-w-0 gap-0.5 rounded-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <span className="flex min-w-0 items-center gap-2">
                <span className="truncate font-medium hover:underline">{a.title}</span>
                {a.audience === 'agents' && <InternalBadge className="shrink-0" />}
                {a.classification && <ClassificationBadge value={a.classification} className="shrink-0" />}
              </span>
              <span className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
                <span className="shrink-0 font-mono">{a.reference}</span>
                <span className="truncate">{a.summary}</span>
              </span>
              <DataTableSummary>
                <LocaleChip locale={a.locale} foreignOnly />
                {a.category && <span>{categoryName(a.category)}</span>}
                <RelativeTime date={a.updatedAt} />
              </DataTableSummary>
            </Link>
          );
        },
      },
      {
        id: 'category',
        header: t('columns.category'),
        meta: { priority: 3 },
        cell: ({ row }) =>
          row.original.category ? (
            <span className="text-sm">{categoryName(row.original.category)}</span>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      {
        id: 'status',
        header: t('columns.status'),
        cell: ({ row }) => (
          <span className="flex flex-wrap items-center gap-1.5">
            <StatusBadge status={row.original.status} />
            {row.original.awaitingApproval && <Badge variant="neutral" label={t('awaitingApproval')} />}
          </span>
        ),
      },
      {
        id: 'locale',
        header: t('columns.language'),
        meta: { priority: 2 },
        cell: ({ row }) => <LocaleChip locale={row.original.locale} />,
      },
      {
        id: 'owner',
        header: t('columns.owner'),
        meta: { priority: 3 },
        cell: ({ row }) =>
          row.original.owner ? (
            <span className="flex min-w-0 items-center gap-2">
              <UserAvatar
                name={row.original.owner.displayName}
                src={row.original.owner.avatarUrl}
                className="size-6 text-[10px]"
              />
              <span className="truncate text-sm">{row.original.owner.displayName}</span>
            </span>
          ) : (
            <span className="text-sm text-muted-foreground">{t('noOwner')}</span>
          ),
      },
      {
        id: 'views',
        header: t('columns.views'),
        meta: { sortKey: 'views', priority: 2 },
        cell: ({ row }) => (
          <ArticleStats
            views={row.original.views}
            helpful={row.original.helpfulCount}
            notHelpful={row.original.notHelpfulCount}
          />
        ),
      },
      {
        id: 'review',
        header: t('columns.review'),
        meta: { sortKey: 'reviewAt', priority: 3 },
        cell: ({ row }) =>
          row.original.reviewAt ? (
            <span className="flex items-center gap-1.5 text-sm tabular-nums">
              {/* A calendar date: shown as written, whatever the reader's time zone. */}
              {format.dateTime(new Date(`${row.original.reviewAt}T00:00:00Z`), {
                dateStyle: 'medium',
                timeZone: 'UTC',
              })}
              {row.original.reviewDue && <Badge variant="warning" label={t('due')} />}
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      {
        id: 'updated',
        header: t('columns.updated'),
        meta: { sortKey: 'updatedAt', priority: 2, className: 'text-muted-foreground' },
        cell: ({ row }) => <RelativeTime date={row.original.updatedAt} />,
      },
    ],
    [t, categoryName, format],
  );

  if (!canWrite)
    return (
      <>
        <PageHeader title={t('title')} />
        <EmptyState icon={<LockIcon />} title={t('noAccess')} />
      </>
    );

  const filter = (key: Filter, value: string) => set({ [key]: value === ALL ? undefined : value });
  const filtered = FILTERS.some((k) => state[k] !== undefined) || Boolean(state.q);
  const clearAll = () =>
    set({
      q: undefined,
      category: undefined,
      audience: undefined,
      locale: undefined,
      classification: undefined,
    });
  const categoryItems = categories.data?.items ?? [];
  const pickedCategory = categoryItems.find((c) => c.key === state.category);

  const filterDefs: FilterDef[] = [
    {
      id: 'category',
      label: t('columns.category'),
      primary: true,
      value: state.category
        ? pickedCategory
          ? localize(pickedCategory.name, locale) || pickedCategory.key
          : String(state.category)
        : undefined,
      onClear: () => set({ category: undefined }),
      control: (
        <Selector
          label={t('columns.category')}
          isLabelHidden
          size="sm"
          width={176}
          hasSearch={categoryItems.length > 8}
          value={(state.category as string) ?? ALL}
          onChange={(v) => filter('category', v)}
          options={[
            { value: ALL, label: t('allCategories') },
            ...categoryItems.map((c) => ({ value: c.key, label: localize(c.name, locale) || c.key })),
          ]}
        />
      ),
    },
    {
      id: 'audience',
      label: t('audienceFilter'),
      primary: true,
      value:
        state.audience === 'everyone' || state.audience === 'agents'
          ? tk(`audience.${state.audience}`)
          : undefined,
      onClear: () => set({ audience: undefined }),
      control: (
        <Selector
          label={t('audienceFilter')}
          isLabelHidden
          size="sm"
          width={176}
          value={(state.audience as string) ?? ALL}
          onChange={(v) => filter('audience', v)}
          options={[
            { value: ALL, label: t('allAudiences') },
            { value: 'everyone', label: tk('audience.everyone') },
            { value: 'agents', label: tk('audience.agents') },
          ]}
        />
      ),
    },
    {
      id: 'locale',
      label: t('columns.language'),
      value: (ARTICLE_LOCALES as readonly string[]).includes(String(state.locale))
        ? LOCALE_LABEL[state.locale as (typeof ARTICLE_LOCALES)[number]]
        : undefined,
      onClear: () => set({ locale: undefined }),
      control: (
        <Selector
          label={t('columns.language')}
          isLabelHidden
          size="sm"
          width="100%"
          value={(state.locale as string) ?? ALL}
          onChange={(v) => filter('locale', v)}
          options={[
            { value: ALL, label: t('allLanguages') },
            ...ARTICLE_LOCALES.map((l) => ({ value: l, label: LOCALE_LABEL[l] })),
          ]}
        />
      ),
    },
    {
      id: 'classification',
      label: t('classificationFilter'),
      value: state.classification
        ? state.classification === 'none'
          ? t('unclassified')
          : classifications.label(String(state.classification))
        : undefined,
      onClear: () => set({ classification: undefined }),
      control: (
        <Selector
          label={t('classificationFilter')}
          isLabelHidden
          size="sm"
          width="100%"
          value={(state.classification as string) ?? ALL}
          onChange={(v) => filter('classification', v)}
          options={[
            { value: ALL, label: t('allClassifications') },
            { value: 'none', label: t('unclassified') },
            ...classifications.levels.map((l) => ({ value: l.key, label: classifications.label(l.key) })),
          ]}
        />
      ),
    },
  ];

  const toolbar = (
    <FilterBar
      search={<SearchInput value={state.q ?? ''} onChange={(q) => set({ q })} placeholder={t('search')} />}
      filters={filterDefs}
      onClearAll={clearAll}
    />
  );

  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={
          <Button
            label={tk('newArticle')}
            variant="primary"
            icon={<Icon icon={PlusIcon} />}
            href="/knowledge/new"
          />
        }
      />
      <KnowledgeSections />
      {tab ? (
        <VStack gap={3} className="min-w-0">
          {/* The views are the same list under different filters: they share one panel. */}
          <TabList
            role="tablist"
            aria-label={t('tabsLabel')}
            value={tab}
            onChange={(v) => set({ tab: v, sort: undefined })}
            hasDivider
          >
            {TABS.map((k) => (
              <Tab
                key={k}
                value={k}
                label={t(`tabs.${k}`)}
                panelId={panelId}
                endContent={
                  counts.data ? (
                    <Badge variant="neutral" label={<AnimatedNumber value={counts.data[k]} />} />
                  ) : undefined
                }
              />
            ))}
          </TabList>
          <div role="tabpanel" id={panelId} aria-label={t(`tabs.${tab}`)} className="min-w-0">
            <DataTable
              label={t(`tabs.${tab}`)}
              columns={columns}
              data={data?.items ?? []}
              total={data?.total ?? 0}
              page={state.page}
              pageSize={state.pageSize}
              sort={state.sort ?? (tab === 'due' ? 'reviewAt' : '-updatedAt')}
              onSortChange={(sort) => set({ sort })}
              onPageChange={(page) => set({ page })}
              onPageSizeChange={(pageSize) => set({ pageSize })}
              loading={isLoading}
              fetching={isFetching}
              error={error}
              onRetry={() => refetch()}
              getRowId={(a) => a.id}
              onRowClick={(a) => router.push(a.href)}
              toolbar={toolbar}
              empty={
                filtered ? (
                  <EmptyState variant="filtered" onClearFilters={clearAll} />
                ) : (
                  <EmptyState
                    icon={<NotebookPenIcon />}
                    title={t(`empty.${tab}`)}
                    action={
                      tab === 'mine' ? (
                        <Button
                          label={tk('newArticle')}
                          variant="primary"
                          size="sm"
                          icon={<Icon icon={PlusIcon} />}
                          href="/knowledge/new"
                        />
                      ) : undefined
                    }
                  />
                )
              }
            />
          </div>
        </VStack>
      ) : (
        <div className="grid gap-4" aria-busy="true">
          <Skeleton className="h-9 w-full max-w-xl" />
          <Skeleton className="h-80 rounded-xl" />
        </div>
      )}
    </>
  );
}
