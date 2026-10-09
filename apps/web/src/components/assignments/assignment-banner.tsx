'use client';

import type { FormAssignment } from '@isbp/contracts';
import {
  BanIcon,
  CircleCheckIcon,
  ClipboardCheckIcon,
  TriangleAlertIcon,
  UsersRoundIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useNow, useTranslations } from 'next-intl';
import { useId } from 'react';
import { AssignmentDueBadge, useShortDate } from './assignment-badges';

/**
 * The to-do a form is being filled in for, above the form: its title, when it is due (once), who may fill it in, and
 * that sending the form completes it. Or why it can't be (done, cancelled, not yours).
 */
export function AssignmentBanner({
  assignment,
  notFound,
}: {
  assignment: FormAssignment | undefined;
  notFound: boolean;
}) {
  const t = useTranslations('assignments.banner');
  const now = useNow({ updateInterval: 60_000 });
  const short = useShortDate();
  const uid = useId();
  if (notFound)
    return (
      <p
        role="status"
        className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2.5 text-sm text-warning-foreground"
      >
        <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
        {t('notYours')}
      </p>
    );
  if (!assignment) return null;
  if (assignment.status === 'done') {
    const reference = assignment.submission?.reference ?? '';
    const by = assignment.submission?.submittedBy?.displayName;
    return (
      <p
        role="status"
        className="flex items-start gap-2 rounded-lg border border-success/30 bg-success/10 px-3 py-2.5 text-sm text-success"
      >
        <CircleCheckIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>
          {by ? t('doneBy', { name: by }) : t('done')}{' '}
          {reference && (
            <Link href={`/requests/${reference}`} className="font-medium underline-offset-2 hover:underline">
              {reference}
            </Link>
          )}
        </span>
      </p>
    );
  }
  if (assignment.status === 'cancelled')
    return (
      <p role="status" className="flex items-start gap-2 rounded-lg border bg-muted px-3 py-2.5 text-sm">
        <BanIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
        {t('cancelled')}
      </p>
    );
  const group = assignment.assignee?.type === 'group' ? assignment.assignee.group.name : null;
  return (
    <section
      aria-labelledby={uid}
      className="grid gap-2 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3 text-sm"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold tracking-wide text-primary uppercase">
          <ClipboardCheckIcon className="size-4" aria-hidden />
          {t('label')}
        </span>
        <AssignmentDueBadge dueAt={assignment.dueAt} now={now} />
      </div>
      <h2 id={uid} className="text-base font-semibold [overflow-wrap:anywhere]">
        {assignment.title}
      </h2>
      <p className="text-muted-foreground">
        <time dateTime={assignment.dueAt}>{t('due', { date: short(assignment.dueAt, now) })}</time>
        {assignment.createdBy && <> · {t('assignedBy', { name: assignment.createdBy.displayName })}</>}
      </p>
      {assignment.note && <p className="whitespace-pre-line [overflow-wrap:anywhere]">{assignment.note}</p>}
      {group && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <UsersRoundIcon className="size-3.5" aria-hidden />
          {t('group', { group })}
        </p>
      )}
      <p className="font-medium">{t('willComplete')}</p>
    </section>
  );
}
