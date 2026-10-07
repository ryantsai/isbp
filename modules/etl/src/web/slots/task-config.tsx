'use client';

import type { TaskConfigSlotProps } from '@isbp/contracts';
import type { Page } from '@isbp/sdk';
import { Label } from '@isbp/ui/label';
import { useApiQuery } from '@isbp/ui/query';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@isbp/ui/select';
import { ExternalLinkIcon } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useId } from 'react';
import type { PipelineSummary } from '../../contracts';
import { pipelineHref } from '../lib';

/**
 * Config editor of the `etl.pipeline` task type in Scheduled Jobs' job form (`scheduler.task-config.etl.pipeline`):
 * a labelled pipeline picker that writes `{ pipelineId }`.
 */
export default function PipelineTaskConfig({ value, onChange, errors, disabled }: TaskConfigSlotProps) {
  const t = useTranslations('etl.taskConfig');
  const id = useId();
  const { data, isLoading } = useApiQuery<Page<PipelineSummary>>('/etl/pipelines', {
    pageSize: 200,
    sort: 'name',
  });
  const pipelineId = typeof value.pipelineId === 'string' ? value.pipelineId : '';
  const error = errors?.pipelineId ?? errors?.[''];
  const selected = data?.items.find((p) => p.id === pipelineId);
  return (
    <div className="grid min-w-0 gap-1.5">
      <Label htmlFor={`${id}-pipeline`}>{t('pipeline')}</Label>
      <Select
        value={pipelineId}
        onValueChange={(v) => onChange({ ...value, pipelineId: v })}
        disabled={disabled}
      >
        <SelectTrigger
          id={`${id}-pipeline`}
          className="w-full"
          aria-invalid={Boolean(error) || undefined}
          aria-describedby={`${id}-hint`}
        >
          <SelectValue placeholder={isLoading ? t('loading') : t('pick')} />
        </SelectTrigger>
        <SelectContent>
          {(data?.items ?? []).map((p) => (
            <SelectItem key={p.id} value={p.id} disabled={!p.enabled}>
              {p.name}
              {!p.enabled ? ` · ${t('disabled')}` : ` · ${p.targetTable}`}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p id={`${id}-hint`} className="text-xs text-muted-foreground">
        {t('hint')}
      </p>
      {error && <p className="text-xs text-destructive">{error}</p>}
      {selected && (
        <Link
          href={pipelineHref(selected.id)}
          className="inline-flex w-fit items-center gap-1 text-sm text-primary hover:underline focus-visible:underline focus-visible:outline-none"
        >
          {t('open', { name: selected.name })}
          <ExternalLinkIcon className="size-3.5" aria-hidden />
        </Link>
      )}
    </div>
  );
}
