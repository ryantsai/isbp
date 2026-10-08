'use client';

import type { CatalogItem, MyRequest, PortalEntry } from '@isbp/contracts';
import { localize, type Page } from '@isbp/sdk';
import { Slot } from '@isbp/sdk/web';
import { UserAvatar } from '@isbp/ui/avatar';
import { Badge } from '@isbp/ui/badge';
import { Button } from '@isbp/ui/button';
import { useListState } from '@isbp/ui/data-table';
import { EmptyState } from '@isbp/ui/empty-state';
import { Stagger, StaggerItem } from '@isbp/ui/motion';
import { PageHeader } from '@isbp/ui/page-header';
import { RelativeTime } from '@isbp/ui/relative-time';
import { Skeleton } from '@isbp/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@isbp/ui/tabs';
import { ArrowRightIcon, ChevronRightIcon, InboxIcon, KeyRoundIcon, StampIcon } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useApiQuery } from '@/lib/api';
import { TodoSection } from '../assignments/todo-section';
import { NavIcon } from '../nav-icon';
import { fulfilmentOf, RequestStatus, requestHref } from './request-status';

function CatalogCard({
  href,
  icon,
  title,
  description,
  badge,
  featured,
}: {
  href: string;
  icon: React.ReactNode;
  title: string;
  description?: string | null;
  badge?: React.ReactNode;
  featured?: boolean;
}) {
  return (
    <Link
      href={href}
      className={
        'group relative flex h-full flex-col gap-3 overflow-hidden rounded-xl border bg-card p-4 shadow-xs outline-none transition-all hover:-translate-y-0.5 hover:border-ring/40 hover:shadow-md focus-visible:ring-[3px] focus-visible:ring-ring/50 motion-reduce:hover:translate-y-0' +
        (featured ? ' bg-gradient-to-br from-primary/10 via-card to-card' : '')
      }
    >
      <span className="grid size-10 place-items-center rounded-xl bg-primary/10 text-primary transition-transform group-hover:scale-105 [&_svg]:size-5">
        {icon}
      </span>
      <span className="grid gap-1">
        <span className="font-medium">{title}</span>
        {description && <span className="line-clamp-2 text-sm text-muted-foreground">{description}</span>}
      </span>
      <span className="mt-auto flex items-center justify-between gap-2">
        {badge ?? <span />}
        <ArrowRightIcon
          className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5"
          aria-hidden
        />
      </span>
    </Link>
  );
}

function RequestRow({ r }: { r: MyRequest }) {
  const t = useTranslations('requests');
  const locale = useLocale();
  const waiting = r.workflow?.status === 'running' ? r.workflow : null;
  // A form request being fulfilled shows the fulfilment's status instead of "Approved".
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
          <span className="flex flex-wrap items-center gap-x-2">
            <span className="truncate font-medium group-hover:underline">{localize(r.title, locale)}</span>
            {r.subtitle && <span className="truncate text-sm text-muted-foreground">{r.subtitle}</span>}
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
            {waiting && waiting.currentSteps.length > 0 && (
              <>
                <span aria-hidden>·</span>
                <span>
                  {t('home.waitingFor', {
                    step: waiting.currentSteps.map((s) => localize(s.name, locale)).join(', '),
                  })}
                </span>
                <span className="flex -space-x-1.5">
                  {waiting.pendingWith.slice(0, 3).map((p) => (
                    <UserAvatar
                      key={p.id}
                      name={p.displayName}
                      src={p.avatarUrl}
                      className="size-5 text-[8px] ring-2 ring-background"
                    />
                  ))}
                </span>
                {waiting.pendingWith.length > 3 && <span>+{waiting.pendingWith.length - 3}</span>}
              </>
            )}
          </span>
        </span>
        <RequestStatus r={r} />
        <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      </Link>
    </li>
  );
}

/** The self-service portal: what you can ask for, and where your requests are. */
export function RequestsHome() {
  const t = useTranslations('requests');
  const tc = useTranslations('requests.categories');
  const locale = useLocale();
  const [state, set] = useListState({ pageSize: 10 });
  const scope = (state.show as string | undefined) ?? 'open';
  const root = useTranslations();
  const catalog = useApiQuery<{ items: CatalogItem[] }>('/forms/catalog');
  const entries = useApiQuery<{ items: PortalEntry[] }>('/portal/entries');
  const mine = useApiQuery<Page<MyRequest>>('/me/requests', {
    status: scope === 'all' ? undefined : scope,
    page: state.page,
    pageSize: state.pageSize,
  });
  const categories = [...new Set((catalog.data?.items ?? []).map((f) => f.category ?? 'other'))];
  const pages = mine.data ? Math.ceil(mine.data.total / mine.data.pageSize) : 1;

  return (
    <div className="grid gap-10">
      <PageHeader title={t('home.title')} description={t('home.description')} />

      {/* Extension point: e.g. Helpdesk AI's virtual agent. */}
      <Slot name="core.requests.assist" props={{}} />

      {/* Forms someone asked the person to fill in by a date (hidden when there are none). */}
      <TodoSection />

      <section aria-labelledby="new-request" className="grid gap-4">
        <h2 id="new-request" className="text-lg font-semibold">
          {t('home.new')}
        </h2>
        <Stagger className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {(entries.data?.items ?? []).map((e) => (
            <StaggerItem key={`${e.moduleId}-${e.id}`}>
              <CatalogCard
                featured
                href={e.href}
                icon={<NavIcon name={e.icon} />}
                title={root.has(e.label) ? root(e.label) : e.label}
                description={e.description && root.has(e.description) ? root(e.description) : null}
              />
            </StaggerItem>
          ))}
          <StaggerItem>
            <CatalogCard
              featured
              href="/requests/access"
              icon={<KeyRoundIcon />}
              title={t('home.accessTitle')}
              description={t('home.accessDescription')}
              badge={
                <Badge variant="info">
                  <StampIcon aria-hidden />
                  {t('home.needsApproval')}
                </Badge>
              }
            />
          </StaggerItem>
          {catalog.isLoading &&
            [0, 1, 2].map((i) => (
              <StaggerItem key={i}>
                <Skeleton className="h-40 rounded-xl" />
              </StaggerItem>
            ))}
          {categories.flatMap((cat) =>
            (catalog.data?.items ?? [])
              .filter((f) => (f.category ?? 'other') === cat)
              .map((f) => (
                <StaggerItem key={f.id}>
                  <CatalogCard
                    href={`/requests/forms/${f.key}`}
                    icon={<NavIcon name={f.icon} />}
                    title={localize(f.name, locale)}
                    description={localize(f.description, locale)}
                    badge={
                      <span className="flex flex-wrap items-center gap-1.5">
                        <Badge variant="muted">{tc.has(cat) ? tc(cat) : cat}</Badge>
                        {f.hasApproval && (
                          <Badge variant="info">
                            <StampIcon aria-hidden />
                            {t('home.needsApproval')}
                          </Badge>
                        )}
                      </span>
                    }
                  />
                </StaggerItem>
              )),
          )}
        </Stagger>
      </section>

      <section aria-labelledby="my-requests">
        <Tabs value={scope} onValueChange={(v) => set({ show: v === 'open' ? undefined : v })}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="my-requests" className="text-lg font-semibold">
              {t('home.mine')}
            </h2>
            <TabsList>
              <TabsTrigger value="open">{t('home.open')}</TabsTrigger>
              <TabsTrigger value="closed">{t('home.closed')}</TabsTrigger>
              <TabsTrigger value="all">{t('home.all')}</TabsTrigger>
            </TabsList>
          </div>
          {/* Radix renders the panel's children only for the active tab. */}
          {(['open', 'closed', 'all'] as const).map((v) => (
            <TabsContent key={v} value={v} className="grid gap-4">
              <div className="overflow-hidden rounded-xl border bg-card">
                {mine.isLoading ? (
                  <div className="grid gap-px">
                    {[0, 1, 2].map((i) => (
                      <Skeleton key={i} className="h-16 rounded-none" />
                    ))}
                  </div>
                ) : !mine.data?.items.length ? (
                  <EmptyState
                    icon={<InboxIcon />}
                    title={t(scope === 'open' ? 'home.emptyOpen' : 'home.empty')}
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
                    variant="outline"
                    size="sm"
                    disabled={state.page <= 1}
                    onClick={() => set({ page: state.page - 1 })}
                  >
                    {t('previous')}
                  </Button>
                  <span className="text-sm text-muted-foreground">
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
            </TabsContent>
          ))}
        </Tabs>
      </section>
    </div>
  );
}
