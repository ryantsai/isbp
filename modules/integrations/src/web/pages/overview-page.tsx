'use client';

import { Button } from '@astryxdesign/core/Button';
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import { Grid } from '@astryxdesign/core/Grid';
import { Icon } from '@astryxdesign/core/Icon';
import { HStack, Layout, LayoutContent, VStack } from '@astryxdesign/core/Layout';
import { Link } from '@astryxdesign/core/Link';
import { List, ListItem } from '@astryxdesign/core/List';
import { Text } from '@astryxdesign/core/Text';
import { useCan } from '@isbp/sdk/web';
import { Card, CardContent, CardHeader, CardTitle } from '@isbp/ui/card';
import { EmptyState, ErrorState } from '@isbp/ui/empty-state';
import { IconTile } from '@isbp/ui/icon-tile';
import { Stagger, StaggerItem } from '@isbp/ui/motion';
import { PageHeader } from '@isbp/ui/page-header';
import { useApiQuery } from '@isbp/ui/query';
import { RelativeTime } from '@isbp/ui/relative-time';
import { Skeleton } from '@isbp/ui/skeleton';
import { ArrowLeftRightIcon, ChevronRightIcon, PlusIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import type { Connection, ConnectionCreated, ConnectorInfoDto } from '../../contracts';
import { HealthBadge, InsecureBadge, ModuleIcon, RunStatusText } from '../badges';
import { ConnectionSheet } from '../connection/connection-sheet';
import { SecretDialog } from '../connection/secret-dialog';
import { connectionHref, useCatalogue, useLabel } from '../lib';

function Stat({
  label,
  value,
  href,
  action,
}: {
  label: string;
  value: number;
  /** Problems are links to where they are dealt with. */
  href?: string;
  action?: string;
}) {
  const format = useFormatter();
  return (
    <VStack gap={0} className="min-w-0">
      <Text type="supporting" maxLines={1}>
        {label}
      </Text>
      {href && value > 0 ? (
        <Link href={href} weight="semibold" size="lg" className="relative z-10">
          {format.number(value)}
          {action && (
            <Text type="supporting" weight="medium">
              {' '}
              {action} →
            </Text>
          )}
        </Link>
      ) : (
        <Text weight="semibold" size="lg" hasTabularNumbers>
          {format.number(value)}
        </Text>
      )}
    </VStack>
  );
}

function ConnectionCard({ c }: { c: Connection }) {
  const t = useTranslations('integrations.overview');
  const label = useLabel();
  return (
    <Card interactive className="h-full min-w-0">
      <CardHeader className="gap-3">
        <HStack gap={3} vAlign="start" className="min-w-0">
          <IconTile aria-hidden>
            <ModuleIcon name={c.connector.icon} />
          </IconTile>
          <VStack gap={0} className="min-w-0 flex-1">
            <CardTitle>
              <Link
                href={connectionHref(c.id)}
                weight="semibold"
                color="primary"
                className="after:absolute after:inset-0"
              >
                {c.name}
              </Link>
            </CardTitle>
            <Text color="secondary" maxLines={1}>
              {label(c.connector.name)}
            </Text>
          </VStack>
          <Icon icon={ChevronRightIcon} color="secondary" />
        </HStack>
        <HStack gap={2} wrap="wrap" vAlign="center">
          <HealthBadge
            health={c.health}
            enabled={c.enabled}
            attention={c.stats.conflicts > 0 || c.stats.errors > 0}
          />
          {c.allowInsecureHttp && <InsecureBadge />}
          {!c.connector.available && <Text type="supporting">{t('unavailable')}</Text>}
        </HStack>
      </CardHeader>
      <CardContent>
        <VStack gap={3}>
          <Grid columns={2} gap={4}>
            <Stat label={t('profiles')} value={c.stats.profiles} />
            <Stat label={t('linked')} value={c.stats.links} />
            <Stat
              label={t('conflicts')}
              value={c.stats.conflicts}
              href={`${connectionHref(c.id)}?tab=conflicts`}
              action={t('resolve')}
            />
            <Stat
              label={t('errors')}
              value={c.stats.errors}
              href={`${connectionHref(c.id)}?tab=links&state=error`}
              action={t('view')}
            />
          </Grid>
          <HStack gap={2} wrap="wrap" vAlign="center">
            <Text type="supporting">
              {t('lastSync')} {c.stats.lastSyncAt ? <RelativeTime date={c.stats.lastSyncAt} /> : t('never')}
            </Text>
            {c.stats.lastRunStatus && <RunStatusText status={c.stats.lastRunStatus} />}
          </HStack>
        </VStack>
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
  const name = useLabel();
  return (
    <Dialog isOpen={open} onOpenChange={onOpenChange} width={512}>
      <Layout
        header={
          <DialogHeader title={t('pickTitle')} subtitle={t('pickDescription')} onOpenChange={onOpenChange} />
        }
        content={
          <LayoutContent padding={4}>
            {connectors.length === 0 ? (
              <Text color="secondary">{t('noConnectors')}</Text>
            ) : (
              <List hasDividers>
                {connectors.map((c) => (
                  <ListItem
                    key={c.type}
                    label={name(c.name)}
                    description={
                      <VStack gap={0.5}>
                        {c.description && <span>{name(c.description)}</span>}
                        <Text type="supporting">{c.objects.map((o) => name(o.name)).join(' · ')}</Text>
                      </VStack>
                    }
                    startContent={
                      <IconTile aria-hidden size="sm">
                        <ModuleIcon name={c.icon} />
                      </IconTile>
                    }
                    onClick={() => onPick(c)}
                  />
                ))}
              </List>
            )}
          </LayoutContent>
        }
      />
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
  const { data, isLoading, error, refetch } = useApiQuery<{ items: Connection[] }>(
    '/integrations/connections',
  );
  const [picking, setPicking] = useState(false);
  const [connector, setConnector] = useState<ConnectorInfoDto | null>(null);
  const [created, setCreated] = useState<ConnectionCreated | null>(null);
  const connectors = catalogue.list.connectors.map((c) => ({
    ...c,
    name: label(c.name),
    description: c.description ? label(c.description) : null,
  }));

  const add = canManage && (
    <Button
      label={t('add')}
      variant="primary"
      icon={<Icon icon={PlusIcon} />}
      onClick={() => setPicking(true)}
    />
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
      ) : error && !data ? (
        <ErrorState error={error} onRetry={() => refetch()} />
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
