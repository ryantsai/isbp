'use client';

import { parameterNames, writeKeywords } from '@isbp/sql/params';
import { CodeEditor, type SqlSchema } from '@isbp/ui/code-editor';
import { Input } from '@isbp/ui/input';
import { useApiQuery, useErrorText } from '@isbp/ui/query';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@isbp/ui/select';
import { DatabaseIcon, InfoIcon, TriangleAlertIcon } from 'lucide-react';
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
import { type EditorProps, FormRow } from './fields';

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
    <div className="grid min-w-0 gap-5">
      <div className="grid min-w-0 gap-4 sm:grid-cols-2">
        <FormRow label={t('connection')} hint={t('connectionHint')} error={errors.connectionId}>
          {({ id: fid, describedBy, invalid }) => (
            <Select
              value={c.connectionId ?? ''}
              onValueChange={(v) => set({ connectionId: v })}
              disabled={disabled}
            >
              <SelectTrigger
                id={fid}
                className="w-full"
                aria-describedby={describedBy}
                aria-invalid={invalid || undefined}
              >
                <SelectValue placeholder={isLoading ? t('loading') : t('pickConnection')} />
              </SelectTrigger>
              <SelectContent>
                {connections.map((x) => (
                  <SelectItem key={x.id} value={x.id}>
                    <DatabaseIcon aria-hidden />
                    {x.name}
                    <span className="text-xs text-muted-foreground">
                      {t(`engines.${x.engine}`)}
                      {x.readOnly ? ` · ${t('readOnly')}` : ''}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </FormRow>
        <FormRow label={t('mode')} hint={t(`modeHint.${c.mode}`)} error={errors.mode}>
          {({ id: fid, describedBy }) => (
            <Select value={c.mode} onValueChange={(v) => set({ mode: v })} disabled={disabled}>
              <SelectTrigger id={fid} className="w-full" aria-describedby={describedBy}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="query">{t('modes.query')}</SelectItem>
                <SelectItem value="execute">{t('modes.execute')}</SelectItem>
              </SelectContent>
            </Select>
          )}
        </FormRow>
      </div>
      {!isLoading && connections.length === 0 && (
        <p role="status" className="flex items-start gap-2 text-sm text-muted-foreground">
          <InfoIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
          {t('noConnections')}
        </p>
      )}
      {conn?.readOnly && c.mode === 'execute' && (
        <p role="status" className="flex items-start gap-2 text-sm text-warning-foreground">
          <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
          {t('readOnlyExecute')}
        </p>
      )}

      <div className="grid min-w-0 gap-2">
        <p
          id={`${id}-stmt`}
          className={errors.statement ? 'text-sm font-medium text-destructive' : 'text-sm font-medium'}
        >
          {t('statement')}
        </p>
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
        <p id={`${id}-stmt-hint`} className="text-xs text-muted-foreground">
          {t('statementHint')}
        </p>
        {catalog.error && (
          <p className="text-xs text-muted-foreground">
            {t('catalogUnavailable', { error: errorText(catalog.error) })}
          </p>
        )}
        {c.mode === 'query' && writes.length > 0 && (
          <p role="status" className="flex items-start gap-2 text-xs text-warning-foreground">
            <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            {t('writesInQuery', { keywords: writes.join(', ') })}
          </p>
        )}
        {errors.statement && <p className="text-xs font-medium text-destructive">{errors.statement}</p>}
      </div>

      <div className="grid min-w-0 gap-2">
        <p className="text-sm font-medium">{t('parameters')}</p>
        {errors.params && <p className="text-xs font-medium text-destructive">{errors.params}</p>}
        {params.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('noParameters')}</p>
        ) : (
          <ul className="grid min-w-0 gap-3" aria-label={t('parameters')}>
            {params.map((p, i) => (
              <li
                key={p.name}
                className="grid min-w-0 gap-2 rounded-lg border p-3 sm:grid-cols-[minmax(0,8rem)_minmax(0,12rem)_minmax(0,9rem)_minmax(0,1fr)] sm:items-center"
              >
                <code className="truncate text-sm font-medium">:{p.name}</code>
                <Select
                  value={p.source}
                  onValueChange={(v) => setParam(i, { source: v as SqlParamInput['source'] })}
                  disabled={disabled}
                >
                  <SelectTrigger className="w-full" aria-label={t('paramSource', { name: p.name })}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="static">{t('sources.static')}</SelectItem>
                    {SQL_BUILTINS.map((b) => (
                      <SelectItem key={b} value={b}>
                        {t(`sources.${b}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {p.source === 'static' ? (
                  <>
                    <Select
                      value={p.type}
                      onValueChange={(v) => setParam(i, { type: v as SqlParamInput['type'] })}
                      disabled={disabled}
                    >
                      <SelectTrigger className="w-full" aria-label={t('paramType', { name: p.name })}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {SQL_PARAM_TYPES.map((ty) => (
                          <SelectItem key={ty} value={ty}>
                            {t(`types.${ty}`)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input
                      value={p.value ?? ''}
                      onChange={(e) => setParam(i, { value: e.target.value })}
                      aria-label={t('paramValue', { name: p.name })}
                      aria-invalid={Boolean(errors[`params.${i}.value`]) || undefined}
                      placeholder={t(`placeholders.${p.type}`)}
                      className="min-w-0"
                      disabled={disabled}
                    />
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground sm:col-span-2">{t(`sourceHint.${p.source}`)}</p>
                )}
                {errors[`params.${i}.value`] && (
                  <p className="text-xs font-medium text-destructive sm:col-span-4">
                    {errors[`params.${i}.value`]}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
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
