'use client';

import type { CiRelatedSlotProps } from '@isbp/module-cmdb/contracts';
import { useApiQuery } from '@isbp/ui/query';
import { RelativeTime } from '@isbp/ui/relative-time';
import { Skeleton } from '@isbp/ui/skeleton';
import { AppWindowIcon } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { CiApplication } from '../../contracts';
import { DeploymentStatusText, StageBadge } from '../badges';
import { appHref } from '../lib';

/**
 * `cmdb.ci.related`: the application this CI is (its application CI) or hosts (an environment's CI) —
 * code, stage, owners, the production version and the last deployment.
 */
export default function CiRelatedApplications({ ci }: CiRelatedSlotProps) {
  const t = useTranslations('alm.ciRelated');
  const { data, isLoading, error } = useApiQuery<{ items: CiApplication[] }>(
    `/alm/cis/${ci.id}/applications`,
  );
  if (!isLoading && !error && !data?.items.length) return null;
  const headingId = `alm-ci-${ci.id}`;
  return (
    <section className="grid min-w-0 grid-cols-1 gap-2" aria-labelledby={headingId}>
      <h3 id={headingId} className="flex items-center gap-2 text-sm font-semibold">
        <AppWindowIcon className="size-4 text-primary" aria-hidden />
        {t('title')}
      </h3>
      {isLoading ? (
        <Skeleton className="h-16 w-full" />
      ) : error ? (
        <p className="text-sm text-muted-foreground">{t('unavailable')}</p>
      ) : (
        <ul className="divide-y">
          {data!.items.map((a) => (
            <li key={a.id} className="grid min-w-0 gap-1 py-2 text-sm">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <Link
                  href={appHref(a.code)}
                  className="truncate font-medium outline-none hover:underline focus-visible:underline"
                >
                  {a.name}
                </Link>
                <span className="font-mono text-xs text-muted-foreground">{a.code}</span>
                <StageBadge stage={a.stage} />
              </div>
              <p className="text-xs text-muted-foreground">
                {a.roles.includes('application')
                  ? t('asApplication')
                  : t('asEnvironment', { environments: a.environments.join(', ') })}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {t('owners', {
                  business: a.businessOwner?.displayName ?? '—',
                  technical: a.technicalOwner?.displayName ?? '—',
                })}
              </p>
              <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                <span className="text-muted-foreground">
                  {t('production')}{' '}
                  <span className="font-mono text-foreground">{a.productionVersion ?? '—'}</span>
                </span>
                {a.lastDeployment && (
                  <span className="inline-flex min-w-0 items-center gap-1 text-muted-foreground">
                    · <DeploymentStatusText status={a.lastDeployment.status} />
                    <span className="truncate">
                      {a.lastDeployment.environment.name} <RelativeTime date={a.lastDeployment.at} />
                    </span>
                  </span>
                )}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
