'use client';

import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { CheckboxInput } from '@astryxdesign/core/CheckboxInput';
import { Divider } from '@astryxdesign/core/Divider';
import { Field } from '@astryxdesign/core/Field';
import { FormLayout } from '@astryxdesign/core/FormLayout';
import { Grid } from '@astryxdesign/core/Grid';
import { Icon } from '@astryxdesign/core/Icon';
import { IconButton } from '@astryxdesign/core/IconButton';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { NumberInput } from '@astryxdesign/core/NumberInput';
import { ScrollableArea } from '@astryxdesign/core/ScrollableArea';
import { Selector } from '@astryxdesign/core/Selector';
import { Switch } from '@astryxdesign/core/Switch';
import { Table } from '@astryxdesign/core/Table';
import { Text } from '@astryxdesign/core/Text';
import { TextArea } from '@astryxdesign/core/TextArea';
import { TextInput } from '@astryxdesign/core/TextInput';
import { parameterNames } from '@isbp/sql/params';
import { ApiError } from '@isbp/sdk/web';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@isbp/ui/card';
import { CodeEditor } from '@isbp/ui/code-editor';
import { PersonPicker, type PersonOption } from '@isbp/ui/person-picker';
import { useApiMutation, useErrorText } from '@isbp/ui/query';
import { CircleAlertIcon, EyeIcon, PlusIcon, SaveIcon, Trash2Icon, WandSparklesIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type ReactNode, useId, useMemo, useState } from 'react';
import {
  CAST_TYPES,
  formatTransform,
  type MappingInput,
  parseTransform,
  type PipelineDetail,
  type PipelineInput,
  type PreviewResult,
  TRANSFORM_KINDS,
  type TransformKind,
  WATERMARK_PARAM,
  WRITE_MODES,
  type WriteModeValue,
} from '../../contracts';
import { INVALIDATE, sqlSchemaOf, useCatalog, useConnections } from '../lib';

type Errors = Record<string, string>;

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
  owner: PersonOption | null;
  enabled: boolean;
  sourceConnectionId: string;
  sql: string;
  params: Record<string, string>;
  incremental: boolean;
  watermarkColumn: string;
  watermarkInitial: string;
  targetConnectionId: string;
  table: string;
  mode: WriteModeValue;
  keys: string[];
  mappings: MappingInput[];
  batchSize: string;
}

function stateOf(p: PipelineDetail | undefined): State {
  const d = p?.definition;
  return {
    name: p?.name ?? '',
    description: p?.description ?? '',
    owner: p?.owner
      ? { id: p.owner.id, displayName: p.owner.displayName, avatarUrl: p.owner.avatarUrl }
      : null,
    enabled: p?.enabled ?? true,
    sourceConnectionId: d?.source.connectionId ?? '',
    sql: d?.source.sql ?? '',
    params: Object.fromEntries(
      Object.entries(d?.source.params ?? {}).map(([k, v]) => [k, v === null ? '' : String(v)]),
    ),
    incremental: Boolean(d?.incremental),
    watermarkColumn: d?.incremental?.column ?? '',
    watermarkInitial: d?.incremental?.initial ?? '1970-01-01T00:00:00Z',
    targetConnectionId: d?.target.connectionId ?? '',
    table: d ? `${d.target.schema ?? ''}.${d.target.table}` : '',
    mode: d?.target.mode ?? 'upsert',
    keys: d?.target.keys ?? [],
    mappings: d?.mappings ?? [],
    batchSize: String(d?.batchSize ?? 500),
  };
}

/** One mapping row: source column → target column, with a fixed transform. */
function MappingRow({
  mapping,
  index,
  sourceColumns,
  targetColumns,
  onChange,
  onRemove,
  errors,
}: {
  mapping: MappingInput;
  index: number;
  sourceColumns: string[];
  targetColumns: string[];
  onChange: (m: MappingInput) => void;
  onRemove: () => void;
  errors: Errors;
}) {
  const t = useTranslations('etl.mapping');
  const { kind, arg } = parseTransform(mapping.transform ?? 'none');
  const err = (f: string) => {
    const message = errors[`mappings.${index}.${f}`];
    return message ? { type: 'error' as const, message } : undefined;
  };
  return (
    <li>
      <VStack gap={3} className="min-w-0">
        {index > 0 && <Divider />}
        <HStack gap={3} vAlign="end" wrap="wrap">
          <div className="min-w-0 flex-1 basis-40">
            {sourceColumns.length ? (
              <Selector
                label={t('source')}
                hasSearch
                hasClear
                placeholder={t('pick')}
                options={[...new Set([...sourceColumns, ...(mapping.source ? [mapping.source] : [])])]}
                value={mapping.source || null}
                onChange={(v) => onChange({ ...mapping, source: v ?? '' })}
                status={err('source')}
              />
            ) : (
              <TextInput
                label={t('source')}
                value={mapping.source}
                onChange={(v) => onChange({ ...mapping, source: v })}
                status={err('source')}
              />
            )}
          </div>
          <div className="min-w-0 flex-1 basis-40">
            <Selector
              label={t('target')}
              hasSearch
              hasClear
              placeholder={t('pick')}
              options={[...new Set([...targetColumns, ...(mapping.target ? [mapping.target] : [])])]}
              value={mapping.target || null}
              onChange={(v) => onChange({ ...mapping, target: v ?? '' })}
              status={err('target')}
            />
          </div>
          <div className="min-w-0 flex-1 basis-36">
            <Selector
              label={t('transform')}
              options={TRANSFORM_KINDS.map((k) => ({ value: k, label: t(`transforms.${k}`) }))}
              value={kind}
              onChange={(v) =>
                onChange({
                  ...mapping,
                  transform: formatTransform(v as TransformKind, v === 'cast' ? 'string' : ''),
                })
              }
              status={err('transform')}
            />
          </div>
          {kind === 'cast' ? (
            <div className="min-w-0 flex-1 basis-36">
              <Selector
                label={t('castTo')}
                options={CAST_TYPES.map((c) => ({ value: c, label: t(`castTypes.${c}`) }))}
                value={arg ?? 'string'}
                onChange={(v) => onChange({ ...mapping, transform: formatTransform('cast', v) })}
              />
            </div>
          ) : kind === 'default' || kind === 'constant' ? (
            <div className="min-w-0 flex-1 basis-36">
              <TextInput
                label={t('value')}
                value={arg ?? ''}
                onChange={(v) => onChange({ ...mapping, transform: formatTransform(kind, v) })}
              />
            </div>
          ) : null}
          <IconButton
            label={t('remove', { n: index + 1 })}
            variant="ghost"
            size="sm"
            icon={<Icon icon={Trash2Icon} />}
            type="button"
            onClick={onRemove}
          />
        </HStack>
      </VStack>
    </li>
  );
}

interface SampleRow extends Record<string, unknown> {
  id: number;
  cells: Record<string, unknown>;
}

/**
 * Create or edit a pipeline: source SQL with static `:param` values (optionally incremental through
 * `:watermark`), a target table from the catalog with its write mode and keys, and the column mapping.
 * Saved definitions are validated against the target catalog by the API.
 */
export function PipelineEditor({
  pipeline,
  onSaved,
}: {
  pipeline?: PipelineDetail;
  onSaved: (p: PipelineDetail) => void;
}) {
  const t = useTranslations('etl');
  const errorText = useErrorText();
  const id = useId();
  const initial = useMemo(() => stateOf(pipeline), [pipeline]);
  const [s, setS] = useState<State>(initial);
  const [errors, setErrors] = useState<Errors>({});
  const [rootError, setRootError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const set = (patch: Partial<State>) => setS((x) => ({ ...x, ...patch }));
  const statusOf = (key: string) =>
    errors[key] ? { type: 'error' as const, message: errors[key] } : undefined;

  const connections = useConnections('pipelines');
  const source = connections.items.find((c) => c.id === s.sourceConnectionId);
  const target = connections.items.find((c) => c.id === s.targetConnectionId);
  const sourceCatalog = useCatalog('pipelines', s.sourceConnectionId);
  const targetCatalog = useCatalog('pipelines', s.targetConnectionId);
  const sqlSchema = useMemo(() => sqlSchemaOf(sourceCatalog.data), [sourceCatalog.data]);
  const tables = (targetCatalog.data?.tables ?? []).filter((x) => x.kind === 'table');
  const table = tables.find((x) => `${x.schema}.${x.name}` === s.table);
  const targetColumns = table?.columns.map((c) => c.name) ?? [];
  const sourceColumns = preview?.columns.map((c) => c.name) ?? [];
  const used = useMemo(() => parameterNames(s.sql, source?.engine ?? 'postgres'), [s.sql, source?.engine]);
  const staticParams = used.filter((n) => !(s.incremental && n === WATERMARK_PARAM));
  const dirty = JSON.stringify(s) !== JSON.stringify(initial);
  const keyErrors = Object.entries(errors)
    .filter(([k]) => k.startsWith('target.keys'))
    .map(([, m]) => m);

  const body = (): PipelineInput => {
    const [schema, ...rest] = s.table.split('.');
    return {
      name: s.name.trim(),
      description: s.description.trim() || null,
      ownerId: s.owner?.id ?? null,
      enabled: s.enabled,
      source: {
        connectionId: s.sourceConnectionId,
        sql: s.sql,
        params: Object.fromEntries(staticParams.map((n) => [n, s.params[n] ?? ''])),
      },
      incremental: s.incremental
        ? { column: s.watermarkColumn.trim(), initial: s.watermarkInitial.trim() }
        : null,
      target: {
        connectionId: s.targetConnectionId,
        schema: rest.length ? schema || null : null,
        table: rest.length ? rest.join('.') : s.table,
        mode: s.mode,
        keys: s.mode === 'upsert' ? s.keys : [],
      },
      mappings: s.mappings,
      batchSize: Number(s.batchSize) || 500,
    };
  };

  const save = useApiMutation(
    (api, input: PipelineInput) =>
      pipeline
        ? api.patch<PipelineDetail>(`/etl/pipelines/${pipeline.id}`, input)
        : api.post<PipelineDetail>('/etl/pipelines', input),
    {
      invalidate: INVALIDATE,
      success: (p) => (pipeline ? t('pipelineEditor.saved') : t('pipelineEditor.created', { name: p.name })),
      onSuccess: onSaved,
      silent: true,
    },
  );
  const runPreview = useApiMutation(
    (
      api,
      input: {
        connectionId: string;
        sql: string;
        params: Record<string, string>;
        incremental: PipelineInput['incremental'];
      },
    ) => api.post<PreviewResult>('/etl/pipelines/preview', input),
    { silent: true, onSuccess: (r) => setPreview(r) },
  );

  const onSave = async () => {
    setErrors({});
    setRootError(null);
    try {
      await save.mutateAsync(body());
    } catch (err) {
      if (err instanceof ApiError && err.code === 'VALIDATION_FAILED') {
        const issues =
          (err.details as { issues?: { path: string; message: string }[] } | undefined)?.issues ?? [];
        setErrors(Object.fromEntries(issues.map((i) => [i.path, i.message])));
        setRootError(issues.map((i) => `${i.path}: ${i.message}`).join(' · ') || errorText(err));
        return;
      }
      setRootError(errorText(err));
    }
  };

  const autoMap = () => {
    const bySource = new Map(sourceColumns.map((c) => [c.toLowerCase(), c]));
    const mapped = new Set(s.mappings.map((m) => m.target));
    const added = targetColumns
      .filter((c) => !mapped.has(c) && bySource.has(c.toLowerCase()))
      .map((c) => ({ source: bySource.get(c.toLowerCase())!, target: c, transform: 'none' }));
    set({ mappings: [...s.mappings, ...added] });
  };

  const sampleRows: SampleRow[] =
    preview && !preview.error ? preview.rows.map((cells, rowId) => ({ id: rowId, cells })) : [];

  return (
    <VStack gap={4} className="min-w-0">
      <div className="grid min-w-0 grid-cols-1 items-start gap-4 xl:grid-cols-3">
        <div className="grid min-w-0 gap-4 xl:col-span-2">
          <Section title={t('pipelineEditor.source')} description={t('pipelineEditor.sourceHint')}>
            <Selector
              label={t('fields.connection')}
              placeholder={t('create.pickConnection')}
              options={connections.items.map((c) => ({
                value: c.id,
                label: `${c.name} · ${t(`engine.${c.engine}`)}`,
              }))}
              value={s.sourceConnectionId}
              onChange={(v) => set({ sourceConnectionId: v })}
              status={statusOf('source.connectionId')}
            />
            <Field
              label={t('fields.sql')}
              inputID={`${id}-sql`}
              labelID={`${id}-sql-label`}
              status={statusOf('source.sql')}
              statusVariant="detached"
            >
              <CodeEditor
                value={s.sql}
                onChange={(sql) => set({ sql })}
                language="sql"
                dialect={source?.engine ?? 'postgres'}
                schema={sqlSchema}
                placeholder="SELECT … FROM …"
                aria-labelledby={`${id}-sql-label`}
                aria-invalid={Boolean(errors['source.sql'])}
                minHeight="9rem"
              />
            </Field>
            {staticParams.length > 0 && (
              <VStack gap={2}>
                <Text type="label">{t('pipelineEditor.paramValues')}</Text>
                <Grid columns={{ minWidth: 200 }} gap={3}>
                  {staticParams.map((n) => (
                    <TextInput
                      key={n}
                      label={`:${n}`}
                      value={s.params[n] ?? ''}
                      onChange={(v) => set({ params: { ...s.params, [n]: v } })}
                      status={statusOf(`source.params.${n}`)}
                    />
                  ))}
                </Grid>
              </VStack>
            )}
            <Switch
              label={t('pipelineEditor.incremental')}
              description={t('pipelineEditor.incrementalHint')}
              value={s.incremental}
              onChange={(v) => set({ incremental: v })}
            />
            {s.incremental && (
              <VStack gap={3}>
                <Grid columns={{ minWidth: 200 }} gap={3}>
                  {sourceColumns.length ? (
                    <Selector
                      label={t('pipelineEditor.watermarkColumn')}
                      hasSearch
                      options={[
                        ...new Set([...sourceColumns, ...(s.watermarkColumn ? [s.watermarkColumn] : [])]),
                      ]}
                      value={s.watermarkColumn}
                      onChange={(v) => set({ watermarkColumn: v })}
                      status={statusOf('incremental.column')}
                    />
                  ) : (
                    <TextInput
                      label={t('pipelineEditor.watermarkColumn')}
                      value={s.watermarkColumn}
                      onChange={(v) => set({ watermarkColumn: v })}
                      status={statusOf('incremental.column')}
                    />
                  )}
                  <TextInput
                    label={t('pipelineEditor.watermarkInitial')}
                    value={s.watermarkInitial}
                    onChange={(v) => set({ watermarkInitial: v })}
                    status={statusOf('incremental.initial')}
                  />
                </Grid>
                {pipeline?.watermark && (
                  <Text type="supporting">
                    {t('pipelineEditor.currentWatermark', { value: pipeline.watermark })}
                  </Text>
                )}
              </VStack>
            )}
            <HStack gap={2} wrap="wrap" vAlign="center">
              <Button
                label={t('pipelineEditor.preview')}
                variant="secondary"
                size="sm"
                icon={<Icon icon={EyeIcon} />}
                isLoading={runPreview.isPending}
                isDisabled={!s.sourceConnectionId || !s.sql.trim()}
                type="button"
                onClick={() =>
                  runPreview.mutate({
                    connectionId: s.sourceConnectionId,
                    sql: s.sql,
                    params: Object.fromEntries(staticParams.map((n) => [n, s.params[n] ?? ''])),
                    incremental: s.incremental
                      ? { column: s.watermarkColumn || 'x', initial: s.watermarkInitial }
                      : null,
                  })
                }
              />
              {preview && !preview.error && (
                <Text color="secondary" aria-live="polite">
                  {t('pipelineEditor.previewColumns', { list: sourceColumns.join(', ') })}
                </Text>
              )}
            </HStack>
            {preview?.error && (
              <Banner
                status="error"
                title={`${preview.error.dbCode ? `${preview.error.dbCode}: ` : ''}${preview.error.message}`}
                collapsible={false}
              />
            )}
            {preview && !preview.error && preview.rows.length > 0 && (
              <ScrollableArea
                label={t('pipelineEditor.sample')}
                role="region"

                className="max-h-64"
              >
                <Table
                  aria-label={t('pipelineEditor.sample')}
                  density="compact"
                  textOverflow="truncate"
                  data={sampleRows}
                  idKey="id"
                  columns={preview.columns.map((c) => ({
                    key: c.name,
                    header: c.name,
                    renderCell: (r: SampleRow) => (
                      <Text type="code">{r.cells[c.name] === null ? '∅' : String(r.cells[c.name])}</Text>
                    ),
                  }))}
                />
              </ScrollableArea>
            )}
          </Section>

          <Section title={t('pipelineEditor.mapping')} description={t('pipelineEditor.mappingHint')}>
            {errors.mappings && <Banner status="error" title={errors.mappings} collapsible={false} />}
            {s.mappings.length === 0 ? (
              <Text color="secondary">{t('pipelineEditor.noMappings')}</Text>
            ) : (
              <VStack as="ul" gap={3} className="min-w-0" aria-label={t('pipelineEditor.mapping')}>
                {s.mappings.map((m, i) => (
                  <MappingRow
                    key={i}
                    index={i}
                    mapping={m}
                    sourceColumns={sourceColumns}
                    targetColumns={targetColumns}
                    errors={errors}
                    onChange={(next) => set({ mappings: s.mappings.map((x, j) => (j === i ? next : x)) })}
                    onRemove={() => set({ mappings: s.mappings.filter((_, j) => j !== i) })}
                  />
                ))}
              </VStack>
            )}
            <HStack gap={2} wrap="wrap">
              <Button
                label={t('pipelineEditor.addMapping')}
                variant="secondary"
                size="sm"
                icon={<Icon icon={PlusIcon} />}
                type="button"
                onClick={() =>
                  set({ mappings: [...s.mappings, { source: '', target: '', transform: 'none' }] })
                }
              />
              <Button
                label={t('pipelineEditor.autoMap')}
                variant="secondary"
                size="sm"
                icon={<Icon icon={WandSparklesIcon} />}
                isDisabled={!sourceColumns.length || !targetColumns.length}
                type="button"
                onClick={autoMap}
              />
            </HStack>
          </Section>
        </div>

        <div className="grid min-w-0 gap-4">
          <Section title={t('editor.general')}>
            <TextInput
              label={t('fields.name')}
              isRequired
              value={s.name}
              onChange={(name) => set({ name })}
              status={statusOf('name')}
            />
            <TextArea
              label={t('fields.description')}
              rows={3}
              maxLength={2_000}
              value={s.description}
              onChange={(description) => set({ description })}
            />
            <Field
              label={t('fields.owner')}
              inputID={`${id}-owner`}
              description={t('pipelineEditor.ownerHint')}
              status={statusOf('ownerId')}
              statusVariant="detached"
            >
              <PersonPicker id={`${id}-owner`} value={s.owner} onChange={(owner) => set({ owner })} />
            </Field>
            <Switch label={t('fields.enabled')} value={s.enabled} onChange={(enabled) => set({ enabled })} />
          </Section>

          <Section title={t('pipelineEditor.target')} description={t('pipelineEditor.targetHint')}>
            <Selector
              label={t('fields.connection')}
              placeholder={t('create.pickConnection')}
              options={connections.items.map((c) => ({
                value: c.id,
                label: `${c.name} · ${t(`engine.${c.engine}`)}${c.readOnly ? ` · ${t('connection.readOnly')}` : ''}`,
                disabled: c.readOnly,
              }))}
              value={s.targetConnectionId}
              onChange={(v) => set({ targetConnectionId: v, table: '', keys: [] })}
              status={statusOf('target.connectionId')}
            />
            <Selector
              label={t('fields.table')}
              hasSearch
              hasClear
              placeholder={
                targetCatalog.isLoading ? t('editor.loadingCatalog') : t('pipelineEditor.pickTable')
              }
              options={[
                ...tables.map((x) => `${x.schema}.${x.name}`),
                ...(s.table && !table ? [s.table] : []),
              ]}
              value={s.table || null}
              onChange={(v) => set({ table: v ?? '', keys: [] })}
              status={statusOf('target.table')}
            />
            <Selector
              label={t('fields.mode')}
              description={t(`pipelineEditor.modeHint.${s.mode}`)}
              options={WRITE_MODES.map((m) => ({ value: m, label: t(`writeMode.${m}`) }))}
              value={s.mode}
              onChange={(v) => set({ mode: v as WriteModeValue })}
            />
            {s.mode === 'upsert' && (
              <VStack gap={2} role="group" aria-labelledby={`${id}-keys`} className="min-w-0">
                <Text type="label" id={`${id}-keys`}>
                  {t('fields.keys')}
                </Text>
                {targetColumns.length === 0 ? (
                  <Text color="secondary">{t('pipelineEditor.pickTableFirst')}</Text>
                ) : (
                  targetColumns.map((c) => (
                    <CheckboxInput
                      key={c}
                      label={c}
                      description={
                        table?.columns.find((x) => x.name === c)?.key
                          ? t('pipelineEditor.uniqueKey')
                          : undefined
                      }
                      value={s.keys.includes(c)}
                      onChange={(on) => set({ keys: on ? [...s.keys, c] : s.keys.filter((k) => k !== c) })}
                    />
                  ))
                )}
                {keyErrors.length > 0 && (
                  <HStack gap={1.5} vAlign="start">
                    <Icon icon={CircleAlertIcon} color="error" />
                    <Text type="supporting">{keyErrors.join(' · ')}</Text>
                  </HStack>
                )}
              </VStack>
            )}
            <NumberInput
              label={t('fields.batchSize')}
              min={1}
              max={10_000}
              isIntegerOnly
              hasClear
              value={s.batchSize.trim() ? Number(s.batchSize) : null}
              onChange={(v) => set({ batchSize: v === null ? '' : String(v) })}
            />
            {target?.readOnly && (
              <Banner status="error" title={t('pipelineEditor.readOnlyTarget')} collapsible={false} />
            )}
          </Section>
        </div>
      </div>

      <VStack gap={2} className="sticky bottom-0 z-10 -mx-1 bg-background/95 px-1 pb-3 backdrop-blur">
        <Divider />
        {rootError && <Banner status="error" title={rootError} collapsible={false} />}
        <HStack gap={3} wrap="wrap" hAlign="end" vAlign="center">
          {pipeline && (
            <Text color="secondary" aria-live="polite">
              {dirty ? t('editor.unsaved') : t('editor.allSaved')}
            </Text>
          )}
          <Button
            label={pipeline ? t('pipelineEditor.save') : t('pipelineEditor.create')}
            variant="primary"
            icon={<Icon icon={SaveIcon} />}
            isLoading={save.isPending}
            isDisabled={Boolean(pipeline) && !dirty}
            type="button"
            onClick={onSave}
          />
        </HStack>
      </VStack>
    </VStack>
  );
}
