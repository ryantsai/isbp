'use client';

import { Badge } from '@astryxdesign/core/Badge';
import { Button } from '@astryxdesign/core/Button';
import { Icon } from '@astryxdesign/core/Icon';
import { IconButton } from '@astryxdesign/core/IconButton';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { Link } from '@astryxdesign/core/Link';
import { Tab, TabList } from '@astryxdesign/core/TabList';
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableHeaderCell,
  TableRow,
} from '@astryxdesign/core/Table';
import { Text } from '@astryxdesign/core/Text';
import { useCan, usePlatform, type WebPageProps } from '@isbp/sdk/web';
import { EmptyState } from '@isbp/ui/empty-state';
import { DetailHeader } from '@isbp/ui/page-header';
import { useApiQuery } from '@isbp/ui/query';
import { RelativeTime } from '@isbp/ui/relative-time';
import { Skeleton } from '@isbp/ui/skeleton';
import { useListState } from '@isbp/ui/data-table';
import {
  CalendarClockIcon,
  FileQuestionIcon,
  KeyRoundIcon,
  PencilIcon,
  PlusIcon,
  ServerCogIcon,
  UsersIcon,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import type { Inventory, RequestableRole, Server } from '../../contracts';
import { EngineLabel, EnvironmentBadge, RiskBadge, SyncStatus } from '../badges';
import { useLocalized } from '../lib';
import { RoleFormDialog } from '../role-form-dialog';
import { ServerFormDialog } from '../server-form-dialog';
import { SyncButton } from '../sync';
import { UnmanagedList } from '../unmanaged';

const TABS = ['roles', 'inventory', 'unmanaged'] as const;
type Tab = (typeof TABS)[number];

function RolesTab({ server }: { server: Server }) {
  const t = useTranslations('dbaccess.server');
  const l = useLocalized();
  const [editing, setEditing] = useState<RequestableRole | null>(null);
  const [adding, setAdding] = useState(false);
  const { data, isLoading } = useApiQuery<{ items: RequestableRole[] }>(
    `/dbaccess/servers/${server.id}/roles`,
  );
  const duration = (r: RequestableRole) =>
    r.maxDays
      ? t('durationDays', { def: r.defaultDays ?? r.maxDays, max: r.maxDays })
      : r.allowPermanent
        ? t('durationPermanent')
        : '—';
  return (
    <div className="grid min-w-0 gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Text color="secondary">{t('rolesHint')}</Text>
        <Button
          label={t('addRole')}
          variant="primary"
          size="sm"
          icon={<Icon icon={PlusIcon} />}
          isDisabled={!server.lastSyncAt}
          onClick={() => setAdding(true)}
        />
      </div>
      <div className="min-w-0 overflow-hidden rounded-xl border bg-card">
        {isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : !data?.items.length ? (
          <EmptyState
            icon={<KeyRoundIcon />}
            title={t('noRoles')}
            description={server.lastSyncAt ? t('noRolesHint') : t('syncFirst')}
          />
        ) : (
          <Table aria-label={t('rolesTable')}>
            <TableHeader>
              <TableRow isHeaderRow>
                <TableHeaderCell className="whitespace-nowrap">{t('role')}</TableHeaderCell>
                <TableHeaderCell className="max-w-none whitespace-nowrap">{t('risk')}</TableHeaderCell>
                <TableHeaderCell className="hidden md:table-cell max-w-none whitespace-nowrap">
                  {t('owner')}
                </TableHeaderCell>
                <TableHeaderCell className="hidden lg:table-cell max-w-none whitespace-nowrap">
                  {t('duration')}
                </TableHeaderCell>
                <TableHeaderCell className="hidden sm:table-cell max-w-none whitespace-nowrap">
                  {t('liveGrants')}
                </TableHeaderCell>
                <TableHeaderCell className="max-w-none whitespace-nowrap">
                  <span className="sr-only">{t('edit')}</span>
                </TableHeaderCell>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.items.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="max-w-64">
                    <VStack className="min-w-0">
                      <HStack gap={2} vAlign="center" className="min-w-0">
                        <Text weight="medium" maxLines={1}>
                          {l(r.name)}
                        </Text>
                        {!r.active && <Badge variant="neutral" label={t('inactive')} />}
                      </HStack>
                      <Text type="code" color="secondary" maxLines={1}>
                        {r.database ? `${r.database}.` : ''}
                        {r.roleName}
                      </Text>
                    </VStack>
                  </TableCell>
                  <TableCell className="max-w-none whitespace-nowrap">
                    <RiskBadge risk={r.risk} />
                  </TableCell>
                  <TableCell className="hidden max-w-48 whitespace-nowrap md:table-cell">
                    <HStack gap={1} vAlign="center" className="min-w-0">
                      {r.owner?.kind === 'group' && <Icon icon={UsersIcon} size="sm" color="secondary" />}
                      <Text maxLines={1}>{r.owner?.name ?? '—'}</Text>
                    </HStack>
                  </TableCell>
                  <TableCell className="hidden max-w-none whitespace-nowrap lg:table-cell">
                    <HStack gap={1} vAlign="center">
                      <Icon icon={CalendarClockIcon} size="sm" color="secondary" />
                      <Text>{duration(r)}</Text>
                    </HStack>
                  </TableCell>
                  <TableCell className="hidden max-w-none whitespace-nowrap sm:table-cell">
                    {r.liveGrants}
                  </TableCell>
                  <TableCell className="max-w-none text-right">
                    <IconButton
                      label={t('editRole', { role: r.roleName })}
                      variant="ghost"
                      size="sm"
                      icon={<Icon icon={PencilIcon} />}
                      onClick={() => setEditing(r)}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
      <RoleFormDialog
        target={
          adding ? { kind: 'create', server } : editing ? { kind: 'edit', server, role: editing } : null
        }
        onClose={() => {
          setAdding(false);
          setEditing(null);
        }}
      />
    </div>
  );
}

function InventoryTab({ server }: { server: Server }) {
  const t = useTranslations('dbaccess.server');
  const { data, isLoading } = useApiQuery<Inventory>(`/dbaccess/servers/${server.id}/inventory`);
  return (
    <div className="grid min-w-0 gap-3">
      <HStack gap={2} wrap="wrap" vAlign="center">
        <Text color="secondary">{t('inventoryHint')}</Text>
        <Link href={`/dbaccess/grants?tab=accounts&server=${server.id}`}>{t('seeAccounts')}</Link>
      </HStack>
      <div className="min-w-0 overflow-hidden rounded-xl border bg-card">
        {isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : !data?.roles.length ? (
          <EmptyState icon={<KeyRoundIcon />} title={t('noInventory')} description={t('syncFirst')} />
        ) : (
          <Table aria-label={t('inventoryTable')}>
            <TableHeader>
              <TableRow isHeaderRow>
                {server.engine === 'mssql' && (
                  <TableHeaderCell className="max-w-none whitespace-nowrap">{t('database')}</TableHeaderCell>
                )}
                <TableHeaderCell className="whitespace-nowrap">{t('role')}</TableHeaderCell>
                <TableHeaderCell className="max-w-none whitespace-nowrap">{t('members')}</TableHeaderCell>
                <TableHeaderCell className="max-w-none whitespace-nowrap">{t('requestable')}</TableHeaderCell>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.roles.map((r) => (
                <TableRow key={`${r.database ?? ''}.${r.name}`}>
                  {server.engine === 'mssql' && (
                    <TableCell className="max-w-none whitespace-nowrap">
                      <Text type="code">{r.database ?? t('serverLevel')}</Text>
                    </TableCell>
                  )}
                  <TableCell className="max-w-48">
                    <Text type="code" maxLines={1}>
                      {r.name}
                    </Text>
                  </TableCell>
                  <TableCell className="max-w-none whitespace-nowrap">{r.members}</TableCell>
                  <TableCell className="max-w-none whitespace-nowrap">
                    {r.requestableRoleId ? (
                      <Badge variant="info" label={t('yes')} />
                    ) : (
                      <Text color="secondary">—</Text>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}

/** One server: requestable roles, the inventory of the last sync, unmanaged access and settings. */
export default function ServerPage({ params }: WebPageProps) {
  const t = useTranslations('dbaccess.server');
  const ta = useTranslations('dbaccess.authMode');
  const canManage = useCan('dbaccess.servers.manage');
  const { user } = usePlatform();
  const [state, set] = useListState();
  const [editing, setEditing] = useState(false);
  const panelId = useId();
  const tab: Tab = TABS.includes(state.tab as Tab) ? (state.tab as Tab) : 'roles';
  const { data: server, isLoading } = useApiQuery<Server>(`/dbaccess/servers/${params.id}`);
  if (isLoading) return <Skeleton className="h-96 w-full rounded-xl" />;
  if (!server)
    return (
      <EmptyState
        icon={<FileQuestionIcon />}
        title={t('notFound')}
        action={<Button label={t('back')} variant="secondary" href="/dbaccess/servers" />}
      />
    );
  return (
    <>
      <DetailHeader
        back={{ href: '/dbaccess/servers', label: t('servers'), highlight: server.id }}
        icon={<ServerCogIcon />}
        title={server.displayName}
        meta={t('summary', {
          connection: server.connection?.name ?? t('connectionMissing'),
          // The naming rule as an example account name, not a template.
          pattern: server.accountPattern
            .replaceAll('{username}', user.username)
            .replaceAll('{email_local}', user.email.split('@')[0] ?? user.username),
          auth: ta(server.authMode),
        })}
        actions={
          canManage
            ? [
                {
                  id: 'settings',
                  label: t('settings'),
                  icon: <PencilIcon />,
                  onSelect: () => setEditing(true),
                },
              ]
            : []
        }
      >
        {canManage && <SyncButton serverId={server.id} name={server.displayName} />}
      </DetailHeader>
      <div className="grid min-w-0 grid-cols-1 gap-4">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border bg-card px-4 py-3 text-sm">
          <EngineLabel engine={server.engine} className="text-sm" />
          <EnvironmentBadge environment={server.environment} />
          <SyncStatus status={server.lastSyncStatus} />
          <Text color="secondary">
            {t('lastSync')} <RelativeTime date={server.lastSyncAt} />
          </Text>
          {server.ownerGroup && (
            <Text color="secondary">{t('dbaGroup', { group: server.ownerGroup.name })}</Text>
          )}
          {server.lastSyncStatus === 'error' && server.lastSyncError && (
            <p className="w-full rounded-md bg-destructive/10 px-2 py-1 text-xs break-all text-destructive">
              {server.lastSyncError}
            </p>
          )}
        </div>
        <VStack gap={3} className="min-w-0">
          <TabList
            role="tablist"
            value={tab}
            onChange={(v) => set({ tab: v === 'roles' ? undefined : v })}
            hasDivider
          >
            <Tab value="roles" label={t('tabs.roles', { count: server.counts.roles })} panelId={panelId} />
            <Tab value="inventory" label={t('tabs.inventory')} panelId={panelId} />
            <Tab
              value="unmanaged"
              label={t('tabs.unmanaged', { count: server.counts.unmanaged })}
              panelId={panelId}
            />
          </TabList>
          <div role="tabpanel" id={panelId} className="min-w-0">
            {tab === 'roles' && <RolesTab server={server} />}
            {tab === 'inventory' && <InventoryTab server={server} />}
            {tab === 'unmanaged' && <UnmanagedList serverId={server.id} />}
          </div>
        </VStack>
      </div>
      <ServerFormDialog
        target={editing ? { kind: 'edit', server } : null}
        onClose={() => setEditing(false)}
      />
    </>
  );
}
