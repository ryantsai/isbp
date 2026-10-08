'use client';

import { cn } from '@isbp/ui';
import { Button } from '@isbp/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@isbp/ui/card';
import { useApiQuery } from '@isbp/ui/query';
import { Skeleton } from '@isbp/ui/skeleton';
import {
  ArrowRightIcon,
  ClockAlertIcon,
  EraserIcon,
  FileTextIcon,
  ListChecksIcon,
  type LucideIcon,
  PackageIcon,
  ShieldAlertIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { Attention } from '../../contracts';

const ITEMS: { key: keyof Attention; icon: LucideIcon; href: string }[] = [
  { key: 'nonCompliantLicenses', icon: ShieldAlertIcon, href: '/itam/software?view=attention' },
  { key: 'contractsRenewing30', icon: FileTextIcon, href: '/itam/contracts?view=renewing' },
  { key: 'warrantiesExpiring30', icon: ClockAlertIcon, href: '/itam/hardware?warranty=expiring' },
  { key: 'wipesDue', icon: EraserIcon, href: '/itam/hardware?wipe=due' },
  { key: 'unapprovedSoftware', icon: ListChecksIcon, href: '/itam/discovery?tab=compliance' },
];

/** "Asset attention" on the home dashboard (`core.dashboard.work`), for asset managers. */
export default function AssetAttentionCard() {
  const t = useTranslations('itam.attention');
  const { data } = useApiQuery<Attention>('/itam/attention', undefined, { refetchInterval: 300_000 });
  const items = ITEMS.filter((i) => !data || data[i.key] !== null);
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <PackageIcon className="size-4 text-primary" aria-hidden />
          {t('title')}
        </CardTitle>
        <CardDescription>{t('description')}</CardDescription>
        <CardAction>
          <Button asChild variant="ghost" size="sm">
            <Link href="/itam">
              {t('open')}
              <ArrowRightIcon />
            </Link>
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-3" aria-label={t('title')}>
          {items.map(({ key, icon: Icon, href }) => {
            const value = data?.[key];
            const hot = (value ?? 0) > 0;
            return (
              <li key={key} className="min-w-0">
                <Link
                  href={href}
                  className={cn(
                    'flex h-full flex-col gap-1 rounded-lg border px-3 py-2 outline-none transition-colors hover:bg-accent/60 focus-visible:ring-[3px] focus-visible:ring-ring/50',
                    hot && 'border-warning/40 bg-warning/10',
                  )}
                >
                  <span className="flex min-w-0 items-start gap-1.5 text-xs leading-snug text-muted-foreground">
                    <Icon
                      className={cn('mt-px size-3.5 shrink-0', hot && 'text-warning-foreground')}
                      aria-hidden
                    />
                    <span className="line-clamp-2">{t(key)}</span>
                  </span>
                  {value === undefined ? (
                    <Skeleton className="h-6 w-8" />
                  ) : (
                    <span className="text-lg font-semibold">{value ?? 0}</span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
