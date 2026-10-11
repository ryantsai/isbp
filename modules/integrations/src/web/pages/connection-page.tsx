'use client';

import { Badge } from '@astryxdesign/core/Badge';
import { Button } from '@astryxdesign/core/Button';
import { Collapsible } from '@astryxdesign/core/Collapsible';
import { Icon } from '@astryxdesign/core/Icon';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { Link } from '@astryxdesign/core/Link';
import { MetadataList, MetadataListItem } from '@astryxdesign/core/MetadataList';
import { Tab, TabList } from '@astryxdesign/core/TabList';
import { Text } from '@astryxdesign/core/Text';
import type { WebPageProps } from '@isbp/sdk/web';
import { useCan } from '@isbp/sdk/web';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@isbp/ui/card';
import { useListState } from '@isbp/ui/data-table';
import { EmptyState, ErrorState } from '@isbp/ui/empty-state';
import { DetailHeader } from '@isbp/ui/page-header';
import { useApiMutation, useApiQuery } from '@isbp/ui/query';
import { DateTime, RelativeTime } from '@isbp/ui/relative-time';
import { Skeleton } from '@isbp/ui/skeleton';
import { StatusBadge } from '@isbp/ui/status';
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
import { useRouter } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import type { Connection, Profile, TestResult, WebhookSecret } from '../../contracts';
import { DIRECTION_ICON, HealthBadge, InsecureBadge, ModuleIcon, RunStatusText } from '../badges';
import { ConfirmDialog } from '../confirm-dialog';
import { NeedsAttention } from '../connection/attention';
import { ConnectionSheet, TestResultNote } from '../connection/connection-sheet';
import { CopyButton, SecretDialog } from '../connection/secret-dialog';
import { WebhookHints } from '../connection/webhook-hints';
import { ConflictsTable } from '../conflicts';
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
    <div className="grid min-w-0 grid-cols-1 items-start gap-4 lg:grid-cols-2">
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
                label={t('test')}
                variant="secondary"
                size="sm"
                icon={<Icon icon={PlugZapIcon} />}
                isLoading={test.isPending}
                onClick={() => test.mutate(undefined)}
              />
            </CardAction>
          )}
        </CardHeader>
        <CardContent>
          <VStack gap={3}>
            <MetadataList label={{ position: 'start', width: 136 }}>
              <MetadataListItem label={t('status')}>
                <HStack gap={2} wrap="wrap" vAlign="center">
                  <HealthBadge health={c.health} enabled={c.enabled} />
                  {c.allowInsecureHttp && <InsecureBadge />}
                </HStack>
              </MetadataListItem>
              {c.healthMessage && <MetadataListItem label={t('message')}>{c.healthMessage}</MetadataListItem>}
              {c.account && <MetadataListItem label={t('account')}>{c.account}</MetadataListItem>}
              {c.lastCheckedAt && (
                <MetadataListItem label={t('lastChecked')}>
                  <DateTime date={c.lastCheckedAt} />
                </MetadataListItem>
              )}
              <MetadataListItem label={t('lastSync')}>
                {c.stats.lastSyncAt ? <RelativeTime date={c.stats.lastSyncAt} /> : '—'}
              </MetadataListItem>
            </MetadataList>
            <div aria-live="polite">{result && <TestResultNote result={result} />}</div>
          </VStack>
        </CardContent>
      </Card>

      <Card className="min-w-0">
        <CardContent>
          <Collapsible
            defaultIsOpen={false}
            trigger={
              <HStack gap={2} vAlign="center">
                <Icon icon={WebhookIcon} color="secondary" />
                <Text weight="semibold">{tw('setup')}</Text>
              </HStack>
            }
          >
            <VStack gap={3} paddingBlockStart={3}>
              <Text color="secondary" as="p" display="block">
                {c.connector.webhooks ? tw('description') : tw('notSupported')}
              </Text>
              {canManage && (
                <div>
                  <Button
                    label={tw('rotate')}
                    variant="secondary"
                    size="sm"
                    icon={<Icon icon={KeyRoundIcon} />}
                    onClick={() => setConfirmRotate(true)}
                  />
                </div>
              )}
              <HStack gap={2} vAlign="center" className="min-w-0">
                <Text type="code" maxLines={1} className="min-w-0 flex-1">
                  {url}
                </Text>
                <CopyButton value={url} label={tw('copyUrl')} />
              </HStack>
              <MetadataList label={{ position: 'start', width: 136 }}>
                <MetadataListItem label={tw('secret')}>
                  {c.webhook.secretSet ? tw('secretSet') : tw('secretNotSet')}
                </MetadataListItem>
                <MetadataListItem label={tw('rotatedAt')}>
                  {c.webhook.rotatedAt ? <DateTime date={c.webhook.rotatedAt} /> : '—'}
                </MetadataListItem>
              </MetadataList>
              <WebhookHints type={c.type} />
            </VStack>
          </Collapsible>
        </CardContent>
      </Card>

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
    <Button label={t('new')} variant="primary" icon={<Icon icon={PlusIcon} />} href={newProfileHref(c.id)} />
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
    <VStack gap={4}>
      {add && <HStack hAlign="end">{add}</HStack>}
      <VStack as="ul" gap={3}>
        {items.map((p) => {
          const object = connector?.objects.find((o) => o.type === p.objectType);
          const entity = catalogue.entities.get(p.entity);
          return (
            <li key={p.id}>
              <Card className="min-w-0">
                <CardHeader className="gap-2">
                  <CardTitle>
                    <Link href={profileHref(c.id, p.id)}>{p.name}</Link>
                  </CardTitle>
                  <CardDescription>
                    <HStack gap={2} wrap="wrap" vAlign="center">
                      <span>
                        {label(object?.name, p.objectType)}
                        {p.remoteScopeName ? ` (${p.remoteScopeName})` : ''}
                      </span>
                      <Icon icon={DIRECTION_ICON[p.direction]} color="accent" />
                      <span className="sr-only">{td(p.direction)}</span>
                      <span>
                        {label(entity?.name, p.entity)}
                        {p.containerLabel ? ` (${p.containerLabel})` : ''}
                      </span>
                    </HStack>
                  </CardDescription>
                  {canManage && (
                    <CardAction>
                      <Button
                        label={t('run')}
                        aria-label={t('runNamed', { name: p.name })}
                        variant="secondary"
                        size="sm"
                        icon={<Icon icon={PlayIcon} />}
                        isLoading={run.isPending && run.variables === p.id}
                        onClick={() => run.mutate(p.id)}
                      />
                    </CardAction>
                  )}
                </CardHeader>
                <CardContent>
                  <HStack gap={4} wrap="wrap" vAlign="center">
                    <Text type="supporting">{td(p.direction)}</Text>
                    {!p.enabled && <Text type="supporting">{t('disabled')}</Text>}
                    <Text type="supporting">
                      {t('linked', { count: p.stats.links, n: format.number(p.stats.links) })}
                    </Text>
                    {p.stats.conflicts > 0 && (
                      <StatusBadge tone="warning" label={t('conflicts', { count: p.stats.conflicts })} />
                    )}
                    {p.stats.errors > 0 && (
                      <StatusBadge tone="destructive" label={t('errors', { count: p.stats.errors })} />
                    )}
                    <HStack gap={1} vAlign="center">
                      <Text type="supporting">{t('lastRun')}</Text>
                      {p.lastRun ? (
                        <>
                          <RunStatusText status={p.lastRun.status} />
                          <Text type="supporting">
                            <RelativeTime date={p.lastRun.finishedAt ?? p.lastRun.startedAt} />
                          </Text>
                        </>
                      ) : (
                        <Text type="supporting">{t('never')}</Text>
                      )}
                    </HStack>
                    <Text type="supporting">
                      {p.intervalMinutes > 0 && p.direction !== 'push'
                        ? t('every', { minutes: p.intervalMinutes })
                        : t('noSchedule')}
                    </Text>
                  </HStack>
                </CardContent>
              </Card>
            </li>
          );
        })}
      </VStack>
    </VStack>
  );
}

/** One connection: overview (health, webhook), profiles, runs, linked records and conflicts. */
export default function ConnectionPage({ params }: WebPageProps) {
  const t = useTranslations('integrations.connection');
  const tt = useTranslations('integrations.connection.tabs');
  const tc = useTranslations('common');
  const label = useLabel();
  const router = useRouter();
  const panelId = useId();
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
      <VStack gap={5}>
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-16 w-full rounded-xl" />
        <Skeleton className="h-72 w-full rounded-xl" />
      </VStack>
    );
  if (error || !c) return <ErrorState error={error} kind="page" />;
  const connector = catalogue.connectors.get(c.type) ?? null;

  return (
    <VStack gap={5}>
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

      <VStack gap={3}>
        <TabList
          role="tablist"
          value={tab}
          onChange={(v) =>
            set({
              tab: v === 'overview' ? undefined : v,
              q: undefined,
              state: undefined,
              status: undefined,
              sort: undefined,
            })
          }
          hasDivider
        >
          {TABS.map((v) => (
            <Tab
              key={v}
              value={v}
              label={tt(v)}
              panelId={panelId}
              endContent={
                v === 'conflicts' && c.stats.conflicts > 0 ? (
                  <Badge variant="warning" label={c.stats.conflicts} />
                ) : undefined
              }
            />
          ))}
        </TabList>

        <div role="tabpanel" id={panelId} aria-label={tt(tab)} className="min-w-0">
          {tab === 'overview' && <OverviewTab c={c} canManage={canManage} />}
          {tab === 'profiles' && <ProfilesTab c={c} canManage={canManage} />}
          {tab === 'runs' && <RunsTable connectionId={c.id} state={state} set={set} />}
          {tab === 'links' && <LinksTable connectionId={c.id} state={state} set={set} />}
          {tab === 'conflicts' && <ConflictsTable connectionId={c.id} state={state} set={set} />}
        </div>
      </VStack>

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
    </VStack>
  );
}
