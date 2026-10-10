'use client';

import { ApiError } from '@isbp/sdk/web';
import { cn } from '@isbp/ui';
import { problemOfError, RunProblemBanner } from '@isbp/ui/run-detail';
import { Button } from '@isbp/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@isbp/ui/card';
import { CodeEditor } from '@isbp/ui/code-editor';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@isbp/ui/dialog';
import { Input } from '@isbp/ui/input';
import { Label } from '@isbp/ui/label';
import { useApiMutation, useErrorText } from '@isbp/ui/query';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@isbp/ui/select';
import { Textarea } from '@isbp/ui/textarea';
import { CircleCheckIcon, CircleXIcon, PlayIcon, RocketIcon } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import type { EndpointDetail, ParamDef, TestRequest, TestResult } from '../../contracts';
import { TONE } from '../badges';
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
  const id = useId();
  const hint = [
    tp(`types.${param.type}`) + (param.list ? ` · ${t('listHint')}` : ''),
    param.required && param.default === null ? t('required') : null,
    param.default !== null ? t('defaultIs', { value: param.default }) : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const choices =
    param.type === 'boolean' ? ['true', 'false'] : !param.list && param.enum?.length ? param.enum : null;
  return (
    <div className="grid min-w-0 gap-1.5">
      <Label htmlFor={id} className="font-mono">
        {param.name}
      </Label>
      {choices ? (
        <Select value={value || UNSET} onValueChange={(v) => onChange(v === UNSET ? '' : v)}>
          <SelectTrigger
            id={id}
            className="w-full"
            aria-describedby={`${id}-hint`}
            aria-invalid={Boolean(error) || undefined}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={UNSET}>{t('notSet')}</SelectItem>
            {choices.map((c) => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <Input
          id={id}
          value={value}
          placeholder={param.example ?? param.default ?? undefined}
          aria-describedby={`${id}-hint`}
          aria-invalid={Boolean(error) || undefined}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      <p id={`${id}-hint`} className="text-xs text-muted-foreground">
        {param.description ? `${param.description} · ` : ''}
        {hint}
      </p>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

/** Rows of a test run as a scrollable, focusable table. */
function ResultTable({ result }: { result: TestResult }) {
  const t = useTranslations('etl.test');
  const rows = result.rows.slice(0, SHOWN_ROWS);
  return (
    <div
      role="region"
      aria-label={t('results')}
      tabIndex={0}
      className="max-h-[28rem] min-w-0 overflow-auto rounded-lg border outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
    >
      <table className="w-full text-sm">
        <caption className="sr-only">{t('results')}</caption>
        <thead className="sticky top-0 bg-muted/80 backdrop-blur">
          <tr>
            {result.columns.map((c) => (
              <th
                key={c.name}
                scope="col"
                className="px-3 py-2 text-left text-xs font-medium whitespace-nowrap"
              >
                {c.name} <span className="font-normal text-muted-foreground">{c.type}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-t">
              {result.columns.map((c) => (
                <td
                  key={c.name}
                  className="max-w-72 truncate px-3 py-1.5 font-mono text-xs"
                  title={display(row[c.name])}
                >
                  {display(row[c.name])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
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
  const id = useId();
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" closeLabel={tc('close')}>
        <DialogHeader>
          <DialogTitle>{t('title', { version: next })}</DialogTitle>
          <DialogDescription>{t('hint')}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-1.5">
          <Label htmlFor={`${id}-note`}>{t('note')}</Label>
          <Textarea
            id={`${id}-note`}
            rows={3}
            maxLength={2_000}
            value={note}
            placeholder={t('notePlaceholder')}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
        {error && (
          <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {tc('cancel')}
          </Button>
          <Button
            loading={publish.isPending}
            onClick={async () => {
              setError(null);
              try {
                await publish.mutateAsync({ note: note.trim() || null });
              } catch (err) {
                setError(errorText(err));
              }
            }}
          >
            <RocketIcon /> {t('confirm', { version: next })}
          </Button>
        </DialogFooter>
      </DialogContent>
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
            className="grid min-w-0 gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              void onRun();
            }}
          >
            <div className="grid gap-1.5">
              <Label htmlFor={`${id}-target`}>{t('runWhat')}</Label>
              <Select
                value={target}
                onValueChange={(v) => {
                  setTarget(v);
                  setResult(null);
                }}
              >
                <SelectTrigger id={`${id}-target`} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {endpoint.viewer.canManage && <SelectItem value={DRAFT}>{t('draft')}</SelectItem>}
                  {versions.map((v) => (
                    <SelectItem key={v.version} value={String(v.version)}>
                      {t('version', { version: v.version })}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {params.length === 0 && <p className="text-sm text-muted-foreground">{t('noParams')}</p>}
            {params.map((p) => (
              <ParamInput
                key={p.name}
                param={p}
                value={values[p.name] ?? ''}
                error={errors[p.name]}
                onChange={(v) => setValues((s) => ({ ...s, [p.name]: v }))}
              />
            ))}
            <Button type="submit" loading={run.isPending} disabled={!endpoint.viewer.canManage}>
              <PlayIcon /> {t('run')}
            </Button>
            {!endpoint.viewer.canManage && <p className="text-xs text-muted-foreground">{t('manageOnly')}</p>}
          </form>
        </CardContent>
      </Card>

      <div className="grid min-w-0 gap-4 xl:col-span-2" aria-live="polite">
        {failure && (
          <p
            role="alert"
            className={cn('flex items-start gap-2 rounded-lg px-3 py-2 text-sm', TONE.destructive)}
          >
            <CircleXIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span className="min-w-0 wrap-anywhere">{failure}</span>
          </p>
        )}
        {!result && !failure && (
          <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
            {t('empty')}
          </div>
        )}
        {result && (
          <>
            {result.ok ? (
              <div
                className={cn(
                  'flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg px-3 py-2 text-sm',
                  TONE.success,
                )}
              >
                <CircleCheckIcon className="size-4 shrink-0" aria-hidden />
                <span className="font-medium">
                  {t('rows', { count: result.rowCount })} · {duration(result.durationMs)}
                </span>
                {result.truncated && <span>{t('truncated')}</span>}
                {result.rowCount > SHOWN_ROWS && (
                  <span>{t('shownRows', { n: format.number(SHOWN_ROWS) })}</span>
                )}
                {canPublish && (
                  <Button size="sm" className="ml-auto" onClick={onPublish}>
                    <RocketIcon /> {t('publish')}
                  </Button>
                )}
              </div>
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
              <div className="grid min-w-0 gap-1.5">
                <span id={`${id}-bound`} className="text-sm font-medium">
                  {t('boundSql')}
                </span>
                <CodeEditor
                  value={result.boundSql}
                  language="sql"
                  readOnly
                  lineNumbers={false}
                  minHeight="2.5rem"
                  maxHeight="14rem"
                  aria-labelledby={`${id}-bound`}
                />
              </div>
            )}
            {result.ok && result.columns.length > 0 && <ResultTable result={result} />}
          </>
        )}
      </div>
    </div>
  );
}
