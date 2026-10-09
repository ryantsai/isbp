'use client';

import { useCan } from '@isbp/sdk/web';
import { Badge } from '@isbp/ui/badge';
import { Button } from '@isbp/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@isbp/ui/card';
import { EmptyState } from '@isbp/ui/empty-state';
import { Stagger, StaggerItem } from '@isbp/ui/motion';
import { PageHeader } from '@isbp/ui/page-header';
import { useApiQuery } from '@isbp/ui/query';
import { RelativeTime } from '@isbp/ui/relative-time';
import { Skeleton } from '@isbp/ui/skeleton';
import { ArrowRightIcon, CircleAlertIcon, PlugIcon, ServerCogIcon, SettingsIcon } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { type ConnectionInfo, isManagedEngine, type Server, type Servers } from '../../contracts';
import { EngineLabel, EnvironmentBadge, SyncStatus } from '../badges';
import { serverHref } from '../lib';
import { ServerFormDialog } from '../server-form-dialog';
import { SyncButton } from '../sync';

function Count({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-xs text-muted-foreground">{label}</dt>
      <dd className="flex items-center gap-1 text-lg font-semibold">
        {warn && value > 0 && <CircleAlertIcon className="size-4 text-warning-foreground" aria-hidden />}
        {value}
      </dd>
    </div>
  );
}

function ServerCard({ server }: { server: Server }) {
  const t = useTranslations('dbaccess.servers');
  const headingId = `dbaccess-server-${server.id}`;
  // Access without a request, accounts that match nobody, and failed changes: one number to look at.
  const attention = server.counts.unmanaged + server.counts.orphans + server.counts.failed;
  return (
    <Card className="h-full min-w-0 gap-4">
      <CardHeader className="gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <EnvironmentBadge environment={server.environment} />
          <SyncStatus status={server.lastSyncStatus} />
        </div>
        <CardTitle id={headingId} className="min-w-0 text-base">
          <Link
            href={serverHref(server.id)}
            className="block truncate outline-none hover:underline focus-visible:underline"
          >
            {server.displayName}
          </Link>
        </CardTitle>
        <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
          <EngineLabel engine={server.engine} />
          <span className="truncate">{server.connection?.name ?? t('connectionMissing')}</span>
        </p>
      </CardHeader>
      <CardContent className="grid gap-3">
        <dl className="grid grid-cols-3 gap-3">
          <Count label={t('liveGrants')} value={server.counts.liveGrants} />
          <Count label={t('roles')} value={server.counts.roles} />
          <Count label={t('attention')} value={attention} warn />
        </dl>
        {attention > 0 && (
          <p className="text-xs text-muted-foreground">
            {t('attentionHint', {
              unmanaged: server.counts.unmanaged,
              orphans: server.counts.orphans,
              failed: server.counts.failed,
            })}{' '}
            <Link href={serverHref(server.id)} className="font-medium text-primary hover:underline">
              {t('review')}
            </Link>
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          {t('lastSync')} <RelativeTime date={server.lastSyncAt} />
        </p>
        {server.lastSyncStatus === 'error' && server.lastSyncError && (
          <p
            className="line-clamp-2 rounded-md bg-destructive/10 px-2 py-1 text-xs break-all text-destructive"
            title={server.lastSyncError}
          >
            {server.lastSyncError}
          </p>
        )}
      </CardContent>
      <CardFooter className="mt-auto flex flex-wrap gap-2">
        <SyncButton serverId={server.id} name={server.displayName} />
        <Button size="sm" variant="ghost" asChild>
          <Link href={serverHref(server.id)}>
            {t('open')} <ArrowRightIcon />
          </Link>
        </Button>
      </CardFooter>
    </Card>
  );
}

/** Servers (DBAs): admin connections the module manages accounts on, their sync and drift at a glance. */
export default function ServersPage() {
  const t = useTranslations('dbaccess.servers');
  const router = useRouter();
  const { data, isLoading } = useApiQuery<Servers>('/dbaccess/servers');
  const [configuring, setConfiguring] = useState<ConnectionInfo | null>(null);
  const canConnections = useCan('core.databases.manage');
  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={
          canConnections && (
            <Button variant="outline" asChild>
              <Link href="/admin/databases">
                <SettingsIcon /> {t('connections')}
              </Link>
            </Button>
          )
        }
      />
      {isLoading || !data ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-64 rounded-xl" />
          ))}
        </div>
      ) : (
        <div className="grid min-w-0 grid-cols-1 gap-8">
          {data.items.length === 0 ? (
            <div className="rounded-xl border bg-card shadow-xs">
              <EmptyState icon={<ServerCogIcon />} title={t('empty')} description={t('emptyHint')} />
            </div>
          ) : (
            <Stagger className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {data.items.map((s) => (
                <StaggerItem key={s.id} className="min-w-0">
                  <ServerCard server={s} />
                </StaggerItem>
              ))}
            </Stagger>
          )}
          {data.unconfigured.length > 0 && (
            <section aria-labelledby="dbaccess-unconfigured" className="grid gap-3">
              <h2 id="dbaccess-unconfigured" className="text-lg font-semibold">
                {t('unconfigured')}
              </h2>
              <p className="text-sm text-muted-foreground">{t('unconfiguredHint')}</p>
              <ul className="divide-y rounded-xl border bg-card shadow-xs">
                {data.unconfigured.map((c) => {
                  const managed = isManagedEngine(c.engine);
                  return (
                    <li
                      key={c.id}
                      className="flex min-w-0 flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-4"
                    >
                      <PlugIcon
                        className="hidden size-4 shrink-0 text-muted-foreground sm:block"
                        aria-hidden
                      />
                      <span className="grid min-w-0 flex-1">
                        <span className="truncate font-medium">{c.name}</span>
                        <span className="flex min-w-0 flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          <EngineLabel engine={c.engine} />
                          <span className="truncate font-mono">{c.host}</span>
                          {!c.enabled && <Badge variant="muted">{t('disabled')}</Badge>}
                        </span>
                      </span>
                      {managed ? (
                        <Button size="sm" variant="outline" onClick={() => setConfiguring(c)}>
                          <ServerCogIcon /> {t('manage')}
                        </Button>
                      ) : (
                        <span className="text-xs text-muted-foreground">{t('notManaged')}</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
        </div>
      )}
      <ServerFormDialog
        target={configuring ? { kind: 'create', connection: configuring } : null}
        onClose={() => setConfiguring(null)}
        onSaved={(s) => router.push(serverHref(s.id))}
      />
    </>
  );
}
