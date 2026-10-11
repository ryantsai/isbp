'use client';

import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { CheckboxInput } from '@astryxdesign/core/CheckboxInput';
import { Divider } from '@astryxdesign/core/Divider';
import { Field } from '@astryxdesign/core/Field';
import { FormLayout } from '@astryxdesign/core/FormLayout';
import { Grid } from '@astryxdesign/core/Grid';
import { Icon } from '@astryxdesign/core/Icon';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { NumberInput } from '@astryxdesign/core/NumberInput';
import { Selector } from '@astryxdesign/core/Selector';
import { Switch } from '@astryxdesign/core/Switch';
import { Text } from '@astryxdesign/core/Text';
import { TextArea } from '@astryxdesign/core/TextArea';
import { TextInput } from '@astryxdesign/core/TextInput';
import { parameterNames, writeKeywords } from '@isbp/sql/params';
import { ApiError } from '@isbp/sdk/web';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@isbp/ui/card';
import { CodeEditor } from '@isbp/ui/code-editor';
import { countFilled, OptionalFields, useFieldList } from '@isbp/ui/optional-fields';
import { useApiMutation, useApiQuery, useErrorText } from '@isbp/ui/query';
import { problemOfError, RunProblemBanner } from '@isbp/ui/run-detail';
import { SaveIcon, WandSparklesIcon } from 'lucide-react';
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
import { INVALIDATE, sqlSchemaOf, useCatalog, useConnections } from '../lib';
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
      <CardContent className="min-w-0">
        <FormLayout defaultOptionality="optional">{children}</FormLayout>
      </CardContent>
    </Card>
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
  const statusOf = (key: string) =>
    errors[key] ? { type: 'error' as const, message: errors[key] } : undefined;

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
  const connectionOptions = [
    ...connections.items.map((c) => ({ value: c.id, label: `${c.name} · ${t(`engine.${c.engine}`)}` })),
    ...(!connection && endpoint.connection
      ? [
          {
            value: draft.connectionId,
            label:
              endpoint.connection.status === 'missing' ? t('connection.missing') : endpoint.connection.name,
            disabled: true,
          },
        ]
      : []),
  ];
  const procedureOptions = [
    ...procedures.map((p) => ({
      value: `${p.schema}.${p.name}`,
      label: `${p.schema}.${p.name} · ${t(`routine.${p.kind}`)}`,
    })),
    ...(draft.procedure && !procedures.some((p) => `${p.schema}.${p.name}` === procKey)
      ? [{ value: procKey, label: procKey }]
      : []),
  ];

  return (
    <VStack gap={4} className="min-w-0">
      <div className="grid min-w-0 grid-cols-1 items-start gap-4 xl:grid-cols-3">
        <div className="grid min-w-0 gap-4 xl:col-span-2">
          <Section title={t('editor.statement')} description={t(`editor.statementHint.${draft.kind}`)}>
            <Selector
              label={t('fields.connection')}
              placeholder={t('create.pickConnection')}
              options={connectionOptions}
              value={draft.connectionId}
              onChange={(v) => setDraft({ connectionId: v })}
              status={statusOf('draft.connectionId')}
            />
            <Grid columns={{ minWidth: 200 }} gap={4}>
              <Selector
                label={t('fields.method')}
                options={ENDPOINT_METHODS.map((m) => ({ value: m, label: m }))}
                value={draft.method}
                onChange={(v) => setDraft({ method: v as 'GET' | 'POST' })}
              />
              <Selector
                label={t('fields.kind')}
                options={ENDPOINT_KINDS.map((k) => ({ value: k, label: t(`kind.${k}`) }))}
                value={draft.kind}
                onChange={(v) => setDraft({ kind: v as 'query' | 'procedure' })}
              />
            </Grid>

            {draft.kind === 'query' ? (
              <VStack gap={2} className="min-w-0">
                <Field
                  label={t('fields.sql')}
                  inputID={`${id}-sql`}
                  labelID={`${id}-sql-label`}
                  description={t('editor.sqlHint')}
                  descriptionID={`${id}-sql-hint`}
                  status={statusOf('draft.sql')}
                  statusVariant="detached"
                >
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
                </Field>
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
                <HStack gap={2} wrap="wrap" vAlign="center" aria-live="polite">
                  <Text color="secondary">{t('editor.detected')}</Text>
                  {used.length ? (
                    used.map((n) => (
                      <Text key={n} type="code">
                        :{n}
                      </Text>
                    ))
                  ) : (
                    <Text color="secondary">{t('editor.noneDetected')}</Text>
                  )}
                  <HStack gap={2} wrap="wrap" className="sm:ml-auto">
                    {drift.missing.length > 0 && (
                      <Button
                        label={t('editor.addMissing', { count: drift.missing.length })}
                        variant="secondary"
                        size="sm"
                        icon={<Icon icon={WandSparklesIcon} />}
                        type="button"
                        onClick={() =>
                          setDraft({ params: [...params, ...drift.missing.map((n) => newParam(n))] })
                        }
                      />
                    )}
                    {drift.unused.length > 0 && (
                      <Button
                        label={t('editor.removeUnused', { count: drift.unused.length })}
                        variant="ghost"
                        size="sm"
                        type="button"
                        onClick={() =>
                          setDraft({ params: params.filter((p) => !drift.unused.includes(p.name)) })
                        }
                      />
                    )}
                  </HStack>
                </HStack>
                {keywords.length > 0 && (
                  <Banner
                    status={draft.allowsWrites ? 'info' : 'warning'}
                    title={t(draft.allowsWrites ? 'editor.writesAllowed' : 'editor.writesFound', {
                      keywords: keywords.join(', '),
                    })}
                    collapsible={false}
                  />
                )}
              </VStack>
            ) : (
              <VStack gap={3} className="min-w-0">
                <Selector
                  label={t('fields.procedure')}
                  description={t('editor.procedureHint')}
                  hasSearch
                  placeholder={catalog.isLoading ? t('editor.loadingCatalog') : t('editor.pickProcedure')}
                  options={procedureOptions}
                  value={procKey}
                  onChange={(v) => {
                    const proc = procedures.find((p) => `${p.schema}.${p.name}` === v);
                    if (proc) setDraft({ procedure: proc, params: paramsForProcedure(proc) });
                  }}
                  status={statusOf('draft.procedure')}
                />
                {draft.procedure && (
                  <Text color="secondary">
                    {t('editor.arguments')}{' '}
                    {draft.procedure.parameters
                      .filter((a) => a.direction !== 'out')
                      .map((a) => `${a.name} (${a.type})`)
                      .join(', ') || '—'}
                  </Text>
                )}
              </VStack>
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
            <TextInput
              label={t('fields.name')}
              isRequired
              value={state.name}
              onChange={(name) => setState((s) => ({ ...s, name }))}
              status={statusOf('name')}
            />
            <TextArea
              label={t('fields.description')}
              rows={3}
              maxLength={2_000}
              value={state.description}
              onChange={(description) => setState((s) => ({ ...s, description }))}
            />
          </Section>

          <Section title={t('editor.response')}>
            <Selector
              label={t('fields.responseShape')}
              options={RESPONSE_SHAPES.map((s) => ({ value: s, label: t(`shape.${s}`) }))}
              value={draft.responseShape}
              onChange={(v) => setDraft({ responseShape: v as 'rows' | 'single' })}
            />
            <Switch
              label={t('fields.allowsWrites')}
              description={t('editor.allowsWritesHint')}
              value={draft.allowsWrites ?? false}
              onChange={(v) => setDraft({ allowsWrites: v })}
            />
            <OptionalFields
              hint={list([t('fields.maxRows'), t('fields.timeoutSeconds'), t('fields.cacheSeconds')])}
              filled={limitsFilled}
            >
              <FormLayout defaultOptionality="optional">
                <Grid columns={{ minWidth: 140 }} gap={4}>
                  <NumberInput
                    label={t('fields.maxRows')}
                    description={t('editor.maxRowsHint')}
                    min={1}
                    isIntegerOnly
                    value={draft.maxRows ?? DEFAULT_MAX_ROWS}
                    onChange={(v) => setDraft({ maxRows: v || 1 })}
                    status={statusOf('draft.maxRows')}
                  />
                  <NumberInput
                    label={t('fields.timeoutSeconds')}
                    min={1}
                    isIntegerOnly
                    value={Math.round((draft.timeoutMs ?? DEFAULT_TIMEOUT_MS) / 1000)}
                    onChange={(v) => setDraft({ timeoutMs: Math.max(1, v || 1) * 1000 })}
                    status={statusOf('draft.timeoutMs')}
                  />
                </Grid>
                <NumberInput
                  label={t('fields.cacheSeconds')}
                  description={t('editor.cacheHint')}
                  min={0}
                  isIntegerOnly
                  value={draft.cacheTtlSeconds ?? 0}
                  onChange={(v) => setDraft({ cacheTtlSeconds: Math.max(0, v || 0) })}
                />
              </FormLayout>
            </OptionalFields>
          </Section>

          <Section title={t('editor.access')} description={t('editor.accessHint')}>
            <Switch
              label={t('fields.allowUsers')}
              description={t('editor.allowUsersHint')}
              value={state.allowUsers}
              onChange={(allowUsers) => setState((s) => ({ ...s, allowUsers }))}
            />
            <VStack gap={2} role="group" aria-labelledby={`${id}-clients`} className="min-w-0">
              <Text type="label" id={`${id}-clients`}>
                {t('fields.allowedClients')}
              </Text>
              {clients.length === 0 ? (
                <Text color="secondary">{t('editor.noClients')}</Text>
              ) : (
                clients.map((c) => (
                  <CheckboxInput
                    key={c.id}
                    label={c.name}
                    description={c.revoked ? `${c.clientId} · ${t('editor.revoked')}` : c.clientId}
                    value={state.allowedClients.includes(c.id)}
                    onChange={(on) =>
                      setState((s) => ({
                        ...s,
                        allowedClients: on
                          ? [...s.allowedClients, c.id]
                          : s.allowedClients.filter((x) => x !== c.id),
                      }))
                    }
                  />
                ))
              )}
            </VStack>
            <NumberInput
              label={t('fields.rateLimit')}
              description={t('editor.rateLimitHint', { n: endpoint.effectiveRateLimit })}
              min={1}
              isIntegerOnly
              hasClear
              placeholder={String(endpoint.rateLimitPerMinute ?? endpoint.effectiveRateLimit)}
              value={state.rateLimit.trim() ? Number(state.rateLimit) : null}
              onChange={(v) => setState((s) => ({ ...s, rateLimit: v === null ? '' : String(v) }))}
              status={statusOf('rateLimitPerMinute')}
            />
          </Section>
        </div>
      </div>

      <VStack gap={2} className="sticky bottom-0 z-10 -mx-1 bg-background/95 px-1 pb-3 backdrop-blur">
        <Divider />
        {rootError && <Banner status="error" title={rootError} collapsible={false} />}
        <HStack gap={3} wrap="wrap" hAlign="end" vAlign="center">
          <Text color="secondary" aria-live="polite">
            {dirty ? t('editor.unsaved') : t('editor.allSaved')}
          </Text>
          <Button
            label={t('editor.discard')}
            variant="secondary"
            isDisabled={!dirty || save.isPending}
            type="button"
            onClick={() => setState(initial)}
          />
          <Button
            label={t('editor.save')}
            variant="primary"
            icon={<Icon icon={SaveIcon} />}
            isLoading={save.isPending}
            isDisabled={!dirty}
            type="button"
            onClick={onSave}
          />
        </HStack>
      </VStack>
    </VStack>
  );
}
