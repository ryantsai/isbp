'use client';

import type { Page } from '@isbp/sdk';
import { useCan } from '@isbp/sdk/web';
import { UserAvatar } from '@isbp/ui/avatar';
import { Badge } from '@isbp/ui/badge';
import { Button } from '@isbp/ui/button';
import { DataTable, type DataTableColumn, useListState } from '@isbp/ui/data-table';
import { EmptyState } from '@isbp/ui/empty-state';
import { PageHeader } from '@isbp/ui/page-header';
import { useApiQuery } from '@isbp/ui/query';
import { RelativeTime } from '@isbp/ui/relative-time';
import { SearchInput } from '@isbp/ui/search-input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@isbp/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@isbp/ui/tabs';
import { FolderTreeIcon, LockIcon, NotebookPenIcon, PlusIcon } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo } from 'react';
import { localize } from '@isbp/sdk';
import { ARTICLE_LOCALES, type ArticleListItem, type ArticleQuery, type Category } from '../../contracts';
import {
  ArticleStats,
  ClassificationBadge,
  InternalBadge,
  LOCALE_LABEL,
  LocaleChip,
  StatusBadge,
  useCategoryName,
  useClassifications,
} from '../parts';

const TABS = ['mine', 'review', 'published', 'retired', 'due'] as const;
type Tab = (typeof TABS)[number];
const ALL = '__all';

/** What each tab asks the API for. */
const TAB_QUERY: Record<Tab, Partial<ArticleQuery>> = {
  mine: { status: 'draft', owner: 'me' },
  review: { status: 'in_review' },
  published: { status: 'published' },
  retired: { status: 'retired' },
  due: { reviewDue: 'true' },
};

/** Agent workspace: drafts, the review queue, published and retired articles, and overdue reviews. */
export default function ManagePage() {
  const t = useTranslations('knowledge.manage');
  const tk = useTranslations('knowledge');
  const locale = useLocale();
  const router = useRouter();
  const categoryName = useCategoryName();
  const classifications = useClassifications();
  const canWrite = useCan('knowledge.articles.write');
  const canManageCategories = useCan('knowledge.categories.manage');
  const canPublish = useCan('knowledge.articles.publish');
  const [state, set] = useListState({ pageSize: 25 });
  const tab = (TABS as readonly string[]).includes(String(state.tab)) ? (state.tab as Tab) : 'mine';
  const categories = useApiQuery<{ items: Category[] }>(canWrite ? '/knowledge/categories' : null);
  const { data, isLoading, isFetching } = useApiQuery<Page<ArticleListItem>>(
    canWrite ? '/knowledge/articles' : null,
    {
      ...TAB_QUERY[tab],
      // Authors are reminded about their own articles; editors see every overdue review.
      ...(tab === 'due' && !canPublish ? { owner: 'me' } : {}),
      q: state.q,
      category: state.category as string | undefined,
      audience: state.audience as string | undefined,
      locale: state.locale as string | undefined,
      classification: state.classification as string | undefined,
      sort: state.sort ?? (tab === 'due' ? 'reviewAt' : '-updatedAt'),
      page: state.page,
      pageSize: state.pageSize,
    },
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
            </Link>
          );
        },
      },
      {
        id: 'category',
        header: t('columns.category'),
        meta: { className: 'hidden lg:table-cell', headerClassName: 'hidden lg:table-cell' },
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
            {row.original.awaitingApproval && <Badge variant="outline">{t('awaitingApproval')}</Badge>}
          </span>
        ),
      },
      {
        id: 'locale',
        header: t('columns.language'),
        meta: { className: 'hidden md:table-cell', headerClassName: 'hidden md:table-cell' },
        cell: ({ row }) => <LocaleChip locale={row.original.locale} />,
      },
      {
        id: 'owner',
        header: t('columns.owner'),
        meta: { className: 'hidden xl:table-cell', headerClassName: 'hidden xl:table-cell' },
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
        meta: {
          sortKey: 'views',
          className: 'hidden sm:table-cell',
          headerClassName: 'hidden sm:table-cell',
        },
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
        meta: {
          sortKey: 'reviewAt',
          className: 'hidden lg:table-cell',
          headerClassName: 'hidden lg:table-cell',
        },
        cell: ({ row }) =>
          row.original.reviewAt ? (
            <span className="flex items-center gap-1.5 text-sm tabular-nums">
              {new Date(`${row.original.reviewAt}T00:00:00`).toLocaleDateString(locale)}
              {row.original.reviewDue && <Badge variant="warning">{t('due')}</Badge>}
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      {
        id: 'updated',
        header: t('columns.updated'),
        meta: {
          sortKey: 'updatedAt',
          className: 'hidden text-muted-foreground md:table-cell',
          headerClassName: 'hidden md:table-cell',
        },
        cell: ({ row }) => <RelativeTime date={row.original.updatedAt} />,
      },
    ],
    [t, categoryName, locale],
  );

  if (!canWrite)
    return (
      <>
        <PageHeader title={t('title')} />
        <EmptyState icon={<LockIcon />} title={t('noAccess')} />
      </>
    );

  const filter = (key: 'category' | 'audience' | 'locale' | 'classification', value: string) =>
    set({ [key]: value === ALL ? undefined : value });

  const toolbar = (
    <>
      <SearchInput value={state.q ?? ''} onChange={(q) => set({ q })} placeholder={t('search')} />
      <Select value={(state.category as string) ?? ALL} onValueChange={(v) => filter('category', v)}>
        <SelectTrigger size="sm" className="w-full sm:w-44" aria-label={t('columns.category')}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{t('allCategories')}</SelectItem>
          {(categories.data?.items ?? []).map((c) => (
            <SelectItem key={c.id} value={c.key}>
              {localize(c.name, locale) || c.key}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={(state.audience as string) ?? ALL} onValueChange={(v) => filter('audience', v)}>
        <SelectTrigger size="sm" className="w-full sm:w-40" aria-label={t('audienceFilter')}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{t('allAudiences')}</SelectItem>
          <SelectItem value="everyone">{tk('audience.everyone')}</SelectItem>
          <SelectItem value="agents">{tk('audience.agents')}</SelectItem>
        </SelectContent>
      </Select>
      <Select value={(state.locale as string) ?? ALL} onValueChange={(v) => filter('locale', v)}>
        <SelectTrigger size="sm" className="w-full sm:w-36" aria-label={t('columns.language')}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{t('allLanguages')}</SelectItem>
          {ARTICLE_LOCALES.map((l) => (
            <SelectItem key={l} value={l}>
              {LOCALE_LABEL[l]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={(state.classification as string) ?? ALL}
        onValueChange={(v) => filter('classification', v)}
      >
        <SelectTrigger size="sm" className="w-full sm:w-48" aria-label={t('classificationFilter')}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{t('allClassifications')}</SelectItem>
          <SelectItem value="none">{t('unclassified')}</SelectItem>
          {classifications.levels.map((l) => (
            <SelectItem key={l.key} value={l.key}>
              {classifications.label(l.key)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </>
  );

  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={
          <>
            {canManageCategories && (
              <Button variant="outline" asChild>
                <Link href="/knowledge/categories">
                  <FolderTreeIcon /> {tk('nav.categories')}
                </Link>
              </Button>
            )}
            <Button asChild>
              <Link href="/knowledge/new">
                <PlusIcon /> {tk('newArticle')}
              </Link>
            </Button>
          </>
        }
      />
      <Tabs value={tab} onValueChange={(v) => set({ tab: v === 'mine' ? undefined : v, sort: undefined })}>
        <TabsList aria-label={t('title')}>
          {TABS.map((k) => (
            <TabsTrigger key={k} value={k}>
              {t(`tabs.${k}`)}
            </TabsTrigger>
          ))}
        </TabsList>
        {TABS.map((k) => (
          <TabsContent key={k} value={k}>
            <DataTable
              label={t(`tabs.${k}`)}
              columns={columns}
              data={data?.items ?? []}
              total={data?.total ?? 0}
              page={state.page}
              pageSize={state.pageSize}
              sort={state.sort ?? (k === 'due' ? 'reviewAt' : '-updatedAt')}
              onSortChange={(sort) => set({ sort })}
              onPageChange={(page) => set({ page })}
              onPageSizeChange={(pageSize) => set({ pageSize })}
              loading={isLoading}
              fetching={isFetching}
              getRowId={(a) => a.id}
              onRowClick={(a) => router.push(a.href)}
              toolbar={toolbar}
              empty={
                <EmptyState
                  icon={<NotebookPenIcon />}
                  title={t(`empty.${k}`)}
                  action={
                    k === 'mine' ? (
                      <Button asChild size="sm">
                        <Link href="/knowledge/new">
                          <PlusIcon /> {tk('newArticle')}
                        </Link>
                      </Button>
                    ) : undefined
                  }
                />
              }
            />
          </TabsContent>
        ))}
      </Tabs>
    </>
  );
}
