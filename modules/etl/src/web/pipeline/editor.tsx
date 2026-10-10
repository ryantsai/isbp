'use client';

import { parameterNames } from '@isbp/sql/params';
import { ApiError } from '@isbp/sdk/web';
import { cn } from '@isbp/ui';
import { Button } from '@isbp/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@isbp/ui/card';
import { Checkbox } from '@isbp/ui/checkbox';
import { CodeEditor } from '@isbp/ui/code-editor';
import { Input } from '@isbp/ui/input';
import { Label } from '@isbp/ui/label';
import { PersonPicker, type PersonOption } from '@isbp/ui/person-picker';
import { useApiMutation, useErrorText } from '@isbp/ui/query';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@isbp/ui/select';
import { Switch } from '@isbp/ui/switch';
import { Textarea } from '@isbp/ui/textarea';
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
import { TONE } from '../badges';
import { INVALIDATE, sqlSchemaOf, useCatalog, useConnections } from '../lib';

type Errors = Record<string, string>;
const NONE = '__none__';

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
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
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
  const id = useId();
  const { kind, arg } = parseTransform(mapping.transform ?? 'none');
  const err = (f: string) => errors[`mappings.${index}.${f}`];
  return (
    <li className="grid min-w-0 grid-cols-1 gap-3 rounded-lg border bg-background p-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.8fr)_minmax(0,0.8fr)_auto]">
      <Field id={`${id}-source`} label={t('source')} error={err('source')}>
        {sourceColumns.length ? (
          <Select
            value={mapping.source || NONE}
            onValueChange={(v) => onChange({ ...mapping, source: v === NONE ? '' : v })}
          >
            <SelectTrigger id={`${id}-source`} className="h-8 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>{t('pick')}</SelectItem>
              {[...new Set([...sourceColumns, ...(mapping.source ? [mapping.source] : [])])].map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <Input
            id={`${id}-source`}
            className="h-8 font-mono"
            value={mapping.source}
            onChange={(e) => onChange({ ...mapping, source: e.target.value })}
          />
        )}
      </Field>
      <Field id={`${id}-target`} label={t('target')} error={err('target')}>
        <Select
          value={mapping.target || NONE}
          onValueChange={(v) => onChange({ ...mapping, target: v === NONE ? '' : v })}
        >
          <SelectTrigger
            id={`${id}-target`}
            className="h-8 w-full"
            aria-invalid={Boolean(err('target')) || undefined}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>{t('pick')}</SelectItem>
            {[...new Set([...targetColumns, ...(mapping.target ? [mapping.target] : [])])].map((c) => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field id={`${id}-transform`} label={t('transform')} error={err('transform')}>
        <Select
          value={kind}
          onValueChange={(v) =>
            onChange({
              ...mapping,
              transform: formatTransform(v as TransformKind, v === 'cast' ? 'string' : ''),
            })
          }
        >
          <SelectTrigger id={`${id}-transform`} className="h-8 w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TRANSFORM_KINDS.map((k) => (
              <SelectItem key={k} value={k}>
                {t(`transforms.${k}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      {kind === 'cast' ? (
        <Field id={`${id}-arg`} label={t('castTo')}>
          <Select
            value={arg ?? 'string'}
            onValueChange={(v) => onChange({ ...mapping, transform: formatTransform('cast', v) })}
          >
            <SelectTrigger id={`${id}-arg`} className="h-8 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CAST_TYPES.map((c) => (
                <SelectItem key={c} value={c}>
                  {t(`castTypes.${c}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      ) : kind === 'default' || kind === 'constant' ? (
        <Field id={`${id}-arg`} label={t('value')}>
          <Input
            id={`${id}-arg`}
            className="h-8"
            value={arg ?? ''}
            maxLength={500}
            onChange={(e) => onChange({ ...mapping, transform: formatTransform(kind, e.target.value) })}
          />
        </Field>
      ) : (
        <span className="hidden lg:block" />
      )}
      <div className="flex items-end">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={t('remove', { n: index + 1 })}
          onClick={onRemove}
        >
          <Trash2Icon />
        </Button>
      </div>
    </li>
  );
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

  return (
    <div className="grid min-w-0 gap-4">
      <div className="grid min-w-0 grid-cols-1 items-start gap-4 xl:grid-cols-3">
        <div className="grid min-w-0 gap-4 xl:col-span-2">
          <Section title={t('pipelineEditor.source')} description={t('pipelineEditor.sourceHint')}>
            <Field id={`${id}-source`} label={t('fields.connection')} error={errors['source.connectionId']}>
              <Select value={s.sourceConnectionId} onValueChange={(v) => set({ sourceConnectionId: v })}>
                <SelectTrigger id={`${id}-source`} className="w-full">
                  <SelectValue placeholder={t('create.pickConnection')} />
                </SelectTrigger>
                <SelectContent>
                  {connections.items.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name} · {t(`engine.${c.engine}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <div className="grid min-w-0 gap-2">
              <Label id={`${id}-sql-label`}>{t('fields.sql')}</Label>
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
              {errors['source.sql'] && <p className="text-xs text-destructive">{errors['source.sql']}</p>}
            </div>
            {staticParams.length > 0 && (
              <fieldset className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
                <legend className="mb-2 text-sm font-medium">{t('pipelineEditor.paramValues')}</legend>
                {staticParams.map((n) => (
                  <Field key={n} id={`${id}-p-${n}`} label={`:${n}`} error={errors[`source.params.${n}`]}>
                    <Input
                      id={`${id}-p-${n}`}
                      value={s.params[n] ?? ''}
                      onChange={(e) => set({ params: { ...s.params, [n]: e.target.value } })}
                    />
                  </Field>
                ))}
              </fieldset>
            )}
            <div className="flex items-start justify-between gap-4 rounded-lg border p-3">
              <div className="grid gap-1">
                <Label htmlFor={`${id}-incremental`}>{t('pipelineEditor.incremental')}</Label>
                <p className="text-xs text-muted-foreground">{t('pipelineEditor.incrementalHint')}</p>
              </div>
              <Switch
                id={`${id}-incremental`}
                checked={s.incremental}
                onCheckedChange={(v) => set({ incremental: v })}
              />
            </div>
            {s.incremental && (
              <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
                <Field
                  id={`${id}-wcol`}
                  label={t('pipelineEditor.watermarkColumn')}
                  error={errors['incremental.column']}
                >
                  <Input
                    id={`${id}-wcol`}
                    className="font-mono"
                    list={`${id}-columns`}
                    value={s.watermarkColumn}
                    onChange={(e) => set({ watermarkColumn: e.target.value })}
                  />
                  <datalist id={`${id}-columns`}>
                    {sourceColumns.map((c) => (
                      <option key={c} value={c} />
                    ))}
                  </datalist>
                </Field>
                <Field
                  id={`${id}-winit`}
                  label={t('pipelineEditor.watermarkInitial')}
                  error={errors['incremental.initial']}
                >
                  <Input
                    id={`${id}-winit`}
                    value={s.watermarkInitial}
                    onChange={(e) => set({ watermarkInitial: e.target.value })}
                  />
                </Field>
                {pipeline?.watermark && (
                  <p className="text-xs text-muted-foreground sm:col-span-2">
                    {t('pipelineEditor.currentWatermark', { value: pipeline.watermark })}
                  </p>
                )}
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!s.sourceConnectionId || !s.sql.trim()}
                loading={runPreview.isPending}
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
              >
                <EyeIcon /> {t('pipelineEditor.preview')}
              </Button>
              {preview && !preview.error && (
                <span className="text-sm text-muted-foreground" aria-live="polite">
                  {t('pipelineEditor.previewColumns', { list: sourceColumns.join(', ') })}
                </span>
              )}
            </div>
            {preview?.error && (
              <p role="alert" className={cn('rounded-lg px-3 py-2 text-sm wrap-anywhere', TONE.destructive)}>
                {preview.error.dbCode ? `${preview.error.dbCode}: ` : ''}
                {preview.error.message}
              </p>
            )}
            {preview && !preview.error && preview.rows.length > 0 && (
              <div
                role="region"
                tabIndex={0}
                aria-label={t('pipelineEditor.sample')}
                className="max-h-64 min-w-0 overflow-auto rounded-lg border outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                <table className="w-full text-xs">
                  <caption className="sr-only">{t('pipelineEditor.sample')}</caption>
                  <thead className="sticky top-0 bg-muted/80">
                    <tr>
                      {preview.columns.map((c) => (
                        <th
                          key={c.name}
                          scope="col"
                          className="px-2 py-1.5 text-left font-medium whitespace-nowrap"
                        >
                          {c.name}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.map((r, i) => (
                      <tr key={i} className="border-t">
                        {preview.columns.map((c) => (
                          <td key={c.name} className="max-w-48 truncate px-2 py-1 font-mono">
                            {r[c.name] === null ? '∅' : String(r[c.name])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          <Section title={t('pipelineEditor.mapping')} description={t('pipelineEditor.mappingHint')}>
            {errors.mappings && <p className="text-xs text-destructive">{errors.mappings}</p>}
            {s.mappings.length === 0 ? (
              <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                {t('pipelineEditor.noMappings')}
              </p>
            ) : (
              <ul className="grid min-w-0 gap-3" aria-label={t('pipelineEditor.mapping')}>
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
              </ul>
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  set({ mappings: [...s.mappings, { source: '', target: '', transform: 'none' }] })
                }
              >
                <PlusIcon /> {t('pipelineEditor.addMapping')}
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={!sourceColumns.length || !targetColumns.length}
                onClick={autoMap}
              >
                <WandSparklesIcon /> {t('pipelineEditor.autoMap')}
              </Button>
            </div>
          </Section>
        </div>

        <div className="grid min-w-0 gap-4">
          <Section title={t('editor.general')}>
            <Field id={`${id}-name`} label={t('fields.name')} error={errors.name}>
              <Input
                id={`${id}-name`}
                value={s.name}
                maxLength={120}
                onChange={(e) => set({ name: e.target.value })}
              />
            </Field>
            <Field id={`${id}-description`} label={t('fields.description')}>
              <Textarea
                id={`${id}-description`}
                rows={3}
                value={s.description}
                maxLength={2_000}
                onChange={(e) => set({ description: e.target.value })}
              />
            </Field>
            <Field
              id={`${id}-owner`}
              label={t('fields.owner')}
              hint={t('pipelineEditor.ownerHint')}
              error={errors.ownerId}
            >
              <PersonPicker id={`${id}-owner`} value={s.owner} onChange={(owner) => set({ owner })} />
            </Field>
            <div className="flex items-center justify-between gap-4">
              <Label htmlFor={`${id}-enabled`}>{t('fields.enabled')}</Label>
              <Switch id={`${id}-enabled`} checked={s.enabled} onCheckedChange={(v) => set({ enabled: v })} />
            </div>
          </Section>

          <Section title={t('pipelineEditor.target')} description={t('pipelineEditor.targetHint')}>
            <Field id={`${id}-target`} label={t('fields.connection')} error={errors['target.connectionId']}>
              <Select
                value={s.targetConnectionId}
                onValueChange={(v) => set({ targetConnectionId: v, table: '', keys: [] })}
              >
                <SelectTrigger id={`${id}-target`} className="w-full">
                  <SelectValue placeholder={t('create.pickConnection')} />
                </SelectTrigger>
                <SelectContent>
                  {connections.items.map((c) => (
                    <SelectItem key={c.id} value={c.id} disabled={c.readOnly}>
                      {c.name} · {t(`engine.${c.engine}`)}
                      {c.readOnly ? ` · ${t('connection.readOnly')}` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field id={`${id}-table`} label={t('fields.table')} error={errors['target.table']}>
              <Select
                value={s.table || NONE}
                onValueChange={(v) => set({ table: v === NONE ? '' : v, keys: [] })}
              >
                <SelectTrigger id={`${id}-table`} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>
                    {targetCatalog.isLoading ? t('editor.loadingCatalog') : t('pipelineEditor.pickTable')}
                  </SelectItem>
                  {tables.map((x) => (
                    <SelectItem key={`${x.schema}.${x.name}`} value={`${x.schema}.${x.name}`}>
                      {x.schema}.{x.name}
                    </SelectItem>
                  ))}
                  {s.table && !table && <SelectItem value={s.table}>{s.table}</SelectItem>}
                </SelectContent>
              </Select>
            </Field>
            <Field id={`${id}-mode`} label={t('fields.mode')} hint={t(`pipelineEditor.modeHint.${s.mode}`)}>
              <Select value={s.mode} onValueChange={(v) => set({ mode: v as WriteModeValue })}>
                <SelectTrigger id={`${id}-mode`} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {WRITE_MODES.map((m) => (
                    <SelectItem key={m} value={m}>
                      {t(`writeMode.${m}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            {s.mode === 'upsert' && (
              <fieldset className="grid min-w-0 gap-2">
                <legend className="mb-1 text-sm font-medium">{t('fields.keys')}</legend>
                {targetColumns.length === 0 && (
                  <p className="text-sm text-muted-foreground">{t('pipelineEditor.pickTableFirst')}</p>
                )}
                {targetColumns.map((c) => (
                  <div key={c} className="flex items-center gap-2">
                    <Checkbox
                      id={`${id}-key-${c}`}
                      checked={s.keys.includes(c)}
                      onCheckedChange={(v) =>
                        set({ keys: v === true ? [...s.keys, c] : s.keys.filter((k) => k !== c) })
                      }
                    />
                    <Label htmlFor={`${id}-key-${c}`} className="font-mono font-normal">
                      {c}
                      {table?.columns.find((x) => x.name === c)?.key && (
                        <span className="ml-1 font-sans text-xs text-muted-foreground">
                          {t('pipelineEditor.uniqueKey')}
                        </span>
                      )}
                    </Label>
                  </div>
                ))}
                {Object.entries(errors)
                  .filter(([k]) => k.startsWith('target.keys'))
                  .map(([k, m]) => (
                    <p key={k} className="text-xs text-destructive">
                      {m}
                    </p>
                  ))}
              </fieldset>
            )}
            <Field id={`${id}-batch`} label={t('fields.batchSize')}>
              <Input
                id={`${id}-batch`}
                type="number"
                min={1}
                max={10_000}
                value={s.batchSize}
                onChange={(e) => set({ batchSize: e.target.value })}
              />
            </Field>
            {target?.readOnly && (
              <p className="text-xs text-destructive">{t('pipelineEditor.readOnlyTarget')}</p>
            )}
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
        {pipeline && (
          <span className="text-sm text-muted-foreground" aria-live="polite">
            {dirty ? t('editor.unsaved') : t('editor.allSaved')}
          </span>
        )}
        <Button
          type="button"
          onClick={onSave}
          disabled={Boolean(pipeline) && !dirty}
          loading={save.isPending}
        >
          <SaveIcon /> {pipeline ? t('pipelineEditor.save') : t('pipelineEditor.create')}
        </Button>
      </div>
    </div>
  );
}
