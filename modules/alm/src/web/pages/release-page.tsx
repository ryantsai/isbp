'use client';

import type { RecordPanelSlotProps } from '@isbp/contracts';
import { Slot, type WebPageProps } from '@isbp/sdk/web';
import { cn } from '@isbp/ui';
import { Button } from '@isbp/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@isbp/ui/card';
import { ErrorState } from '@isbp/ui/empty-state';
import { Markdown } from '@isbp/ui/markdown';
import { Stagger, StaggerItem } from '@isbp/ui/motion';
import { DetailHeader } from '@isbp/ui/page-header';
import { useApiMutation, useApiQuery } from '@isbp/ui/query';
import { DateTime, RelativeTime } from '@isbp/ui/relative-time';
import { Skeleton } from '@isbp/ui/skeleton';
import { CheckIcon, PencilIcon, RocketIcon } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import {
  type AppDetail,
  ENVIRONMENT_KINDS,
  type EnvironmentKind,
  type ReleaseDetail,
  type ReleaseStatus,
} from '../../contracts';
import { DeploymentStatusText, ENV_ICON, RELEASE_META } from '../badges';
import { DeploymentDialog } from '../deployment-dialog';
import { DeploymentsTable } from '../deployments-table';
import { appHref, INVALIDATE, releaseHref } from '../lib';
import { ReadinessCard } from '../readiness-card';
import { PlannedDate } from '../release-bits';
import { ReleaseFormDialog } from '../release-form-dialog';

const STEPS: ReleaseStatus[] = ['planned', 'in_progress', 'ready', 'released'];

/**
 * planned → in progress → ready → released, as plain progress text (it is the release's status, not a set of
 * buttons; the status menu changes it). Cancelled shows apart.
 */
function StatusStepper({ status }: { status: ReleaseStatus }) {
  const t = useTranslations('alm');
  if (status === 'cancelled')
    return (
      <p className="flex items-center gap-2 rounded-lg bg-muted/50 px-4 py-3 text-sm text-muted-foreground">
        <RELEASE_META.cancelled.icon className="size-4 shrink-0" aria-hidden />
        {t('release.cancelledBanner')}
      </p>
    );
  const current = STEPS.indexOf(status);
  return (
    <ol className="flex flex-wrap items-center gap-x-2 gap-y-2" aria-label={t('release.lifecycle')}>
      {STEPS.map((s, i) => {
        const done = i < current;
        const active = i === current;
        const Icon = done ? CheckIcon : RELEASE_META[s].icon;
        return (
          <li
            key={s}
            aria-current={active ? 'step' : undefined}
            className={cn(
              'flex min-w-0 items-center gap-2 text-sm',
              active ? 'font-semibold text-foreground' : done ? 'text-foreground' : 'text-muted-foreground',
            )}
          >
            {i > 0 && (
              <span
                aria-hidden
                className={cn('h-px w-6 sm:w-10', done || active ? 'bg-success' : 'bg-border')}
              />
            )}
            <span
              className={cn(
                'grid size-6 shrink-0 place-items-center rounded-full',
                done && 'bg-success/12 text-success',
                active && 'bg-primary text-primary-foreground',
                !active && !done && 'bg-muted',
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
  const searchParams = useSearchParams();
  // `?deploy=production` (the "ready for production" notification) opens Record deployment for that environment.
  const linkKind = searchParams.get('deploy');
  const [dialog, setDialog] = useState<'edit' | 'deploy' | null>(linkKind ? 'deploy' : null);
  const [deployKind, setDeployKind] = useState<EnvironmentKind | null>(
    ENVIRONMENT_KINDS.includes(linkKind as EnvironmentKind) ? (linkKind as EnvironmentKind) : null,
  );
  const close = (open: boolean) => !open && setDialog(null);
  const openDeploy = (kind: EnvironmentKind | null) => {
    setDeployKind(kind);
    setDialog('deploy');
  };
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
      <div className="space-y-5">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-14 w-full rounded-xl" />
        <Skeleton className="h-72 w-full rounded-xl" />
      </div>
    );
  if (error || !release) return <ErrorState error={error} kind="page" />;

  const record: RecordPanelSlotProps['record'] = { type: 'alm.release', id: release.id };
  const canDeploy =
    release.viewer.canDeploy && release.status !== 'cancelled' && Boolean(app?.environments.length);

  return (
    <div className="space-y-5">
      <DetailHeader
        className="pb-0"
        back={{ href: appHref(release.application.code), label: release.application.name }}
        icon={<RocketIcon />}
        reference={
          <span className="flex flex-wrap items-center gap-x-2">
            <span>{release.application.name}</span>
            <span aria-hidden>·</span>
            <span>{t('release.plannedFor')}</span>
            <PlannedDate date={release.plannedDate} />
            {release.releasedAt && (
              <>
                <span aria-hidden>·</span>
                <span>
                  {t('release.releasedOn')} <DateTime date={release.releasedAt} />
                </span>
              </>
            )}
          </span>
        }
        title={
          <span className="flex flex-wrap items-baseline gap-x-3">
            <span className="font-mono">{release.version}</span>
            {release.name && (
              <span className="text-lg font-normal text-muted-foreground">{release.name}</span>
            )}
          </span>
        }
        primaryAction={
          canDeploy && (
            <Button onClick={() => openDeploy(null)}>
              <RocketIcon /> {t('app.recordDeployment')}
            </Button>
          )
        }
        actions={
          release.viewer.canManageReleases
            ? [
                {
                  id: 'edit',
                  label: t('release.edit'),
                  icon: <PencilIcon />,
                  onSelect: () => setDialog('edit'),
                },
              ]
            : []
        }
        menu={release.transitions.map((st) => ({
          id: st,
          label: t('release.moveToStatus', { status: t(`releaseStatus.${st}`) }),
          disabled: move.isPending,
          onSelect: () => move.mutate(st),
        }))}
      />

      <StatusStepper status={release.status} />

      <div className="grid min-w-0 grid-cols-1 items-start gap-4 lg:grid-cols-3">
        <div className="grid min-w-0 gap-4 lg:col-span-2">
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
        <div className="grid min-w-0 gap-4">
          <ReadinessCard
            release={release}
            onEditNotes={release.viewer.canManageReleases ? () => setDialog('edit') : undefined}
            onDeploy={canDeploy ? (kind) => openDeploy(kind) : undefined}
          />
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
          onOpenChange={(open) => {
            close(open);
            if (!open && searchParams.get('deploy'))
              router.replace(releaseHref(code, release.version), { scroll: false });
          }}
          app={release.application}
          environments={app.environments}
          release={{ id: release.id, version: release.version }}
          canOverride={release.viewer.canOverride}
          environmentKind={deployKind ?? undefined}
        />
      )}
    </div>
  );
}
