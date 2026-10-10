'use client';

import { parameterNames, writeKeywords } from '@isbp/sql/params';
import { ApiError } from '@isbp/sdk/web';
import { cn } from '@isbp/ui';
import { Button } from '@isbp/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@isbp/ui/card';
import { Checkbox } from '@isbp/ui/checkbox';
import { CodeEditor } from '@isbp/ui/code-editor';
import { Input } from '@isbp/ui/input';
import { Label } from '@isbp/ui/label';
import { countFilled, OptionalFields, useFieldList } from '@isbp/ui/optional-fields';
import { useApiMutation, useApiQuery, useErrorText } from '@isbp/ui/query';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@isbp/ui/select';
import { Switch } from '@isbp/ui/switch';
import { Textarea } from '@isbp/ui/textarea';
import { CircleAlertIcon, SaveIcon, TriangleAlertIcon, WandSparklesIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type ReactNode, useId, useMemo, useState } from 'react';
import {
  type ApiClientRef,
  type EndpointDefinitionDto,
  type EndpointDetail,
  ENDPOINT_KINDS,
  ENDPOINT_METHODS,
  newParam,
  type ParamDef,
  paramDrift,
  paramsForProcedure,
  RESPONSE_SHAPES,
  type UpdateEndpointInput,
} from '../../contracts';
import { TONE } from '../badges';
import { INVALIDATE, sqlSchemaOf, useCatalog, useConnections } from '../lib';
import { problemOfError, RunProblemBanner } from '@isbp/ui/run-detail';
import { type Errors, ParamsEditor } from './params-editor';

const EMPTY_CLIENTS: ApiClientRef[] = [];
const DEFAULT_MAX_ROWS = 1000;
const DEFAULT_TIMEOUT_MS = 30_000;

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle role="heading" aria-level={2}>
          {title}
        </CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent className="grid min-w-0 gap-4">{children}</CardContent>
    </Card>
  );
}

function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="grid min-w-0 gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

interface State {
  name: string;
  description: string;
  draft: EndpointDefinitionDto;
  allowUsers: boolean;
  allowedClients: string[];
  rateLimit: string;
}

const stateOf = (e: EndpointDetail): State => ({
  name: e.name,
  description: e.description ?? '',
  draft: e.draft,
  allowUsers: e.allowUsers,
  allowedClients: e.allowedClients.map((c) => c.id),
  rateLimit: e.rateLimitPerMinute === null ? '' : String(e.rateLimitPerMinute),
});

/**
 * The draft editor: SQL (or a routine from the catalog) with live `:param` detection, typed parameters,
 * response and limits, access. Saving changes only the draft; published versions never change.
 */
export function EndpointEditor({ endpoint }: { endpoint: EndpointDetail }) {
  const t = useTranslations('etl');
  const errorText = useErrorText();
  const list = useFieldList();
  const id = useId();
  const initial = useMemo(() => stateOf(endpoint), [endpoint]);
  const [state, setState] = useState<State>(initial);
  const [errors, setErrors] = useState<Errors>({});
  const [rootError, setRootError] = useState<string | null>(null);
  const draft = state.draft;
  const setDraft = (patch: Partial<EndpointDefinitionDto>) =>
    setState((s) => ({ ...s, draft: { ...s.draft, ...patch } }));

  const connections = useConnections('endpoints');
  const connection = connections.items.find((c) => c.id === draft.connectionId);
  const engine = connection?.engine ?? 'postgres';
  const catalog = useCatalog('endpoints', draft.connectionId);
  const sqlSchema = useMemo(() => sqlSchemaOf(catalog.data), [catalog.data]);
  const clients = useApiQuery<{ items: ApiClientRef[] }>('/etl/clients').data?.items ?? EMPTY_CLIENTS;

  const used = useMemo(
    () => (draft.kind === 'query' ? parameterNames(draft.sql, engine) : []),
    [draft.kind, draft.sql, engine],
  );
  const keywords = useMemo(
    () => (draft.kind === 'query' ? writeKeywords(draft.sql, engine) : []),
    [draft.kind, draft.sql, engine],
  );
  const params = (draft.params ?? []) as ParamDef[];
  const drift = paramDrift(
    params.map((p) => p.name),
    used,
  );
  const dirty = JSON.stringify(state) !== JSON.stringify(initial);
  const limitsFilled = countFilled(
    (draft.maxRows ?? DEFAULT_MAX_ROWS) !== DEFAULT_MAX_ROWS,
    (draft.timeoutMs ?? DEFAULT_TIMEOUT_MS) !== DEFAULT_TIMEOUT_MS,
    (draft.cacheTtlSeconds ?? 0) > 0,
  );

  const save = useApiMutation(
    (api, body: UpdateEndpointInput) => api.patch<EndpointDetail>(`/etl/endpoints/${endpoint.id}`, body),
    { invalidate: INVALIDATE, success: t('editor.saved'), silent: true },
  );
  const onSave = async () => {
    setErrors({});
    setRootError(null);
    try {
      await save.mutateAsync({
        name: state.name.trim(),
        description: state.description.trim() || null,
        draft: draft as UpdateEndpointInput['draft'],
        allowUsers: state.allowUsers,
        allowedClients: state.allowedClients,
        rateLimitPerMinute: state.rateLimit.trim() ? Number(state.rateLimit) : null,
      });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'VALIDATION_FAILED') {
        const issues =
          (err.details as { issues?: { path: string; message: string }[] } | undefined)?.issues ?? [];
        setErrors(Object.fromEntries(issues.map((i) => [i.path, i.message])));
        const unplaced = issues.filter((i) => !/^draft\.params\.\d+\./.test(i.path));
        setRootError(
          unplaced.length
            ? unplaced.map((i) => `${i.path}: ${i.message}`).join(' · ')
            : t('editor.fixFields'),
        );
        return;
      }
      setRootError(errorText(err));
    }
  };

  const procedures = catalog.data?.procedures ?? [];
  const procKey = draft.procedure ? `${draft.procedure.schema}.${draft.procedure.name}` : '';

  return (
    <div className="grid min-w-0 gap-4">
      <div className="grid min-w-0 grid-cols-1 items-start gap-4 xl:grid-cols-3">
        <div className="grid min-w-0 gap-4 xl:col-span-2">
          <Section title={t('editor.statement')} description={t(`editor.statementHint.${draft.kind}`)}>
            <div className="grid min-w-0 grid-cols-1 gap-4">
              <Field
                id={`${id}-connection`}
                label={t('fields.connection')}
                error={errors['draft.connectionId']}
              >
                <Select value={draft.connectionId} onValueChange={(v) => setDraft({ connectionId: v })}>
                  <SelectTrigger id={`${id}-connection`} className="w-full">
                    <SelectValue placeholder={t('create.pickConnection')} />
                  </SelectTrigger>
                  <SelectContent>
                    {connections.items.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name} · {t(`engine.${c.engine}`)}
                      </SelectItem>
                    ))}
                    {!connection && endpoint.connection && (
                      <SelectItem value={draft.connectionId} disabled>
                        {endpoint.connection.status === 'missing'
                          ? t('connection.missing')
                          : endpoint.connection.name}
                      </SelectItem>
                    )}
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
              <Field id={`${id}-method`} label={t('fields.method')}>
                <Select value={draft.method} onValueChange={(v) => setDraft({ method: v as 'GET' | 'POST' })}>
                  <SelectTrigger id={`${id}-method`} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ENDPOINT_METHODS.map((m) => (
                      <SelectItem key={m} value={m}>
                        {m}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field id={`${id}-kind`} label={t('fields.kind')}>
                <Select
                  value={draft.kind}
                  onValueChange={(v) => setDraft({ kind: v as 'query' | 'procedure' })}
                >
                  <SelectTrigger id={`${id}-kind`} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ENDPOINT_KINDS.map((k) => (
                      <SelectItem key={k} value={k}>
                        {t(`kind.${k}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>

            {draft.kind === 'query' ? (
              <div className="grid min-w-0 gap-2">
                <Label id={`${id}-sql-label`}>{t('fields.sql')}</Label>
                <CodeEditor
                  value={draft.sql ?? ''}
                  onChange={(sql) => setDraft({ sql })}
                  language="sql"
                  dialect={engine}
                  schema={sqlSchema}
                  placeholder="SELECT … FROM … WHERE column = :name"
                  aria-labelledby={`${id}-sql-label`}
                  aria-describedby={`${id}-sql-hint`}
                  aria-invalid={Boolean(errors['draft.sql'])}
                  minHeight="10rem"
                />
                <p id={`${id}-sql-hint`} className="text-xs text-muted-foreground">
                  {t('editor.sqlHint')}
                </p>
                {catalog.error && (
                  <RunProblemBanner
                    tone="warning"
                    title={t('editor.catalogFailed', {
                      name: connection?.name ?? endpoint.connection?.name ?? '',
                    })}
                    problem={problemOfError(
                      catalog.error,
                      draft.connectionId
                        ? {
                            id: draft.connectionId,
                            name: connection?.name ?? endpoint.connection?.name ?? '',
                          }
                        : null,
                    )}
                  />
                )}
                {errors['draft.sql'] && <p className="text-xs text-destructive">{errors['draft.sql']}</p>}
                <div
                  className="flex min-w-0 flex-wrap items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2 text-sm"
                  aria-live="polite"
                >
                  <span className="text-muted-foreground">{t('editor.detected')}</span>
                  {used.length ? (
                    used.map((n) => (
                      <code key={n} className="rounded bg-background px-1.5 py-0.5 font-mono text-xs">
                        :{n}
                      </code>
                    ))
                  ) : (
                    <span className="text-muted-foreground">{t('editor.noneDetected')}</span>
                  )}
                  <span className="flex flex-wrap gap-2 sm:ml-auto">
                    {drift.missing.length > 0 && (
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={() =>
                          setDraft({ params: [...params, ...drift.missing.map((n) => newParam(n))] })
                        }
                      >
                        <WandSparklesIcon /> {t('editor.addMissing', { count: drift.missing.length })}
                      </Button>
                    )}
                    {drift.unused.length > 0 && (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          setDraft({ params: params.filter((p) => !drift.unused.includes(p.name)) })
                        }
                      >
                        {t('editor.removeUnused', { count: drift.unused.length })}
                      </Button>
                    )}
                  </span>
                </div>
                {keywords.length > 0 && (
                  <p
                    className={cn(
                      'flex items-start gap-2 rounded-lg px-3 py-2 text-sm',
                      draft.allowsWrites ? TONE.info : TONE.warning,
                    )}
                  >
                    <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
                    {t(draft.allowsWrites ? 'editor.writesAllowed' : 'editor.writesFound', {
                      keywords: keywords.join(', '),
                    })}
                  </p>
                )}
              </div>
            ) : (
              <div className="grid min-w-0 gap-3">
                <Field
                  id={`${id}-procedure`}
                  label={t('fields.procedure')}
                  hint={t('editor.procedureHint')}
                  error={errors['draft.procedure']}
                >
                  <Select
                    value={procKey}
                    onValueChange={(v) => {
                      const proc = procedures.find((p) => `${p.schema}.${p.name}` === v);
                      if (proc) setDraft({ procedure: proc, params: paramsForProcedure(proc) });
                    }}
                  >
                    <SelectTrigger id={`${id}-procedure`} className="w-full">
                      <SelectValue
                        placeholder={
                          catalog.isLoading ? t('editor.loadingCatalog') : t('editor.pickProcedure')
                        }
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {procedures.map((p) => (
                        <SelectItem key={`${p.schema}.${p.name}`} value={`${p.schema}.${p.name}`}>
                          {p.schema}.{p.name} · {t(`routine.${p.kind}`)}
                        </SelectItem>
                      ))}
                      {draft.procedure && !procedures.some((p) => `${p.schema}.${p.name}` === procKey) && (
                        <SelectItem value={procKey}>{procKey}</SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                </Field>
                {draft.procedure && (
                  <p className="text-sm text-muted-foreground">
                    {t('editor.arguments')}{' '}
                    {draft.procedure.parameters
                      .filter((a) => a.direction !== 'out')
                      .map((a) => `${a.name} (${a.type})`)
                      .join(', ') || '—'}
                  </p>
                )}
              </div>
            )}
          </Section>

          <Section title={t('params.title')} description={t('params.hint')}>
            <ParamsEditor
              params={params}
              onChange={(next) => setDraft({ params: next })}
              procedure={draft.kind === 'procedure' ? (draft.procedure ?? null) : null}
              errors={errors}
            />
          </Section>
        </div>

        <div className="grid min-w-0 gap-4">
          <Section title={t('editor.general')}>
            <Field id={`${id}-name`} label={t('fields.name')} error={errors.name}>
              <Input
                id={`${id}-name`}
                value={state.name}
                maxLength={120}
                onChange={(e) => setState((s) => ({ ...s, name: e.target.value }))}
              />
            </Field>
            <Field id={`${id}-description`} label={t('fields.description')}>
              <Textarea
                id={`${id}-description`}
                rows={3}
                maxLength={2_000}
                value={state.description}
                onChange={(e) => setState((s) => ({ ...s, description: e.target.value }))}
              />
            </Field>
          </Section>

          <Section title={t('editor.response')}>
            <Field id={`${id}-shape`} label={t('fields.responseShape')}>
              <Select
                value={draft.responseShape}
                onValueChange={(v) => setDraft({ responseShape: v as 'rows' | 'single' })}
              >
                <SelectTrigger id={`${id}-shape`} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RESPONSE_SHAPES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {t(`shape.${s}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <div className="flex items-start justify-between gap-4 rounded-lg border p-3">
              <div className="grid gap-1">
                <Label htmlFor={`${id}-writes`}>{t('fields.allowsWrites')}</Label>
                <p className="text-xs text-muted-foreground">{t('editor.allowsWritesHint')}</p>
              </div>
              <Switch
                id={`${id}-writes`}
                checked={draft.allowsWrites ?? false}
                onCheckedChange={(v) => setDraft({ allowsWrites: v })}
              />
            </div>
            <OptionalFields
              hint={list([t('fields.maxRows'), t('fields.timeoutSeconds'), t('fields.cacheSeconds')])}
              filled={limitsFilled}
            >
              <div className="grid min-w-0 grid-cols-2 gap-4">
                <Field
                  id={`${id}-maxRows`}
                  label={t('fields.maxRows')}
                  hint={t('editor.maxRowsHint')}
                  error={errors['draft.maxRows']}
                >
                  <Input
                    id={`${id}-maxRows`}
                    type="number"
                    min={1}
                    aria-invalid={Boolean(errors['draft.maxRows']) || undefined}
                    value={draft.maxRows ?? DEFAULT_MAX_ROWS}
                    onChange={(e) => setDraft({ maxRows: Number(e.target.value) || 1 })}
                  />
                </Field>
                <Field
                  id={`${id}-timeout`}
                  label={t('fields.timeoutSeconds')}
                  error={errors['draft.timeoutMs']}
                >
                  <Input
                    id={`${id}-timeout`}
                    type="number"
                    min={1}
                    aria-invalid={Boolean(errors['draft.timeoutMs']) || undefined}
                    value={Math.round((draft.timeoutMs ?? DEFAULT_TIMEOUT_MS) / 1000)}
                    onChange={(e) => setDraft({ timeoutMs: Math.max(1, Number(e.target.value) || 1) * 1000 })}
                  />
                </Field>
              </div>
              <Field id={`${id}-cache`} label={t('fields.cacheSeconds')} hint={t('editor.cacheHint')}>
                <Input
                  id={`${id}-cache`}
                  type="number"
                  min={0}
                  value={draft.cacheTtlSeconds ?? 0}
                  onChange={(e) => setDraft({ cacheTtlSeconds: Math.max(0, Number(e.target.value) || 0) })}
                />
              </Field>
            </OptionalFields>
          </Section>

          <Section title={t('editor.access')} description={t('editor.accessHint')}>
            <div className="flex items-start justify-between gap-4 rounded-lg border p-3">
              <div className="grid gap-1">
                <Label htmlFor={`${id}-users`}>{t('fields.allowUsers')}</Label>
                <p className="text-xs text-muted-foreground">{t('editor.allowUsersHint')}</p>
              </div>
              <Switch
                id={`${id}-users`}
                checked={state.allowUsers}
                onCheckedChange={(v) => setState((s) => ({ ...s, allowUsers: v }))}
              />
            </div>
            <fieldset className="grid min-w-0 gap-2">
              <legend className="mb-1 text-sm font-medium">{t('fields.allowedClients')}</legend>
              {clients.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('editor.noClients')}</p>
              ) : (
                clients.map((c) => (
                  <div key={c.id} className="flex min-w-0 items-center gap-2">
                    <Checkbox
                      id={`${id}-client-${c.id}`}
                      checked={state.allowedClients.includes(c.id)}
                      onCheckedChange={(v) =>
                        setState((s) => ({
                          ...s,
                          allowedClients:
                            v === true
                              ? [...s.allowedClients, c.id]
                              : s.allowedClients.filter((x) => x !== c.id),
                        }))
                      }
                    />
                    <Label htmlFor={`${id}-client-${c.id}`} className="min-w-0 font-normal">
                      <span className="truncate">{c.name}</span>
                      <span className="truncate font-mono text-xs text-muted-foreground">{c.clientId}</span>
                      {c.revoked && <span className="text-xs text-destructive">{t('editor.revoked')}</span>}
                    </Label>
                  </div>
                ))
              )}
            </fieldset>
            <Field
              id={`${id}-rate`}
              label={t('fields.rateLimit')}
              hint={t('editor.rateLimitHint', { n: endpoint.effectiveRateLimit })}
              error={errors.rateLimitPerMinute}
            >
              <Input
                id={`${id}-rate`}
                type="number"
                min={1}
                value={state.rateLimit}
                placeholder={String(endpoint.rateLimitPerMinute ?? endpoint.effectiveRateLimit)}
                onChange={(e) => setState((s) => ({ ...s, rateLimit: e.target.value }))}
              />
            </Field>
          </Section>
        </div>
      </div>

      <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center justify-end gap-3 border-t bg-background/95 px-1 py-3 backdrop-blur">
        {rootError && (
          <p role="alert" className="mr-auto flex min-w-0 items-start gap-2 text-sm text-destructive">
            <CircleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span className="min-w-0 wrap-anywhere">{rootError}</span>
          </p>
        )}
        <span className="text-sm text-muted-foreground" aria-live="polite">
          {dirty ? t('editor.unsaved') : t('editor.allSaved')}
        </span>
        <Button
          type="button"
          variant="outline"
          disabled={!dirty || save.isPending}
          onClick={() => setState(initial)}
        >
          {t('editor.discard')}
        </Button>
        <Button type="button" onClick={onSave} disabled={!dirty} loading={save.isPending}>
          <SaveIcon /> {t('editor.save')}
        </Button>
      </div>
    </div>
  );
}
