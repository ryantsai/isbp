'use client';

import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import { FormLayout } from '@astryxdesign/core/FormLayout';
import { Icon } from '@astryxdesign/core/Icon';
import { HStack, Layout, LayoutContent, LayoutFooter, VStack } from '@astryxdesign/core/Layout';
import { ScrollableArea } from '@astryxdesign/core/ScrollableArea';
import { Selector } from '@astryxdesign/core/Selector';
import { Table } from '@astryxdesign/core/Table';
import { Text } from '@astryxdesign/core/Text';
import { TextArea } from '@astryxdesign/core/TextArea';
import { TextInput } from '@astryxdesign/core/TextInput';
import { ApiError } from '@isbp/sdk/web';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@isbp/ui/card';
import { CodeEditor } from '@isbp/ui/code-editor';
import { EmptyState } from '@isbp/ui/empty-state';
import { useApiMutation, useErrorText } from '@isbp/ui/query';
import { problemOfError, RunProblemBanner } from '@isbp/ui/run-detail';
import { FlaskConicalIcon, PlayIcon, RocketIcon } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import type { EndpointDetail, ParamDef, TestRequest, TestResult } from '../../contracts';
import { INVALIDATE, useDuration } from '../lib';

const DRAFT = 'draft';
const UNSET = '__unset__';
const SHOWN_ROWS = 200;

function display(value: unknown): string {
  if (value === null || value === undefined) return '∅';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/** One parameter input: enums and booleans as selects, everything else as text (lists comma-separated). */
function ParamInput({
  param,
  value,
  onChange,
  error,
}: {
  param: ParamDef;
  value: string;
  onChange: (v: string) => void;
  error?: string;
}) {
  const t = useTranslations('etl.test');
  const tp = useTranslations('etl.params');
  const hint = [
    tp(`types.${param.type}`) + (param.list ? ` · ${t('listHint')}` : ''),
    param.required && param.default === null ? t('required') : null,
    param.default !== null ? t('defaultIs', { value: param.default }) : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const description = `${param.description ? `${param.description} · ` : ''}${hint}`;
  const status = error ? { type: 'error' as const, message: error } : undefined;
  const choices =
    param.type === 'boolean' ? ['true', 'false'] : !param.list && param.enum?.length ? param.enum : null;
  return choices ? (
    <Selector
      label={param.name}
      description={description}
      options={[{ value: UNSET, label: t('notSet') }, ...choices.map((c) => ({ value: c, label: c }))]}
      value={value || UNSET}
      onChange={(v) => onChange(v === UNSET ? '' : v)}
      status={status}
    />
  ) : (
    <TextInput
      label={param.name}
      description={description}
      placeholder={param.example ?? param.default ?? undefined}
      value={value}
      onChange={onChange}
      status={status}
    />
  );
}

interface ResultRow extends Record<string, unknown> {
  id: number;
  cells: Record<string, unknown>;
}

/** Rows of a test run as a scrollable table. */
function ResultTable({ result }: { result: TestResult }) {
  const t = useTranslations('etl.test');
  const rows: ResultRow[] = result.rows.slice(0, SHOWN_ROWS).map((cells, id) => ({ id, cells }));
  return (
    <ScrollableArea label={t('results')} role="region" className="max-h-[28rem]">
      <Table
        aria-label={t('results')}
        density="compact"
        textOverflow="truncate"
        data={rows}
        idKey="id"
        columns={result.columns.map((c) => ({
          key: c.name,
          header: (
            <>
              {c.name} <Text type="supporting">{c.type}</Text>
            </>
          ),
          renderCell: (r: ResultRow) => <Text type="code">{display(r.cells[c.name])}</Text>,
        }))}
      />
    </ScrollableArea>
  );
}

/** Publish the tested draft as the next version, with a change note. */
export function PublishDialog({
  endpoint,
  open,
  onOpenChange,
}: {
  endpoint: EndpointDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('etl.publish');
  const tc = useTranslations('common');
  const errorText = useErrorText();
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const next = Math.max(0, ...endpoint.versions.map((v) => v.version)) + 1;
  const publish = useApiMutation(
    (api, body: { note: string | null }) =>
      api.post<EndpointDetail>(`/etl/endpoints/${endpoint.id}/publish`, body),
    {
      invalidate: INVALIDATE,
      success: (e) => t('published', { version: e.latestVersion ?? next }),
      silent: true,
      onSuccess: () => {
        setNote('');
        onOpenChange(false);
      },
    },
  );
  return (
    <Dialog isOpen={open} onOpenChange={onOpenChange} width={512} purpose="form">
      <Layout
        header={
          <DialogHeader
            title={t('title', { version: next })}
            subtitle={t('hint')}
            onOpenChange={onOpenChange}
          />
        }
        content={
          <LayoutContent padding={4}>
            <FormLayout defaultOptionality="optional">
              <TextArea
                label={t('note')}
                rows={3}
                maxLength={2_000}
                placeholder={t('notePlaceholder')}
                value={note}
                onChange={setNote}
              />
              {error && <Banner status="error" title={error} collapsible={false} />}
            </FormLayout>
          </LayoutContent>
        }
        footer={
          <LayoutFooter hasDivider padding={3}>
            <HStack gap={2} hAlign="end">
              <Button label={tc('cancel')} variant="ghost" onClick={() => onOpenChange(false)} />
              <Button
                label={t('confirm', { version: next })}
                variant="primary"
                icon={<Icon icon={RocketIcon} />}
                isLoading={publish.isPending}
                onClick={async () => {
                  setError(null);
                  try {
                    await publish.mutateAsync({ note: note.trim() || null });
                  } catch (err) {
                    setError(errorText(err));
                  }
                }}
              />
            </HStack>
          </LayoutFooter>
        }
      />
    </Dialog>
  );
}

/**
 * The test console: runs the draft (or a published version) with a parameter form, and shows rows,
 * columns, the time, the bound SQL and the database's own error. A successful draft test unlocks
 * publishing.
 */
export function TestConsole({ endpoint, onPublish }: { endpoint: EndpointDetail; onPublish: () => void }) {
  const t = useTranslations('etl.test');
  const format = useFormatter();
  const duration = useDuration();
  const errorText = useErrorText();
  const id = useId();
  const versions = endpoint.versions.filter((v) => v.status !== 'retired');
  const [target, setTarget] = useState<string>(
    endpoint.viewer.canManage ? DRAFT : String(versions[0]?.version ?? DRAFT),
  );
  const [values, setValues] = useState<Record<string, string>>({});
  const [result, setResult] = useState<TestResult | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const def =
    target === DRAFT
      ? endpoint.draft
      : (versions.find((v) => String(v.version) === target)?.definition ?? endpoint.draft);
  const params = def.params as ParamDef[];

  const run = useApiMutation(
    (api, body: TestRequest) => api.post<TestResult>(`/etl/endpoints/${endpoint.id}/test`, body),
    {
      invalidate:
        target === DRAFT ? [`/etl/endpoints/${endpoint.id}`, `/etl/endpoints/${endpoint.slug}`] : [],
      silent: true,
    },
  );
  const onRun = async () => {
    setErrors({});
    setFailure(null);
    const sent = Object.fromEntries(Object.entries(values).filter(([, v]) => v.trim() !== ''));
    try {
      setResult(
        await run.mutateAsync({ params: sent, version: target === DRAFT ? undefined : Number(target) }),
      );
    } catch (err) {
      setResult(null);
      if (err instanceof ApiError && err.code === 'VALIDATION_FAILED') {
        const issues =
          (err.details as { issues?: { path: string; message: string }[] } | undefined)?.issues ?? [];
        setErrors(Object.fromEntries(issues.map((i) => [i.path.replace(/^params\./, ''), i.message])));
        setFailure(
          issues.map((i) => `${i.path.replace(/^params\./, '')}: ${i.message}`).join(' · ') || errorText(err),
        );
      } else setFailure(errorText(err));
    }
  };

  const canPublish = endpoint.viewer.canManage && target === DRAFT && result?.ok && result.draftTested;

  return (
    <div className="grid min-w-0 grid-cols-1 items-start gap-4 xl:grid-cols-3">
      <Card className="min-w-0">
        <CardHeader>
          <CardTitle role="heading" aria-level={2}>
            {t('title')}
          </CardTitle>
          <CardDescription>{t('hint')}</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void onRun();
            }}
          >
            <FormLayout defaultOptionality="optional">
              <Selector
                label={t('runWhat')}
                options={[
                  ...(endpoint.viewer.canManage ? [{ value: DRAFT, label: t('draft') }] : []),
                  ...versions.map((v) => ({
                    value: String(v.version),
                    label: t('version', { version: v.version }),
                  })),
                ]}
                value={target}
                onChange={(v) => {
                  setTarget(v);
                  setResult(null);
                }}
              />
              {params.length === 0 && <Text color="secondary">{t('noParams')}</Text>}
              {params.map((p) => (
                <ParamInput
                  key={p.name}
                  param={p}
                  value={values[p.name] ?? ''}
                  error={errors[p.name]}
                  onChange={(v) => setValues((s) => ({ ...s, [p.name]: v }))}
                />
              ))}
              <div>
                <Button
                  label={t('run')}
                  variant="primary"
                  icon={<Icon icon={PlayIcon} />}
                  isLoading={run.isPending}
                  isDisabled={!endpoint.viewer.canManage}
                  type="submit"
                />
              </div>
              {!endpoint.viewer.canManage && <Text type="supporting">{t('manageOnly')}</Text>}
            </FormLayout>
          </form>
        </CardContent>
      </Card>

      <VStack gap={4} className="min-w-0 xl:col-span-2" aria-live="polite">
        {failure && <Banner status="error" title={failure} collapsible={false} />}
        {!result && !failure && <EmptyState icon={<FlaskConicalIcon />} title={t('empty')} />}
        {result && (
          <>
            {result.ok ? (
              <Banner
                status="success"
                title={`${t('rows', { count: result.rowCount })} · ${duration(result.durationMs)}`}
                description={
                  [
                    result.truncated ? t('truncated') : null,
                    result.rowCount > SHOWN_ROWS ? t('shownRows', { n: format.number(SHOWN_ROWS) }) : null,
                  ]
                    .filter(Boolean)
                    .join(' · ') || undefined
                }
                endContent={
                  canPublish ? (
                    <Button
                      label={t('publish')}
                      variant="primary"
                      size="sm"
                      icon={<Icon icon={RocketIcon} />}
                      onClick={onPublish}
                    />
                  ) : undefined
                }
                collapsible={false}
              />
            ) : (
              <RunProblemBanner
                live
                problem={problemOfError(
                  result.error ?? { kind: 'other', dbCode: null, message: '' },
                  endpoint.connection ? { id: endpoint.connection.id, name: endpoint.connection.name } : null,
                )}
                error={[result.error?.dbCode, result.error?.message].filter(Boolean).join(': ') || null}
              />
            )}
            {result.boundSql && (
              <VStack gap={1.5} className="min-w-0">
                <Text type="label" id={`${id}-bound`}>
                  {t('boundSql')}
                </Text>
                <CodeEditor
                  value={result.boundSql}
                  language="sql"
                  readOnly
                  lineNumbers={false}
                  minHeight="2.5rem"
                  maxHeight="14rem"
                  aria-labelledby={`${id}-bound`}
                />
              </VStack>
            )}
            {result.ok && result.columns.length > 0 && <ResultTable result={result} />}
          </>
        )}
      </VStack>
    </div>
  );
}
