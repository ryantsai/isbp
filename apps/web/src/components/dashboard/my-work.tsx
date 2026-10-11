'use client';

import type { MyRequest, MyWork, WorkItemDTO, WorkKind } from '@isbp/contracts';
import { localize, type Page } from '@isbp/sdk';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@isbp/ui/card';
import { ErrorState } from '@isbp/ui/empty-state';
import { AnimatedItem, AnimatedList, AnimatedNumber } from '@isbp/ui/motion';
import { useApiQuery } from '@isbp/ui/query';
import { ArrowRightIcon, ClipboardListIcon, InboxIcon, PlusIcon } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useNow, useTranslations } from 'next-intl';
import { WorkRow } from '../my-work/my-work-view';
import { RequestStatus, requestHref } from '../requests/request-status';
import { Button } from '@astryxdesign/core/Button';
import { Icon } from '@astryxdesign/core/Icon';

const SHOWN = 5;
const KIND_RANK: Record<WorkKind, number> = { approval: 0, todo: 1, review: 2, task: 3 };

/**
 * The most pressing items across My work: one from each source in turn (decisions, to-dos and reviews before tasks),
 * so a long approvals list doesn't hide the one form that is due; overdue ones first.
 */
function topItems(work: MyWork): (WorkItemDTO & { key: string })[] {
  const sections = work.sections
    .filter((s) => !s.error && s.items.length)
    .sort((a, b) => KIND_RANK[a.kind] - KIND_RANK[b.kind]);
  const picked: (WorkItemDTO & { key: string })[] = [];
  for (let round = 0; picked.length < SHOWN && sections.some((s) => s.items.length > round); round++)
    for (const s of sections) {
      const item = s.items[round];
      if (item && picked.length < SHOWN) picked.push({ ...item, key: `${s.source}:${item.id}` });
    }
  return picked.sort((a, b) => Number(b.overdue) - Number(a.overdue));
}

/** "Needs you" on Home: the first few things on My work, each opening the item itself. Nothing waiting: no card. */
export function NeedsYou({ work }: { work: MyWork | undefined }) {
  const t = useTranslations('dashboard.needsYou');
  const now = useNow({ updateInterval: 60_000 });
  if (!work || work.total + work.tasks === 0) return null;
  const items = topItems(work);
  const count = work.total || work.tasks;
  return (
    <Card className="min-w-0 lg:only:col-span-2">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <InboxIcon className="size-4 text-primary" aria-hidden />
          {work.total ? t('title') : t('tasksTitle')}
          <span className="ml-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary tabular-nums">
            <AnimatedNumber value={count} />
          </span>
        </CardTitle>
        <CardDescription>{t('description')}</CardDescription>
        <CardAction>
          <Button
            label={t('open')}
            variant="ghost"
            size="sm"
            endContent={<Icon icon={ArrowRightIcon} />}
            href="/my-work"
          />
        </CardAction>
      </CardHeader>
      <CardContent>
        <AnimatedList className="divide-y">
          {items.map((i) => (
            <AnimatedItem key={i.key}>
              <WorkRow item={i} now={now} compact />
            </AnimatedItem>
          ))}
        </AnimatedList>
      </CardContent>
    </Card>
  );
}

/** "Your requests" on Home: open requests with who or what they wait for. None open: no card. */
export function YourRequests() {
  const t = useTranslations('dashboard.requests');
  const tc = useTranslations('common');
  const locale = useLocale();
  const { data, error, refetch } = useApiQuery<Page<MyRequest>>('/me/requests', {
    status: 'open',
    pageSize: 4,
  });
  if (error)
    return (
      <Card className="min-w-0">
        <CardContent>
          <ErrorState error={error} onRetry={() => void refetch()} compact />
        </CardContent>
      </Card>
    );
  if (!data?.items.length) return null;
  return (
    <Card className="min-w-0 lg:only:col-span-2">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ClipboardListIcon className="size-4 text-primary" aria-hidden />
          {t('title')}
        </CardTitle>
        <CardDescription>{t('description')}</CardDescription>
        <CardAction className="flex gap-1">
          <Button
            label={t('new')}
            variant="secondary"
            size="sm"
            icon={<Icon icon={PlusIcon} />}
            href="/requests"
          />
        </CardAction>
      </CardHeader>
      <CardContent>
        <ul className="divide-y">
          {data.items.map((r) => (
            <li key={`${r.kind}-${r.id}`}>
              <Link
                href={requestHref(r)}
                className="group flex min-w-0 items-center gap-3 rounded-md px-2 py-2 text-sm outline-none hover:bg-muted/60 focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium group-hover:underline">
                    {localize(r.title, locale)}
                  </span>
                  <span className="block font-mono text-xs text-muted-foreground">{r.reference}</span>
                </span>
                <RequestStatus r={r} />
              </Link>
            </li>
          ))}
        </ul>
        {data.total > data.items.length && (
          <div className="mt-1 flex justify-end">
            <Button
              label={tc('viewAll')}
              variant="ghost"
              size="sm"
              endContent={<Icon icon={ArrowRightIcon} />}
              href="/requests#my-requests"
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
