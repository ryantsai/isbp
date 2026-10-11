'use client';

import { Selector } from '@astryxdesign/core/Selector';
import type { TaskConfigSlotProps } from '@isbp/contracts';
import { useApiQuery } from '@isbp/ui/query';
import { useTranslations } from 'next-intl';
import type { ServerOption } from '../../contracts';

/** Lists longer than this get a search box in the dropdown. */
const SEARCH_FROM = 8;

/**
 * `scheduler.task-config.dbaccess.sync`: the config editor of the inventory sync task type in the
 * Scheduled jobs form — a labelled server picker writing `{ serverId }`.
 */
export default function SyncTaskConfig({ type, value, onChange, errors, disabled }: TaskConfigSlotProps) {
  const t = useTranslations('dbaccess.taskConfig');
  const { data, isLoading } = useApiQuery<{ items: ServerOption[] }>('/dbaccess/lookups/servers');
  if (type !== 'dbaccess.sync') return null;
  const serverId = typeof value.serverId === 'string' ? value.serverId : '';
  const error = errors?.serverId ?? errors?.['config.serverId'];
  const servers = data?.items ?? [];
  return (
    <Selector
      label={t('server')}
      width={320}
      value={serverId || undefined}
      placeholder={t('placeholder')}
      description={error ? undefined : t('hint')}
      status={error ? { type: 'error', message: error } : undefined}
      isDisabled={disabled || isLoading}
      hasSearch={servers.length > SEARCH_FROM}
      onChange={(v) => onChange({ ...value, serverId: v })}
      options={servers.map((s) => ({ value: s.id, label: s.displayName }))}
    />
  );
}
