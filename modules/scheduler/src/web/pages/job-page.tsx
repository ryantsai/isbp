'use client';

import { HStack } from '@astryxdesign/core/Layout';
import { Badge } from '@astryxdesign/core/Badge';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Icon } from '@astryxdesign/core/Icon';
import { Link } from '@astryxdesign/core/Link';
import { Tab, TabList } from '@astryxdesign/core/TabList';
import { Text } from '@astryxdesign/core/Text';
import type { RecordPanelSlotProps } from '@isbp/contracts';
import { Slot, type WebPageProps } from '@isbp/sdk/web';
import { UserAvatar } from '@isbp/ui/avatar';
import { Card, CardContent, CardHeader, CardTitle } from '@isbp/ui/card';
import { CodeEditor } from '@isbp/ui/code-editor';
import { useListState } from '@isbp/ui/data-table';
import { ErrorState } from '@isbp/ui/empty-state';
import { Markdown } from '@isbp/ui/markdown';
import { DetailHeader } from '@isbp/ui/page-header';
import { useApiMutation, useApiQuery } from '@isbp/ui/query';
import { DateTime, RelativeTime } from '@isbp/ui/relative-time';
import { RunProblemBanner } from '@isbp/ui/run-detail';
import { Skeleton } from '@isbp/ui/skeleton';
import { StatusBadge } from '@isbp/ui/status';
import {
  ArrowRightIcon,
  ExternalLinkIcon,
  GitMergeIcon,
  PauseIcon,
  PencilIcon,
  PlayIcon,
  Trash2Icon,
  TriangleAlertIcon,
  UsersIcon,
  ZapIcon,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import { type ReactNode, useId, useState } from 'react';
import { BUILTIN_TYPES, type JobDetail, type RunDetail } from '../../contracts';
import { JobStateBadge, RunStatusText, TaskIcon, TRIGGER_ICON } from '../badges';
import { ConfirmDialog } from '../confirm-dialog';
import { INVALIDATE, jobHref, runHref, useRunResult, useSeconds, useTaskTypes, useTypeName } from '../lib';
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
        <Text id={`${id}-code`} color="secondary">
          {isSql ? t('sql.statement') : t('script.script')}
        </Text>
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
        {isSql && <Text type="supporting">{t(`sql.modes.${str(c.mode) || 'query'}`)}</Text>}
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
        <CardTitle>
          <HStack gap={2} vAlign="center">
            <Icon icon={GitMergeIcon} color="accent" />
            {t('dependencies')}
          </HStack>
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2">
        <div className="min-w-0">
          <h3 className="mb-2 text-xs font-semibold text-muted-foreground">
            {t('upstream', { mode: job.trigger.mode ?? 'all' })}
          </h3>
          {job.upstream.length ? (
            <ul className="grid gap-2" aria-label={t('upstreamList')}>
              {job.upstream.map((u) => (
                <li key={u.id} className="flex min-w-0 items-center justify-between gap-2 text-sm">
                  <Link href={jobHref(u.id)} weight="medium" maxLines={1}>
                    {u.name}
                  </Link>
                  {u.lastStatus && <RunStatusText status={u.lastStatus} className="shrink-0" />}
                </li>
              ))}
            </ul>
          ) : (
            <Text color="secondary">{t('noUpstream')}</Text>
          )}
        </div>
        <div className="min-w-0">
          <h3 className="mb-2 text-xs font-semibold text-muted-foreground">{t('downstream')}</h3>
          {job.downstream.length ? (
            <ul className="grid gap-2" aria-label={t('downstreamList')}>
              {job.downstream.map((d) => (
                <li key={d.id} className="flex min-w-0 items-center justify-between gap-2 text-sm">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <Icon icon={ArrowRightIcon} size="xsm" color="secondary" />
                    <Link href={jobHref(d.id)} weight="medium" maxLines={1}>
                      {d.name}
                    </Link>
                  </span>
                  {d.lastStatus && <RunStatusText status={d.lastStatus} className="shrink-0" />}
                </li>
              ))}
            </ul>
          ) : (
            <Text color="secondary">{t('noDownstream')}</Text>
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
  const runResult = useRunResult();
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
  // The URL is the source of truth, but it reaches this page a render later: show the chosen tab at once.
  const [picked, setPicked] = useState<{ tab: string; seen: unknown } | null>(null);
  const panelId = useId();

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
      <div className="space-y-5">
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
  if (error || !job) return <ErrorState error={error} kind="page" />;

  const rawTab = picked && picked.seen === state.tab ? picked.tab : state.tab;
  const tab: Tab = TABS.includes(rawTab as Tab) ? (rawTab as Tab) : 'overview';
  const lastResult = job.lastRun ? runResult(job.lastRun) : null;
  const failing =
    job.failureStreak > 0 && (job.lastRun?.status === 'failed' || job.lastRun?.status === 'timed_out');
  // An attempt failed and the run tries again: say why now, not only after the last attempt.
  const retrying = job.lastRun?.status === 'retrying' && Boolean(job.lastRun.problem || job.lastRun.error);
  const record: RecordPanelSlotProps['record'] = { type: 'scheduler.job', id: job.id };
  const scriptBlocked = job.type === BUILTIN_TYPES.script && sandbox.runner === 'none';

  return (
    <div className="space-y-5">
      <DetailHeader
        className="pb-0"
        back={{ href: '/scheduler/jobs', label: t('nav.jobs'), highlight: job.id }}
        icon={<TaskIcon icon={job.task.icon} />}
        reference={`${job.reference} · ${typeName(job.task.name, job.type)}`}
        title={job.name}
        status={
          <>
            {!job.enabled && <JobStateBadge enabled={job.enabled} disabledReason={job.disabledReason} />}
            {job.running && <StatusBadge tone="info" icon={ZapIcon} label={t('job.runningNow')} />}
            {job.failureStreak > 0 && (
              <StatusBadge
                tone="destructive"
                icon={TriangleAlertIcon}
                label={t('jobs.streak', { count: job.failureStreak })}
              />
            )}
          </>
        }
        meta={
          job.enabled && job.nextRunAt ? (
            <span>
              {t('job.nextRunMeta')} <RelativeTime date={job.nextRunAt} />
            </span>
          ) : undefined
        }
        primaryAction={
          job.viewer.canRun && (
            <Button
              label={t('job.runNow')}
              variant="primary"
              icon={<Icon icon={PlayIcon} />}
              isLoading={run.isPending}
              isDisabled={scriptBlocked}
              onClick={() => run.mutate(undefined)}
            />
          )
        }
        actions={[
          ...(job.viewer.canEdit
            ? [
                { label: t('job.edit'), icon: <PencilIcon />, href: `${jobHref(job.id)}/edit` },
                {
                  label: job.enabled ? t('job.disable') : t('job.enable'),
                  icon: job.enabled ? <PauseIcon /> : <PlayIcon />,
                  disabled: toggle.isPending || (!job.enabled && scriptBlocked),
                  onSelect: () => toggle.mutate(!job.enabled),
                },
              ]
            : []),
        ]}
        menu={
          job.viewer.canDelete
            ? [
                {
                  label: t('job.delete'),
                  icon: <Trash2Icon />,
                  destructive: true,
                  onSelect: () => setConfirmDelete(true),
                },
              ]
            : []
        }
      />

      {(failing || retrying) && job.lastRun && (
        <RunProblemBanner
          problem={job.lastRun.problem}
          error={job.lastRun.error}
          tone={failing ? 'destructive' : 'warning'}
          actions={
            <Button
              label={t('job.seeLastRun')}
              variant="secondary"
              size="sm"
              href={runHref(job.lastRun.id)}
            />
          }
        />
      )}

      {scriptBlocked && (
        <Banner role="status" status="warning" collapsible={false} title={t('script.runnerNone')} />
      )}
      {!job.task.available && (
        <Banner
          role="status"
          status="warning"
          collapsible={false}
          title={t('job.typeUnavailable', { type: job.type })}
        />
      )}

      <TabList
        role="tablist"
        hasDivider
        value={tab}
        onChange={(v) => {
          setPicked({ tab: v, seen: state.tab });
          set({ tab: v === 'overview' ? undefined : v, page: undefined, sort: undefined });
        }}
      >
        <Tab value="overview" label={t('job.tabs.overview')} panelId={panelId} />
        <Tab
          value="runs"
          label={t('job.tabs.runs')}
          panelId={panelId}
          endContent={<Badge variant="neutral" label={format.number(job.runs.total)} />}
        />
      </TabList>

      <div
        role="tabpanel"
        id={panelId}
        aria-label={t(`job.tabs.${tab}`)}
        className={
          tab === 'overview' ? 'grid min-w-0 grid-cols-1 items-start gap-4 lg:grid-cols-3' : 'min-w-0'
        }
      >
        {tab === 'overview' && (
          <>
            <div className="grid min-w-0 gap-4 lg:col-span-2">
              <Card className="min-w-0">
                <CardHeader>
                  <CardTitle>
                    <HStack gap={2} vAlign="center">
                      <Icon icon={TRIGGER_ICON[job.trigger.kind]} color="accent" />
                      {t('job.schedule')}
                    </HStack>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <dl className="divide-y">
                    <Field label={t('fields.trigger')}>
                      <span className="flex flex-col">
                        <span>{triggerText(job.trigger)}</span>
                        {job.trigger.kind === 'cron' && (
                          <Text type="code" color="secondary">
                            {job.trigger.cron}
                          </Text>
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
                        <Text color="secondary">
                          {!job.enabled
                            ? t('job.notScheduledDisabled')
                            : t(`job.notScheduled.${job.trigger.kind}`)}
                        </Text>
                      )}
                    </Field>
                    <Field label={t('fields.lastRun')}>
                      {job.lastRun ? (
                        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <Link href={runHref(job.lastRun.id)} size="xsm">
                            <RunStatusText status={job.lastRun.status} />
                          </Link>
                          <RelativeTime
                            date={job.lastRun.finishedAt ?? job.lastRun.startedAt ?? job.lastRun.scheduledFor}
                            className="text-xs text-muted-foreground"
                          />
                          {lastResult?.text && (
                            <span className="text-xs text-muted-foreground">· {lastResult.text}</span>
                          )}
                        </span>
                      ) : (
                        <Text color="secondary">{t('jobs.neverRun')}</Text>
                      )}
                    </Field>
                    <Field label={t('job.lastSuccess')}>
                      {job.lastSuccessAt ? <RelativeTime date={job.lastSuccessAt} /> : null}
                    </Field>
                    <Field label={t('job.last7days')}>
                      {t('job.last7daysValue', {
                        succeeded: job.runs.succeeded7d,
                        failed: job.runs.failed7d,
                      })}
                    </Field>
                  </dl>
                </CardContent>
              </Card>

              <Card className="min-w-0">
                <CardHeader>
                  <CardTitle>
                    <HStack gap={2} vAlign="center">
                      <TaskIcon icon={job.task.icon} color="accent" />
                      {t('job.task')}
                    </HStack>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <dl className="divide-y">
                    <Field label={t('fields.taskType')}>{typeName(job.task.name, job.type)}</Field>
                    <Field label={t('job.what')}>
                      <span className="flex flex-col gap-0.5">
                        <span>{job.task.label}</span>
                        {job.task.href && (
                          <Link href={job.task.href} size="xsm">
                            <span className="inline-flex items-center gap-1">
                              <Icon icon={ExternalLinkIcon} size="xsm" /> {t('job.openTask')}
                            </span>
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
            <div className="grid min-w-0 gap-4">
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
                          <Icon icon={UsersIcon} color="secondary" />
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
                    <Field label={t('job.timeout')}>{seconds(job.timeoutSeconds)}</Field>
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
          </>
        )}
        {tab === 'runs' && <RunsTable jobId={job.id} label={t('job.runsOf', { job: job.name })} />}
      </div>

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
