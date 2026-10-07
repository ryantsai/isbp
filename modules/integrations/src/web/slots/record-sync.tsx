'use client';

import type { RecordPanelSlotProps } from '@isbp/contracts';
import { Button } from '@isbp/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@isbp/ui/card';
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
    <ul className="grid gap-3">
      {items.map((l) => (
        <li key={l.id} className="grid min-w-0 gap-1.5">
          <div className="flex min-w-0 items-center gap-2">
            <span className="grid size-7 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
              <ModuleIcon name={l.connection.icon} className="size-3.5" />
            </span>
            <span className="min-w-0 flex-1 truncate text-sm font-medium">{l.connection.name}</span>
            <LinkStateBadge state={l.state} />
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 pl-9 text-xs text-muted-foreground">
            <RemoteCell remoteRef={l.remoteRef} remoteUrl={l.remoteUrl} />
            <span>
              {t('lastSynced')} <RelativeTime date={l.lastSyncedAt} />
            </span>
          </div>
          {l.lastErrorCode && l.state === 'error' && (
            <p className="pl-9 text-xs text-destructive">
              {te.has(l.lastErrorCode) ? te(l.lastErrorCode) : t('error')}
            </p>
          )}
          {l.canSync && l.state !== 'orphaned' && (
            <div className="flex items-center gap-2 pl-9">
              <Button
                size="sm"
                variant="outline"
                loading={sync.isPending && sync.variables === l.id}
                onClick={() => sync.mutate(l.id)}
                aria-label={t('syncNowFor', { system: l.connection.name })}
              >
                <RefreshCwIcon /> {t('syncNow')}
              </Button>
              <span role="status" aria-live="polite" className="text-xs text-muted-foreground">
                {requested === l.id ? t('requested') : ''}
              </span>
            </div>
          )}
        </li>
      ))}
    </ul>
  );

  if (bare)
    return (
      <section aria-labelledby={headingId} className="mt-4 grid gap-2">
        <h3 id={headingId} className="flex items-center gap-2 text-sm font-medium">
          <ArrowLeftRightIcon className="size-4 text-muted-foreground" aria-hidden />
          {t('title')}
        </h3>
        {body}
      </section>
    );
  return (
    <Card role="region" aria-labelledby={headingId} className="mt-4 min-w-0">
      <CardHeader>
        <CardTitle id={headingId} className="flex items-center gap-2">
          <ArrowLeftRightIcon className="size-4 text-muted-foreground" aria-hidden />
          {t('title')}
        </CardTitle>
      </CardHeader>
      <CardContent>{body}</CardContent>
    </Card>
  );
}
