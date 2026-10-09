'use client';

import { type ErrorCode, HttpError, type RunProblem, runProblemFromText, runProblemOf } from '@isbp/sdk';
import { useCan } from '@isbp/sdk/web';
import {
  CircleXIcon,
  CopyIcon,
  DownloadIcon,
  InfoIcon,
  ScrollTextIcon,
  TriangleAlertIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import * as React from 'react';
import { cn } from '../lib/utils';
import { Button } from './button';
import { Label } from './label';
import { ProblemBanner } from './problem-banner';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './select';
import { toast } from './sonner';
import { Switch } from './switch';

/*
 * The one run page layout for Scheduled jobs, pipelines and syncs (docs/ai/ui-guidelines.md "States": failed work):
 * a header (the page's DetailHeader), the reason in plain words (`RunProblemBanner`), the counts (`RunCounts`), the
 * log (`RunLog`: level filter, follow, copy, download) in the main column, and the details and attempts
 * (`RunTimeline`) in the aside (`RunLayout`).
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/;

/**
 * Text a server stored as an i18n key with ICU values (task results, sync summaries), in the reader's language.
 * Anything that isn't a key in the catalogs is shown as is (results recorded before they were translated).
 */
export function useResultText() {
  const t = useTranslations();
  return React.useCallback(
    (key: string | null | undefined, params?: Record<string, string | number> | null): string => {
      if (!key) return '';
      if (!/^[a-z][\w-]*(\.[\w-]+)+$/i.test(key) || !t.has(key)) return key;
      const values = Object.fromEntries(
        Object.entries(params ?? {}).map(([k, v]) => [
          k,
          typeof v === 'string' && ISO_DATE.test(v) ? new Date(v) : v,
        ]),
      );
      try {
        return t(key, values);
      } catch {
        return key;
      }
    },
    [t],
  );
}

/** The problem of a failed run: the stored one, or one read from the raw error of an older run. */
export function problemOf(problem: RunProblem | null | undefined, error: string | null | undefined) {
  if (problem) return problem;
  return error ? runProblemFromText(error) : null;
}

/**
 * The problem behind a failed API call or a database answer (reading a connection's catalog, a Data API test):
 * an `ApiError`, or `{ kind, dbCode, message }` as a test result reports it.
 */
export function problemOfError(err: unknown, connection?: RunProblem['connection']): RunProblem | null {
  const e = err as {
    status?: number;
    code?: string;
    message?: string;
    details?: unknown;
    kind?: string;
  } | null;
  if (!e) return null;
  if (!e.code && typeof e.kind === 'string')
    return runProblemOf(new HttpError(422, 'DATABASE_ERROR', e.message ?? '', e), { connection });
  if (!e.code) return null;
  return runProblemOf(new HttpError(e.status ?? 422, e.code as ErrorCode, e.message ?? '', e.details), {
    connection,
  });
}

/** "The server of CRM (MySQL) couldn't be found" + what to do, in the reader's language. */
export function useRunProblemText() {
  const t = useTranslations('ui.runProblem');
  return React.useCallback(
    (p: RunProblem) => {
      const status = typeof p.params.status === 'number' ? p.params.status : Number(p.params.status ?? 0);
      const values = {
        ...p.params,
        connection: p.connection?.name ?? t('theConnection'),
        host: typeof p.params.host === 'string' && p.params.host ? p.params.host : t('theService'),
        expected: p.params.expected ?? '2xx',
        status,
        class: status >= 500 ? 'server' : 'client',
        seconds: Number(p.params.seconds ?? 0),
        code: p.params.code ?? '?',
      };
      return { title: t(`${p.kind}.title`, values), hint: t(`${p.kind}.hint`, values) };
    },
    [t],
  );
}

/** Where a person fixes the connection: its own page, or the database connection's sheet. */
function useConnectionLink(problem: RunProblem | null) {
  const canManage = useCan('core.databases.manage');
  const canRead = useCan('core.databases.read');
  const c = problem?.connection;
  if (!c) return null;
  if (c.href) return c.href;
  if (canManage) return `/admin/databases?edit=${encodeURIComponent(c.id)}`;
  if (canRead) return `/admin/databases?catalog=${encodeURIComponent(c.id)}`;
  return null;
}

/**
 * Why a run failed, once, in plain words with the next step: "Open connection" when a connection is to blame, plus
 * the page's own `actions` (Run again). While the run is retrying it reads as a warning: "Attempt 1 failed —
 * retrying at 8:30". The raw error stays behind "Technical details".
 */
export function RunProblemBanner({
  problem,
  error,
  retry,
  actions,
  live,
  title: headline,
  tone = 'destructive',
  className,
}: {
  problem: RunProblem | null | undefined;
  /** The raw error text (technical details). */
  error?: string | null;
  /** A headline of the page's own ("Couldn't read the tables of CRM"); the problem then explains it. */
  title?: React.ReactNode;
  tone?: 'destructive' | 'warning' | 'info';
  /** The run will try again: the failed attempt and when the next one starts. */
  retry?: { attempt: number; at: string | Date } | null;
  actions?: React.ReactNode;
  live?: boolean;
  className?: string;
}) {
  const t = useTranslations('ui.runProblem');
  const text = useRunProblemText();
  const format = useFormatter();
  const p = problemOf(problem, error);
  const href = useConnectionLink(p);
  if (!p) return null;
  const { title, hint } = text(p);
  const action =
    href || actions ? (
      <>
        {href && (
          <Button asChild size="sm" variant="outline">
            <Link href={href}>{t('openConnection')}</Link>
          </Button>
        )}
        {actions}
      </>
    ) : undefined;
  if (retry || headline)
    return (
      <ProblemBanner
        tone={retry ? 'warning' : tone}
        live={live}
        className={className}
        title={
          retry
            ? t('retrying', {
                attempt: retry.attempt,
                time: format.dateTime(new Date(retry.at), { hour: '2-digit', minute: '2-digit' }),
              })
            : headline
        }
        description={
          <>
            <span className="font-medium text-foreground">{title}</span> {hint}
          </>
        }
        action={action}
        details={error}
      />
    );
  return (
    <ProblemBanner
      tone={tone}
      live={live}
      className={className}
      title={title}
      description={hint}
      action={action}
      details={error}
    />
  );
}

/** Main column and aside of a run page (one column on a phone). */
export function RunLayout({
  children,
  aside,
  className,
}: {
  children: React.ReactNode;
  aside?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('grid min-w-0 grid-cols-1 items-start gap-6 lg:grid-cols-3', className)}>
      <div className="grid min-w-0 gap-6 lg:col-span-2">{children}</div>
      {aside && <div className="grid min-w-0 gap-6">{aside}</div>}
    </div>
  );
}

export interface RunCount {
  key: string;
  label: React.ReactNode;
  value: React.ReactNode;
  /** Problems (rejected rows, errors) in the destructive tone when not zero. */
  tone?: 'default' | 'destructive' | 'warning' | 'success';
}

const COUNT_TONE = {
  default: '',
  success: 'text-success',
  warning: 'text-warning-foreground',
  destructive: 'text-destructive',
} as const;

/** The run's counters (rows read/written, records created/updated, errors) in one row of small tiles. */
export function RunCounts({
  items,
  label,
  className,
}: {
  items: RunCount[];
  label: string;
  className?: string;
}) {
  return (
    <dl
      aria-label={label}
      className={cn('grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4', className)}
      aria-live="polite"
    >
      {items.map((c) => (
        <div key={c.key} className="min-w-0 rounded-xl border bg-card px-4 py-3 shadow-xs">
          <dt className="truncate text-xs text-muted-foreground">{c.label}</dt>
          <dd
            className={cn(
              'mt-1 truncate text-xl font-semibold tracking-tight tabular-nums',
              COUNT_TONE[c.tone ?? 'default'],
            )}
          >
            {c.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export interface RunStep {
  key: string;
  icon: React.ComponentType<{ className?: string }>;
  /** Text colour of the icon (`text-success`, `text-destructive`…). */
  tone?: string;
  title: React.ReactNode;
  at?: string | null;
  detail?: React.ReactNode;
}

/** Queued → attempts → finished, as a vertical timeline. */
export function RunTimeline({ steps, label }: { steps: RunStep[]; label: string }) {
  const format = useFormatter();
  return (
    <ol className="grid gap-0" aria-label={label}>
      {steps.map((s, i) => {
        const Icon = s.icon;
        return (
          <li key={s.key} className="relative grid grid-cols-[1.5rem_minmax(0,1fr)] gap-3 pb-4 last:pb-0">
            {i < steps.length - 1 && (
              <span className="absolute top-6 bottom-0 left-3 w-px -translate-x-1/2 bg-border" aria-hidden />
            )}
            <span
              className={cn(
                'grid size-6 place-items-center rounded-full border bg-card',
                s.tone ?? 'text-muted-foreground',
              )}
              aria-hidden
            >
              <Icon className="size-3.5" />
            </span>
            <div className="min-w-0 text-sm">
              <p className="font-medium">{s.title}</p>
              {s.at && (
                <p className="text-xs text-muted-foreground">
                  <time dateTime={s.at}>
                    {format.dateTime(new Date(s.at), { dateStyle: 'medium', timeStyle: 'medium' })}
                  </time>
                </p>
              )}
              {s.detail && <p className="text-xs text-muted-foreground">{s.detail}</p>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export interface RunLogLine {
  key: string | number;
  at: string;
  level: 'info' | 'warn' | 'error';
  message: string;
  /** Extra content after the message (a link to the record a line is about). */
  extra?: React.ReactNode;
}

const LEVEL = {
  info: { icon: InfoIcon, className: 'text-info' },
  warn: { icon: TriangleAlertIcon, className: 'text-warning-foreground' },
  error: { icon: CircleXIcon, className: 'text-destructive' },
} as const;

type LevelFilter = 'all' | 'problems' | 'errors';
const FILTERS: LevelFilter[] = ['all', 'problems', 'errors'];

/**
 * A run's log: level filter (all · warnings and errors · errors only), "Follow" while it's live, Copy and Download.
 * Lines are technical text (they stay in the language they were written in); the plain explanation is the
 * `RunProblemBanner` above it.
 */
export function RunLog({
  lines,
  live = false,
  fileName,
  title,
  className,
}: {
  lines: RunLogLine[];
  live?: boolean;
  fileName: string;
  title?: React.ReactNode;
  className?: string;
}) {
  const t = useTranslations('ui.runLog');
  const format = useFormatter();
  const id = React.useId();
  const [follow, setFollow] = React.useState(true);
  const [filter, setFilter] = React.useState<LevelFilter>('all');
  const box = React.useRef<HTMLDivElement>(null);
  const shown = React.useMemo(
    () =>
      filter === 'all'
        ? lines
        : lines.filter((l) => l.level === 'error' || (filter === 'problems' && l.level === 'warn')),
    [lines, filter],
  );
  const problems = React.useMemo(() => lines.filter((l) => l.level !== 'info').length, [lines]);

  React.useEffect(() => {
    const el = box.current;
    if (live && follow && el) el.scrollTop = el.scrollHeight;
  }, [shown, follow, live]);

  const asText = () =>
    lines
      .map((l) => `${new Date(l.at).toISOString()} ${l.level.toUpperCase().padEnd(5)} ${l.message}`)
      .join('\n');
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(asText());
      toast.success(t('copied'));
    } catch {
      toast.error(t('copyFailed'));
    }
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([`${asText()}\n`], { type: 'text/plain;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1_000);
  };

  return (
    <section
      aria-labelledby={`${id}-title`}
      className={cn('min-w-0 rounded-xl border bg-card shadow-xs', className)}
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <ScrollTextIcon className="size-4 shrink-0 text-primary" aria-hidden />
          <h2 id={`${id}-title`} className="font-semibold">
            {title ?? t('title')}
          </h2>
          <span className="text-xs text-muted-foreground" aria-live="polite">
            {live ? t('live', { count: lines.length }) : t('lines', { count: lines.length })}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {problems > 0 && (
            <Select value={filter} onValueChange={(v) => setFilter(v as LevelFilter)}>
              <SelectTrigger size="sm" className="w-auto" aria-label={t('filter')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FILTERS.map((f) => (
                  <SelectItem key={f} value={f}>
                    {t(`filters.${f}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {live && (
            <div className="flex items-center gap-2">
              <Switch id={`${id}-follow`} checked={follow} onCheckedChange={setFollow} />
              <Label htmlFor={`${id}-follow`} className="text-sm font-normal">
                {t('follow')}
              </Label>
            </div>
          )}
          <Button variant="outline" size="sm" onClick={() => void copy()} disabled={!lines.length}>
            <CopyIcon /> {t('copy')}
          </Button>
          <Button variant="outline" size="sm" onClick={download} disabled={!lines.length}>
            <DownloadIcon /> {t('download')}
          </Button>
        </div>
      </div>
      <div
        ref={box}
        role="log"
        aria-live="off"
        aria-labelledby={`${id}-title`}
        tabIndex={0}
        className="max-h-[32rem] min-h-32 overflow-auto bg-muted/30 py-2 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        {shown.length === 0 ? (
          <p className="px-4 py-6 text-center font-sans text-sm text-muted-foreground">
            {lines.length ? t('noMatch') : live ? t('waiting') : t('empty')}
          </p>
        ) : (
          <ol className="min-w-0">
            {shown.map((l) => {
              const meta = LEVEL[l.level];
              const Icon = meta.icon;
              return (
                <li
                  key={l.key}
                  className={cn(
                    'grid grid-cols-[auto_auto_minmax(0,1fr)] items-start gap-x-2 px-4 py-0.5 hover:bg-accent/40',
                    l.level === 'error' && 'bg-destructive/5',
                  )}
                >
                  <time dateTime={l.at} className="text-muted-foreground tabular-nums select-none">
                    {format.dateTime(new Date(l.at), {
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                    })}
                  </time>
                  <span
                    className={cn(
                      'inline-flex w-16 items-center gap-1 font-sans font-medium',
                      meta.className,
                    )}
                  >
                    <Icon className="size-3.5 shrink-0" aria-hidden />
                    {t(`levels.${l.level}`)}
                  </span>
                  <span className="whitespace-pre-wrap wrap-anywhere">
                    {l.message}
                    {l.extra}
                  </span>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </section>
  );
}
