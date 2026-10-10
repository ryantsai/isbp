'use client';

import type { AccessRequest, FileInfoDto, FormSubmission } from '@isbp/contracts';
import { localize } from '@isbp/sdk';
import { Button } from '@isbp/ui/button';
import { EmptyState } from '@isbp/ui/empty-state';
import { FormAnswers } from '@isbp/ui/form-renderer';
import { DateTime } from '@isbp/ui/relative-time';
import { Skeleton } from '@isbp/ui/skeleton';
import { ArrowLeftIcon, FileQuestionIcon, PrinterIcon } from 'lucide-react';
import Link from 'next/link';
import { useFormatter, useLocale, useNow, useTranslations } from 'next-intl';
import { type ReactNode, useId } from 'react';
import { useApiQuery } from '@/lib/api';
import { DecisionValues } from '../workflows/decision-values';
import { StatusBadge } from '../workflows/status-badges';
import { useResultText } from './request-actions';

type Lookup = { kind: 'access'; request: AccessRequest } | { kind: 'form'; submission: FormSubmission };

/** The record type of a request (attachments and links), as in the request's evidence panel. */
const REQUEST_RECORD_TYPE = 'core.request';

function Section({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="grid gap-3 break-inside-avoid-page">
      <h2 id={id} className="border-b pb-1 text-base font-semibold">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 break-words">{children}</dd>
    </div>
  );
}

/** "Printed on …" (next-intl's clock, so the server and the browser agree). */
function PrintedAt() {
  const t = useTranslations('requests.print');
  const now = useNow();
  return (
    <span>
      {t('printedAt')} <DateTime date={now} />
    </span>
  );
}

/**
 * A request laid out for paper or PDF (audit evidence): the form and its version, the requester and dates, every
 * answer (tables included), each approval decision with its approver, time, comment and the fields they filled in,
 * what the request set off, its reminders and its attachments. Always light; the toolbar is left off the print.
 */
export function RequestPrintView({ reference }: { reference: string }) {
  const t = useTranslations('requests.print');
  const td = useTranslations('requests.detail');
  const root = useTranslations();
  const locale = useLocale();
  const format = useFormatter();
  const resultText = useResultText();
  const { data, isLoading, error } = useApiQuery<Lookup>(`/requests/${encodeURIComponent(reference)}`);
  const submission = data?.kind === 'form' ? data.submission : null;
  const files = useApiQuery<{ files: FileInfoDto[] }>(
    submission ? `/records/${REQUEST_RECORD_TYPE}/${submission.id}/files` : null,
  );
  const back = `/requests/${encodeURIComponent(reference)}`;

  if (isLoading) return <Skeleton className="mx-auto mt-8 h-96 w-full max-w-4xl rounded-xl" />;
  if (error || !data || !submission)
    return (
      <main className="mx-auto max-w-4xl px-4 py-10">
        <EmptyState
          icon={<FileQuestionIcon />}
          title={data?.kind === 'access' ? t('formsOnly') : td('notFound')}
          action={
            <Button asChild variant="outline">
              <Link href={data ? back : '/requests'}>{t('back')}</Link>
            </Button>
          }
        />
      </main>
    );

  const s = submission;
  const formName = localize(s.form.name, locale);
  const decisions = s.decisions ?? [];
  const attachments = files.data?.files ?? [];
  const nameOfRun = (run: FormSubmission['actions'][number]) =>
    localize(run.name, locale) || (run.typeName && root.has(run.typeName) ? root(run.typeName) : run.type);

  return (
    <div className="mx-auto grid max-w-4xl gap-8 px-4 py-6 text-sm sm:px-8 print:max-w-none print:px-0 print:py-0">
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <Button asChild variant="ghost">
          <Link href={back}>
            <ArrowLeftIcon aria-hidden />
            {t('back')}
          </Link>
        </Button>
        <Button type="button" onClick={() => window.print()}>
          <PrinterIcon aria-hidden />
          {t('print')}
        </Button>
      </div>

      <header className="grid gap-1 border-b-2 border-foreground pb-3">
        <p className="text-xs text-muted-foreground">{root('common.appName')}</p>
        <h1 className="text-2xl font-semibold">{formName}</h1>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground">
          <span className="font-mono text-foreground">{s.reference}</span>
          <span>{t('version', { version: s.version })}</span>
          <StatusBadge status={s.status} />
        </p>
      </header>

      <main className="grid gap-8">
        <Section title={t('summary')}>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-3 print:grid-cols-3">
            <Fact label={t('requester')}>{s.submittedBy?.displayName ?? '—'}</Fact>
            <Fact label={t('submitted')}>
              <DateTime date={s.createdAt} />
            </Fact>
            <Fact label={t('completed')}>{s.completedAt ? <DateTime date={s.completedAt} /> : '—'}</Fact>
            <Fact label={t('form')}>
              {formName} <span className="font-mono text-xs text-muted-foreground">({s.form.key})</span>
            </Fact>
            <Fact label={t('formVersion')}>{s.version}</Fact>
            <Fact label={t('status')}>
              <StatusBadge status={s.status} />
            </Fact>
          </dl>
        </Section>

        <Section title={td('answers')}>
          <FormAnswers elements={s.schema.elements} data={s.data} people={s.people} />
        </Section>

        <Section title={t('decisions')}>
          {!s.workflow ? (
            <p className="text-muted-foreground">{td('noApproval')}</p>
          ) : !decisions.length ? (
            <p className="text-muted-foreground">{t('noDecisions')}</p>
          ) : (
            <ol className="grid gap-4">
              {decisions.map((d) => (
                <li key={d.taskId} className="grid min-w-0 gap-2 break-inside-avoid border-l-2 pl-3">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="font-medium">{localize(d.step, locale)}</span>
                    <StatusBadge status={d.status} kind="task" />
                  </div>
                  <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2 print:grid-cols-2">
                    <Fact label={t('approver')}>{d.decidedBy?.displayName ?? t('decidedAutomatically')}</Fact>
                    <Fact label={t('decidedAt')}>{d.decidedAt ? <DateTime date={d.decidedAt} /> : '—'}</Fact>
                    <div className="min-w-0 sm:col-span-2 print:col-span-2">
                      <dt className="text-xs font-medium text-muted-foreground">{t('comment')}</dt>
                      <dd
                        className={
                          d.comment
                            ? 'mt-0.5 break-words whitespace-pre-line'
                            : 'mt-0.5 text-muted-foreground'
                        }
                      >
                        {d.comment || t('noComment')}
                      </dd>
                    </div>
                  </dl>
                  {d.fields.length > 0 && Object.keys(d.data).length > 0 && (
                    <DecisionValues fields={d.fields} data={d.data} people={s.people} />
                  )}
                </li>
              ))}
            </ol>
          )}
          {s.workflow?.outcomeComment && (
            <p>
              <span className="font-medium">{t('outcomeComment')}</span> {s.workflow.outcomeComment}
            </p>
          )}
        </Section>

        {s.actions.length > 0 && (
          <Section title={t('actions')}>
            <table className="w-full border-collapse">
              <caption className="sr-only">{t('actions')}</caption>
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th scope="col" className="py-1.5 pr-3 font-medium">
                    {t('action')}
                  </th>
                  <th scope="col" className="py-1.5 pr-3 font-medium">
                    {t('status')}
                  </th>
                  <th scope="col" className="py-1.5 font-medium">
                    {t('result')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {s.actions.map((run) => (
                  <tr key={run.id} className="border-b align-top">
                    <td className="py-1.5 pr-3">
                      <span className="font-medium">{nameOfRun(run)}</span>
                      <span className="block text-xs text-muted-foreground">
                        {td(`actions.on.${run.on}`)}
                      </span>
                    </td>
                    <td className="py-1.5 pr-3">
                      {td(`actions.status.${run.status}`)}
                      {run.finishedAt && (
                        <span className="block text-xs text-muted-foreground">
                          <DateTime date={run.finishedAt} />
                        </span>
                      )}
                    </td>
                    <td className="py-1.5 break-words">
                      {[
                        run.result?.summary ? resultText(run.result.summary, run.result.summaryParams) : '',
                        run.result?.reference ?? '',
                        run.status === 'skipped' && run.reason ? td(`actions.reason.${run.reason}`) : '',
                      ]
                        .filter(Boolean)
                        .join(' · ') || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>
        )}

        {(s.reminders ?? []).length > 0 && (
          <Section title={td('reminders.title')}>
            <ul className="grid gap-1">
              {s.reminders.map((r) => (
                <li key={r.id} className="flex flex-wrap gap-x-2">
                  <span className="font-medium">{r.title || td('reminders.untitled')}</span>
                  <span className="text-muted-foreground">
                    {r.status === 'sent' && r.sentAt ? td('reminders.sentAt') : td('reminders.dueAt')}{' '}
                    <DateTime date={r.status === 'sent' && r.sentAt ? r.sentAt : r.dueAt} />
                  </span>
                  <span>· {td(`reminders.status.${r.status}`)}</span>
                </li>
              ))}
            </ul>
          </Section>
        )}

        <Section title={t('attachments')}>
          {files.isLoading ? (
            <Skeleton className="h-10 w-full" />
          ) : !attachments.length ? (
            <p className="text-muted-foreground">{t('noAttachments')}</p>
          ) : (
            <table className="w-full border-collapse">
              <caption className="sr-only">{t('attachments')}</caption>
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th scope="col" className="py-1.5 pr-3 font-medium">
                    {t('fileName')}
                  </th>
                  <th scope="col" className="py-1.5 pr-3 font-medium">
                    {t('fileSize')}
                  </th>
                  <th scope="col" className="py-1.5 font-medium">
                    {t('fileAdded')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {attachments.map((f) => (
                  <tr key={f.id} className="border-b align-top">
                    <td className="py-1.5 pr-3 break-all">{f.name}</td>
                    <td className="py-1.5 pr-3 whitespace-nowrap">
                      {t('kilobytes', { size: format.number(Math.max(1, Math.round(f.size / 1024))) })}
                    </td>
                    <td className="py-1.5">
                      <DateTime date={f.createdAt} />
                      {f.uploadedBy?.name && (
                        <span className="block text-xs text-muted-foreground">{f.uploadedBy.name}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>
      </main>

      <footer className="flex flex-wrap justify-between gap-2 border-t pt-2 text-xs text-muted-foreground">
        <span>
          {s.reference} · {formName}
        </span>
        <PrintedAt />
      </footer>
    </div>
  );
}
