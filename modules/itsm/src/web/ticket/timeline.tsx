'use client';

import { cn } from '@isbp/ui';
import { UserAvatar } from '@isbp/ui/avatar';
import { Badge } from '@isbp/ui/badge';
import { Markdown } from '@isbp/ui/markdown';
import { usePeople } from '@isbp/ui/person-picker';
import { useApiQuery } from '@isbp/ui/query';
import { RelativeTime } from '@isbp/ui/relative-time';
import { Skeleton } from '@isbp/ui/skeleton';
import {
  AlarmClockOffIcon,
  ArrowRightLeftIcon,
  BotIcon,
  CirclePlusIcon,
  ClockAlertIcon,
  GavelIcon,
  InfoIcon,
  LinkIcon,
  LockIcon,
  type LucideIcon,
  PencilIcon,
  RotateCcwIcon,
  SparklesIcon,
  UserRoundCogIcon,
} from 'lucide-react';
import { motion } from 'motion/react';
import { useTranslations } from 'next-intl';
import { type ReactNode, useMemo } from 'react';
import type { Page } from '@isbp/sdk';
import type { Activity, TicketDetail, TicketStatus } from '../../contracts';
import { statusIcon } from '../components/badges';
import { ticketApi, useGroups } from '../lib';

/* ───────────────────────────── data ───────────────────────────── */

/** The latest timeline entries (up to 200), oldest first. */
export function useActivities(ref: string) {
  const q = useApiQuery<Page<Activity>>(`${ticketApi(ref)}/activities`, {
    order: 'desc',
    pageSize: 200,
  });
  const items = useMemo(() => [...(q.data?.items ?? [])].reverse(), [q.data]);
  return { items, total: q.data?.total ?? 0, isLoading: q.isLoading, error: q.error, refetch: q.refetch };
}

/* ───────────────────────────── tolerant readers for `data` ───────────────────────────── */

type Data = Record<string, unknown>;

const isObj = (v: unknown): v is Data => typeof v === 'object' && v !== null && !Array.isArray(v);

/** A display name from a string, a person/group ref or a `{ reference }`. */
function nameOf(v: unknown): string | null {
  if (typeof v === 'string') return v || null;
  if (typeof v === 'number') return String(v);
  if (isObj(v)) {
    for (const k of ['displayName', 'name', 'reference', 'title', 'key'] as const)
      if (typeof v[k] === 'string' && v[k]) return v[k] as string;
  }
  return null;
}

/** Field names from `{ changes }` as an array of names, an array of `{ field }` or a record. */
function changedFields(data: Data): string[] {
  const c = data.changes ?? data.fields;
  if (Array.isArray(c))
    return c
      .map((x) => (typeof x === 'string' ? x : isObj(x) ? (nameOf(x.field) ?? nameOf(x.key)) : null))
      .filter((x): x is string => Boolean(x));
  if (isObj(c)) return Object.keys(c);
  return [];
}

/* ───────────────────────────── rendering ───────────────────────────── */

function SystemLine({
  icon: Icon,
  tone,
  children,
  activity,
  note,
}: {
  icon: LucideIcon;
  tone?: 'destructive' | 'warning' | 'ai';
  children: ReactNode;
  activity: Activity;
  note?: ReactNode;
}) {
  return (
    <div className="flex gap-3 py-1 text-sm">
      <span
        className={cn(
          'mt-0.5 grid size-6 shrink-0 place-items-center rounded-full border bg-background text-muted-foreground',
          tone === 'destructive' &&
            'border-destructive/30 bg-destructive/10 text-destructive dark:bg-destructive/20',
          tone === 'warning' && 'border-warning/40 bg-warning/15 text-warning-foreground',
          tone === 'ai' && 'border-primary/30 bg-primary/10 text-primary',
        )}
        aria-hidden
      >
        <Icon className="size-3.5" />
      </span>
      <div className="min-w-0 flex-1 pt-0.5">
        <p className="text-muted-foreground">
          {children}
          <span aria-hidden> · </span>
          <RelativeTime date={activity.createdAt} className="text-xs" />
        </p>
        {note}
      </div>
    </div>
  );
}

function Bubble({ activity, end, label }: { activity: Activity; end: boolean; label?: ReactNode }) {
  const t = useTranslations('itsm.timeline');
  const author = activity.author;
  const name = author?.displayName ?? t('system');
  return (
    <div className={cn('flex gap-3', end && 'flex-row-reverse')}>
      {author?.ai ? (
        <span
          className="grid size-8 shrink-0 place-items-center rounded-full bg-primary/10 text-primary"
          aria-hidden
        >
          <BotIcon className="size-4" />
        </span>
      ) : (
        <UserAvatar name={name} src={author?.avatarUrl} className="size-8 text-[11px]" />
      )}
      <div className={cn('flex max-w-[min(42rem,85%)] min-w-0 flex-col gap-1', end && 'items-end')}>
        <div className={cn('flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs', end && 'justify-end')}>
          <span className="font-medium">{name}</span>
          {label}
          <RelativeTime date={activity.createdAt} className="text-muted-foreground" />
        </div>
        <div
          className={cn(
            'rounded-2xl border px-3.5 py-2.5',
            end ? 'rounded-tr-sm border-primary/20 bg-primary/8' : 'rounded-tl-sm bg-muted/60',
          )}
        >
          <Markdown>{activity.body ?? ''}</Markdown>
        </div>
      </div>
    </div>
  );
}

function WorkNote({ activity }: { activity: Activity }) {
  const t = useTranslations('itsm.timeline');
  const name = activity.author?.displayName ?? t('system');
  return (
    <div className="flex gap-3">
      {activity.author?.ai ? (
        <span
          className="grid size-8 shrink-0 place-items-center rounded-full bg-primary/10 text-primary"
          aria-hidden
        >
          <BotIcon className="size-4" />
        </span>
      ) : (
        <UserAvatar name={name} src={activity.author?.avatarUrl} className="size-8 text-[11px]" />
      )}
      <div className="min-w-0 flex-1 rounded-xl border border-warning/40 bg-warning/10 px-3.5 py-2.5">
        <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
          <span className="font-medium">{name}</span>
          <Badge variant="warning" className="gap-1">
            <LockIcon aria-hidden />
            {t('internal')}
          </Badge>
          <RelativeTime date={activity.createdAt} className="text-muted-foreground" />
        </div>
        <Markdown>{activity.body ?? ''}</Markdown>
      </div>
    </div>
  );
}

function Quote({ children }: { children: string | null | undefined }) {
  if (!children) return null;
  return (
    <div className="mt-1.5 rounded-lg border-l-2 bg-muted/40 px-3 py-1.5 text-foreground">
      <Markdown>{children}</Markdown>
    </div>
  );
}

/** Resolves the ids that assignment entries carry (`{ groupId, assigneeId }`) to names. */
export interface NameResolver {
  person: (id: string) => string | null;
  group: (id: string) => string | null;
}

/** One timeline entry, rendered by kind. `end` puts the bubble on the right. */
export function ActivityItem({
  activity: a,
  end,
  names,
}: {
  activity: Activity;
  end: boolean;
  names?: NameResolver;
}) {
  const t = useTranslations('itsm');
  const tl = useTranslations('itsm.timeline');
  const data = (a.data ?? {}) as Data;
  const who = a.author?.displayName ?? tl('system');
  const statusText = (v: unknown) => {
    const s = typeof v === 'string' ? v : null;
    return s && t.has(`status.${s}`) ? t(`status.${s}`) : (s ?? '—');
  };
  const fieldText = (list: string[]) =>
    [...new Set(list.map((f) => (tl.has(`fields.${f}`) ? tl(`fields.${f}`) : f)))].join(', ');

  switch (a.kind) {
    case 'comment':
      return (
        <Bubble
          activity={a}
          end={end}
          label={
            data.reopen === true ? (
              <Badge variant="warning" className="gap-1">
                <RotateCcwIcon aria-hidden />
                {tl('reopened')}
              </Badge>
            ) : undefined
          }
        />
      );
    case 'work_note':
      return <WorkNote activity={a} />;
    case 'status': {
      const to = typeof data.to === 'string' ? (data.to as TicketStatus) : null;
      const code =
        typeof data.resolutionCode === 'string' && t.has(`resolution.${data.resolutionCode}`)
          ? t(`resolution.${data.resolutionCode}`)
          : null;
      const rating = typeof data.rating === 'number' ? data.rating : null;
      return (
        <SystemLine
          icon={to ? statusIcon(to) : ArrowRightLeftIcon}
          activity={a}
          note={
            <>
              {(code || rating) && (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {[code, rating ? tl('rated', { rating }) : null].filter(Boolean).join(' · ')}
                </p>
              )}
              <Quote>{a.body}</Quote>
            </>
          }
        >
          {data.confirmed === true
            ? tl('confirmed', { name: who })
            : data.reopened === true
              ? tl('reopenedStatus', { name: who })
              : data.auto === true
                ? tl('autoClosed')
                : data.from
                  ? tl('status', { name: who, from: statusText(data.from), to: statusText(data.to) })
                  : tl('statusSet', { name: who, to: statusText(data.to) })}
        </SystemLine>
      );
    }
    case 'assignment': {
      const to = isObj(data.to) ? data.to : data;
      const assigneeId = typeof to.assigneeId === 'string' ? to.assigneeId : null;
      const groupId = typeof to.groupId === 'string' ? to.groupId : null;
      const plain = typeof data.to === 'string' ? data.to : null;
      const resolvedPerson = assigneeId && names ? names.person(assigneeId) : null;
      const resolvedGroup = groupId && names ? names.group(groupId) : null;
      const assignee = nameOf(to.assignee) || resolvedPerson || plain;
      const group = nameOf(to.group ?? to.assignmentGroup) || resolvedGroup;
      const target = assignee && group ? `${assignee} (${group})` : (assignee ?? group);
      // Ids we can't name (e.g. a group the viewer can't look up): say what happened, generically.
      const unnamed = !target && (assigneeId || groupId);
      return (
        <SystemLine
          icon={UserRoundCogIcon}
          activity={a}
          note={
            data.reason === 'offboarded' ? (
              <p className="mt-0.5 text-xs text-muted-foreground">{tl('offboarded')}</p>
            ) : (
              <Quote>{a.body}</Quote>
            )
          }
        >
          {target
            ? tl('assigned', { name: who, to: target })
            : unnamed
              ? tl('assignmentChanged', { name: who })
              : tl('unassigned', { name: who })}
        </SystemLine>
      );
    }
    case 'field': {
      const fields = changedFields(data);
      return (
        <SystemLine icon={PencilIcon} activity={a}>
          {fields.length
            ? tl('fieldsChanged', { name: who, fields: fieldText(fields) })
            : (a.body ?? tl('updated', { name: who }))}
        </SystemLine>
      );
    }
    case 'link': {
      const type = typeof data.type === 'string' ? data.type : null;
      const direction = data.direction === 'incoming' ? 'incoming' : 'outgoing';
      const target = nameOf(data.target) ?? nameOf(data.ticket) ?? nameOf(data.reference) ?? '';
      const label = type && t.has(`linkType.${type}.${direction}`) ? t(`linkType.${type}.${direction}`) : '';
      const removed = data.action === 'removed' || data.removed === true;
      return (
        <SystemLine icon={LinkIcon} activity={a}>
          {target
            ? tl(removed ? 'unlinked' : 'linked', { name: who, relation: label || tl('related'), target })
            : (a.body ?? tl('updated', { name: who }))}
        </SystemLine>
      );
    }
    case 'sla': {
      const metric =
        typeof data.metric === 'string' && t.has(`slaMetric.${data.metric}`)
          ? t(`slaMetric.${data.metric}`)
          : '';
      const event = String(data.event ?? data.status ?? data.type ?? '');
      const breached = event === 'breached' || event === 'breach';
      return (
        <SystemLine
          icon={breached ? AlarmClockOffIcon : ClockAlertIcon}
          tone={breached ? 'destructive' : 'warning'}
          activity={a}
        >
          {tl(breached ? 'slaBreached' : 'slaWarning', { metric: metric || tl('sla') })}
        </SystemLine>
      );
    }
    case 'approval': {
      const outcome = String(data.outcome ?? data.event ?? data.status ?? '');
      const key = ['started', 'approved', 'rejected', 'cancelled'].includes(outcome) ? outcome : 'updated';
      return (
        <SystemLine
          icon={GavelIcon}
          tone={key === 'rejected' ? 'destructive' : undefined}
          activity={a}
          note={<Quote>{a.body}</Quote>}
        >
          {tl(`approval.${key}`)}
        </SystemLine>
      );
    }
    case 'triage': {
      const applied = changedFields(data);
      const skipped = Array.isArray(data.skipped)
        ? data.skipped.filter((x): x is string => typeof x === 'string')
        : [];
      const suggested =
        data.applied === false ||
        data.mode === 'suggested' ||
        data.suggested === true ||
        (!applied.length && skipped.length > 0);
      const fields = applied.length ? applied : skipped;
      const confidence = typeof data.confidence === 'number' ? Math.round(data.confidence * 100) : null;
      const rationale = typeof data.rationale === 'string' && data.rationale ? data.rationale : a.body;
      const ai = Boolean(a.author?.ai);
      const text = tl(ai ? (suggested ? 'triage.aiSuggested' : 'triage.aiSet') : 'triage.set', {
        name: who,
        fields: fields.length ? fieldText(fields) : tl('triage.classification'),
      });
      return (
        <SystemLine
          icon={ai ? SparklesIcon : UserRoundCogIcon}
          tone={ai ? 'ai' : undefined}
          activity={a}
          note={
            (confidence !== null || rationale) && (
              <div className="mt-1.5 grid gap-1 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-foreground">
                {confidence !== null && (
                  <p className="text-xs font-medium">{tl('triage.confidence', { value: confidence })}</p>
                )}
                {rationale && <p className="text-sm text-muted-foreground">{rationale}</p>}
              </div>
            )
          }
        >
          {text}
        </SystemLine>
      );
    }
    default: {
      if (data.event === 'created') {
        const channel =
          typeof data.channel === 'string' && t.has(`channel.${data.channel}`)
            ? t(`channel.${data.channel}`)
            : null;
        const onBehalf = typeof data.onBehalfOf === 'string' ? names?.person(data.onBehalfOf) : null;
        return (
          <SystemLine icon={CirclePlusIcon} activity={a}>
            {onBehalf
              ? tl('createdFor', { name: who, person: onBehalf, channel: channel ?? '—' })
              : tl('created', { name: who, channel: channel ?? '—' })}
          </SystemLine>
        );
      }
      return (
        <SystemLine icon={InfoIcon} activity={a}>
          {a.body ?? tl('updated', { name: who })}
        </SystemLine>
      );
    }
  }
}

/** The ticket's timeline, oldest first; requester comments on the left, everyone else's on the right. */
export function Timeline({
  ticket,
  items,
  isLoading,
  total,
  isMine,
}: {
  ticket: TicketDetail;
  items: Activity[];
  isLoading: boolean;
  total: number;
  /** Requester view: own messages on the right. */
  isMine?: (a: Activity) => boolean;
}) {
  const t = useTranslations('itsm.timeline');
  const personIds = useMemo(() => {
    const ids: string[] = [];
    for (const a of items) {
      const d = (a.data ?? {}) as Data;
      if (a.kind === 'assignment' && isObj(d.to) && typeof d.to.assigneeId === 'string')
        ids.push(d.to.assigneeId);
      if (typeof d.onBehalfOf === 'string') ids.push(d.onBehalfOf);
    }
    return ids;
  }, [items]);
  const people = usePeople(personIds);
  const hasGroups = items.some((a) => a.kind === 'assignment');
  const { groups } = useGroups(hasGroups);
  const { requester, requestedFor, assignee, assignmentGroup } = ticket;
  const names = useMemo<NameResolver>(() => {
    const known = new Map<string, string>();
    for (const p of [requester, requestedFor, assignee]) if (p) known.set(p.id, p.displayName);
    return {
      person: (id) => people.get(id)?.displayName ?? known.get(id) ?? null,
      group: (id) =>
        groups.find((g) => g.id === id)?.name ?? (assignmentGroup?.id === id ? assignmentGroup.name : null),
    };
  }, [people, groups, requester, requestedFor, assignee, assignmentGroup]);
  if (isLoading)
    return (
      <div className="grid gap-4" aria-busy>
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-16 w-full rounded-xl" />
        ))}
      </div>
    );
  if (!items.length) return <p className="py-6 text-center text-sm text-muted-foreground">{t('empty')}</p>;
  return (
    <>
      {total > items.length && (
        <p className="mb-3 text-center text-xs text-muted-foreground">
          {t('truncated', { count: items.length })}
        </p>
      )}
      <ol className="grid gap-3" aria-label={t('label')}>
        {items.map((a, i) => (
          <motion.li
            key={a.id}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, delay: Math.min(i, 10) * 0.03, ease: [0.22, 1, 0.36, 1] }}
          >
            <ActivityItem
              activity={a}
              names={names}
              end={isMine ? isMine(a) : Boolean(a.author && a.author.id !== ticket.requester?.id)}
            />
          </motion.li>
        ))}
      </ol>
    </>
  );
}
