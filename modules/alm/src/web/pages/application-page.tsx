'use client';

import type { RecordPanelSlotProps } from '@isbp/contracts';
import { Slot, type WebPageProps } from '@isbp/sdk/web';
import { cn } from '@isbp/ui';
import { UserAvatar } from '@isbp/ui/avatar';
import { Badge } from '@isbp/ui/badge';
import { Button } from '@isbp/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@isbp/ui/card';
import { useListState } from '@isbp/ui/data-table';
import { EmptyState } from '@isbp/ui/empty-state';
import { Markdown, safeUrl } from '@isbp/ui/markdown';
import { FadeIn } from '@isbp/ui/motion';
import { useApiQuery } from '@isbp/ui/query';
import { RelativeTime } from '@isbp/ui/relative-time';
import { Skeleton } from '@isbp/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@isbp/ui/tabs';
import {
  AppWindowIcon,
  ArrowLeftIcon,
  BookOpenIcon,
  ChevronDownIcon,
  FilePenLineIcon,
  FileQuestionIcon,
  GitBranchIcon,
  GitCommitHorizontalIcon,
  GitPullRequestIcon,
  NetworkIcon,
  PencilIcon,
  PlusIcon,
  RefreshCwIcon,
  RocketIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import { type ReactNode, useId, useState } from 'react';
import type { AppDetail, PersonRef } from '../../contracts';
import { AppFormDialog } from '../app-form-dialog';
import { CriticalityBadge, DispositionBadge, HostingLabel, StageBadge } from '../badges';
import { CustomFieldsCard } from '../custom-fields';
import { DeploymentDialog } from '../deployment-dialog';
import { DeploymentsTable } from '../deployments-table';
import { DoraCard } from '../dora';
import { EnvironmentPipeline } from '../environment-pipeline';
import { releaseHref } from '../lib';
import { PlannedDate } from '../release-bits';
import { ReleaseFormDialog } from '../release-form-dialog';
import { ReleasesTable } from '../releases-table';
import { SettingsTab } from '../settings-tab';

const TABS = ['overview', 'releases', 'deployments', 'settings'] as const;
type Tab = (typeof TABS)[number];
type Dialog = 'edit' | 'release' | 'deploy' | null;

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,8.5rem)_minmax(0,1fr)] gap-3 py-2 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 wrap-anywhere">
        {children ?? <span className="text-muted-foreground">—</span>}
      </dd>
    </div>
  );
}

function Person({ person }: { person: PersonRef | null }) {
  if (!person) return null;
  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      <UserAvatar name={person.displayName} src={person.avatarUrl} className="size-5 text-[9px]" />
      <span className="truncate">{person.displayName}</span>
    </span>
  );
}

function OwnershipCard({ app }: { app: AppDetail }) {
  const t = useTranslations('alm');
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>{t('app.ownership')}</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="divide-y">
          <Field label={t('fields.businessOwner')}>
            <Person person={app.businessOwner} />
          </Field>
          <Field label={t('fields.technicalOwner')}>
            <Person person={app.technicalOwner} />
          </Field>
          <Field label={t('fields.team')}>{app.team?.name}</Field>
          <Field label={t('fields.supportGroup')}>{app.supportGroup?.name}</Field>
          <Field label={t('fields.department')}>{app.department?.name}</Field>
          {app.vendor && <Field label={t('fields.vendor')}>{app.vendor}</Field>}
        </dl>
      </CardContent>
    </Card>
  );
}

function DetailsCard({ app }: { app: AppDetail }) {
  const t = useTranslations('alm');
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>{t('app.details')}</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="divide-y">
          <Field label={t('fields.hosting')}>
            <HostingLabel hosting={app.hosting} />
          </Field>
          <Field label={t('fields.disposition')}>
            <DispositionBadge disposition={app.disposition} />
          </Field>
          <Field label={t('fields.dataClassification')}>
            {t(`classification.${app.dataClassification}`)}
          </Field>
          <Field label={t('fields.goLiveDate')}>
            {app.goLiveDate && <PlannedDate date={app.goLiveDate} />}
          </Field>
          {(app.retireDate || app.stage === 'sunsetting' || app.stage === 'retired') && (
            <Field label={t('fields.retireDate')}>
              {app.retireDate && <PlannedDate date={app.retireDate} />}
            </Field>
          )}
          <Field label={t('fields.techStack')}>
            {app.techStack.length > 0 && (
              <span className="flex flex-wrap gap-1">
                {app.techStack.map((s) => (
                  <Badge key={s} variant="secondary" className="font-normal">
                    {s}
                  </Badge>
                ))}
              </span>
            )}
          </Field>
          {app.documentationUrl && (
            <Field label={t('fields.documentationUrl')}>
              <a
                href={app.documentationUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-primary hover:underline focus-visible:underline focus-visible:outline-none"
              >
                <BookOpenIcon className="size-3.5" aria-hidden />
                {t('app.openDocs')}
              </a>
            </Field>
          )}
        </dl>
      </CardContent>
    </Card>
  );
}

function CiCard({ app }: { app: AppDetail }) {
  const t = useTranslations('alm');
  const tc = useTranslations('cmdb.status');
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <NetworkIcon className="size-4 text-primary" aria-hidden />
          {t('app.ci')}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {app.ci ? (
          <div className="grid gap-1">
            <Link
              href={`/cmdb/${app.ci.reference}`}
              className="truncate font-medium text-primary hover:underline focus-visible:underline focus-visible:outline-none"
            >
              {app.ci.name}
            </Link>
            <p className="text-xs text-muted-foreground">
              <span className="font-mono">{app.ci.reference}</span> ·{' '}
              {tc.has(app.ci.status) ? tc(app.ci.status) : app.ci.status}
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{t('app.noCi')}</p>
        )}
      </CardContent>
    </Card>
  );
}

type Repository = AppDetail['repositories'][number];

/** Branches of a synced repository, behind a toggle (the default branch first). */
function Branches({ repo }: { repo: Repository }) {
  const t = useTranslations('alm.git');
  const [open, setOpen] = useState(false);
  const listId = useId();
  const branches = [...(repo.branches ?? [])].sort((a, b) =>
    a.name === repo.defaultBranch ? -1 : b.name === repo.defaultBranch ? 1 : a.name.localeCompare(b.name),
  );
  return (
    <div className="grid min-w-0 gap-1">
      <p className="flex min-w-0 flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
        <GitBranchIcon className="size-3.5 shrink-0" aria-hidden />
        <span>{t('branches', { count: branches.length })}</span>
        {branches.length > 0 && (
          <Button
            variant="link"
            size="sm"
            className="h-auto p-0 text-xs"
            aria-expanded={open}
            aria-controls={listId}
            onClick={() => setOpen((o) => !o)}
          >
            {open ? t('hideBranches') : t('showBranches')}
            <ChevronDownIcon
              className={cn('transition-transform motion-reduce:transition-none', open && 'rotate-180')}
              aria-hidden
            />
          </Button>
        )}
      </p>
      {open && (
        <ul id={listId} className="grid max-h-48 gap-1 overflow-y-auto rounded-md border p-2 text-xs">
          {branches.map((b) => (
            <li key={b.name} className="flex min-w-0 items-center gap-2">
              <span className="truncate font-mono">{b.name}</span>
              {b.name === repo.defaultBranch && (
                <Badge variant="outline" className="shrink-0">
                  {t('defaultBranch')}
                </Badge>
              )}
              {b.committedAt && (
                <RelativeTime date={b.committedAt} className="ml-auto shrink-0 text-muted-foreground" />
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Active pull requests of a synced repository, linking out to the Git server. */
function PullRequests({ repo }: { repo: Repository }) {
  const t = useTranslations('alm.git');
  const prs = repo.pullRequests ?? [];
  return (
    <div className="grid min-w-0 gap-1.5">
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <GitPullRequestIcon className="size-3.5 shrink-0" aria-hidden />
        {t('pullRequests', { count: prs.length })}
      </p>
      {prs.length > 0 && (
        <ul className="grid gap-2 border-l pl-3">
          {prs.map((pr) => {
            const url = pr.url ? safeUrl(pr.url) : '';
            return (
              <li key={pr.id} className="grid min-w-0 gap-0.5 text-sm">
                <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                  {url ? (
                    <a
                      href={url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="min-w-0 font-medium wrap-anywhere text-primary hover:underline focus-visible:underline focus-visible:outline-none"
                    >
                      {pr.title}
                    </a>
                  ) : (
                    <span className="min-w-0 font-medium wrap-anywhere">{pr.title}</span>
                  )}
                  {pr.draft && (
                    <Badge variant="muted" className="gap-1">
                      <FilePenLineIcon aria-hidden />
                      {t('draft')}
                    </Badge>
                  )}
                </span>
                <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
                  {pr.author && <span>{pr.author}</span>}
                  {pr.author && <span aria-hidden>·</span>}
                  <span className="font-mono wrap-anywhere">
                    {t('mergeInto', { source: pr.sourceBranch, target: pr.targetBranch })}
                  </span>
                  {pr.createdAt && (
                    <>
                      <span aria-hidden>·</span>
                      <RelativeTime date={pr.createdAt} />
                    </>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** One repository with its Git status (default branch, last commit, branches, active pull requests). */
function RepositoryItem({ repo }: { repo: Repository }) {
  const t = useTranslations('alm');
  const synced = repo.branches !== null || repo.pullRequests !== null;
  return (
    <li className="grid min-w-0 gap-2">
      <div className="grid min-w-0 gap-1">
        <a
          href={repo.url}
          target="_blank"
          rel="noopener noreferrer"
          className="truncate text-sm font-medium text-primary hover:underline focus-visible:underline focus-visible:outline-none"
        >
          {repo.name}
        </a>
        <p className="flex min-w-0 flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
          <span>{t(`provider.${repo.provider}`)}</span>
          <span aria-hidden>·</span>
          <span className="inline-flex min-w-0 items-center gap-1 font-mono">
            <GitBranchIcon className="size-3 shrink-0" aria-hidden />
            <span className="truncate">{repo.defaultBranch}</span>
          </span>
        </p>
      </div>
      {repo.lastCommit && (
        <p className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
          <GitCommitHorizontalIcon className="size-3.5 shrink-0" aria-hidden />
          <span className="sr-only">{t('git.lastCommit')}</span>
          <span className="font-mono">{repo.lastCommit.sha.slice(0, 7)}</span>
          {repo.lastCommit.message && (
            <span className="min-w-0 basis-full truncate text-foreground sm:basis-auto sm:flex-1">
              {repo.lastCommit.message.split('\n')[0]}
            </span>
          )}
          {repo.lastCommit.author && (
            <span className="inline-flex gap-x-1.5">
              <span aria-hidden>·</span>
              {repo.lastCommit.author}
            </span>
          )}
          {repo.lastCommit.at && (
            <span className="inline-flex gap-x-1.5">
              <span aria-hidden>·</span>
              <RelativeTime date={repo.lastCommit.at} />
            </span>
          )}
        </p>
      )}
      {synced && (
        <div className="grid min-w-0 gap-2 rounded-lg border bg-muted/30 p-3">
          <Branches repo={repo} />
          <PullRequests repo={repo} />
        </div>
      )}
      {repo.syncedAt && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <RefreshCwIcon className="size-3 shrink-0" aria-hidden />
          <span>{t('git.synced')}</span>
          <RelativeTime date={repo.syncedAt} />
        </p>
      )}
    </li>
  );
}

function RepositoriesCard({ app }: { app: AppDetail }) {
  const t = useTranslations('alm');
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <GitBranchIcon className="size-4 text-primary" aria-hidden />
          {t('app.repositories')}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {app.repositories.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('app.noRepositories')}</p>
        ) : (
          <ul className="grid gap-5 divide-y [&>li:not(:first-child)]:pt-5">
            {app.repositories.map((r) => (
              <RepositoryItem key={r.id} repo={r} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export default function ApplicationPage({ params }: WebPageProps) {
  const t = useTranslations('alm');
  const format = useFormatter();
  const router = useRouter();
  const code = params.code ?? '';
  const {
    data: app,
    isLoading,
    error,
  } = useApiQuery<AppDetail>(`/alm/applications/${encodeURIComponent(code)}`);
  const [state, set] = useListState();
  const [dialog, setDialog] = useState<Dialog>(null);
  const close = (open: boolean) => !open && setDialog(null);

  if (isLoading)
    return (
      <div className="space-y-6">
        <Skeleton className="h-5 w-40" />
        <div className="flex items-center gap-4">
          <Skeleton className="size-12 rounded-xl" />
          <div className="space-y-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-7 w-64" />
          </div>
        </div>
        <Skeleton className="h-40 w-full rounded-xl" />
        <Skeleton className="h-72 w-full rounded-xl" />
      </div>
    );
  if (error || !app) return <EmptyState icon={<FileQuestionIcon />} title={t('app.notFound')} />;

  const visible = TABS.filter((tab) => tab !== 'settings' || app.viewer.canEdit);
  const tab: Tab = visible.includes(state.tab as Tab) ? (state.tab as Tab) : 'overview';
  const record: RecordPanelSlotProps['record'] = { type: 'alm.application', id: app.id };

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" asChild className="-ml-2 text-muted-foreground">
        <Link href="/alm">
          <ArrowLeftIcon /> {t('inventory.title')}
        </Link>
      </Button>

      <FadeIn y={4} className="flex flex-col gap-4 lg:flex-row lg:items-start">
        <div className="flex min-w-0 flex-1 items-start gap-4">
          <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
            <AppWindowIcon className="size-6" aria-hidden />
          </span>
          <div className="min-w-0 flex-1 space-y-1.5">
            <p className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
              <span className="font-mono">{app.code}</span>
              <span aria-hidden>·</span>
              <HostingLabel hosting={app.hosting} />
              {app.productionVersion && (
                <>
                  <span aria-hidden>·</span>
                  <span>{t('app.inProduction', { version: app.productionVersion })}</span>
                </>
              )}
            </p>
            <h1 className="text-2xl font-semibold tracking-tight wrap-anywhere">{app.name}</h1>
            <div className="flex flex-wrap items-center gap-2">
              <StageBadge stage={app.stage} />
              <CriticalityBadge criticality={app.criticality} />
              {app.disposition && <DispositionBadge disposition={app.disposition} />}
            </div>
            <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
              <span>
                {t('fields.businessOwner')}:{' '}
                <span className="text-foreground">
                  {app.businessOwner?.displayName ?? t('app.unassigned')}
                </span>
              </span>
              <span>
                {t('fields.technicalOwner')}:{' '}
                <span className="text-foreground">
                  {app.technicalOwner?.displayName ?? t('app.unassigned')}
                </span>
              </span>
            </p>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {app.viewer.canEdit && (
            <Button variant="outline" onClick={() => setDialog('edit')}>
              <PencilIcon /> {t('app.edit')}
            </Button>
          )}
          {app.viewer.canDeploy && app.environments.length > 0 && (
            <Button variant="outline" onClick={() => setDialog('deploy')}>
              <RocketIcon /> {t('app.recordDeployment')}
            </Button>
          )}
          {app.viewer.canManageReleases && (
            <Button onClick={() => setDialog('release')}>
              <PlusIcon /> {t('app.newRelease')}
            </Button>
          )}
        </div>
      </FadeIn>

      <Tabs
        value={tab}
        onValueChange={(v) =>
          set({ tab: v === 'overview' ? undefined : v, page: undefined, sort: undefined })
        }
      >
        <TabsList>
          <TabsTrigger value="overview">{t('app.tabs.overview')}</TabsTrigger>
          <TabsTrigger value="releases">
            {t('app.tabs.releases')}
            <Badge variant="muted" className="px-1.5 tabular-nums">
              {format.number(app.counts.releases)}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="deployments">
            {t('app.tabs.deployments')}
            <Badge variant="muted" className="px-1.5 tabular-nums">
              {format.number(app.counts.deployments)}
            </Badge>
          </TabsTrigger>
          {app.viewer.canEdit && <TabsTrigger value="settings">{t('app.tabs.settings')}</TabsTrigger>}
        </TabsList>

        <TabsContent value="overview" className="grid min-w-0 grid-cols-1 items-start gap-6 lg:grid-cols-3">
          <div className="grid min-w-0 gap-6 lg:col-span-2">
            <Card className="min-w-0">
              <CardHeader>
                <CardTitle>{t('pipeline.title')}</CardTitle>
              </CardHeader>
              <CardContent className="min-w-0">
                <EnvironmentPipeline code={app.code} environments={app.environments} />
              </CardContent>
            </Card>
            <DoraCard code={app.code} />
            <Card className="min-w-0">
              <CardHeader>
                <CardTitle>{t('fields.description')}</CardTitle>
              </CardHeader>
              <CardContent>
                {app.description ? (
                  <Markdown>{app.description}</Markdown>
                ) : (
                  <p className="text-sm text-muted-foreground">{t('app.noDescription')}</p>
                )}
              </CardContent>
            </Card>
            <RepositoriesCard app={app} />
            <CustomFieldsCard attributes={app.attributes} />
          </div>
          <div className="grid min-w-0 gap-6">
            <OwnershipCard app={app} />
            <CiCard app={app} />
            <DetailsCard app={app} />
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
        </TabsContent>

        <TabsContent value="releases" className="min-w-0">
          {tab === 'releases' && (
            <ReleasesTable
              code={app.code}
              onNew={app.viewer.canManageReleases ? () => setDialog('release') : undefined}
            />
          )}
        </TabsContent>

        <TabsContent value="deployments" className="min-w-0">
          {tab === 'deployments' && (
            <DeploymentsTable application={app.code} environments={app.environments} />
          )}
        </TabsContent>

        {app.viewer.canEdit && (
          <TabsContent value="settings" className="min-w-0">
            {tab === 'settings' && <SettingsTab app={app} />}
          </TabsContent>
        )}
      </Tabs>

      {app.viewer.canEdit && <AppFormDialog open={dialog === 'edit'} onOpenChange={close} app={app} />}
      {app.viewer.canManageReleases && (
        <ReleaseFormDialog
          open={dialog === 'release'}
          onOpenChange={close}
          app={app}
          onSaved={(r) => router.push(releaseHref(app.code, r.version))}
        />
      )}
      {app.viewer.canDeploy && (
        <DeploymentDialog
          open={dialog === 'deploy'}
          onOpenChange={close}
          app={app}
          environments={app.environments}
          canOverride={app.viewer.canOverride}
        />
      )}
    </div>
  );
}
