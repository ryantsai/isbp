'use client';

import { Button } from '@astryxdesign/core/Button';
import { Icon } from '@astryxdesign/core/Icon';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { Text } from '@astryxdesign/core/Text';
import type { RecordPanelSlotProps } from '@isbp/contracts';
import { Card, CardContent, CardHeader, CardTitle } from '@isbp/ui/card';
import { IconTile } from '@isbp/ui/icon-tile';
import { useApiMutation, useApiQuery } from '@isbp/ui/query';
import { RelativeTime } from '@isbp/ui/relative-time';
import { ArrowLeftRightIcon, RefreshCwIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import type { RecordLink } from '../../contracts';
import { LinkStateBadge, ModuleIcon } from '../badges';
import { INVALIDATE } from '../lib';
import { RemoteCell } from '../links-table';

/**
 * `core.record.links`: "Synced with" — the outside systems this record is linked to (system, remote
 * reference, state, last sync), with "Sync now" for integration admins. Renders nothing when the record has
 * no links (or isn't a syncable kind of record).
 */
export default function RecordSync({ record, bare }: RecordPanelSlotProps) {
  const t = useTranslations('integrations.panel');
  const te = useTranslations('errors');
  const headingId = useId();
  const [requested, setRequested] = useState<string | null>(null);
  const { data } = useApiQuery<{ items: RecordLink[] }>('/integrations/links/by-record', {
    entity: record.type,
    id: record.id,
  });
  const sync = useApiMutation((api, id: string) => api.post(`/integrations/links/${id}/resync`), {
    invalidate: INVALIDATE,
    onSuccess: (_r, id) => setRequested(id),
  });
  const items = data?.items ?? [];
  if (!items.length) return null;

  const body = (
    <VStack as="ul" gap={3}>
      {items.map((l) => (
        <li key={l.id}>
          <VStack gap={1.5} className="min-w-0">
            <HStack gap={2} vAlign="center" className="min-w-0">
              <IconTile size="xs" aria-hidden className="text-(--color-text-secondary)">
                <ModuleIcon name={l.connection.icon} />
              </IconTile>
              <Text weight="medium" maxLines={1} className="min-w-0 flex-1">
                {l.connection.name}
              </Text>
              <LinkStateBadge state={l.state} />
            </HStack>
            <HStack gap={3} wrap="wrap" vAlign="center" className="pl-8">
              <RemoteCell remoteRef={l.remoteRef} remoteUrl={l.remoteUrl} />
              <Text type="supporting">
                {t('lastSynced')} <RelativeTime date={l.lastSyncedAt} />
              </Text>
            </HStack>
            {l.lastErrorCode && l.state === 'error' && (
              <Text type="supporting" className="pl-8">
                {te.has(l.lastErrorCode) ? te(l.lastErrorCode) : t('error')}
              </Text>
            )}
            {l.canSync && l.state !== 'orphaned' && (
              <HStack gap={2} vAlign="center" className="pl-8">
                <Button
                  label={t('syncNow')}
                  aria-label={t('syncNowFor', { system: l.connection.name })}
                  variant="secondary"
                  size="sm"
                  icon={<Icon icon={RefreshCwIcon} />}
                  isLoading={sync.isPending && sync.variables === l.id}
                  onClick={() => sync.mutate(l.id)}
                />
                <span role="status" aria-live="polite">
                  <Text type="supporting">{requested === l.id ? t('requested') : ''}</Text>
                </span>
              </HStack>
            )}
          </VStack>
        </li>
      ))}
    </VStack>
  );

  if (bare)
    return (
      <VStack as="section" gap={2} className="mt-4" aria-labelledby={headingId}>
        <Text type="label" as="div" role="heading" aria-level={3} id={headingId}>
          <HStack gap={2} vAlign="center">
            <Icon icon={ArrowLeftRightIcon} color="secondary" />
            {t('title')}
          </HStack>
        </Text>
        {body}
      </VStack>
    );
  return (
    <Card role="region" aria-labelledby={headingId} className="mt-4 min-w-0">
      <CardHeader>
        <CardTitle id={headingId}>
          <HStack gap={2} vAlign="center">
            <Icon icon={ArrowLeftRightIcon} color="secondary" />
            {t('title')}
          </HStack>
        </CardTitle>
      </CardHeader>
      <CardContent>{body}</CardContent>
    </Card>
  );
}
