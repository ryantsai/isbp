'use client';

import { Icon } from '@astryxdesign/core/Icon';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { Link } from '@astryxdesign/core/Link';
import { Selector } from '@astryxdesign/core/Selector';
import type { TaskConfigSlotProps } from '@isbp/contracts';
import type { Page } from '@isbp/sdk';
import { useApiQuery } from '@isbp/ui/query';
import { ExternalLinkIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { PipelineSummary } from '../../contracts';
import { pipelineHref } from '../lib';

/**
 * Config editor of the `etl.pipeline` task type in Scheduled Jobs' job form (`scheduler.task-config.etl.pipeline`):
 * a labelled pipeline picker that writes `{ pipelineId }`.
 */
export default function PipelineTaskConfig({ value, onChange, errors, disabled }: TaskConfigSlotProps) {
  const t = useTranslations('etl.taskConfig');
  const { data, isLoading } = useApiQuery<Page<PipelineSummary>>('/etl/pipelines', {
    pageSize: 200,
    sort: 'name',
  });
  const pipelineId = typeof value.pipelineId === 'string' ? value.pipelineId : '';
  const error = errors?.pipelineId ?? errors?.[''];
  const selected = data?.items.find((p) => p.id === pipelineId);
  return (
    <VStack gap={1.5} className="min-w-0">
      <Selector
        label={t('pipeline')}
        description={t('hint')}
        hasSearch
        isDisabled={disabled}
        placeholder={isLoading ? t('loading') : t('pick')}
        options={(data?.items ?? []).map((p) => ({
          value: p.id,
          label: `${p.name}${!p.enabled ? ` · ${t('disabled')}` : ` · ${p.targetTable}`}`,
          disabled: !p.enabled,
        }))}
        value={pipelineId}
        onChange={(v) => onChange({ ...value, pipelineId: v })}
        status={error ? { type: 'error', message: error } : undefined}
      />
      {selected && (
        <HStack gap={1} vAlign="center">
          <Link href={pipelineHref(selected.id)}>{t('open', { name: selected.name })}</Link>
          <Icon icon={ExternalLinkIcon} color="secondary" />
        </HStack>
      )}
    </VStack>
  );
}
