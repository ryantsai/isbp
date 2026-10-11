'use client';

import type { FormAssignment, FormAssignmentState } from '@isbp/contracts';
import { localize } from '@isbp/sdk';
import {
  BanIcon,
  ChevronRightIcon,
  CircleCheckIcon,
  CircleDotIcon,
  ClockAlertIcon,
  ClockIcon,
  type LucideIcon,
  TriangleAlertIcon,
  UsersRoundIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { StatusBadge, type StatusTone } from '@isbp/ui/status';
import { NavIcon } from '../nav-icon';

/** "Due soon" starts this long before the due date (the reminders start then too). */
export const DUE_SOON_MS = 2 * 24 * 3_600_000;

const STATES: Record<FormAssignmentState, { variant: StatusTone; icon: LucideIcon }> = {
  open: { variant: 'info', icon: CircleDotIcon },
  overdue: { variant: 'destructive', icon: TriangleAlertIcon },
  done: { variant: 'success', icon: CircleCheckIcon },
  late: { variant: 'warning', icon: ClockAlertIcon },
  cancelled: { variant: 'muted', icon: BanIcon },
};

/** The icon of each state (also used in the state filter). */
export const ASSIGNMENT_STATE_ICONS: Record<FormAssignmentState, LucideIcon> = {
  open: STATES.open.icon,
  overdue: STATES.overdue.icon,
  done: STATES.done.icon,
  late: STATES.late.icon,
  cancelled: STATES.cancelled.icon,
};

export function AssignmentStateBadge({ state }: { state: FormAssignmentState }) {
  const t = useTranslations('assignments.state');
  const s = STATES[state] ?? STATES.open;
  return <StatusBadge tone={s.variant} icon={s.icon} label={t(state)} />;
}

/** A short date ("31 Oct"), with the year when it isn't this year's. */
export function useShortDate() {
  const format = useFormatter();
  return (date: string | Date, now: Date) => {
    const d = typeof date === 'string' ? new Date(date) : date;
    return format.dateTime(d, {
      month: 'short',
      day: 'numeric',
      ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}),
    });
  };
}

/** The due date of an open to-do: overdue, due soon (within two days) or just the date — with an icon, not only a colour. */
export function AssignmentDueBadge({ dueAt, now }: { dueAt: string; now: Date }) {
  const t = useTranslations('assignments.due');
  const short = useShortDate();
  const format = useFormatter();
  const due = new Date(dueAt);
  const ms = due.getTime() - now.getTime();
  const date = short(due, now);
  const kind = ms < 0 ? 'overdue' : ms < DUE_SOON_MS ? 'soon' : 'due';
  return (
    <StatusBadge
      tone={kind === 'overdue' ? 'destructive' : kind === 'soon' ? 'warning' : 'muted'}
      icon={kind === 'overdue' ? TriangleAlertIcon : ClockIcon}
      label={t(kind, { date })}
      title={format.dateTime(due, { dateStyle: 'medium', timeStyle: 'short' })}
    />
  );
}

/** One open to-do: the form's icon, the title, the form (and group), the due badge; opens the form. */
export function TodoRow({ a, now, compact }: { a: FormAssignment; now: Date; compact?: boolean }) {
  const t = useTranslations('assignments');
  const locale = useLocale();
  const group = a.assignee?.type === 'group' ? a.assignee.group.name : null;
  return (
    <li>
      <Link
        href={a.href}
        className={
          compact
            ? 'flex items-center gap-3 py-2.5 text-sm outline-none hover:underline focus-visible:underline'
            : 'group flex items-center gap-3 px-4 py-3 outline-none transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 motion-reduce:transition-none'
        }
      >
        {!compact && (
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary [&_svg]:size-4">
            <NavIcon name={a.form.icon} />
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium group-hover:underline">{a.title}</span>
          {!compact && (
            <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
              <span className="truncate">{localize(a.form.name, locale)}</span>
              {group && (
                <>
                  <span aria-hidden>·</span>
                  <span className="inline-flex items-center gap-1">
                    <UsersRoundIcon className="size-3" aria-hidden />
                    {t('forGroup', { group })}
                  </span>
                </>
              )}
            </span>
          )}
        </span>
        <AssignmentDueBadge dueAt={a.dueAt} now={now} />
        {!compact && <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />}
      </Link>
    </li>
  );
}
