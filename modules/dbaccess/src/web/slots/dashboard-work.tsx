'use client';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@isbp/ui/card';
import { useApiQuery } from '@isbp/ui/query';
import { AlarmClockIcon, ArrowRightIcon, DatabaseIcon } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { MySummary } from '../../contracts';
import { useDate, useLocalized } from '../lib';
import { Button } from '@astryxdesign/core/Button';
import { Icon } from '@astryxdesign/core/Icon';

/**
 * `core.dashboard.work`: "Access expiring soon" for the person's own database access, with Extend. Reviews awaiting
 * them are on My work (`dbaccess.reviews`), not repeated here. Renders nothing when nothing expires.
 */
export default function DatabaseAccessWork() {
  const t = useTranslations('dbaccess.dashboard');
  const l = useLocalized();
  const date = useDate();
  const { data } = useApiQuery<MySummary>('/dbaccess/me/summary', undefined, { refetchInterval: 120_000 });
  if (!data || !data.expiring.length) return null;
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <DatabaseIcon className="size-4 text-primary" aria-hidden />
          {t('title')}
        </CardTitle>
        <CardDescription>{t('expiringDescription', { count: data.expiring.length })}</CardDescription>
        <CardAction>
          <Button
            label={t('open')}
            variant="ghost"
            size="sm"
            endContent={<Icon icon={ArrowRightIcon} />}
            href="/dbaccess"
          />
        </CardAction>
      </CardHeader>
      <CardContent className="grid gap-4">
        {data.expiring.length > 0 && (
          <section aria-label={t('expiring')} className="grid gap-1">
            <h3 className="text-xs font-medium text-muted-foreground">{t('expiring')}</h3>
            <ul className="divide-y">
              {data.expiring.map((g) => (
                <li key={g.id} className="flex min-w-0 items-center gap-3 py-2 text-sm">
                  <AlarmClockIcon className="size-4 shrink-0 text-warning-foreground" aria-hidden />
                  <span className="min-w-0 flex-1 truncate">
                    {l(g.role.name)} · {g.server.displayName}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {t('ends', { date: date(g.expiresAt) })}
                  </span>
                  {g.viewer.canExtend && (
                    <Link
                      href={`/dbaccess/request?extend=${g.id}`}
                      className="shrink-0 text-xs font-medium text-primary hover:underline"
                    >
                      {t('extend')}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
      </CardContent>
    </Card>
  );
}
