'use client';

import type { Page } from '@isbp/sdk';
import { Button } from '@isbp/ui/button';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@isbp/ui/card';
import { useApiQuery } from '@isbp/ui/query';
import { RelativeTime } from '@isbp/ui/relative-time';
import { ArrowRightIcon, MegaphoneIcon, PinIcon } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { Post } from '../../contracts';
import { SeverityBadge } from '../severity';

/**
 * "News" on Home (`core.home.news`): the current announcements, pinned first. Readers see announcements here rather
 * than in the sidebar. Nothing current: no card.
 */
export default function HomeNews() {
  const t = useTranslations('announcements');
  const { data } = useApiQuery<Page<Post>>('/announcements/posts', { view: 'current', pageSize: 3 });
  const posts = data?.items ?? [];
  if (!posts.length) return null;
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MegaphoneIcon className="size-4 text-primary" aria-hidden />
          {t('home.title')}
        </CardTitle>
        <CardAction>
          <Button asChild variant="ghost" size="sm">
            <Link href="/announcements">
              {t('home.viewAll')}
              <ArrowRightIcon />
            </Link>
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        <ul className="divide-y">
          {posts.map((p) => (
            <li key={p.id}>
              <Link
                href={`/announcements/${p.id}`}
                className="group flex min-w-0 flex-col gap-1 rounded-md px-2 py-2.5 outline-none hover:bg-muted/60 focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:flex-row sm:items-center sm:gap-3"
              >
                <span className="flex shrink-0 items-center gap-2">
                  <SeverityBadge severity={p.severity} />
                  {p.pinned && (
                    <PinIcon className="size-3.5 text-muted-foreground" aria-label={t('pinned')} />
                  )}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium group-hover:underline">
                  {p.title}
                </span>
                <RelativeTime
                  date={p.publishedAt ?? p.updatedAt}
                  className="shrink-0 text-xs text-muted-foreground"
                />
              </Link>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
