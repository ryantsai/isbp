'use client';

import type { RecordPanelSlotProps } from '@isbp/contracts';
import { Slot, type WebPageProps } from '@isbp/sdk/web';
import { cn } from '@isbp/ui';
import { Button } from '@isbp/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@isbp/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@isbp/ui/dropdown-menu';
import { EmptyState } from '@isbp/ui/empty-state';
import { Markdown } from '@isbp/ui/markdown';
import { FadeIn, Stagger, StaggerItem } from '@isbp/ui/motion';
import { useApiMutation, useApiQuery } from '@isbp/ui/query';
import { DateTime, RelativeTime } from '@isbp/ui/relative-time';
import { Skeleton } from '@isbp/ui/skeleton';
import {
  ArrowLeftIcon,
  CheckIcon,
  ChevronDownIcon,
  FileQuestionIcon,
  PencilIcon,
  RocketIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import type { AppDetail, ReleaseDetail, ReleaseStatus } from '../../contracts';
import { DeploymentStatusText, ENV_ICON, RELEASE_META, ReleaseStatusBadge } from '../badges';
import { DeploymentDialog } from '../deployment-dialog';
import { DeploymentsTable } from '../deployments-table';
import { appHref, INVALIDATE, releaseHref } from '../lib';
import { ReadinessCard } from '../readiness-card';
import { PlannedDate } from '../release-bits';
import { ReleaseFormDialog } from '../release-form-dialog';

const STEPS: ReleaseStatus[] = ['planned', 'in_progress', 'ready', 'released'];

/** planned → in progress → ready → released, with the current step marked (cancelled shows apart). */
function StatusStepper({ status }: { status: ReleaseStatus }) {
  const t = useTranslations('alm');
  if (status === 'cancelled')
    return (
      <p className="flex items-center gap-2 rounded-lg border bg-muted/50 px-4 py-3 text-sm text-muted-foreground">
        <RELEASE_META.cancelled.icon className="size-4 shrink-0" aria-hidden />
        {t('release.cancelledBanner')}
      </p>
    );
  const current = STEPS.indexOf(status);
  return (
    <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label={t('release.lifecycle')}>
      {STEPS.map((s, i) => {
        const done = i < current;
        const active = i === current;
        const Icon = done ? CheckIcon : RELEASE_META[s].icon;
        return (
          <li
            key={s}
            aria-current={active ? 'step' : undefined}
            className={cn(
              'flex min-w-0 items-center gap-2 rounded-lg border px-3 py-2 text-sm',
              active && 'border-primary bg-primary/5 font-medium text-foreground',
              done && 'text-foreground',
              !active && !done && 'text-muted-foreground',
            )}
          >
            <span
              className={cn(
                'grid size-6 shrink-0 place-items-center rounded-full border',
                done && 'border-success bg-success/12 text-success',
                active && 'border-primary bg-primary text-primary-foreground',
              )}
            >
              <Icon className="size-3.5" aria-hidden />
            </span>
            <span className="truncate">{t(`releaseStatus.${s}`)}</span>
            {done && <span className="sr-only">({t('release.stepDone')})</span>}
          </li>
        );
      })}
    </ol>
  );
}

/** Which environments this version reached, and when. */
function VersionPipeline({ release }: { release: ReleaseDetail }) {
  const t = useTranslations('alm');
  if (!release.pipeline.length) return <p className="text-sm text-muted-foreground">{t('pipeline.none')}</p>;
  return (
    <Stagger
      className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4"
      role="list"
      aria-label={t('release.pipelineLabel')}
    >
      {release.pipeline.map((p) => {
        const Icon = ENV_ICON[p.environment.kind];
        return (
          <StaggerItem
            key={p.environment.id}
            role="listitem"
            className={cn(
              'grid min-w-0 gap-1.5 rounded-lg border p-3',
              p.current && 'border-success/40 bg-success/5',
              !p.deployment && 'border-dashed',
            )}
          >
            <span className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
              <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="truncate">{p.environment.name}</span>
            </span>
            {p.deployment ? (
              <>
                <DeploymentStatusText status={p.deployment.status} className="text-xs" />
                <span className="text-xs text-muted-foreground">
                  <RelativeTime date={p.deployment.finishedAt ?? p.deployment.startedAt} />
                </span>
                {p.current && (
                  <span className="text-xs font-medium text-success">{t('release.runningNow')}</span>
                )}
              </>
            ) : (
              <span className="text-xs text-muted-foreground">{t('release.notYet')}</span>
            )}
          </StaggerItem>
        );
      })}
    </Stagger>
  );
}

export default function ReleasePage({ params }: WebPageProps) {
  const t = useTranslations('alm');
  const router = useRouter();
  const code = params.code ?? '';
  const version = params.version ?? '';
  const path = `/alm/applications/${encodeURIComponent(code)}/releases/${encodeURIComponent(version)}`;
  const { data: release, isLoading, error } = useApiQuery<ReleaseDetail>(path);
  const { data: app } = useApiQuery<AppDetail>(
    release ? `/alm/applications/${encodeURIComponent(code)}` : null,
  );
  const [dialog, setDialog] = useState<'edit' | 'deploy' | null>(null);
  const close = (open: boolean) => !open && setDialog(null);
  const move = useApiMutation(
    (api, status: ReleaseStatus) =>
      api.post<ReleaseDetail>(`/alm/releases/${release!.id}/status`, { status }),
    {
      invalidate: INVALIDATE,
      success: (r) => t('release.moved', { status: t(`releaseStatus.${r.status}`) }),
    },
  );

  if (isLoading)
    return (
      <div className="space-y-6">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-14 w-full rounded-xl" />
        <Skeleton className="h-72 w-full rounded-xl" />
      </div>
    );
  if (error || !release) return <EmptyState icon={<FileQuestionIcon />} title={t('release.notFound')} />;

  const record: RecordPanelSlotProps['record'] = { type: 'alm.release', id: release.id };
  const canDeploy =
    release.viewer.canDeploy && release.status !== 'cancelled' && Boolean(app?.environments.length);

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" asChild className="-ml-2 text-muted-foreground">
        <Link href={appHref(release.application.code)}>
          <ArrowLeftIcon /> {release.application.name}
        </Link>
      </Button>

      <FadeIn y={4} className="flex flex-col gap-4 lg:flex-row lg:items-start">
        <div className="flex min-w-0 flex-1 items-start gap-4">
          <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
            <RocketIcon className="size-6" aria-hidden />
          </span>
          <div className="min-w-0 flex-1 space-y-1.5">
            <p className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
              <Link
                href={appHref(release.application.code)}
                className="hover:underline focus-visible:underline focus-visible:outline-none"
              >
                {release.application.name}
              </Link>
              <span aria-hidden>·</span>
              <span>{t('release.plannedFor')}</span>
              <PlannedDate date={release.plannedDate} />
            </p>
            <h1 className="flex flex-wrap items-baseline gap-x-3 text-2xl font-semibold tracking-tight wrap-anywhere">
              <span className="font-mono">{release.version}</span>
              {release.name && (
                <span className="text-lg font-normal text-muted-foreground">{release.name}</span>
              )}
            </h1>
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <ReleaseStatusBadge status={release.status} />
              {release.releasedAt && (
                <span>
                  {t('release.releasedOn')} <DateTime date={release.releasedAt} />
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {release.viewer.canManageReleases && (
            <Button variant="outline" onClick={() => setDialog('edit')}>
              <PencilIcon /> {t('release.edit')}
            </Button>
          )}
          {release.transitions.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" disabled={move.isPending}>
                  {t('release.changeStatus')} <ChevronDownIcon />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuLabel>{t('release.moveTo')}</DropdownMenuLabel>
                {release.transitions.map((s) => (
                  <DropdownMenuItem key={s} onSelect={() => move.mutate(s)}>
                    <ReleaseStatusBadge status={s} />
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {canDeploy && (
            <Button onClick={() => setDialog('deploy')}>
              <RocketIcon /> {t('app.recordDeployment')}
            </Button>
          )}
        </div>
      </FadeIn>

      <StatusStepper status={release.status} />

      <div className="grid min-w-0 grid-cols-1 items-start gap-6 lg:grid-cols-3">
        <div className="grid min-w-0 gap-6 lg:col-span-2">
          <Card className="min-w-0">
            <CardHeader>
              <CardTitle>{t('release.pipeline')}</CardTitle>
              <CardDescription>{t('release.pipelineHint', { version: release.version })}</CardDescription>
            </CardHeader>
            <CardContent>
              <VersionPipeline release={release} />
            </CardContent>
          </Card>
          <Card className="min-w-0">
            <CardHeader>
              <CardTitle>{t('fields.notes')}</CardTitle>
              {release.viewer.canManageReleases && (
                <CardAction>
                  <Button size="sm" variant="ghost" onClick={() => setDialog('edit')}>
                    <PencilIcon /> {t('release.editNotes')}
                  </Button>
                </CardAction>
              )}
            </CardHeader>
            <CardContent>
              {release.notes ? (
                <Markdown>{release.notes}</Markdown>
              ) : (
                <p className="text-sm text-muted-foreground">{t('release.noNotes')}</p>
              )}
            </CardContent>
          </Card>
          <section aria-labelledby="alm-release-deployments" className="grid min-w-0 gap-3">
            <h2 id="alm-release-deployments" className="text-base font-semibold">
              {t('release.deployments', { count: release.deploymentCount })}
            </h2>
            <DeploymentsTable
              application={release.application.code}
              release={release.id}
              environments={app?.environments ?? []}
            />
          </section>
        </div>
        <div className="grid min-w-0 gap-6">
          <ReadinessCard release={release} />
          <Slot
            name="core.record.links"
            props={{ record } satisfies RecordPanelSlotProps}
            fallback={<Skeleton className="h-28 w-full" />}
          />
          <Slot
            name="core.record.files"
            props={{ record } satisfies RecordPanelSlotProps}
            fallback={<Skeleton className="h-28 w-full" />}
          />
        </div>
      </div>

      {release.viewer.canManageReleases && (
        <ReleaseFormDialog
          open={dialog === 'edit'}
          onOpenChange={close}
          app={release.application}
          release={release}
          onSaved={(r) => r.version !== release.version && router.replace(releaseHref(code, r.version))}
        />
      )}
      {canDeploy && app && (
        <DeploymentDialog
          open={dialog === 'deploy'}
          onOpenChange={close}
          app={release.application}
          environments={app.environments}
          release={{ id: release.id, version: release.version }}
          canOverride={release.viewer.canOverride}
        />
      )}
    </div>
  );
}
