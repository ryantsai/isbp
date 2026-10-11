'use client';

import { Icon } from '@astryxdesign/core/Icon';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { Link } from '@astryxdesign/core/Link';
import { Selector } from '@astryxdesign/core/Selector';
import type { TaskConfigSlotProps } from '@isbp/contracts';
import { useApiQuery } from '@isbp/ui/query';
import { ExternalLinkIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { Connection, Profile } from '../../contracts';
import { profileHref } from '../lib';

/**
 * Config editor of the `integrations.sync` task type in Scheduled Jobs' job form
 * (`scheduler.task-config.integrations.sync`): a labelled profile picker that writes `{ profileId }`.
 */
export default function SyncTaskConfig({ value, onChange, errors, disabled }: TaskConfigSlotProps) {
  const t = useTranslations('integrations.taskConfig');
  const profiles = useApiQuery<{ items: Profile[] }>('/integrations/profiles');
  const connections = useApiQuery<{ items: Connection[] }>('/integrations/connections');
  const names = new Map((connections.data?.items ?? []).map((c) => [c.id, c.name]));
  const profileId = typeof value.profileId === 'string' ? value.profileId : '';
  const error = errors?.profileId ?? errors?.[''];
  const selected = profiles.data?.items.find((p) => p.id === profileId);
  return (
    <VStack gap={1.5} className="min-w-0">
      <Selector
        label={t('profile')}
        description={t('hint')}
        hasSearch
        isDisabled={disabled}
        placeholder={profiles.isLoading ? t('loading') : t('pick')}
        options={(profiles.data?.items ?? []).map((p) => ({
          value: p.id,
          label: `${t('option', { profile: p.name, connection: names.get(p.connectionId) ?? '' })}${!p.enabled ? ` · ${t('disabled')}` : ''}`,
        }))}
        value={profileId}
        onChange={(v) => onChange({ ...value, profileId: v })}
        status={error ? { type: 'error', message: error } : undefined}
      />
      {selected && (
        <HStack gap={1} vAlign="center">
          <Link href={profileHref(selected.connectionId, selected.id)}>
            {t('open', { name: selected.name })}
          </Link>
          <Icon icon={ExternalLinkIcon} color="secondary" />
        </HStack>
      )}
    </VStack>
  );
}
