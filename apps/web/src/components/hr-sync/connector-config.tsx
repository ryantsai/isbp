'use client';

import { CheckboxInput } from '@astryxdesign/core/CheckboxInput';
import { VStack } from '@astryxdesign/core/Layout';
import { Link } from '@astryxdesign/core/Link';
import { NumberInput } from '@astryxdesign/core/NumberInput';
import { Selector } from '@astryxdesign/core/Selector';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import {
  HR_DEPARTMENTS_SQL,
  HR_EMPLOYEES_SQL,
  type ConnectorConfigSlotProps,
  type DbConnectionDto,
} from '@isbp/contracts';
import { guideHref } from '@isbp/guide/meta';
import { CodeEditor } from '@isbp/ui/code-editor';
import { useApiQuery } from '@isbp/ui/query';
import { useTranslations } from 'next-intl';
import { useId } from 'react';

const text = (v: unknown) => (typeof v === 'string' ? v : '');

/** HR source configuration inside the existing Integrations connection sheet. */
export default function HrConnectorConfig({
  config,
  onConfigChange,
  errors,
  disabled,
}: ConnectorConfigSlotProps) {
  const t = useTranslations('core.hrSync');
  const id = useId();
  const { data, isLoading, error } = useApiQuery<{ items: DbConnectionDto[] }>('/databases');
  const choices = data?.items.filter((c) => c.enabled && c.readOnly && c.purposes.includes('data')) ?? [];
  const selected = choices.find((c) => c.id === config.databaseId);
  const set = (key: string, value: unknown) => onConfigChange({ ...config, [key]: value });
  const status = (key: string) => {
    const message = errors?.[`config.${key}`];
    return message ? { type: 'error' as const, message } : undefined;
  };
  return (
    <VStack gap={4} className="min-w-0">
      <Text type="supporting">{t('setupHint')}</Text>
      <Link href={guideHref('data-and-automation', 'hr-sync')}>{t('guide')}</Link>
      <Selector
        label={t('database')}
        isRequired
        hasClear
        value={text(config.databaseId) || null}
        options={choices.map((c) => ({ value: c.id, label: c.name }))}
        onChange={(value) => set('databaseId', value)}
        isDisabled={disabled || isLoading}
        description={error ? t('databaseError') : t('databaseHint')}
        status={status('databaseId')}
      />
      {(['employeesQuery', 'departmentsQuery'] as const).map((key) => (
        <VStack key={key} gap={1.5} className="min-w-0">
          <Text id={`${id}-${key}`} type="label">
            {t(key)}
          </Text>
          <Text type="supporting">{t(`${key}Hint`)}</Text>
          <CodeEditor
            language="sql"
            dialect={selected?.engine ?? 'mssql'}
            value={text(config[key])}
            onChange={(value) => set(key, value)}
            readOnly={disabled}
            aria-labelledby={`${id}-${key}`}
            aria-invalid={Boolean(status(key))}
            aria-describedby={status(key) ? `${id}-${key}-error` : undefined}
            placeholder={key === 'employeesQuery' ? HR_EMPLOYEES_SQL : HR_DEPARTMENTS_SQL}
          />
          {status(key) && (
            <Text id={`${id}-${key}-error`} role="alert">
              {status(key)!.message}
            </Text>
          )}
        </VStack>
      ))}
      <NumberInput
        label={t('maxRows')}
        value={typeof config.maxRows === 'number' ? config.maxRows : 5000}
        min={1}
        max={20000}
        isIntegerOnly
        isWheelEnabled={false}
        isDisabled={disabled}
        description={t('maxRowsHint')}
        onChange={(value) => set('maxRows', value)}
        status={status('maxRows')}
      />
      <CheckboxInput
        label={t('syncStatus')}
        value={config.syncStatus !== false}
        isDisabled={disabled}
        description={t('syncStatusHint')}
        onChange={(value) => set('syncStatus', value)}
      />
      {config.syncStatus !== false &&
        (['activeValues', 'leaverValues'] as const).map((key) => (
          <TextInput
            key={key}
            label={t(key)}
            value={(Array.isArray(config[key])
              ? config[key]
              : key === 'activeValues'
                ? ['active', 'employed']
                : ['offboarded', 'terminated', 'left']
            ).join(',')}
            description={t('valuesHint')}
            isDisabled={disabled}
            status={status(key)}
            onChange={(value) => set(key, value.split(','))}
          />
        ))}
    </VStack>
  );
}
