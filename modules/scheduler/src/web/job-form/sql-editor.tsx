'use client';

import { Banner } from '@astryxdesign/core/Banner';
import { Field } from '@astryxdesign/core/Field';
import { Grid } from '@astryxdesign/core/Grid';
import { VStack } from '@astryxdesign/core/Layout';
import { Selector } from '@astryxdesign/core/Selector';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import { parameterNames, writeKeywords } from '@isbp/sql/params';
import { Card, CardContent } from '@isbp/ui/card';
import { CodeEditor, type SqlSchema } from '@isbp/ui/code-editor';
import { useApiQuery, useErrorText } from '@isbp/ui/query';
import { DatabaseIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useMemo } from 'react';
import {
  type CatalogDto,
  type DbConnectionSummary,
  SQL_BUILTINS,
  SQL_PARAM_TYPES,
  type SqlParamInput,
  syncParams,
} from '../../contracts';
import { type EditorProps, errorStatus } from './fields';

export const SQL_DEFAULTS = { connectionId: '', statement: '', mode: 'query', params: [] as SqlParamInput[] };

const EMPTY: DbConnectionSummary[] = [];

function safeNames(sql: string, engine: DbConnectionSummary['engine']): string[] {
  try {
    return parameterNames(sql, engine);
  } catch {
    return [];
  }
}

/** SQL statement on a data connection: catalog autocompletion and `:parameters` detected as you type. */
export function SqlEditor({ value, onChange, errors, disabled }: EditorProps) {
  const t = useTranslations('scheduler.sql');
  const errorText = useErrorText();
  const id = useId();
  const c = { ...SQL_DEFAULTS, ...value } as typeof SQL_DEFAULTS & { mode: 'query' | 'execute' };
  const set = (patch: Record<string, unknown>) => onChange({ ...c, ...patch });
  const { data: conns, isLoading } = useApiQuery<{ items: DbConnectionSummary[] }>('/scheduler/connections');
  const connections = conns?.items ?? EMPTY;
  const conn = connections.find((x) => x.id === c.connectionId) ?? null;
  const engine = conn?.engine ?? 'postgres';
  const catalog = useApiQuery<CatalogDto>(conn ? `/scheduler/connections/${conn.id}/catalog` : null);
  const schema = useMemo<SqlSchema | undefined>(() => {
    if (!catalog.data) return undefined;
    const out: Record<string, string[]> = {};
    for (const tbl of catalog.data.tables) {
      const cols = tbl.columns.map((col) => col.name);
      out[`${tbl.schema}.${tbl.name}`] = cols;
      if (tbl.schema === catalog.data.defaultSchema) out[tbl.name] = cols;
    }
    return out;
  }, [catalog.data]);
  const statement = String(c.statement ?? '');
  const names = useMemo(() => safeNames(statement, engine), [statement, engine]);
  const params = syncParams(names, c.params ?? []);
  const writes = useMemo(() => {
    try {
      return writeKeywords(statement, engine);
    } catch {
      return [];
    }
  }, [statement, engine]);
  const setParam = (i: number, patch: Partial<SqlParamInput>) =>
    set({ params: params.map((p, k) => (k === i ? { ...p, ...patch } : p)) });

  return (
    <VStack gap={5}>
      <Grid columns={{ minWidth: 240, repeat: 'fit' }} gap={4} align="end">
        <Selector
          label={t('connection')}
          description={t('connectionHint')}
          width="100%"
          placeholder={isLoading ? t('loading') : t('pickConnection')}
          value={c.connectionId || undefined}
          onChange={(v) => set({ connectionId: v })}
          options={connections.map((x) => ({
            value: x.id,
            label: x.name,
            description: `${t(`engines.${x.engine}`)}${x.readOnly ? ` · ${t('readOnly')}` : ''}`,
            icon: DatabaseIcon,
          }))}
          status={errorStatus(errors.connectionId)}
          isDisabled={disabled}
        />
        <Selector
          label={t('mode')}
          description={t(`modeHint.${c.mode}`)}
          width="100%"
          value={c.mode}
          onChange={(v) => set({ mode: v })}
          options={[
            { value: 'query', label: t('modes.query') },
            { value: 'execute', label: t('modes.execute') },
          ]}
          status={errorStatus(errors.mode)}
          isDisabled={disabled}
        />
      </Grid>
      {!isLoading && connections.length === 0 && (
        <Banner role="status" status="info" collapsible={false} title={t('noConnections')} />
      )}
      {conn?.readOnly && c.mode === 'execute' && (
        <Banner role="status" status="warning" collapsible={false} title={t('readOnlyExecute')} />
      )}

      <Field
        label={t('statement')}
        isGroupLabel
        labelID={`${id}-stmt`}
        inputID={`${id}-stmt-editor`}
        description={t('statementHint')}
        descriptionID={`${id}-stmt-hint`}
        status={errorStatus(errors.statement)}
        statusVariant="detached"
      >
        <VStack gap={2}>
          <CodeEditor
            aria-labelledby={`${id}-stmt`}
            aria-describedby={`${id}-stmt-hint`}
            aria-invalid={Boolean(errors.statement)}
            value={c.statement}
            onChange={(statement) => set({ statement })}
            language="sql"
            dialect={engine}
            schema={schema}
            readOnly={disabled}
            placeholder="SELECT …"
            minHeight="8rem"
          />
          {catalog.error && (
            <Text size="xsm" color="secondary">
              {t('catalogUnavailable', { error: errorText(catalog.error) })}
            </Text>
          )}
          {c.mode === 'query' && writes.length > 0 && (
            <Banner
              role="status"
              status="warning"
              collapsible={false}
              title={t('writesInQuery', { keywords: writes.join(', ') })}
            />
          )}
        </VStack>
      </Field>

      <VStack gap={2}>
        <Text weight="medium">{t('parameters')}</Text>
        {errors.params && <Banner status="error" collapsible={false} title={errors.params} />}
        {params.length === 0 ? (
          <Text color="secondary">{t('noParameters')}</Text>
        ) : (
          <ul className="grid min-w-0 gap-3" aria-label={t('parameters')}>
            {params.map((p, i) => (
              <li key={p.name} className="min-w-0">
                <Card>
                  <CardContent>
                    <div className="grid min-w-0 gap-2 sm:grid-cols-[minmax(0,8rem)_minmax(0,12rem)_minmax(0,9rem)_minmax(0,1fr)] sm:items-center">
                      <Text type="code" weight="medium" maxLines={1}>
                        :{p.name}
                      </Text>
                      <Selector
                        label={t('paramSource', { name: p.name })}
                        isLabelHidden
                        width="100%"
                        value={p.source}
                        onChange={(v) => setParam(i, { source: v as SqlParamInput['source'] })}
                        options={[
                          { value: 'static', label: t('sources.static') },
                          ...SQL_BUILTINS.map((b) => ({ value: b, label: t(`sources.${b}`) })),
                        ]}
                        isDisabled={disabled}
                      />
                      {p.source === 'static' ? (
                        <>
                          <Selector
                            label={t('paramType', { name: p.name })}
                            isLabelHidden
                            width="100%"
                            value={p.type}
                            onChange={(v) => setParam(i, { type: v as SqlParamInput['type'] })}
                            options={SQL_PARAM_TYPES.map((ty) => ({ value: ty, label: t(`types.${ty}`) }))}
                            isDisabled={disabled}
                          />
                          <TextInput
                            label={t('paramValue', { name: p.name })}
                            isLabelHidden
                            value={p.value ?? ''}
                            onChange={(v) => setParam(i, { value: v })}
                            placeholder={t(`placeholders.${p.type}`)}
                            status={errorStatus(errors[`params.${i}.value`])}
                            statusVariant="detached"
                            isDisabled={disabled}
                          />
                        </>
                      ) : (
                        <div className="sm:col-span-2">
                          <Text type="supporting">{t(`sourceHint.${p.source}`)}</Text>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </VStack>
    </VStack>
  );
}

/** Parameter definitions to save: one per `:name` in the statement. */
export function normalizeSql(
  config: Record<string, unknown>,
  engine: DbConnectionSummary['engine'] = 'postgres',
) {
  const c = { ...SQL_DEFAULTS, ...config };
  return { ...c, params: syncParams(safeNames(c.statement, engine), c.params ?? []) };
}
