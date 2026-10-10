'use client';

import { useCan, usePlatform, type WebPageProps } from '@isbp/sdk/web';
import { Badge } from '@isbp/ui/badge';
import { Button } from '@isbp/ui/button';
import { EmptyState } from '@isbp/ui/empty-state';
import { DetailHeader } from '@isbp/ui/page-header';
import { useApiQuery } from '@isbp/ui/query';
import { RelativeTime } from '@isbp/ui/relative-time';
import { Skeleton } from '@isbp/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@isbp/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@isbp/ui/tabs';
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
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
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
        <p className="text-sm text-muted-foreground">{t('rolesHint')}</p>
        <Button size="sm" onClick={() => setAdding(true)} disabled={!server.lastSyncAt}>
          <PlusIcon /> {t('addRole')}
        </Button>
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
              <TableRow>
                <TableHead>{t('role')}</TableHead>
                <TableHead>{t('risk')}</TableHead>
                <TableHead className="hidden md:table-cell">{t('owner')}</TableHead>
                <TableHead className="hidden lg:table-cell">{t('duration')}</TableHead>
                <TableHead className="hidden sm:table-cell">{t('liveGrants')}</TableHead>
                <TableHead>
                  <span className="sr-only">{t('edit')}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.items.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="max-w-64">
                    <span className="grid min-w-0">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="truncate font-medium">{l(r.name)}</span>
                        {!r.active && <Badge variant="muted">{t('inactive')}</Badge>}
                      </span>
                      <span className="truncate font-mono text-xs text-muted-foreground">
                        {r.database ? `${r.database}.` : ''}
                        {r.roleName}
                      </span>
                    </span>
                  </TableCell>
                  <TableCell>
                    <RiskBadge risk={r.risk} />
                  </TableCell>
                  <TableCell className="hidden max-w-40 md:table-cell">
                    <span className="flex min-w-0 items-center gap-1 text-sm">
                      {r.owner?.kind === 'group' && (
                        <UsersIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                      )}
                      <span className="truncate">{r.owner?.name ?? '—'}</span>
                    </span>
                  </TableCell>
                  <TableCell className="hidden text-sm lg:table-cell">
                    <span className="flex items-center gap-1">
                      <CalendarClockIcon className="size-3.5 text-muted-foreground" aria-hidden />
                      {duration(r)}
                    </span>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">{r.liveGrants}</TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={t('editRole', { role: r.roleName })}
                      onClick={() => setEditing(r)}
                    >
                      <PencilIcon />
                    </Button>
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
      <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        {t('inventoryHint')}
        <Link
          href={`/dbaccess/grants?tab=accounts&server=${server.id}`}
          className="font-medium text-primary hover:underline"
        >
          {t('seeAccounts')}
        </Link>
      </p>
      <div className="min-w-0 overflow-hidden rounded-xl border bg-card">
        {isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : !data?.roles.length ? (
          <EmptyState icon={<KeyRoundIcon />} title={t('noInventory')} description={t('syncFirst')} />
        ) : (
          <Table aria-label={t('inventoryTable')}>
            <TableHeader>
              <TableRow>
                {server.engine === 'mssql' && <TableHead>{t('database')}</TableHead>}
                <TableHead>{t('role')}</TableHead>
                <TableHead>{t('members')}</TableHead>
                <TableHead>{t('requestable')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.roles.map((r) => (
                <TableRow key={`${r.database ?? ''}.${r.name}`}>
                  {server.engine === 'mssql' && (
                    <TableCell className="font-mono text-xs">{r.database ?? t('serverLevel')}</TableCell>
                  )}
                  <TableCell className="max-w-48 truncate font-mono text-sm">{r.name}</TableCell>
                  <TableCell>{r.members}</TableCell>
                  <TableCell>
                    {r.requestableRoleId ? (
                      <Badge variant="info">{t('yes')}</Badge>
                    ) : (
                      <span className="text-muted-foreground">—</span>
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
  const tab: Tab = TABS.includes(state.tab as Tab) ? (state.tab as Tab) : 'roles';
  const { data: server, isLoading } = useApiQuery<Server>(`/dbaccess/servers/${params.id}`);
  if (isLoading) return <Skeleton className="h-96 w-full rounded-xl" />;
  if (!server)
    return (
      <EmptyState
        icon={<FileQuestionIcon />}
        title={t('notFound')}
        action={
          <Button asChild variant="outline">
            <Link href="/dbaccess/servers">{t('back')}</Link>
          </Button>
        }
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
          <span className="text-muted-foreground">
            {t('lastSync')} <RelativeTime date={server.lastSyncAt} />
          </span>
          {server.ownerGroup && (
            <span className="text-muted-foreground">{t('dbaGroup', { group: server.ownerGroup.name })}</span>
          )}
          {server.lastSyncStatus === 'error' && server.lastSyncError && (
            <p className="w-full rounded-md bg-destructive/10 px-2 py-1 text-xs break-all text-destructive">
              {server.lastSyncError}
            </p>
          )}
        </div>
        <Tabs
          value={tab}
          onValueChange={(v) => set({ tab: v === 'roles' ? undefined : v })}
          className="min-w-0"
        >
          <TabsList>
            <TabsTrigger value="roles">{t('tabs.roles', { count: server.counts.roles })}</TabsTrigger>
            <TabsTrigger value="inventory">{t('tabs.inventory')}</TabsTrigger>
            <TabsTrigger value="unmanaged">
              {t('tabs.unmanaged', { count: server.counts.unmanaged })}
            </TabsTrigger>
          </TabsList>
          <TabsContent value="roles" className="min-w-0">
            {tab === 'roles' && <RolesTab server={server} />}
          </TabsContent>
          <TabsContent value="inventory" className="min-w-0">
            {tab === 'inventory' && <InventoryTab server={server} />}
          </TabsContent>
          <TabsContent value="unmanaged" className="min-w-0">
            {tab === 'unmanaged' && <UnmanagedList serverId={server.id} />}
          </TabsContent>
        </Tabs>
      </div>
      <ServerFormDialog
        target={editing ? { kind: 'edit', server } : null}
        onClose={() => setEditing(false)}
      />
    </>
  );
}
