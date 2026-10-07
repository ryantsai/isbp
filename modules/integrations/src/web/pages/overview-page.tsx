'use client';

import { useCan } from '@isbp/sdk/web';
import { Button } from '@isbp/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@isbp/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@isbp/ui/dialog';
import { EmptyState } from '@isbp/ui/empty-state';
import { Stagger, StaggerItem } from '@isbp/ui/motion';
import { PageHeader } from '@isbp/ui/page-header';
import { useApiQuery } from '@isbp/ui/query';
import { RelativeTime } from '@isbp/ui/relative-time';
import { Skeleton } from '@isbp/ui/skeleton';
import { ArrowLeftRightIcon, ChevronRightIcon, PlusIcon } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import type { Connection, ConnectionCreated, ConnectorInfoDto } from '../../contracts';
import { HealthBadge, InsecureBadge, ModuleIcon, RunStatusText } from '../badges';
import { ConnectionSheet } from '../connection/connection-sheet';
import { SecretDialog } from '../connection/secret-dialog';
import { connectionHref, useCatalogue, useLabel } from '../lib';

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'warning' | 'destructive' }) {
  const format = useFormatter();
  return (
    <div className="min-w-0">
      <dt className="truncate text-xs text-muted-foreground">{label}</dt>
      <dd
        className={
          tone && value > 0
            ? tone === 'warning'
              ? 'text-lg font-semibold tabular-nums text-warning-foreground'
              : 'text-lg font-semibold tabular-nums text-destructive'
            : 'text-lg font-semibold tabular-nums'
        }
      >
        {format.number(value)}
      </dd>
    </div>
  );
}

function ConnectionCard({ c }: { c: Connection }) {
  const t = useTranslations('integrations.overview');
  const label = useLabel();
  return (
    <Card className="h-full min-w-0 transition-shadow hover:shadow-md motion-reduce:transition-none">
      <CardHeader className="gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
            <ModuleIcon name={c.connector.icon} className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <CardTitle className="truncate">
              <Link
                href={connectionHref(c.id)}
                className="outline-none after:absolute after:inset-0 hover:underline focus-visible:underline"
              >
                {c.name}
              </Link>
            </CardTitle>
            <p className="truncate text-sm text-muted-foreground">{label(c.connector.name)}</p>
          </div>
          <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <HealthBadge health={c.health} enabled={c.enabled} />
          {c.allowInsecureHttp && <InsecureBadge />}
          {!c.connector.available && (
            <span className="text-xs text-muted-foreground">{t('unavailable')}</span>
          )}
        </div>
      </CardHeader>
      <CardContent className="grid gap-3">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
          <Stat label={t('profiles')} value={c.stats.profiles} />
          <Stat label={t('linked')} value={c.stats.links} />
          <Stat label={t('conflicts')} value={c.stats.conflicts} tone="warning" />
          <Stat label={t('errors')} value={c.stats.errors} tone="destructive" />
        </dl>
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <span>
            {t('lastSync')} {c.stats.lastSyncAt ? <RelativeTime date={c.stats.lastSyncAt} /> : t('never')}
          </span>
          {c.stats.lastRunStatus && <RunStatusText status={c.stats.lastRunStatus} />}
        </p>
      </CardContent>
    </Card>
  );
}

/** Pick the kind of system to connect to. */
function ConnectorPicker({
  open,
  onOpenChange,
  connectors,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connectors: ConnectorInfoDto[];
  onPick: (c: ConnectorInfoDto) => void;
}) {
  const t = useTranslations('integrations.overview');
  const tc = useTranslations('common');
  const name = useLabel();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={tc('close')} className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('pickTitle')}</DialogTitle>
          <DialogDescription>{t('pickDescription')}</DialogDescription>
        </DialogHeader>
        {connectors.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('noConnectors')}</p>
        ) : (
          <ul className="grid gap-2">
            {connectors.map((c) => (
              <li key={c.type}>
                <button
                  type="button"
                  onClick={() => onPick(c)}
                  className="flex w-full min-w-0 items-start gap-3 rounded-lg border p-3 text-left transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none motion-reduce:transition-none"
                >
                  <span className="grid size-9 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
                    <ModuleIcon name={c.icon} className="size-4" />
                  </span>
                  <span className="min-w-0">
                    <span className="block font-medium">{name(c.name)}</span>
                    {c.description && (
                      <span className="block text-sm text-muted-foreground">{name(c.description)}</span>
                    )}
                    <span className="mt-1 block text-xs text-muted-foreground">
                      {c.objects.map((o) => name(o.name)).join(' · ')}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Administration → Integrations: one card per connection, and "Add connection". */
export default function OverviewPage() {
  const t = useTranslations('integrations.overview');
  const label = useLabel();
  const router = useRouter();
  const canManage = useCan('integrations.connections.manage');
  const catalogue = useCatalogue();
  const { data, isLoading } = useApiQuery<{ items: Connection[] }>('/integrations/connections');
  const [picking, setPicking] = useState(false);
  const [connector, setConnector] = useState<ConnectorInfoDto | null>(null);
  const [created, setCreated] = useState<ConnectionCreated | null>(null);
  const connectors = catalogue.list.connectors.map((c) => ({
    ...c,
    name: label(c.name),
    description: c.description ? label(c.description) : null,
  }));

  const add = canManage && (
    <Button onClick={() => setPicking(true)}>
      <PlusIcon /> {t('add')}
    </Button>
  );
  const items = data?.items ?? [];

  return (
    <>
      <PageHeader title={t('title')} description={t('description')} actions={add} />
      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-48 rounded-xl" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={<ArrowLeftRightIcon />}
          title={t('empty')}
          description={t('emptyHint')}
          action={add || undefined}
        />
      ) : (
        <Stagger className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {items.map((c) => (
            <StaggerItem key={c.id} className="relative min-w-0">
              <ConnectionCard c={c} />
            </StaggerItem>
          ))}
        </Stagger>
      )}
      <ConnectorPicker
        open={picking}
        onOpenChange={setPicking}
        connectors={connectors}
        onPick={(c) => {
          setPicking(false);
          setConnector(c);
        }}
      />
      <ConnectionSheet
        open={connector !== null}
        onOpenChange={(open) => !open && setConnector(null)}
        connector={connector}
        onCreated={setCreated}
      />
      {created && (
        <SecretDialog
          open
          onOpenChange={(open) => {
            if (!open) {
              const id = created.id;
              setCreated(null);
              router.push(connectionHref(id));
            }
          }}
          secret={created.webhookSecret}
          connectionId={created.id}
          connectorType={created.type}
        />
      )}
    </>
  );
}
