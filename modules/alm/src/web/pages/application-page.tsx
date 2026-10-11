'use client';

import { HStack } from '@astryxdesign/core/Layout';
import { Badge } from '@astryxdesign/core/Badge';
import { Button } from '@astryxdesign/core/Button';
import { Icon } from '@astryxdesign/core/Icon';
import { Link } from '@astryxdesign/core/Link';
import { Tab, TabList } from '@astryxdesign/core/TabList';
import { Text } from '@astryxdesign/core/Text';
import type { RecordPanelSlotProps } from '@isbp/contracts';
import { Slot, type WebPageProps } from '@isbp/sdk/web';
import { UserAvatar } from '@isbp/ui/avatar';
import { Card, CardContent, CardHeader, CardTitle } from '@isbp/ui/card';
import { useListState } from '@isbp/ui/data-table';
import { EmptyState } from '@isbp/ui/empty-state';
import { Markdown, safeUrl } from '@isbp/ui/markdown';
import { FadeIn } from '@isbp/ui/motion';
import { useApiQuery } from '@isbp/ui/query';
import { RelativeTime } from '@isbp/ui/relative-time';
import { Skeleton } from '@isbp/ui/skeleton';
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
                  <Badge variant="neutral" label={s} key={s} />
                ))}
              </span>
            )}
          </Field>
          {app.documentationUrl && (
            <Field label={t('fields.documentationUrl')}>
              <Link href={app.documentationUrl} target="_blank">
                <span className="inline-flex items-center gap-1">
                  <Icon icon={BookOpenIcon} size="xsm" />
                  {t('app.openDocs')}
                </span>
              </Link>
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
        <CardTitle>
          <HStack gap={2} vAlign="center">
            <Icon icon={NetworkIcon} color="accent" />
            {t('app.ci')}
          </HStack>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {app.ci ? (
          <div className="grid gap-1">
            <Link href={`/cmdb/${app.ci.reference}`} weight="medium">
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
            label={open ? t('hideBranches') : t('showBranches')}
            variant="ghost"
            size="sm"
            endContent={<Icon icon={ChevronDownIcon} />}
            aria-expanded={open}
            aria-controls={listId}
            onClick={() => setOpen((o) => !o)}
          />
        )}
      </p>
      {open && (
        <ul id={listId} className="grid max-h-48 gap-1 overflow-y-auto rounded-md border p-2 text-xs">
          {branches.map((b) => (
            <li key={b.name} className="flex min-w-0 items-center gap-2">
              <span className="truncate font-mono">{b.name}</span>
              {b.name === repo.defaultBranch && <Badge variant="neutral" label={t('defaultBranch')} />}
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
                    <Link href={url} target="_blank" weight="medium">
                      {pr.title}
                    </Link>
                  ) : (
                    <span className="min-w-0 font-medium wrap-anywhere">{pr.title}</span>
                  )}
                  {pr.draft && (
                    <Badge
                      variant="neutral"
                      label={t('draft')}
                      icon={<Icon icon={FilePenLineIcon} size="xsm" />}
                    />
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
        <Link href={repo.url} target="_blank" weight="medium">
          {repo.name}
        </Link>
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
        <CardTitle>
          <HStack gap={2} vAlign="center">
            <Icon icon={GitBranchIcon} color="accent" />
            {t('app.repositories')}
          </HStack>
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
  // The URL is the source of truth, but it reaches this page a render later: show the chosen tab at once.
  const [picked, setPicked] = useState<{ tab: string; seen: unknown } | null>(null);
  const panelId = useId();
  const close = (open: boolean) => !open && setDialog(null);

  if (isLoading)
    return (
      <div className="space-y-5">
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
  const rawTab = picked && picked.seen === state.tab ? picked.tab : state.tab;
  const tab: Tab = visible.includes(rawTab as Tab) ? (rawTab as Tab) : 'overview';
  const record: RecordPanelSlotProps['record'] = { type: 'alm.application', id: app.id };

  return (
    <div className="space-y-5">
      <Button
        label={t('inventory.title')}
        variant="ghost"
        size="sm"
        icon={<Icon icon={ArrowLeftIcon} />}
        href="/alm"
      />

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
            <h1 className="text-xl font-semibold tracking-tight wrap-anywhere">{app.name}</h1>
            <div className="flex flex-wrap items-center gap-2">
              <StageBadge stage={app.stage} />
              <CriticalityBadge criticality={app.criticality} />
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
            <Button
              label={t('app.edit')}
              variant="secondary"
              icon={<Icon icon={PencilIcon} />}
              onClick={() => setDialog('edit')}
            />
          )}
          {app.viewer.canDeploy && app.environments.length > 0 && (
            <Button
              label={t('app.recordDeployment')}
              variant="secondary"
              icon={<Icon icon={RocketIcon} />}
              onClick={() => setDialog('deploy')}
            />
          )}
          {app.viewer.canManageReleases && (
            <Button
              label={t('app.newRelease')}
              variant="primary"
              icon={<Icon icon={PlusIcon} />}
              onClick={() => setDialog('release')}
            />
          )}
        </div>
      </FadeIn>

      <TabList
        role="tablist"
        hasDivider
        value={tab}
        onChange={(v) => {
          setPicked({ tab: v, seen: state.tab });
          set({ tab: v === 'overview' ? undefined : v, page: undefined, sort: undefined });
        }}
      >
        <Tab value="overview" label={t('app.tabs.overview')} panelId={panelId} />
        <Tab
          value="releases"
          label={t('app.tabs.releases')}
          panelId={panelId}
          endContent={<Badge variant="neutral" label={format.number(app.counts.releases)} />}
        />
        <Tab
          value="deployments"
          label={t('app.tabs.deployments')}
          panelId={panelId}
          endContent={<Badge variant="neutral" label={format.number(app.counts.deployments)} />}
        />
        {app.viewer.canEdit && <Tab value="settings" label={t('app.tabs.settings')} panelId={panelId} />}
      </TabList>

      <div
        role="tabpanel"
        id={panelId}
        aria-label={t(`app.tabs.${tab}`)}
        className={
          tab === 'overview' ? 'grid min-w-0 grid-cols-1 items-start gap-4 lg:grid-cols-3' : 'min-w-0'
        }
      >
        {tab === 'overview' && (
          <>
            <div className="grid min-w-0 gap-4 lg:col-span-2">
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
                    <Text color="secondary">{t('app.noDescription')}</Text>
                  )}
                </CardContent>
              </Card>
              <RepositoriesCard app={app} />
              <CustomFieldsCard attributes={app.attributes} />
            </div>
            <div className="grid min-w-0 gap-4">
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
          </>
        )}
        {tab === 'releases' && (
          <ReleasesTable
            code={app.code}
            onNew={app.viewer.canManageReleases ? () => setDialog('release') : undefined}
          />
        )}
        {tab === 'deployments' && <DeploymentsTable application={app.code} environments={app.environments} />}
        {tab === 'settings' && app.viewer.canEdit && <SettingsTab app={app} />}
      </div>

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
