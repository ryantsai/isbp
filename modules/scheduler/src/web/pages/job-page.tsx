'use client';

import type { RecordPanelSlotProps } from '@isbp/contracts';
import { Slot, type WebPageProps } from '@isbp/sdk/web';
import { UserAvatar } from '@isbp/ui/avatar';
import { Badge } from '@isbp/ui/badge';
import { Button } from '@isbp/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@isbp/ui/card';
import { CodeEditor } from '@isbp/ui/code-editor';
import { useListState } from '@isbp/ui/data-table';
import { EmptyState } from '@isbp/ui/empty-state';
import { Markdown } from '@isbp/ui/markdown';
import { FadeIn } from '@isbp/ui/motion';
import { useApiMutation, useApiQuery } from '@isbp/ui/query';
import { DateTime, RelativeTime } from '@isbp/ui/relative-time';
import { Skeleton } from '@isbp/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@isbp/ui/tabs';
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ExternalLinkIcon,
  FileQuestionIcon,
  GitMergeIcon,
  PauseIcon,
  PencilIcon,
  PlayIcon,
  Trash2Icon,
  TriangleAlertIcon,
  UsersIcon,
  ZapIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import { type ReactNode, useId, useState } from 'react';
import { BUILTIN_TYPES, type JobDetail, type RunDetail } from '../../contracts';
import { JobStateBadge, RunStatusText, TaskIcon, TRIGGER_ICON } from '../badges';
import { ConfirmDialog } from '../confirm-dialog';
import { INVALIDATE, jobHref, runHref, useSeconds, useTaskTypes, useTypeName } from '../lib';
import { RunsTable } from '../runs-table';
import { useTriggerText } from '../trigger-text';

const TABS = ['overview', 'runs'] as const;
type Tab = (typeof TABS)[number];

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

const str = (v: unknown) => (typeof v === 'string' ? v : '');

/** What the built-in task does, in a few fields (secrets stay hidden). */
function TaskDetails({ job }: { job: JobDetail }) {
  const t = useTranslations('scheduler');
  const id = useId();
  const c = job.config as Record<string, unknown>;
  if (job.type === BUILTIN_TYPES.http)
    return (
      <dl className="divide-y border-t">
        <Field label={t('http.request')}>
          <span className="font-mono text-xs">
            {str(c.method)} {str(c.url)}
          </span>
        </Field>
        <Field label={t('http.expectedStatus')}>{str(c.expectedStatus)}</Field>
        <Field label={t('http.auth')}>
          {t(`http.authType.${str((c.auth as { type?: string })?.type) || 'none'}`)}
        </Field>
        {Array.isArray(c.headers) && c.headers.length > 0 && (
          <Field label={t('http.headers')}>
            <ul className="grid gap-0.5 font-mono text-xs">
              {(c.headers as { name: string; secret: boolean; value: unknown }[]).map((h) => (
                <li key={h.name}>
                  {h.name}: {h.secret ? '••••••' : str(h.value)}
                </li>
              ))}
            </ul>
          </Field>
        )}
      </dl>
    );
  if (job.type === BUILTIN_TYPES.sql || job.type === BUILTIN_TYPES.script) {
    const isSql = job.type === BUILTIN_TYPES.sql;
    const lang = str(c.language);
    return (
      <div className="grid gap-2 pt-2">
        <p id={`${id}-code`} className="text-sm text-muted-foreground">
          {isSql ? t('sql.statement') : t('script.script')}
        </p>
        <CodeEditor
          aria-labelledby={`${id}-code`}
          readOnly
          value={str(isSql ? c.statement : c.script)}
          language={
            isSql
              ? 'sql'
              : lang === 'node'
                ? 'javascript'
                : lang === 'python'
                  ? 'python'
                  : lang === 'powershell'
                    ? 'powershell'
                    : 'shell'
          }
          minHeight="4rem"
          maxHeight="18rem"
        />
        {isSql && <p className="text-xs text-muted-foreground">{t(`sql.modes.${str(c.mode) || 'query'}`)}</p>}
      </div>
    );
  }
  return null;
}

function DependenciesCard({ job }: { job: JobDetail }) {
  const t = useTranslations('scheduler.job');
  if (!job.upstream.length && !job.downstream.length) return null;
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <GitMergeIcon className="size-4 text-primary" aria-hidden />
          {t('dependencies')}
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2">
        <div className="min-w-0">
          <h3 className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
            {t('upstream', { mode: job.trigger.mode ?? 'all' })}
          </h3>
          {job.upstream.length ? (
            <ul className="grid gap-2" aria-label={t('upstreamList')}>
              {job.upstream.map((u) => (
                <li key={u.id} className="flex min-w-0 items-center justify-between gap-2 text-sm">
                  <Link href={jobHref(u.id)} className="min-w-0 truncate font-medium hover:underline">
                    {u.name}
                  </Link>
                  {u.lastStatus && <RunStatusText status={u.lastStatus} className="shrink-0" />}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">{t('noUpstream')}</p>
          )}
        </div>
        <div className="min-w-0">
          <h3 className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
            {t('downstream')}
          </h3>
          {job.downstream.length ? (
            <ul className="grid gap-2" aria-label={t('downstreamList')}>
              {job.downstream.map((d) => (
                <li key={d.id} className="flex min-w-0 items-center justify-between gap-2 text-sm">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <ArrowRightIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                    <Link href={jobHref(d.id)} className="min-w-0 truncate font-medium hover:underline">
                      {d.name}
                    </Link>
                  </span>
                  {d.lastStatus && <RunStatusText status={d.lastStatus} className="shrink-0" />}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">{t('noDownstream')}</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default function JobPage({ params }: WebPageProps) {
  const t = useTranslations('scheduler');
  const format = useFormatter();
  const router = useRouter();
  const triggerText = useTriggerText();
  const typeName = useTypeName();
  const seconds = useSeconds();
  const { sandbox } = useTaskTypes();
  const id = params.id ?? '';
  const path = `/scheduler/jobs/${id}`;
  const {
    data: job,
    isLoading,
    error,
  } = useApiQuery<JobDetail>(path, undefined, { refetchInterval: 15_000 });
  const [state, set] = useListState();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const run = useApiMutation((api) => api.post<RunDetail>(`${path}/run`), {
    invalidate: INVALIDATE,
    success: t('job.runQueued'),
    onSuccess: (r) => router.push(runHref(r.id)),
  });
  const toggle = useApiMutation(
    (api, enable: boolean) => api.post<JobDetail>(`${path}/${enable ? 'enable' : 'disable'}`),
    {
      invalidate: INVALIDATE,
      success: (j) => (j.enabled ? t('job.enabledToast') : t('job.disabledToast')),
    },
  );
  const remove = useApiMutation((api) => api.delete(path), {
    invalidate: INVALIDATE,
    success: t('job.deleted'),
    onSuccess: () => router.push('/scheduler/jobs'),
  });

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
        <Skeleton className="h-72 w-full rounded-xl" />
      </div>
    );
  if (error || !job) return <EmptyState icon={<FileQuestionIcon />} title={t('job.notFound')} />;

  const tab: Tab = TABS.includes(state.tab as Tab) ? (state.tab as Tab) : 'overview';
  const record: RecordPanelSlotProps['record'] = { type: 'scheduler.job', id: job.id };
  const TriggerIcon = TRIGGER_ICON[job.trigger.kind];
  const scriptBlocked = job.type === BUILTIN_TYPES.script && sandbox.runner === 'none';

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" asChild className="-ml-2 text-muted-foreground">
        <Link href="/scheduler/jobs">
          <ArrowLeftIcon /> {t('jobs.title')}
        </Link>
      </Button>

      <FadeIn y={4} className="flex flex-col gap-4 lg:flex-row lg:items-start">
        <div className="flex min-w-0 flex-1 items-start gap-4">
          <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
            <TaskIcon icon={job.task.icon} className="size-6" />
          </span>
          <div className="min-w-0 flex-1 space-y-1.5">
            <p className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
              <span className="font-mono">{job.reference}</span>
              <span aria-hidden>·</span>
              <span>{typeName(job.task.name, job.type)}</span>
            </p>
            <h1 className="text-2xl font-semibold tracking-tight wrap-anywhere">{job.name}</h1>
            <div className="flex flex-wrap items-center gap-2">
              <JobStateBadge enabled={job.enabled} disabledReason={job.disabledReason} />
              {job.running && (
                <Badge variant="info">
                  <ZapIcon aria-hidden /> {t('job.runningNow')}
                </Badge>
              )}
              {job.failureStreak > 0 && (
                <Badge variant="destructive">
                  <TriangleAlertIcon aria-hidden /> {t('jobs.streak', { count: job.failureStreak })}
                </Badge>
              )}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {job.viewer.canEdit && (
            <Button
              variant="outline"
              loading={toggle.isPending}
              disabled={!job.enabled && scriptBlocked}
              onClick={() => toggle.mutate(!job.enabled)}
            >
              {job.enabled ? <PauseIcon /> : <PlayIcon />} {job.enabled ? t('job.disable') : t('job.enable')}
            </Button>
          )}
          {job.viewer.canEdit && (
            <Button variant="outline" asChild>
              <Link href={`${jobHref(job.id)}/edit`}>
                <PencilIcon /> {t('job.edit')}
              </Link>
            </Button>
          )}
          {job.viewer.canDelete && (
            <Button variant="outline" onClick={() => setConfirmDelete(true)} aria-label={t('job.delete')}>
              <Trash2Icon />
              <span className="sm:hidden">{t('job.delete')}</span>
            </Button>
          )}
          {job.viewer.canRun && (
            <Button loading={run.isPending} disabled={scriptBlocked} onClick={() => run.mutate(undefined)}>
              <PlayIcon /> {t('job.runNow')}
            </Button>
          )}
        </div>
      </FadeIn>

      {scriptBlocked && (
        <p
          role="status"
          className="flex items-start gap-2 rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning-foreground"
        >
          <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
          {t('script.runnerNone')}
        </p>
      )}
      {!job.task.available && (
        <p
          role="status"
          className="flex items-start gap-2 rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning-foreground"
        >
          <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
          {t('job.typeUnavailable', { type: job.type })}
        </p>
      )}

      <Tabs
        value={tab}
        onValueChange={(v) =>
          set({ tab: v === 'overview' ? undefined : v, page: undefined, sort: undefined })
        }
      >
        <TabsList>
          <TabsTrigger value="overview">{t('job.tabs.overview')}</TabsTrigger>
          <TabsTrigger value="runs">
            {t('job.tabs.runs')}
            <Badge variant="muted" className="px-1.5 tabular-nums">
              {format.number(job.runs.total)}
            </Badge>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="grid min-w-0 grid-cols-1 items-start gap-6 lg:grid-cols-3">
          <div className="grid min-w-0 gap-6 lg:col-span-2">
            <Card className="min-w-0">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <TriggerIcon className="size-4 text-primary" aria-hidden />
                  {t('job.schedule')}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="divide-y">
                  <Field label={t('fields.trigger')}>
                    <span className="flex flex-col">
                      <span>{triggerText(job.trigger)}</span>
                      {job.trigger.kind === 'cron' && (
                        <span className="font-mono text-xs text-muted-foreground">{job.trigger.cron}</span>
                      )}
                    </span>
                  </Field>
                  <Field label={t('job.nextRun')}>
                    {job.enabled && job.nextRunAt ? (
                      <span className="flex flex-col">
                        <DateTime date={job.nextRunAt} />
                        <RelativeTime date={job.nextRunAt} className="text-xs text-muted-foreground" />
                      </span>
                    ) : (
                      <span className="text-muted-foreground">
                        {!job.enabled
                          ? t('job.notScheduledDisabled')
                          : t(`job.notScheduled.${job.trigger.kind}`)}
                      </span>
                    )}
                  </Field>
                  <Field label={t('fields.lastRun')}>
                    {job.lastRun ? (
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <Link href={runHref(job.lastRun.id)} className="hover:underline">
                          <RunStatusText status={job.lastRun.status} />
                        </Link>
                        <RelativeTime
                          date={job.lastRun.finishedAt ?? job.lastRun.startedAt ?? job.lastRun.scheduledFor}
                          className="text-xs text-muted-foreground"
                        />
                        {job.lastRun.summary && (
                          <span className="text-xs text-muted-foreground">· {job.lastRun.summary}</span>
                        )}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">{t('jobs.neverRun')}</span>
                    )}
                  </Field>
                  <Field label={t('job.lastSuccess')}>
                    {job.lastSuccessAt ? <RelativeTime date={job.lastSuccessAt} /> : null}
                  </Field>
                  <Field label={t('job.last7days')}>
                    {t('job.last7daysValue', { succeeded: job.runs.succeeded7d, failed: job.runs.failed7d })}
                  </Field>
                </dl>
              </CardContent>
            </Card>

            <Card className="min-w-0">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <TaskIcon icon={job.task.icon} className="text-primary" />
                  {t('job.task')}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="divide-y">
                  <Field label={t('fields.taskType')}>{typeName(job.task.name, job.type)}</Field>
                  <Field label={t('job.what')}>
                    <span className="flex flex-col gap-0.5">
                      <span>{job.task.label}</span>
                      {job.task.href && (
                        <Link
                          href={job.task.href}
                          className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                        >
                          <ExternalLinkIcon className="size-3" aria-hidden /> {t('job.openTask')}
                        </Link>
                      )}
                    </span>
                  </Field>
                </dl>
                <TaskDetails job={job} />
              </CardContent>
            </Card>

            <DependenciesCard job={job} />

            {job.description && (
              <Card className="min-w-0">
                <CardHeader>
                  <CardTitle>{t('fields.description')}</CardTitle>
                </CardHeader>
                <CardContent>
                  <Markdown>{job.description}</Markdown>
                </CardContent>
              </Card>
            )}
          </div>
          <div className="grid min-w-0 gap-6">
            <Card className="min-w-0">
              <CardHeader>
                <CardTitle>{t('job.ownership')}</CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="divide-y">
                  <Field label={t('fields.owner')}>
                    {job.owner && (
                      <span className="inline-flex min-w-0 items-center gap-2">
                        <UserAvatar
                          name={job.owner.displayName}
                          src={job.owner.avatarUrl}
                          className="size-5 text-[9px]"
                        />
                        <span className="truncate">{job.owner.displayName}</span>
                      </span>
                    )}
                  </Field>
                  <Field label={t('fields.ownerGroup')}>
                    {job.ownerGroup && (
                      <span className="inline-flex min-w-0 items-center gap-2">
                        <UsersIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                        <span className="truncate">{job.ownerGroup.name}</span>
                      </span>
                    )}
                  </Field>
                  <Field label={t('job.created')}>
                    <span className="flex flex-col">
                      <DateTime date={job.createdAt} />
                      {job.createdBy && (
                        <span className="text-xs text-muted-foreground">{job.createdBy.displayName}</span>
                      )}
                    </span>
                  </Field>
                </dl>
              </CardContent>
            </Card>
            <Card className="min-w-0">
              <CardHeader>
                <CardTitle>{t('job.execution')}</CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="divide-y">
                  <Field label={t('fields.timeout')}>{seconds(job.timeoutSeconds)}</Field>
                  <Field label={t('fields.retries')}>
                    {job.retries.maxAttempts > 1
                      ? t('job.retriesValue', {
                          attempts: job.retries.maxAttempts,
                          backoff: job.retries.backoff,
                          delay: seconds(job.retries.delaySeconds),
                        })
                      : t('job.noRetries')}
                  </Field>
                  <Field label={t('fields.concurrency')}>{t(`concurrency.${job.concurrency}`)}</Field>
                  <Field label={t('fields.alerts')}>
                    <span className="flex flex-col gap-0.5">
                      <span>{job.alerts.onFailure ? t('job.alertsOn') : t('job.alertsOff')}</span>
                      {job.alerts.channels && <span>{t('job.alertsChannels')}</span>}
                      {job.alerts.autoDisableAfter > 0 && (
                        <span>{t('job.autoDisableValue', { count: job.alerts.autoDisableAfter })}</span>
                      )}
                    </span>
                  </Field>
                </dl>
              </CardContent>
            </Card>
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

        <TabsContent value="runs" className="min-w-0">
          {tab === 'runs' && <RunsTable jobId={job.id} label={t('job.runsOf', { job: job.name })} />}
        </TabsContent>
      </Tabs>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={t('job.deleteTitle', { name: job.name })}
        description={t('job.deleteHint')}
        confirmLabel={t('job.delete')}
        destructive
        loading={remove.isPending}
        onConfirm={() => remove.mutate(undefined)}
      />
    </div>
  );
}
