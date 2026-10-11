'use client';

import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { Divider } from '@astryxdesign/core/Divider';
import { Icon } from '@astryxdesign/core/Icon';
import { HStack } from '@astryxdesign/core/Layout';
import { Selector } from '@astryxdesign/core/Selector';
import { Switch } from '@astryxdesign/core/Switch';
import { Heading, Text } from '@astryxdesign/core/Text';
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
import { useFormatter, useTranslations } from 'next-intl';
import * as React from 'react';
import { cn } from '../lib/utils';
import { IconTile } from './icon-tile';
import { ProblemBanner } from './problem-banner';
import {
  Timeline,
  TimelineContent,
  TimelineDate,
  TimelineHeader,
  TimelineIndicator,
  TimelineItem,
  TimelineSeparator,
  TimelineTitle,
} from './timeline';
import { toast } from './toast';

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
        {href && <Button label={t('openConnection')} variant="secondary" size="sm" href={href} />}
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
            <Text weight="medium">{title}</Text> {hint}
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
  success: 'text-(--color-text-green)',
  warning: 'text-(--color-text-yellow)',
  destructive: 'text-(--color-text-red)',
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
        <Card key={c.key} padding={3} className="min-w-0">
          <dt>
            <Text type="supporting" maxLines={1}>
              {c.label}
            </Text>
          </dt>
          <dd>
            <Text
              size="xl"
              weight="semibold"
              hasTabularNumbers
              maxLines={1}
              className={COUNT_TONE[c.tone ?? 'default']}
            >
              {c.value}
            </Text>
          </dd>
        </Card>
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
    <Timeline aria-label={label}>
      {steps.map((s) => {
        const StepIcon = s.icon;
        return (
          <TimelineItem key={s.key}>
            <TimelineHeader>
              <TimelineSeparator />
              <TimelineIndicator asChild>
                <IconTile size="xs" className={s.tone ?? 'text-muted-foreground'}>
                  <StepIcon />
                </IconTile>
              </TimelineIndicator>
              <TimelineTitle>{s.title}</TimelineTitle>
            </TimelineHeader>
            <TimelineContent>
              {s.at && (
                <TimelineDate asChild>
                  <time dateTime={s.at}>
                    {format.dateTime(new Date(s.at), { dateStyle: 'medium', timeStyle: 'medium' })}
                  </time>
                </TimelineDate>
              )}
              {s.detail && <div>{s.detail}</div>}
            </TimelineContent>
          </TimelineItem>
        );
      })}
    </Timeline>
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
  info: { icon: InfoIcon, className: 'text-(--color-text-blue)' },
  warn: { icon: TriangleAlertIcon, className: 'text-(--color-text-yellow)' },
  error: { icon: CircleXIcon, className: 'text-(--color-text-red)' },
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
    <Card padding={0} role="region" aria-labelledby={`${id}-title`} className={cn('min-w-0', className)}>
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <HStack gap={2} vAlign="center" className="min-w-0">
          <Icon icon={ScrollTextIcon} />
          <Heading level={2} id={`${id}-title`}>
            {title ?? t('title')}
          </Heading>
          <Text type="supporting" aria-live="polite">
            {live ? t('live', { count: lines.length }) : t('lines', { count: lines.length })}
          </Text>
        </HStack>
        <HStack gap={3} wrap="wrap" vAlign="center">
          {problems > 0 && (
            <Selector
              label={t('filter')}
              isLabelHidden
              size="sm"
              options={FILTERS.map((f) => ({ value: f, label: t(`filters.${f}`) }))}
              value={filter}
              onChange={(v) => setFilter(v as LevelFilter)}
            />
          )}
          {live && <Switch label={t('follow')} size="sm" value={follow} onChange={setFollow} />}
          <Button
            label={t('copy')}
            variant="secondary"
            size="sm"
            icon={<Icon icon={CopyIcon} />}
            isDisabled={!lines.length}
            onClick={() => void copy()}
          />
          <Button
            label={t('download')}
            variant="secondary"
            size="sm"
            icon={<Icon icon={DownloadIcon} />}
            isDisabled={!lines.length}
            onClick={download}
          />
        </HStack>
      </div>
      <Divider />
      <div
        ref={box}
        role="log"
        aria-live="off"
        aria-labelledby={`${id}-title`}
        tabIndex={0}
        className="max-h-[32rem] min-h-32 overflow-auto bg-(--color-background-muted) py-2"
      >
        {shown.length === 0 ? (
          <div className="px-4 py-6 text-center">
            <Text color="secondary">{lines.length ? t('noMatch') : live ? t('waiting') : t('empty')}</Text>
          </div>
        ) : (
          <ol className="min-w-0">
            {shown.map((l) => {
              const meta = LEVEL[l.level];
              return (
                <li
                  key={l.key}
                  className={cn(
                    'grid grid-cols-[auto_auto_minmax(0,1fr)] items-start gap-x-2 px-4 py-0.5',
                    l.level === 'error' && 'bg-(--color-background-red)',
                  )}
                >
                  <Text type="code" size="sm" color="secondary" hasTabularNumbers className="select-none">
                    <time dateTime={l.at}>
                      {format.dateTime(new Date(l.at), {
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                      })}
                    </time>
                  </Text>
                  <span className={cn('inline-flex w-20 items-center gap-1', meta.className)}>
                    <Icon icon={meta.icon} />
                    <Text type="supporting" size="sm" weight="medium" color="inherit">
                      {t(`levels.${l.level}`)}
                    </Text>
                  </span>
                  <Text type="code" size="sm" className="whitespace-pre-wrap wrap-anywhere">
                    {l.message}
                    {l.extra}
                  </Text>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </Card>
  );
}
