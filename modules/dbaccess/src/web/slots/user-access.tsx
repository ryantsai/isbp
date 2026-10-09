'use client';

import type { UserOverviewSlotProps } from '@isbp/contracts';
import { useCan, usePlatform } from '@isbp/sdk/web';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@isbp/ui/card';
import { useApiQuery } from '@isbp/ui/query';
import { Skeleton } from '@isbp/ui/skeleton';
import { DatabaseIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { Grant } from '../../contracts';
import { PERMISSIONS } from '../../manifest';
import { GrantStatusBadge, RiskBadge } from '../badges';
import { useDate, useLocalized } from '../lib';

/**
 * `core.user.overview`: a person's database access (Administration → People). Shown to DBAs, auditors
 * and the person's manager; the API decides, and nothing renders for anyone else.
 */
export default function UserDatabaseAccess({ user }: UserOverviewSlotProps) {
  const t = useTranslations('dbaccess.userSlot');
  const l = useLocalized();
  const date = useDate();
  const { user: me } = usePlatform();
  // The same people the API lets read it: grants readers, the person and their manager (no request for anyone else).
  const allowed = useCan(PERMISSIONS.grantsRead) || me.id === user.id || user.managerId === me.id;
  const { data, isLoading, error } = useApiQuery<{ items: Grant[] }>(
    allowed ? `/dbaccess/people/${user.id}/access` : null,
  );
  if (!allowed || error) return null;
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <DatabaseIcon className="size-4 text-primary" aria-hidden />
          {t('title')}
        </CardTitle>
        <CardDescription>{t('description', { name: user.displayName })}</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading || !data ? (
          <Skeleton className="h-20 w-full" />
        ) : data.items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('none')}</p>
        ) : (
          <ul className="divide-y">
            {data.items.map((g) => (
              <li
                key={g.id}
                className="flex min-w-0 flex-col gap-1 py-2 text-sm sm:flex-row sm:items-center sm:gap-3"
              >
                <span className="grid min-w-0 flex-1">
                  <span className="truncate font-medium">{l(g.role.name)}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {g.server.displayName} · <span className="font-mono">{g.accountName ?? '—'}</span>
                  </span>
                </span>
                <span className="flex flex-wrap items-center gap-2">
                  <RiskBadge risk={g.role.risk} className="hidden md:inline-flex" />
                  <GrantStatusBadge status={g.viewStatus} />
                  <span className="text-xs text-muted-foreground">
                    {g.expiresAt ? t('until', { date: date(g.expiresAt) }) : t('permanent')}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
