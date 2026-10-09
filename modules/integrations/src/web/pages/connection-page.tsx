'use client';

import type { WebPageProps } from '@isbp/sdk/web';
import { useCan } from '@isbp/sdk/web';
import { Button } from '@isbp/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@isbp/ui/card';
import { useListState } from '@isbp/ui/data-table';
import { EmptyState, ErrorState } from '@isbp/ui/empty-state';
import { Disclosure } from '@isbp/ui/motion';
import { DetailHeader } from '@isbp/ui/page-header';
import { useApiMutation, useApiQuery } from '@isbp/ui/query';
import { DateTime, RelativeTime } from '@isbp/ui/relative-time';
import { Skeleton } from '@isbp/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@isbp/ui/tabs';
import {
  KeyRoundIcon,
  PencilIcon,
  PlayIcon,
  PlugZapIcon,
  PlusIcon,
  RefreshCwIcon,
  Trash2Icon,
  WebhookIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import { type ReactNode, useState } from 'react';
import type { Connection, Profile, TestResult, WebhookSecret } from '../../contracts';
import { DIRECTION_ICON, HealthBadge, InsecureBadge, ModuleIcon, RunStatusText } from '../badges';
import { ConfirmDialog } from '../confirm-dialog';
import { ConnectionSheet, TestResultNote } from '../connection/connection-sheet';
import { CopyButton, SecretDialog } from '../connection/secret-dialog';
import { WebhookHints } from '../connection/webhook-hints';
import { ConflictsTable } from '../conflicts';
import { NeedsAttention } from '../connection/attention';
import {
  INVALIDATE,
  newProfileHref,
  profileHref,
  runHref,
  useCatalogue,
  useLabel,
  useOrigin,
  webhookPath,
} from '../lib';
import { LinksTable } from '../links-table';
import { RunsTable } from '../runs-table';

const TABS = ['overview', 'profiles', 'runs', 'links', 'conflicts'] as const;
type Tab = (typeof TABS)[number];

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] gap-3 py-2 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 wrap-anywhere">
        {children ?? <span className="text-muted-foreground">—</span>}
      </dd>
    </div>
  );
}

function OverviewTab({ c, canManage }: { c: Connection; canManage: boolean }) {
  const t = useTranslations('integrations.connection');
  const tw = useTranslations('integrations.webhook');
  const origin = useOrigin();
  const [result, setResult] = useState<TestResult | null>(null);
  const [confirmRotate, setConfirmRotate] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const test = useApiMutation((api) => api.post<TestResult>(`/integrations/connections/${c.id}/test`), {
    invalidate: INVALIDATE,
    onSuccess: setResult,
  });
  const rotate = useApiMutation(
    (api) => api.post<WebhookSecret>(`/integrations/connections/${c.id}/webhook-secret`),
    {
      invalidate: INVALIDATE,
      onSuccess: (r) => {
        setConfirmRotate(false);
        setSecret(r.webhookSecret);
      },
    },
  );
  const url = `${origin}${webhookPath(c.id)}`;
  return (
    <div className="grid min-w-0 grid-cols-1 items-start gap-6 lg:grid-cols-2">
      <div className="min-w-0 lg:col-span-2">
        <NeedsAttention c={c} />
      </div>
      <Card className="min-w-0">
        <CardHeader>
          <CardTitle>{t('health')}</CardTitle>
          <CardDescription>{t('healthHint')}</CardDescription>
          {canManage && (
            <CardAction>
              <Button
                variant="outline"
                size="sm"
                loading={test.isPending}
                onClick={() => test.mutate(undefined)}
              >
                <PlugZapIcon /> {t('test')}
              </Button>
            </CardAction>
          )}
        </CardHeader>
        <CardContent className="grid gap-3">
          <dl className="divide-y">
            <Field label={t('status')}>
              <span className="flex flex-wrap items-center gap-2">
                <HealthBadge health={c.health} enabled={c.enabled} />
                {c.allowInsecureHttp && <InsecureBadge />}
              </span>
            </Field>
            {c.healthMessage && <Field label={t('message')}>{c.healthMessage}</Field>}
            {c.account && <Field label={t('account')}>{c.account}</Field>}
            {c.lastCheckedAt && (
              <Field label={t('lastChecked')}>
                <DateTime date={c.lastCheckedAt} />
              </Field>
            )}
            <Field label={t('lastSync')}>
              {c.stats.lastSyncAt ? <RelativeTime date={c.stats.lastSyncAt} /> : null}
            </Field>
          </dl>
          <div role="status" aria-live="polite">
            {result && <TestResultNote result={result} />}
          </div>
        </CardContent>
      </Card>

      <Disclosure
        summary={
          <span className="flex items-center gap-2">
            <WebhookIcon className="size-4 text-muted-foreground" aria-hidden />
            {tw('setup')}
          </span>
        }
        className="min-w-0 rounded-xl border bg-card px-4 shadow-xs sm:px-6"
        triggerClassName="py-4 font-semibold"
      >
        <div className="grid gap-3 pb-6">
          <p className="text-sm text-muted-foreground">
            {c.connector.webhooks ? tw('description') : tw('notSupported')}
          </p>
          {canManage && (
            <div>
              <Button variant="outline" size="sm" onClick={() => setConfirmRotate(true)}>
                <KeyRoundIcon /> {tw('rotate')}
              </Button>
            </div>
          )}
          <div className="flex min-w-0 items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-md border bg-muted/40 px-2 py-1.5 font-mono text-xs">
              {url}
            </code>
            <CopyButton value={url} label={tw('copyUrl')} />
          </div>
          <dl className="divide-y">
            <Field label={tw('secret')}>{c.webhook.secretSet ? tw('secretSet') : tw('secretNotSet')}</Field>
            <Field label={tw('rotatedAt')}>
              {c.webhook.rotatedAt ? <DateTime date={c.webhook.rotatedAt} /> : null}
            </Field>
          </dl>
          <WebhookHints type={c.type} />
        </div>
      </Disclosure>

      <ConfirmDialog
        open={confirmRotate}
        onOpenChange={setConfirmRotate}
        title={tw('rotateTitle')}
        description={tw('rotateDescription')}
        confirmLabel={tw('rotate')}
        destructive
        loading={rotate.isPending}
        onConfirm={() => rotate.mutate(undefined)}
      />
      <SecretDialog
        open={secret !== null}
        onOpenChange={(open) => !open && setSecret(null)}
        secret={secret}
        connectionId={c.id}
        connectorType={c.type}
      />
    </div>
  );
}

function ProfilesTab({ c, canManage }: { c: Connection; canManage: boolean }) {
  const t = useTranslations('integrations.profiles');
  const td = useTranslations('integrations.direction');
  const label = useLabel();
  const catalogue = useCatalogue();
  const format = useFormatter();
  const router = useRouter();
  const { data, isLoading } = useApiQuery<{ items: Profile[] }>('/integrations/profiles', {
    connectionId: c.id,
  });
  const run = useApiMutation(
    (api, id: string) => api.post<{ id: string }>(`/integrations/profiles/${id}/run`),
    {
      invalidate: INVALIDATE,
      success: t('runStarted'),
      onSuccess: (r) => router.push(runHref(r.id)),
    },
  );
  const connector = catalogue.connectors.get(c.type);
  const items = data?.items ?? [];
  const add = canManage && (
    <Button asChild>
      <Link href={newProfileHref(c.id)}>
        <PlusIcon /> {t('new')}
      </Link>
    </Button>
  );
  if (isLoading) return <Skeleton className="h-40 w-full rounded-xl" />;
  if (!items.length)
    return (
      <EmptyState
        icon={<RefreshCwIcon />}
        title={t('empty')}
        description={t('emptyHint')}
        action={add || undefined}
      />
    );
  return (
    <div className="grid gap-4">
      {add && <div className="flex justify-end">{add}</div>}
      <ul className="grid gap-3">
        {items.map((p) => {
          const Icon = DIRECTION_ICON[p.direction];
          const object = connector?.objects.find((o) => o.type === p.objectType);
          const entity = catalogue.entities.get(p.entity);
          return (
            <li key={p.id}>
              <Card className="min-w-0">
                <CardHeader className="gap-2">
                  <CardTitle className="truncate">
                    <Link
                      href={profileHref(c.id, p.id)}
                      className="outline-none hover:underline focus-visible:underline"
                    >
                      {p.name}
                    </Link>
                  </CardTitle>
                  <CardDescription className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="truncate">
                      {label(object?.name, p.objectType)}
                      {p.remoteScopeName ? ` (${p.remoteScopeName})` : ''}
                    </span>
                    <Icon className="size-4 shrink-0 text-primary" aria-hidden />
                    <span className="sr-only">{td(p.direction)}</span>
                    <span className="truncate">
                      {label(entity?.name, p.entity)}
                      {p.containerLabel ? ` (${p.containerLabel})` : ''}
                    </span>
                  </CardDescription>
                  {canManage && (
                    <CardAction className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        loading={run.isPending && run.variables === p.id}
                        onClick={() => run.mutate(p.id)}
                        aria-label={t('runNamed', { name: p.name })}
                      >
                        <PlayIcon /> <span className="hidden sm:inline">{t('run')}</span>
                      </Button>
                    </CardAction>
                  )}
                </CardHeader>
                <CardContent className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span>{td(p.direction)}</span>
                  {!p.enabled && <span>{t('disabled')}</span>}
                  <span>{t('linked', { count: p.stats.links, n: format.number(p.stats.links) })}</span>
                  {p.stats.conflicts > 0 && (
                    <span className="text-warning-foreground">
                      {t('conflicts', { count: p.stats.conflicts })}
                    </span>
                  )}
                  {p.stats.errors > 0 && (
                    <span className="text-destructive">{t('errors', { count: p.stats.errors })}</span>
                  )}
                  <span className="inline-flex items-center gap-1">
                    {t('lastRun')}{' '}
                    {p.lastRun ? (
                      <>
                        <RunStatusText status={p.lastRun.status} />
                        <RelativeTime date={p.lastRun.finishedAt ?? p.lastRun.startedAt} />
                      </>
                    ) : (
                      t('never')
                    )}
                  </span>
                  <span>
                    {p.intervalMinutes > 0 && p.direction !== 'push'
                      ? t('every', { minutes: p.intervalMinutes })
                      : t('noSchedule')}
                  </span>
                </CardContent>
              </Card>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** One connection: overview (health, webhook), profiles, runs, linked records and conflicts. */
export default function ConnectionPage({ params }: WebPageProps) {
  const t = useTranslations('integrations.connection');
  const tt = useTranslations('integrations.connection.tabs');
  const tc = useTranslations('common');
  const label = useLabel();
  const router = useRouter();
  const id = params.id ?? '';
  const canManage = useCan('integrations.connections.manage');
  const [state, set] = useListState({ pageSize: 25 });
  const tab: Tab = TABS.includes(state.tab as Tab) ? (state.tab as Tab) : 'overview';
  const catalogue = useCatalogue();
  const { data: c, isLoading, error } = useApiQuery<Connection>(`/integrations/connections/${id}`);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const remove = useApiMutation((api) => api.delete(`/integrations/connections/${id}`), {
    invalidate: INVALIDATE,
    success: t('deleted'),
    onSuccess: () => router.push('/integrations'),
  });

  if (isLoading)
    return (
      <div className="space-y-6">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-16 w-full rounded-xl" />
        <Skeleton className="h-72 w-full rounded-xl" />
      </div>
    );
  if (error || !c) return <ErrorState error={error} kind="page" />;
  const connector = catalogue.connectors.get(c.type) ?? null;

  return (
    <div className="space-y-6">
      <DetailHeader
        className="pb-0"
        back={{ href: '/integrations', label: t('back') }}
        icon={<ModuleIcon name={c.connector.icon} />}
        reference={label(c.connector.name)}
        title={c.name}
        status={
          <>
            <HealthBadge
              health={c.health}
              enabled={c.enabled}
              attention={c.stats.conflicts > 0 || c.stats.errors > 0}
            />
            {c.allowInsecureHttp && <InsecureBadge />}
          </>
        }
        actions={
          canManage
            ? [
                {
                  label: tc('edit'),
                  icon: <PencilIcon />,
                  disabled: !connector,
                  onSelect: () => setEditing(true),
                },
              ]
            : []
        }
        menu={
          canManage
            ? [
                {
                  label: tc('delete'),
                  icon: <Trash2Icon />,
                  destructive: true,
                  onSelect: () => setDeleting(true),
                },
              ]
            : []
        }
      />

      <Tabs
        value={tab}
        onValueChange={(v) =>
          set({
            tab: v === 'overview' ? undefined : v,
            q: undefined,
            state: undefined,
            status: undefined,
            sort: undefined,
          })
        }
      >
        <TabsList className="max-w-full overflow-x-auto">
          {TABS.map((v) => (
            <TabsTrigger key={v} value={v}>
              {tt(v)}
              {v === 'conflicts' && c.stats.conflicts > 0 && (
                <span className="ml-1.5 rounded-full bg-warning/15 px-1.5 text-xs text-warning-foreground tabular-nums">
                  {c.stats.conflicts}
                </span>
              )}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="overview" className="min-w-0">
          {tab === 'overview' && <OverviewTab c={c} canManage={canManage} />}
        </TabsContent>
        <TabsContent value="profiles" className="min-w-0">
          {tab === 'profiles' && <ProfilesTab c={c} canManage={canManage} />}
        </TabsContent>
        <TabsContent value="runs" className="min-w-0">
          {tab === 'runs' && <RunsTable connectionId={c.id} state={state} set={set} />}
        </TabsContent>
        <TabsContent value="links" className="min-w-0">
          {tab === 'links' && <LinksTable connectionId={c.id} state={state} set={set} />}
        </TabsContent>
        <TabsContent value="conflicts" className="min-w-0">
          {tab === 'conflicts' && <ConflictsTable connectionId={c.id} state={state} set={set} />}
        </TabsContent>
      </Tabs>

      {connector && (
        <ConnectionSheet
          open={editing}
          onOpenChange={setEditing}
          connector={{
            ...connector,
            name: label(connector.name),
            description: connector.description ? label(connector.description) : null,
          }}
          connection={c}
        />
      )}
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={t('deleteTitle', { name: c.name })}
        description={t('deleteDescription')}
        confirmLabel={tc('delete')}
        destructive
        loading={remove.isPending}
        onConfirm={() => remove.mutate(undefined)}
      />
    </div>
  );
}
