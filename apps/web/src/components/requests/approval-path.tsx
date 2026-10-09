'use client';

import type { ApprovalPreview, PersonRef, RequestPath } from '@isbp/contracts';
import { localize, type LocalizedText } from '@isbp/sdk';
import { cn } from '@isbp/ui';
import { UserAvatar } from '@isbp/ui/avatar';
import { DateTime, RelativeTime } from '@isbp/ui/relative-time';
import { Skeleton } from '@isbp/ui/skeleton';
import {
  CircleCheckIcon,
  CircleDashedIcon,
  HourglassIcon,
  type LucideIcon,
  SkipForwardIcon,
  XCircleIcon,
} from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';

/** A step of the linear "Who will approve it" list, whichever source it came from. */
export type PathState = 'done' | 'rejected' | 'current' | 'upcoming' | 'skipped';

export interface PathStep {
  id: string;
  name: LocalizedText;
  state: PathState;
  people: PersonRef[];
  decidedAt?: string | Date | null;
  comment?: string | null;
  since?: string | Date | null;
  dueAt?: string | Date | null;
  /** upcoming, preview only: the answer (a field's label) this step's approver waits for. */
  dependsOn?: string | null;
  reason?: 'condition' | 'no-approver' | 'depends' | 'already-approved' | null;
  /** People whose approval of an earlier step counts here (not asked again), with the step it was given at. */
  alreadyApproved?: { person: PersonRef; approvedAt: LocalizedText }[];
}

const ICON: Record<PathState, LucideIcon> = {
  done: CircleCheckIcon,
  rejected: XCircleIcon,
  current: HourglassIcon,
  upcoming: CircleDashedIcon,
  skipped: SkipForwardIcon,
};

const TONE: Record<PathState, string> = {
  done: 'bg-success/12 text-success',
  rejected: 'bg-destructive/10 text-destructive',
  current: 'bg-info/12 text-info',
  upcoming: 'bg-muted text-muted-foreground',
  skipped: 'bg-muted text-muted-foreground',
};

/** The request's approval path (`GET /requests/:reference/path`), as steps for the list. */
export function pathSteps(path: RequestPath | undefined): PathStep[] {
  return (path?.steps ?? []).map((s) => ({
    id: s.id,
    name: s.name,
    state: s.state,
    people: s.people,
    decidedAt: s.decidedAt,
    comment: s.comment,
    since: s.since,
    dueAt: s.dueAt,
    reason: s.reason,
    alreadyApproved: s.alreadyApproved,
  }));
}

/**
 * The approval steps of a dry run ("Who will approve this?" while a form is being filled in). `waiting` maps the steps
 * whose approver comes from answers still empty to the label of the answer they depend on: those say so, instead of
 * implying that nobody could approve the request.
 */
export function previewSteps(
  preview: ApprovalPreview | undefined,
  waiting?: Map<string, string>,
): PathStep[] {
  return (preview?.steps ?? [])
    .filter((s) => s.type === 'approval')
    .map((s): PathStep => {
      if (s.outcome === 'skipped')
        return { id: s.id, name: s.name, state: 'skipped', people: [], reason: 'condition' };
      if (s.outcome === 'already-approved')
        return {
          id: s.id,
          name: s.name,
          state: 'done',
          people: [],
          reason: 'already-approved',
          alreadyApproved: s.counted,
        };
      if (s.outcome === 'ask')
        return { id: s.id, name: s.name, state: 'upcoming', people: s.people, alreadyApproved: s.counted };
      const field = waiting?.get(s.id);
      if (field)
        return { id: s.id, name: s.name, state: 'upcoming', people: [], reason: 'depends', dependsOn: field };
      return { id: s.id, name: s.name, state: 'upcoming', people: [], reason: 'no-approver' };
    });
}

/**
 * The linear list of approval steps: each step with its state written out ("Approved", "Waiting for approval",
 * "Up next", "Not needed") and the people involved. Used by the request page, the approval sheet and the forms'
 * "Who will approve this?" preview (`mode="preview"`: steps not started yet read "Approver", not "Up next").
 */
export function ApprovalPathList({
  steps,
  mode = 'path',
  className,
}: {
  steps: PathStep[];
  mode?: 'path' | 'preview';
  className?: string;
}) {
  const t = useTranslations('requests.path');
  const locale = useLocale();
  if (!steps.length) return <p className="text-sm text-muted-foreground">{t('none')}</p>;
  return (
    <ol className={cn('grid gap-5', className)}>
      {steps.map((s, i) => {
        const Icon = ICON[s.state];
        const last = i === steps.length - 1;
        const names = s.people.map((p) => p.displayName);
        const stateLabel =
          s.reason === 'already-approved'
            ? t('state.alreadyApproved')
            : mode === 'preview' && s.state === 'upcoming'
              ? t('state.preview')
              : t(`state.${s.state}`);
        return (
          <li key={s.id} data-step={s.id} data-state={s.state} className="relative flex min-w-0 gap-3">
            {!last && <span aria-hidden className="absolute top-8 -bottom-5 left-[15px] w-px bg-border" />}
            <span
              className={cn(
                'relative z-10 grid size-8 shrink-0 place-items-center rounded-full ring-4 ring-background [&_svg]:size-4',
                TONE[s.state],
              )}
            >
              <Icon aria-hidden />
            </span>
            <div className="grid min-w-0 flex-1 content-start gap-1 pt-1">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span
                  className={cn(
                    'text-sm font-medium [overflow-wrap:anywhere]',
                    (s.state === 'skipped' || s.state === 'upcoming') && 'text-foreground/80',
                  )}
                >
                  {localize(s.name, locale)}
                </span>
                <span className="text-xs font-medium text-muted-foreground">{stateLabel}</span>
              </div>
              <StepDetail step={s} names={names} />
              {s.reason !== 'already-approved' &&
                s.alreadyApproved?.map((a) => (
                  <p key={a.person.id} className="text-xs text-muted-foreground">
                    {t('alreadyApprovedBy', {
                      name: a.person.displayName,
                      step: localize(a.approvedAt, locale),
                    })}
                  </p>
                ))}
              {s.comment && (
                <blockquote className="mt-0.5 border-l-2 border-border pl-3 text-sm whitespace-pre-line text-foreground/80">
                  {s.comment}
                </blockquote>
              )}
              {s.people.length > 0 && (
                <ul className="mt-0.5 flex flex-wrap gap-1.5" aria-label={t('peopleLabel')}>
                  {s.people.slice(0, 4).map((p) => (
                    <li
                      key={p.id}
                      className="inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-full border py-0.5 pr-2.5 pl-0.5 text-xs"
                    >
                      <UserAvatar name={p.displayName} src={p.avatarUrl} className="size-5 text-[9px]" />
                      <span className="truncate">{p.displayName}</span>
                    </li>
                  ))}
                  {s.people.length > 4 && (
                    <li className="self-center text-xs text-muted-foreground">
                      {t('more', { count: s.people.length - 4 })}
                    </li>
                  )}
                </ul>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function StepDetail({ step, names }: { step: PathStep; names: string[] }) {
  const t = useTranslations('requests.path');
  const locale = useLocale();
  // The builder's wording for "the approver comes from an answer not given yet" (the same key, so both match).
  const tBuilder = useTranslations('forms.preview');
  const sep = t('separator');
  const who = names.length > 1 ? names.join(sep) : names[0];
  switch (step.state) {
    case 'done':
      if (step.reason === 'already-approved')
        return (
          <p className="text-xs text-muted-foreground">
            {t('alreadyApproved', {
              step: localize(step.alreadyApproved?.[0]?.approvedAt ?? { en: '' }, locale),
            })}
          </p>
        );
      return (
        <p className="text-xs text-muted-foreground">
          {t('doneBy', { names: who ?? '' })}
          {step.decidedAt && (
            <>
              {' · '}
              <RelativeTime date={step.decidedAt} />
            </>
          )}
        </p>
      );
    case 'rejected':
      return (
        <p className="text-xs text-muted-foreground">
          {t('rejectedBy', { names: who ?? '' })}
          {step.decidedAt && (
            <>
              {' · '}
              <RelativeTime date={step.decidedAt} />
            </>
          )}
        </p>
      );
    case 'current':
      return (
        <p className="text-xs text-muted-foreground">
          {t('waitingFor', { names: who ?? '' })}
          {step.since && (
            <>
              {' · '}
              <RelativeTime date={step.since} />
            </>
          )}
          {step.dueAt && (
            <>
              {' · '}
              {t('due')} <DateTime date={step.dueAt} />
            </>
          )}
        </p>
      );
    case 'upcoming':
      if (step.reason === 'depends')
        return (
          <p className="text-xs text-muted-foreground">
            {tBuilder('dependsOn', { field: step.dependsOn ?? '' })}
          </p>
        );
      if (step.reason === 'no-approver')
        return <p className="text-xs text-muted-foreground">{t('noApprover')}</p>;
      return names.length ? (
        <p className="text-xs text-muted-foreground">{t('then', { names: who ?? '' })}</p>
      ) : (
        <p className="text-xs text-muted-foreground">{t('afterAbove')}</p>
      );
    case 'skipped':
      return (
        <p className="text-xs text-muted-foreground">
          {step.reason === 'condition' ? t('skippedCondition') : t('skipped')}
        </p>
      );
  }
}

/** A skeleton while the path loads (same height as a two-step path). */
export function ApprovalPathSkeleton() {
  return (
    <div className="grid gap-5">
      <Skeleton className="h-14 w-full rounded-lg" />
      <Skeleton className="h-14 w-full rounded-lg" />
    </div>
  );
}
