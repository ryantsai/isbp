'use client';

import type { CatalogItem, FormAssignment, MyRequest, PortalEntry } from '@isbp/contracts';
import { localize, type Page } from '@isbp/sdk';
import { Slot } from '@isbp/sdk/web';
import { UserAvatar } from '@isbp/ui/avatar';
import { useListState } from '@isbp/ui/data-table';
import { EmptyState } from '@isbp/ui/empty-state';
import { IconTile } from '@isbp/ui/icon-tile';
import { Stagger, StaggerItem } from '@isbp/ui/motion';
import { PageHeader } from '@isbp/ui/page-header';
import { RelativeTime } from '@isbp/ui/relative-time';
import { SearchInput } from '@isbp/ui/search-input';
import { Skeleton } from '@isbp/ui/skeleton';
import {
  ArrowRightIcon,
  BriefcaseBusinessIcon,
  ChevronRightIcon,
  InboxIcon,
  KeyRoundIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo } from 'react';
import { useApiQuery } from '@/lib/api';
import { NavIcon } from '../nav-icon';
import { fulfilmentOf, RequestStatus, requestHref } from './request-status';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Icon } from '@astryxdesign/core/Icon';
import { VStack } from '@astryxdesign/core/Layout';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { Text } from '@astryxdesign/core/Text';

/** The groups of "What do you need?", in the order they appear. */
const GROUPS = ['help', 'equipment', 'access', 'other'] as const;
type Group = (typeof GROUPS)[number];

/** Portal cards by the module that offers them (modules without a card here land in "Other"). */
const ENTRY_GROUP: Record<string, Group> = {
  itsm: 'help',
  knowledge: 'help',
  itam: 'equipment',
  dbaccess: 'access',
};

/** Form categories (keys from the form builder; anything else is "Other"). */
const CATEGORY_GROUP: Record<string, Group> = {
  hardware: 'equipment',
  software: 'equipment',
  access: 'access',
  security: 'help',
};

/**
 * The group of a form's category. Categories are typed in the form builder, so "Hardware", " hardware " and "HARDWARE"
 * are the same category: match them case-insensitively, ignoring surrounding spaces.
 */
function categoryGroup(category: string | null | undefined): Group {
  return CATEGORY_GROUP[(category ?? '').trim().toLowerCase()] ?? 'other';
}

function CatalogCard({
  href,
  icon,
  title,
  description,
  featured,
}: {
  href: string;
  icon: React.ReactNode;
  title: string;
  description?: string | null;
  featured?: boolean;
}) {
  // A real link (not `ClickableCard`, whose link is visually hidden): people, tests and assistive technology all reach it.
  return (
    <Link
      href={href}
      className={
        'group relative flex h-full min-w-0 flex-col gap-3 overflow-hidden rounded-xl border bg-card p-4 shadow-xs outline-none transition-all hover:-translate-y-0.5 hover:border-ring/40 hover:shadow-md focus-visible:ring-[3px] focus-visible:ring-ring/50 motion-reduce:hover:translate-y-0' +
        (featured ? ' bg-gradient-to-br from-primary/10 via-card to-card' : '')
      }
    >
      <IconTile aria-hidden>{icon}</IconTile>
      <VStack gap={1}>
        <Text weight="medium">{title}</Text>
        {description && (
          <Text color="secondary" maxLines={2}>
            {description}
          </Text>
        )}
      </VStack>
      <span className="mt-auto flex items-center justify-end">
        <Icon icon={ArrowRightIcon} color="secondary" />
      </span>
    </Link>
  );
}

function RequestRow({ r }: { r: MyRequest }) {
  const t = useTranslations('requests');
  const locale = useLocale();
  const waiting = r.workflow?.status === 'running' ? r.workflow : null;
  const names = waiting?.pendingWith.map((p) => p.displayName) ?? [];
  // A form request being fulfilled shows the fulfilment's reference next to its own.
  const fulfilling = fulfilmentOf(r);
  return (
    <li>
      <Link
        href={requestHref(r)}
        className="group flex items-center gap-3 px-4 py-3 outline-none transition-colors hover:bg-muted/50 focus-visible:bg-muted/50"
      >
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground [&_svg]:size-4">
          {r.kind === 'access' ? <KeyRoundIcon /> : <NavIcon name={r.icon} />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-medium [overflow-wrap:anywhere] group-hover:underline">
            {localize(r.title, locale)}
          </span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <span className="font-mono">{r.reference}</span>
            {fulfilling && (
              <>
                <span aria-hidden>·</span>
                <span className="font-mono">{fulfilling.reference}</span>
              </>
            )}
            <span aria-hidden>·</span>
            <RelativeTime date={r.updatedAt} />
            <span aria-hidden>·</span>
            <RequestStatus r={r} />
            {waiting && waiting.currentSteps.length > 0 && (
              <span className="flex min-w-0 basis-full items-center gap-1.5 sm:basis-auto">
                <span aria-hidden className="hidden sm:inline">
                  ·
                </span>
                {names.length > 0 && (
                  <span className="flex -space-x-1.5" aria-hidden>
                    {waiting.pendingWith.slice(0, 3).map((p) => (
                      <UserAvatar
                        key={p.id}
                        name={p.displayName}
                        src={p.avatarUrl}
                        className="size-5 text-[8px] ring-2 ring-background"
                      />
                    ))}
                  </span>
                )}
                <span className="min-w-0 [overflow-wrap:anywhere]">
                  {t('home.waitingNamed', {
                    names: names.length > 1 ? `${names[0]} +${names.length - 1}` : (names[0] ?? ''),
                    step: waiting.currentSteps.map((s) => localize(s.name, locale)).join(', '),
                  })}
                </span>
              </span>
            )}
          </span>
        </span>
        <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      </Link>
    </li>
  );
}

/** "To do" lives on My work; this is the way there, shown only while something is waiting. */
function TodoLink() {
  const t = useTranslations('requests.home');
  const open = useApiQuery<Page<FormAssignment>>('/me/form-assignments', { status: 'open', pageSize: 1 });
  const count = open.data?.total ?? 0;
  if (!count) return null;
  return (
    <Banner
      status="info"
      icon={<Icon icon={BriefcaseBusinessIcon} />}
      title={t('todoLink', { count })}
      endContent={
        <Button
          label={t('todoOpen')}
          variant="secondary"
          size="sm"
          endContent={<Icon icon={ArrowRightIcon} />}
          href="/my-work"
        />
      }
      collapsible={false}
    />
  );
}

/** The self-service portal: follow what you asked for, then ask for more. */
export function RequestsHome() {
  const t = useTranslations('requests');
  const tg = useTranslations('requests.groups');
  const locale = useLocale();
  const root = useTranslations();
  const [state, set] = useListState({ pageSize: 5 });
  const scope = (state.show as string | undefined) ?? 'open';
  const catalog = useApiQuery<{ items: CatalogItem[] }>('/forms/catalog');
  const entries = useApiQuery<{ items: PortalEntry[] }>('/portal/entries');
  const mine = useApiQuery<Page<MyRequest>>('/me/requests', {
    status: scope === 'all' ? undefined : scope,
    page: state.page,
    pageSize: state.pageSize,
  });
  const pages = mine.data ? Math.ceil(mine.data.total / mine.data.pageSize) : 1;

  // "What do you need?": portal cards and forms, grouped; a search box once there are more than eight of them.
  const query = (state.q as string | undefined)?.trim().toLowerCase() ?? '';
  const cards = useMemo(() => {
    const out: {
      group: Group;
      key: string;
      href: string;
      icon: React.ReactNode;
      title: string;
      description: string | null;
      text: string;
    }[] = [];
    for (const e of entries.data?.items ?? []) {
      const title = root.has(e.label) ? root(e.label) : e.label;
      const description = e.description && root.has(e.description) ? root(e.description) : null;
      out.push({
        group: ENTRY_GROUP[e.moduleId] ?? 'other',
        key: `${e.moduleId}-${e.id}`,
        href: e.href,
        icon: <NavIcon name={e.icon} />,
        title,
        description,
        text: `${title} ${description ?? ''}`,
      });
    }
    for (const f of catalog.data?.items ?? []) {
      const title = localize(f.name, locale);
      const description = localize(f.description, locale);
      out.push({
        group: categoryGroup(f.category),
        key: `form-${f.id}`,
        href: `/requests/forms/${f.key}`,
        icon: <NavIcon name={f.icon} />,
        title,
        description,
        text: `${title} ${description ?? ''}`,
      });
    }
    return out;
  }, [entries.data, catalog.data, locale, root]);
  const total = cards.length + 1; // the access card
  const shown = query ? cards.filter((c) => c.text.toLowerCase().includes(query)) : cards;
  const loading = entries.isLoading || catalog.isLoading;
  const accessMatches =
    !query || `${t('home.accessTitle')} ${t('home.accessDescription')}`.toLowerCase().includes(query);

  return (
    <div className="grid gap-10">
      <PageHeader title={t('home.title')} description={t('home.description')} />

      <section aria-labelledby="my-requests" className="grid gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="my-requests" className="text-lg font-semibold">
            {t('home.mine')}
          </h2>
          <SegmentedControl
            label={t('home.mine')}
            value={scope}
            onChange={(v) => set({ show: v === 'open' ? undefined : v, page: undefined })}
          >
            <SegmentedControlItem value="open" label={t('home.open')} />
            <SegmentedControlItem value="closed" label={t('home.closed')} />
            <SegmentedControlItem value="all" label={t('home.all')} />
          </SegmentedControl>
        </div>
        <div className="grid gap-4">
          <div className="overflow-hidden rounded-xl border bg-card">
            {mine.isLoading ? (
              <div className="grid gap-px">
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="h-16 rounded-none" />
                ))}
              </div>
            ) : mine.error ? (
              <EmptyState
                icon={<InboxIcon />}
                title={t('home.loadFailed')}
                action={
                  <Button
                    label={t('home.retry')}
                    variant="secondary"
                    size="sm"
                    onClick={() => mine.refetch()}
                  />
                }
              />
            ) : !mine.data?.items.length ? (
              <EmptyState
                icon={<InboxIcon />}
                title={t(scope === 'open' ? 'home.emptyOpen' : 'home.empty')}
                description={scope === 'open' ? t('home.emptyOpenHint') : undefined}
              />
            ) : (
              <ul className="divide-y">
                {mine.data.items.map((r) => (
                  <RequestRow key={`${r.kind}-${r.id}`} r={r} />
                ))}
              </ul>
            )}
          </div>
          {pages > 1 && (
            <div className="flex items-center justify-center gap-2">
              <Button
                label={t('previous')}
                variant="secondary"
                size="sm"
                isDisabled={state.page <= 1}
                onClick={() => set({ page: state.page - 1 })}
              />
              <span className="text-sm text-muted-foreground">
                {t('pageOf', { page: state.page, pages })}
              </span>
              <Button
                label={t('next')}
                variant="secondary"
                size="sm"
                isDisabled={state.page >= pages}
                onClick={() => set({ page: state.page + 1 })}
              />
            </div>
          )}
        </div>
      </section>

      <TodoLink />

      <section aria-labelledby="new-request" className="grid gap-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="grid gap-1">
            <h2 id="new-request" className="text-lg font-semibold">
              {t('home.new')}
            </h2>
            <p className="text-sm text-muted-foreground">{t('home.newHint')}</p>
          </div>
          {total > 8 && (
            <SearchInput
              value={(state.q as string | undefined) ?? ''}
              onChange={(q) => set({ q: q || undefined })}
              placeholder={t('home.search')}
              aria-label={t('home.search')}
              className="sm:w-72"
            />
          )}
        </div>

        {/* Extension point: the service desk's "Ask IT" invitation (`core.requests.assist`). */}
        <Slot name="core.requests.assist" props={{}} />

        {loading ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-32 rounded-xl" />
            ))}
          </div>
        ) : (
          GROUPS.map((group) => {
            const items = shown.filter((c) => c.group === group);
            const showAccess = group === 'access' && accessMatches;
            if (!items.length && !showAccess) return null;
            return (
              <section key={group} aria-labelledby={`group-${group}`} className="grid gap-3">
                <h3 id={`group-${group}`} className="text-sm font-semibold text-muted-foreground">
                  {tg(group)}
                </h3>
                <Stagger className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {showAccess && (
                    <StaggerItem>
                      <CatalogCard
                        featured
                        href="/requests/access"
                        icon={<KeyRoundIcon />}
                        title={t('home.accessTitle')}
                        description={t('home.accessDescription')}
                      />
                    </StaggerItem>
                  )}
                  {items.map((c) => (
                    <StaggerItem key={c.key}>
                      <CatalogCard
                        href={c.href}
                        icon={c.icon}
                        title={c.title}
                        description={c.description}
                        featured={c.group === 'help'}
                      />
                    </StaggerItem>
                  ))}
                </Stagger>
              </section>
            );
          })
        )}

        {!loading && query && shown.length === 0 && !accessMatches && (
          <EmptyState
            icon={<InboxIcon />}
            title={t('home.noMatch')}
            className="rounded-xl border border-dashed"
          />
        )}
      </section>
    </div>
  );
}
