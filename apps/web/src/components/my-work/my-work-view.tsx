'use client';

import type { MyWork, WorkItemDTO, WorkKind, WorkSection } from '@isbp/contracts';
import { cn } from '@isbp/ui';
import { EmptyState, ErrorState } from '@isbp/ui/empty-state';
import { AnimatedItem, AnimatedList, AnimatedNumber } from '@isbp/ui/motion';
import { PageHeader } from '@isbp/ui/page-header';
import { useApiQuery } from '@isbp/ui/query';
import { RelativeTime } from '@isbp/ui/relative-time';
import { Skeleton } from '@isbp/ui/skeleton';
import { IconTile } from '@isbp/ui/icon-tile';
import {
  ArrowRightIcon,
  ClipboardCheckIcon,
  ListChecksIcon,
  ListTodoIcon,
  PartyPopperIcon,
  SquareCheckBigIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useNow, useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { NavIcon } from '../nav-icon';
import { DueBadge } from '../workflows/status-badges';
import { Button } from '@astryxdesign/core/Button';
import { Icon } from '@astryxdesign/core/Icon';

export const WORK_PATH = '/me/work';

/** The sections of My work, in order. */
export const KINDS: { kind: WorkKind; icon: ReactNode }[] = [
  { kind: 'approval', icon: <ListChecksIcon className="size-4" aria-hidden /> },
  { kind: 'todo', icon: <SquareCheckBigIcon className="size-4" aria-hidden /> },
  { kind: 'review', icon: <ClipboardCheckIcon className="size-4" aria-hidden /> },
  { kind: 'task', icon: <ListTodoIcon className="size-4" aria-hidden /> },
];

/** One thing waiting: what it is, the reference or who asked, and when it is due. */
export function WorkRow({ item, now, compact }: { item: WorkItemDTO; now: Date; compact?: boolean }) {
  const t = useTranslations();
  const detail = item.detail && t.has(item.detail.key) ? t(item.detail.key, item.detail.params) : null;
  const sub = [item.subtitle, detail].filter(Boolean).join(' · ');
  return (
    <Link
      href={item.href}
      className={cn(
        'group flex min-w-0 items-center gap-3 rounded-md px-2 outline-none transition-colors hover:bg-muted/60 focus-visible:ring-[3px] focus-visible:ring-ring/50 motion-reduce:transition-none',
        compact ? 'py-2' : 'py-2.5',
      )}
    >
      <span className="min-w-0 flex-1">
        <span className="line-clamp-2 text-sm font-medium group-hover:underline sm:line-clamp-1">
          {item.title}
        </span>
        {sub && <span className="block truncate text-xs text-muted-foreground">{sub}</span>}
      </span>
      {item.due ? (
        <DueBadge dueAt={item.due} now={now} />
      ) : item.since ? (
        <RelativeTime date={item.since} className="hidden shrink-0 text-xs text-muted-foreground sm:block" />
      ) : null}
    </Link>
  );
}

function SourceCard({ section, now }: { section: WorkSection; now: Date }) {
  const t = useTranslations();
  const tw = useTranslations('work');
  const label = t.has(section.label) ? t(section.label) : section.label;
  const more = section.count - section.items.length;
  return (
    <section aria-label={label} className="min-w-0 rounded-xl border bg-card p-3 sm:p-4">
      <div className="mb-1 flex items-center gap-2 px-2">
        <NavIcon name={section.icon ?? undefined} className="size-4 shrink-0 text-muted-foreground" />
        <h3 className="min-w-0 flex-1 truncate text-sm font-semibold">{label}</h3>
        {!section.error && (
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary tabular-nums">
            <AnimatedNumber value={section.count} />
          </span>
        )}
      </div>
      {section.error ? (
        <ErrorState compact className="px-2" />
      ) : (
        <AnimatedList className="divide-y">
          {section.items.map((item) => (
            <AnimatedItem key={item.id}>
              <WorkRow item={item} now={now} />
            </AnimatedItem>
          ))}
        </AnimatedList>
      )}
      {section.href && (more > 0 || section.kind === 'approval') && (
        <div className="mt-1 flex justify-end">
          <Button
            label={more > 0 ? tw('viewMore', { count: more }) : tw('viewAll')}
            variant="ghost"
            size="sm"
            endContent={<Icon icon={ArrowRightIcon} />}
            href={section.href}
          />
        </div>
      )}
    </section>
  );
}

/** My work: everything waiting for the person — decisions, things to do, records to check and tasks. */
export function MyWorkView() {
  const t = useTranslations('work');
  const now = useNow({ updateInterval: 60_000 });
  const { data, isLoading, error, refetch } = useApiQuery<MyWork>(WORK_PATH, { limit: 20 });
  const sections = data?.sections ?? [];
  const present = KINDS.filter(({ kind }) => sections.some((s) => s.kind === kind));
  const countOf = (kind: WorkKind) =>
    sections.filter((s) => s.kind === kind && !s.error).reduce((n, s) => n + s.count, 0);

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title={t('title')} description={t('description')} />
      {isLoading ? (
        <div className="grid gap-4" aria-busy="true">
          <Skeleton className="h-9 w-72" />
          <Skeleton className="h-40 w-full rounded-xl" />
          <Skeleton className="h-28 w-full rounded-xl" />
        </div>
      ) : error ? (
        <ErrorState error={error} onRetry={() => void refetch()} kind="page" />
      ) : !sections.length ? (
        <EmptyState
          icon={<PartyPopperIcon />}
          title={t('allClear')}
          description={t('allClearHint')}
          className="rounded-xl border border-dashed"
        />
      ) : (
        <div className="grid grid-cols-1 gap-5">
          {present.length > 1 && (
            <nav aria-label={t('sectionsLabel')} className="-mt-2 flex flex-wrap gap-2">
              {present.map(({ kind, icon }) => (
                <a
                  key={kind}
                  href={`#work-${kind}`}
                  className="inline-flex max-w-full items-center gap-1.5 rounded-full border bg-card px-3 py-1 text-sm outline-none transition-colors hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50 motion-reduce:transition-none"
                >
                  {icon}
                  <span className="truncate">{t(`kinds.${kind}`)}</span>
                  <span className="font-semibold tabular-nums">{countOf(kind)}</span>
                </a>
              ))}
            </nav>
          )}
          {present.map(({ kind, icon }) => (
            <section
              key={kind}
              id={`work-${kind}`}
              aria-labelledby={`work-${kind}-title`}
              className="min-w-0 scroll-mt-20"
            >
              <h2
                id={`work-${kind}-title`}
                className="mb-1 flex min-w-0 items-center gap-2 text-base font-semibold"
              >
                <IconTile aria-hidden size="sm">
                  {icon}
                </IconTile>
                {t(`kinds.${kind}`)}
              </h2>
              <p className="mb-3 text-sm text-muted-foreground">{t(`kindHints.${kind}`)}</p>
              <div className="grid grid-cols-1 gap-3">
                {sections
                  .filter((s) => s.kind === kind)
                  .map((s) => (
                    <SourceCard key={s.source} section={s} now={now} />
                  ))}
              </div>
            </section>
          ))}
        </div>
      )}
      <p className="sr-only" aria-live="polite">
        {data ? t('liveCount', { count: data.total }) : ''}
      </p>
    </div>
  );
}
