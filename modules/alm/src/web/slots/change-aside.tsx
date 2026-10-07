'use client';

import type { TicketAsideSlotProps } from '@isbp/module-itsm/contracts';
import { useApiQuery } from '@isbp/ui/query';
import { RelativeTime } from '@isbp/ui/relative-time';
import { Skeleton } from '@isbp/ui/skeleton';
import { RocketIcon, ShieldAlertIcon } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { ChangeUsage } from '../../contracts';
import { DeploymentStatusText, ENV_ICON, ReleaseStatusBadge } from '../badges';
import { releaseHref } from '../lib';

/**
 * `itsm.ticket.aside`, for changes only: the releases linked to the change and the deployments that used it
 * as their authorization.
 */
export default function ChangeReleases({ ticket }: TicketAsideSlotProps) {
  if (ticket.type !== 'change') return null;
  return <ChangeReleasesPanel changeId={ticket.id} />;
}

function ChangeReleasesPanel({ changeId }: { changeId: string }) {
  const t = useTranslations('alm.changeAside');
  const { data, isLoading, error } = useApiQuery<ChangeUsage>(`/alm/changes/${changeId}`);
  const headingId = `alm-change-${changeId}`;
  return (
    <section className="grid min-w-0 grid-cols-1 gap-3" aria-labelledby={headingId}>
      <h3 id={headingId} className="flex items-center gap-2 text-sm font-semibold">
        <RocketIcon className="size-4 text-primary" aria-hidden />
        {t('title')}
      </h3>
      {isLoading ? (
        <Skeleton className="h-16 w-full" />
      ) : error || !data ? (
        <p className="text-sm text-muted-foreground">{t('unavailable')}</p>
      ) : (
        <>
          <div className="grid min-w-0 gap-1">
            <p className="text-xs font-medium text-muted-foreground">{t('releases')}</p>
            {data.releases.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('noReleases')}</p>
            ) : (
              <ul className="divide-y">
                {data.releases.map((r) => (
                  <li key={r.id} className="flex min-w-0 flex-wrap items-center gap-2 py-1.5 text-sm">
                    <Link
                      href={releaseHref(r.application.code, r.version)}
                      className="min-w-0 truncate font-medium outline-none hover:underline focus-visible:underline"
                    >
                      {r.application.name} <span className="font-mono">{r.version}</span>
                    </Link>
                    <ReleaseStatusBadge status={r.status} />
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="grid min-w-0 gap-1">
            <p className="text-xs font-medium text-muted-foreground">{t('deployments')}</p>
            {data.deployments.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('noDeployments')}</p>
            ) : (
              <ul className="divide-y">
                {data.deployments.map((d) => {
                  const Icon = ENV_ICON[d.environment.kind];
                  return (
                    <li key={d.id} className="grid min-w-0 gap-0.5 py-1.5 text-sm">
                      <span className="flex min-w-0 items-center gap-1.5">
                        <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                        <span className="truncate">
                          {d.application.code} <span className="font-mono">{d.version}</span> →{' '}
                          {d.environment.name}
                        </span>
                      </span>
                      <span className="flex min-w-0 flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                        <DeploymentStatusText status={d.status} />
                        <RelativeTime date={d.finishedAt ?? d.startedAt} />
                        {d.overridden && (
                          <span className="inline-flex items-center gap-1 text-destructive">
                            <ShieldAlertIcon className="size-3" aria-hidden />
                            {t('overridden')}
                          </span>
                        )}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </>
      )}
    </section>
  );
}
