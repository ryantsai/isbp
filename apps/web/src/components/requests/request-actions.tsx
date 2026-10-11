'use client';

import type { FormSubmission, ProcessActionRun, RequestReminder } from '@isbp/contracts';
import { localize } from '@isbp/sdk';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@isbp/ui/card';
import { DateTime, RelativeTime } from '@isbp/ui/relative-time';
import { StatusBadge, type StatusIcon, type StatusTone } from '@isbp/ui/status';
import {
  AlarmClockIcon,
  ArrowRightIcon,
  BellOffIcon,
  BellRingIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  CircleMinusIcon,
  CircleXIcon,
  LoaderCircleIcon,
  RotateCcwIcon,
} from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback } from 'react';
import { useApiMutation } from '@/lib/api';
import { NavIcon } from '../nav-icon';
import { Button } from '@astryxdesign/core/Button';
import { Icon } from '@astryxdesign/core/Icon';

type Status = ProcessActionRun['status'];

/** Each status once: tone, icon and label (status is never colour only). */
const SpinningLoader: StatusIcon = (props) => (
  <LoaderCircleIcon {...props} className="motion-safe:animate-spin" />
);

const STATUS: Record<Status, { tone: StatusTone; icon: StatusIcon }> = {
  queued: { tone: 'muted', icon: CircleDashedIcon },
  running: { tone: 'info', icon: SpinningLoader },
  succeeded: { tone: 'success', icon: CircleCheckIcon },
  failed: { tone: 'destructive', icon: CircleXIcon },
  skipped: { tone: 'muted', icon: CircleMinusIcon },
};

function RetryButton({
  submissionId,
  run,
  name,
}: {
  submissionId: string;
  run: ProcessActionRun;
  name: string;
}) {
  const t = useTranslations('requests.detail.actions');
  const retry = useApiMutation(
    (api) => api.post(`/form-submissions/${submissionId}/actions/${run.id}/retry`, {}),
    { invalidate: ['/requests', '/form-submissions'], success: t('retried', { name }) },
  );
  return (
    <Button
      label={t('retry')}
      aria-label={t('retryNamed', { name })}
      variant="secondary"
      size="sm"
      icon={<Icon icon={RotateCcwIcon} />}
      isLoading={retry.isPending}
      type="button"
      onClick={() => retry.mutate(undefined)}
    />
  );
}

/** ISO dates and date-times in a result's summary arguments become dates (`{date, date, long}`). */
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?$/;

/**
 * The text of an action's result: an i18n key (with its arguments, dates formatted in the reader's zone) or short
 * plain text.
 */
export function useResultText() {
  const root = useTranslations();
  return useCallback(
    (key: string | null | undefined, params?: Record<string, string | number> | null) => {
      if (!key) return '';
      if (!root.has(key)) return key;
      const values = Object.fromEntries(
        Object.entries(params ?? {}).map(([k, v]) => [
          k,
          typeof v === 'string' && ISO_DATE_RE.test(v) ? new Date(v) : v,
        ]),
      );
      try {
        return root(key, values);
      } catch {
        return root(key);
      }
    },
    [root],
  );
}

/**
 * "What happens next": the process actions the request set off (the form version's actions), with their status,
 * what they made (a link to the change, the ticket, the run) and, for form administrators, the error and Retry.
 */
export function RequestActions({ submission }: { submission: FormSubmission }) {
  const t = useTranslations('requests.detail.actions');
  const root = useTranslations();
  const locale = useLocale();
  const resultText = useResultText();
  const runs = submission.actions;
  if (!runs.length) return null;
  const text = (key: string | null | undefined) => (key ? (root.has(key) ? root(key) : key) : '');
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base" role="heading" aria-level={2}>
          {t('title')}
        </CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent>
        <ol className="grid gap-3">
          {runs.map((run) => {
            const name = localize(run.name, locale) || text(run.typeName) || run.type;
            const status = STATUS[run.status];
            const retrying = run.status === 'queued' && run.attempts > 0;
            return (
              <li key={run.id} className="grid gap-2 rounded-lg border p-3">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary [&_svg]:size-4">
                    <NavIcon name={run.icon ?? undefined} />
                  </span>
                  <span className="grid min-w-0 flex-1 gap-0.5">
                    <span className="font-medium break-words">{name}</span>
                    <span className="text-xs text-muted-foreground">
                      {t(`on.${run.on}`)}
                      {run.finishedAt && (
                        <>
                          {' · '}
                          <RelativeTime date={run.finishedAt} />
                        </>
                      )}
                    </span>
                  </span>
                  <StatusBadge
                    tone={status.tone}
                    icon={status.icon}
                    label={
                      retrying ? t('retrying', { attempt: run.attempts + 1 }) : t(`status.${run.status}`)
                    }
                  />
                </div>
                {(run.result?.summary || run.result?.href || run.result?.reference) && (
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    {run.result?.summary && (
                      <span className="text-muted-foreground">
                        {resultText(run.result.summary, run.result.summaryParams)}
                      </span>
                    )}
                    {run.result?.href ? (
                      <Button
                        label={t('open', { reference: run.result.reference ?? name })}
                        variant="secondary"
                        size="sm"
                        endContent={<Icon icon={ArrowRightIcon} />}
                        href={run.result.href}
                      />
                    ) : (
                      run.result?.reference && <span className="font-medium">{run.result.reference}</span>
                    )}
                  </div>
                )}
                {run.status === 'skipped' && run.reason && (
                  <p className="text-sm text-muted-foreground">{t(`reason.${run.reason}`)}</p>
                )}
                {run.error && (
                  <div className="grid gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm">
                    <p className="break-words">
                      <span className="font-medium text-destructive">{t('error')}</span>{' '}
                      {run.error.code && <code className="font-mono text-xs">{run.error.code}</code>}{' '}
                      {run.error.message}
                    </p>
                  </div>
                )}
                {run.canRetry && (
                  <div>
                    <RetryButton submissionId={submission.id} run={run} name={name} />
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      </CardContent>
    </Card>
  );
}

const REMINDER_STATUS: Record<RequestReminder['status'], { tone: StatusTone; icon: StatusIcon }> = {
  pending: { tone: 'info', icon: AlarmClockIcon },
  sent: { tone: 'success', icon: BellRingIcon },
  cancelled: { tone: 'muted', icon: BellOffIcon },
};

/**
 * Reminders the request's actions scheduled (`core.remind`): when each goes out (or went out), and whether it was
 * cancelled with the request.
 */
export function RequestReminders({ submission }: { submission: FormSubmission }) {
  const t = useTranslations('requests.detail.reminders');
  const reminders = submission.reminders ?? [];
  if (!reminders.length) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base" role="heading" aria-level={2}>
          {t('title')}
        </CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="grid gap-2">
          {reminders.map((r) => {
            const status = REMINDER_STATUS[r.status];
            return (
              <li
                key={r.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border px-3 py-2"
              >
                <span className="min-w-0 flex-1 font-medium break-words">{r.title || t('untitled')}</span>
                <span className="text-sm text-muted-foreground">
                  {r.status === 'sent' && r.sentAt ? (
                    <>
                      {t('sentAt')} <DateTime date={r.sentAt} />
                    </>
                  ) : (
                    <>
                      {t('dueAt')} <DateTime date={r.dueAt} />
                    </>
                  )}
                </span>
                <StatusBadge tone={status.tone} icon={status.icon} label={t(`status.${r.status}`)} />
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
