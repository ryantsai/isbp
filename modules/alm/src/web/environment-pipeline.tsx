'use client';

import { cn } from '@isbp/ui';
import { Stagger, StaggerItem } from '@isbp/ui/motion';
import { RelativeTime } from '@isbp/ui/relative-time';
import { ChevronRightIcon, ExternalLinkIcon } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Fragment } from 'react';
import type { Environment } from '../contracts';
import { DeploymentStatusText, ENV_ICON } from './badges';
import { releaseHref } from './lib';

/**
 * The environment pipeline (Development → Test → Staging → Production → DR): what each environment runs
 * now and how its last deployment went. A list for assistive tech; arrows are decorative.
 */
export function EnvironmentPipeline({ code, environments }: { code: string; environments: Environment[] }) {
  const t = useTranslations('alm.pipeline');
  const tk = useTranslations('alm.envKind');
  if (!environments.length) return <p className="text-sm text-muted-foreground">{t('none')}</p>;
  return (
    <Stagger
      className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:flex lg:flex-row lg:items-stretch"
      role="list"
      aria-label={t('label')}
    >
      {environments.map((e, i) => {
        const Icon = ENV_ICON[e.kind];
        const last = e.lastDeployment;
        return (
          <Fragment key={e.id}>
            {i > 0 && (
              <ChevronRightIcon
                className="hidden size-4 shrink-0 self-center text-muted-foreground lg:block"
                aria-hidden
              />
            )}
            <StaggerItem
              role="listitem"
              className={cn(
                'flex min-w-0 flex-1 flex-col gap-2 rounded-lg border bg-background p-3',
                e.kind === 'production' && 'border-primary/40 bg-primary/5',
              )}
            >
              <div className="flex min-w-0 items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
                  <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="truncate">{e.name}</span>
                </span>
                {e.name.toLowerCase() !== tk(e.kind).toLowerCase() && (
                  <span className="shrink-0 text-xs text-muted-foreground">{tk(e.kind)}</span>
                )}
              </div>
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">{t('current')}</p>
                {e.currentVersion ? (
                  e.currentRelease ? (
                    <Link
                      href={releaseHref(code, e.currentVersion)}
                      className="font-mono text-base font-semibold hover:underline focus-visible:underline focus-visible:outline-none"
                    >
                      {e.currentVersion}
                    </Link>
                  ) : (
                    <p className="truncate font-mono text-base font-semibold">{e.currentVersion}</p>
                  )
                ) : (
                  <p className="text-sm text-muted-foreground">{t('nothingDeployed')}</p>
                )}
              </div>
              {last && (
                <div className="flex min-w-0 flex-col gap-0.5 text-xs">
                  <DeploymentStatusText status={last.status} />
                  <span className="truncate text-muted-foreground">
                    <span className="font-mono">{last.version}</span> · <RelativeTime date={last.at} />
                  </span>
                </div>
              )}
              {e.url && (
                <a
                  href={e.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-auto inline-flex min-w-0 items-center gap-1 text-xs text-primary hover:underline focus-visible:underline focus-visible:outline-none"
                >
                  <span className="truncate">{e.url.replace(/^https:\/\//, '')}</span>
                  <ExternalLinkIcon className="size-3 shrink-0" aria-hidden />
                  <span className="sr-only">{t('opensInNewTab')}</span>
                </a>
              )}
            </StaggerItem>
          </Fragment>
        );
      })}
    </Stagger>
  );
}
