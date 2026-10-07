'use client';

import type { TaskConfigSlotProps } from '@isbp/contracts';
import { Label } from '@isbp/ui/label';
import { useApiQuery } from '@isbp/ui/query';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@isbp/ui/select';
import { ExternalLinkIcon } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useId } from 'react';
import type { Connection, Profile } from '../../contracts';
import { profileHref } from '../lib';

/**
 * Config editor of the `integrations.sync` task type in Scheduled Jobs' job form
 * (`scheduler.task-config.integrations.sync`): a labelled profile picker that writes `{ profileId }`.
 */
export default function SyncTaskConfig({ value, onChange, errors, disabled }: TaskConfigSlotProps) {
  const t = useTranslations('integrations.taskConfig');
  const id = useId();
  const profiles = useApiQuery<{ items: Profile[] }>('/integrations/profiles');
  const connections = useApiQuery<{ items: Connection[] }>('/integrations/connections');
  const names = new Map((connections.data?.items ?? []).map((c) => [c.id, c.name]));
  const profileId = typeof value.profileId === 'string' ? value.profileId : '';
  const error = errors?.profileId ?? errors?.[''];
  const selected = profiles.data?.items.find((p) => p.id === profileId);
  return (
    <div className="grid min-w-0 gap-1.5">
      <Label htmlFor={`${id}-profile`}>{t('profile')}</Label>
      <Select
        value={profileId}
        onValueChange={(v) => onChange({ ...value, profileId: v })}
        disabled={disabled}
      >
        <SelectTrigger
          id={`${id}-profile`}
          className="w-full"
          aria-invalid={Boolean(error) || undefined}
          aria-describedby={error ? `${id}-error` : `${id}-hint`}
        >
          <SelectValue placeholder={profiles.isLoading ? t('loading') : t('pick')} />
        </SelectTrigger>
        <SelectContent>
          {(profiles.data?.items ?? []).map((p) => (
            <SelectItem key={p.id} value={p.id}>
              {t('option', { profile: p.name, connection: names.get(p.connectionId) ?? '' })}
              {!p.enabled ? ` · ${t('disabled')}` : ''}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {error ? (
        <p id={`${id}-error`} className="text-xs text-destructive">
          {error}
        </p>
      ) : (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {t('hint')}
        </p>
      )}
      {selected && (
        <Link
          href={profileHref(selected.connectionId, selected.id)}
          className="inline-flex w-fit items-center gap-1 text-sm text-primary hover:underline focus-visible:underline focus-visible:outline-none"
        >
          {t('open', { name: selected.name })}
          <ExternalLinkIcon className="size-3.5" aria-hidden />
        </Link>
      )}
    </div>
  );
}
