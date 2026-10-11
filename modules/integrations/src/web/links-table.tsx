'use client';

import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import { FormLayout } from '@astryxdesign/core/FormLayout';
import { Icon } from '@astryxdesign/core/Icon';
import { HStack, Layout, LayoutContent, LayoutFooter, VStack } from '@astryxdesign/core/Layout';
import { Link } from '@astryxdesign/core/Link';
import { MoreMenu } from '@astryxdesign/core/MoreMenu';
import { Tab, TabList } from '@astryxdesign/core/TabList';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import type { Page } from '@isbp/sdk';
import { useCan } from '@isbp/sdk/web';
import { DataTable, type DataTableColumn, type ListState } from '@isbp/ui/data-table';
import { EmptyState } from '@isbp/ui/empty-state';
import { useApiMutation, useApiQuery, useErrorText } from '@isbp/ui/query';
import { RelativeTime } from '@isbp/ui/relative-time';
import { SearchInput } from '@isbp/ui/search-input';
import { EyeOffIcon, LinkIcon, RefreshCwIcon, SearchXIcon, UnlinkIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useId, useMemo, useState } from 'react';
import { LINK_STATES, type Link as LinkDto, type LinkState } from '../contracts';
import { LinkStateBadge } from './badges';
import { ConfirmDialog } from './confirm-dialog';
import { INVALIDATE, runHref } from './lib';

const VIEWS = ['all', ...LINK_STATES] as const;
type View = (typeof VIEWS)[number];

/** The local side: a link to the record, or a note that the viewer can't see it (or it isn't created yet). */
export function LocalCell({ local, wrap = false }: { local: LinkDto['local']; wrap?: boolean }) {
  const t = useTranslations('integrations.links');
  if (!local) return <Text color="secondary">{t('notCreated')}</Text>;
  if (local.hidden)
    return (
      <HStack gap={1.5} vAlign="center">
        <Icon icon={EyeOffIcon} color="secondary" />
        <Text color="secondary">{t('hidden')}</Text>
      </HStack>
    );
  const text = (
    <>
      {local.reference && (
        <>
          <Text type="code" color="secondary">
            {local.reference}
          </Text>{' '}
        </>
      )}
      {local.title}
    </>
  );
  return local.href ? (
    <Link
      href={local.href}
      onClick={(e) => e.stopPropagation()}
      weight="medium"
      display="block"
      maxLines={wrap ? 0 : 1}
      className={wrap ? 'wrap-anywhere' : undefined}
    >
      {text}
    </Link>
  ) : (
    <Text
      weight="medium"
      display="block"
      maxLines={wrap ? 0 : 1}
      className={wrap ? 'wrap-anywhere' : undefined}
    >
      {text}
    </Text>
  );
}

/** The remote side, opening the outside system in a new tab. */
export function RemoteCell({
  remoteRef,
  remoteUrl,
  title,
}: {
  remoteRef: string | null;
  remoteUrl: string | null;
  title?: string | null;
}) {
  const t = useTranslations('integrations.links');
  const label = remoteRef ?? '—';
  return (
    <VStack gap={0} className="min-w-0">
      {remoteUrl ? (
        <Link
          href={remoteUrl}
          isExternalLink
          newTabLabel={t('opensNewTab')}
          onClick={(e) => e.stopPropagation()}
        >
          {label}
        </Link>
      ) : (
        <Text type="code">{label}</Text>
      )}
      {title && (
        <Text type="supporting" maxLines={1}>
          {title}
        </Text>
      )}
    </VStack>
  );
}

function RelinkDialog({
  link,
  onOpenChange,
}: {
  link: LinkDto | null;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('integrations.links');
  const tc = useTranslations('common');
  const errorText = useErrorText();
  const formId = useId();
  const [remoteId, setRemoteId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const relink = useApiMutation(
    (api, v: { id: string; remoteId: string }) =>
      api.post(`/integrations/links/${v.id}/relink`, { remoteId: v.remoteId }),
    { invalidate: INVALIDATE, success: t('relinked'), silent: true, onSuccess: () => onOpenChange(false) },
  );
  const change = (open: boolean) => {
    if (!open) {
      setRemoteId('');
      setError(null);
    }
    onOpenChange(open);
  };
  return (
    <Dialog isOpen={link !== null} onOpenChange={change} width={448} purpose="form">
      <Layout
        header={
          <DialogHeader
            title={t('relinkTitle')}
            subtitle={t('relinkDescription', { ref: link?.remoteRef ?? link?.remoteId ?? '' })}
            onOpenChange={change}
          />
        }
        content={
          <LayoutContent padding={4}>
            <form
              id={formId}
              noValidate
              onSubmit={(e) => {
                e.preventDefault();
                if (!link || !remoteId.trim()) return;
                relink.mutate(
                  { id: link.id, remoteId: remoteId.trim() },
                  { onError: (err) => setError(errorText(err)) },
                );
              }}
            >
              <FormLayout defaultOptionality="optional">
                <TextInput
                  label={t('remoteId')}
                  isRequired
                  autoComplete="off"
                  description={t('remoteIdHint')}
                  value={remoteId}
                  onChange={setRemoteId}
                />
                {error && <Banner status="error" title={error} collapsible={false} />}
              </FormLayout>
            </form>
          </LayoutContent>
        }
        footer={
          <LayoutFooter hasDivider padding={3}>
            <HStack gap={2} hAlign="end">
              <Button label={tc('cancel')} variant="ghost" type="button" onClick={() => change(false)} />
              <Button
                label={t('relink')}
                variant="primary"
                type="submit"
                form={formId}
                isLoading={relink.isPending}
                isDisabled={!remoteId.trim()}
              />
            </HStack>
          </LayoutFooter>
        }
      />
    </Dialog>
  );
}

/** Linked records of a connection: filter by state, open either side, sync, relink or unlink. */
export function LinksTable({
  connectionId,
  state,
  set,
}: {
  connectionId: string;
  state: ListState;
  set: (patch: Partial<ListState>) => void;
}) {
  const t = useTranslations('integrations.links');
  const tl = useTranslations('integrations.linkState');
  const tc = useTranslations('common');
  const router = useRouter();
  const panelId = useId();
  const canManage = useCan('integrations.connections.manage');
  const view: View = VIEWS.includes(state.state as View) ? (state.state as View) : 'all';
  const [relinking, setRelinking] = useState<LinkDto | null>(null);
  const [unlinking, setUnlinking] = useState<LinkDto | null>(null);
  const { data, isLoading, isFetching, error, refetch } = useApiQuery<Page<LinkDto>>('/integrations/links', {
    connectionId,
    state: view === 'all' ? undefined : (view as LinkState),
    q: state.q,
    sort: state.sort,
    page: state.page,
    pageSize: state.pageSize,
  });
  const resync = useApiMutation(
    (api, id: string) => api.post<{ runId: string }>(`/integrations/links/${id}/resync`),
    {
      invalidate: INVALIDATE,
      success: t('syncRequested'),
      onSuccess: (r) => router.push(runHref(r.runId)),
    },
  );
  const unlink = useApiMutation((api, id: string) => api.delete(`/integrations/links/${id}`), {
    invalidate: INVALIDATE,
    success: t('unlinked'),
    onSuccess: () => setUnlinking(null),
  });
  const viewLabel = (v: View) => (v === 'all' ? tc('all') : tl(v));

  const columns = useMemo<DataTableColumn<LinkDto>[]>(
    () => [
      {
        id: 'local',
        header: t('local'),
        meta: { className: 'max-w-72' },
        cell: ({ row }) => <LocalCell local={row.original.local} />,
      },
      {
        id: 'remote',
        header: t('remote'),
        meta: { sortKey: 'remoteRef', className: 'max-w-56' },
        cell: ({ row }) => (
          <RemoteCell
            remoteRef={row.original.remoteRef}
            remoteUrl={row.original.remoteUrl}
            title={row.original.remoteTitle}
          />
        ),
      },
      {
        id: 'state',
        header: tc('status'),
        // Errors wrap instead of widening the table.
        meta: { className: 'min-w-32 max-w-64 whitespace-normal' },
        cell: ({ row }) => (
          <VStack gap={0.5} className="min-w-0">
            <div>
              <LinkStateBadge state={row.original.state} />
            </div>
            {row.original.lastError && (
              <Text type="supporting" maxLines={2}>
                {row.original.lastError.message}
              </Text>
            )}
          </VStack>
        ),
      },
      {
        id: 'profile',
        header: t('profile'),
        meta: { className: 'hidden xl:table-cell max-w-48', headerClassName: 'hidden xl:table-cell' },
        cell: ({ row }) => <Text maxLines={1}>{row.original.profileName}</Text>,
      },
      {
        id: 'synced',
        header: t('lastSynced'),
        meta: {
          sortKey: 'lastSyncedAt',
          className: 'hidden sm:table-cell',
          headerClassName: 'hidden sm:table-cell',
        },
        cell: ({ row }) => <RelativeTime date={row.original.lastSyncedAt} />,
      },
      {
        id: 'actions',
        header: () => <span className="sr-only">{tc('actions')}</span>,
        meta: { className: 'w-10' },
        cell: ({ row }) =>
          canManage && (
            <MoreMenu
              label={t('actionsFor', { ref: row.original.remoteRef ?? row.original.remoteId })}
              size="sm"
              alignment="end"
              items={[
                {
                  label: t('syncNow'),
                  icon: RefreshCwIcon,
                  isDisabled: row.original.state === 'orphaned',
                  onClick: () => resync.mutate(row.original.id),
                },
                {
                  label: t('relink'),
                  icon: LinkIcon,
                  isDisabled: !row.original.local,
                  onClick: () => setRelinking(row.original),
                },
                { type: 'divider' },
                {
                  label: t('unlink'),
                  icon: UnlinkIcon,
                  variant: 'destructive',
                  onClick: () => setUnlinking(row.original),
                },
              ]}
            />
          ),
      },
    ],
    [t, tc, canManage, resync],
  );

  const table = (
    <DataTable
      label={t('title')}
      columns={columns}
      data={data?.items ?? []}
      total={data?.total ?? 0}
      page={state.page}
      pageSize={state.pageSize}
      sort={state.sort}
      loading={isLoading}
      fetching={isFetching}
      error={error}
      onRetry={() => refetch()}
      getRowId={(l) => l.id}
      onPageChange={(page) => set({ page })}
      onPageSizeChange={(pageSize) => set({ pageSize })}
      onSortChange={(sort) => set({ sort })}
      toolbar={
        <SearchInput
          value={state.q ?? ''}
          onChange={(q) => set({ q })}
          placeholder={t('search')}
          className="sm:w-72"
        />
      }
      empty={
        <EmptyState
          icon={state.q ? <SearchXIcon /> : <LinkIcon />}
          title={state.q || view !== 'all' ? t('emptyFiltered') : t('empty')}
          description={t('emptyHint')}
        />
      }
    />
  );

  return (
    <>
      <VStack gap={3}>
        <TabList
          role="tablist"
          aria-label={t('filter')}
          value={view}
          onChange={(v) => set({ state: v === 'all' ? undefined : v })}
          hasDivider
        >
          {VIEWS.map((v) => (
            <Tab key={v} value={v} label={viewLabel(v)} panelId={panelId} />
          ))}
        </TabList>
        {/* The tabs only filter the same list; the one panel holds it. */}
        <div role="tabpanel" id={panelId} aria-label={viewLabel(view)} className="min-w-0">
          {table}
        </div>
      </VStack>
      <RelinkDialog link={relinking} onOpenChange={(open) => !open && setRelinking(null)} />
      <ConfirmDialog
        open={unlinking !== null}
        onOpenChange={(open) => !open && setUnlinking(null)}
        title={t('unlinkTitle', { ref: unlinking?.remoteRef ?? unlinking?.remoteId ?? '' })}
        description={t('unlinkDescription')}
        confirmLabel={t('unlink')}
        destructive
        loading={unlink.isPending}
        onConfirm={() => unlinking && unlink.mutate(unlinking.id)}
      />
    </>
  );
}
