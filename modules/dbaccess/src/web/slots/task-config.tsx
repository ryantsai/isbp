'use client';

import type { TaskConfigSlotProps } from '@isbp/contracts';
import { Label } from '@isbp/ui/label';
import { useApiQuery } from '@isbp/ui/query';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@isbp/ui/select';
import { useTranslations } from 'next-intl';
import { useId } from 'react';
import type { ServerOption } from '../../contracts';

/**
 * `scheduler.task-config.dbaccess.sync`: the config editor of the inventory sync task type in the
 * Scheduled jobs form — a labelled server picker writing `{ serverId }`.
 */
export default function SyncTaskConfig({ type, value, onChange, errors, disabled }: TaskConfigSlotProps) {
  const t = useTranslations('dbaccess.taskConfig');
  const id = useId();
  const { data, isLoading } = useApiQuery<{ items: ServerOption[] }>('/dbaccess/lookups/servers');
  if (type !== 'dbaccess.sync') return null;
  const serverId = typeof value.serverId === 'string' ? value.serverId : '';
  const error = errors?.serverId ?? errors?.['config.serverId'];
  return (
    <div className="grid gap-2">
      <Label id={`${id}-label`} htmlFor={id}>
        {t('server')}
      </Label>
      <Select
        value={serverId || undefined}
        onValueChange={(v) => onChange({ ...value, serverId: v })}
        disabled={disabled || isLoading}
      >
        <SelectTrigger
          id={id}
          className="w-full sm:w-80"
          aria-labelledby={`${id}-label`}
          aria-invalid={Boolean(error) || undefined}
          aria-describedby={`${id}-hint`}
        >
          <SelectValue placeholder={t('placeholder')} />
        </SelectTrigger>
        <SelectContent>
          {(data?.items ?? []).map((s) => (
            <SelectItem key={s.id} value={s.id}>
              {s.displayName}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p id={`${id}-hint`} className={error ? 'text-sm text-destructive' : 'text-xs text-muted-foreground'}>
        {error ?? t('hint')}
      </p>
    </div>
  );
}
