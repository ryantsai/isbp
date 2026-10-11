'use client';

import { Tooltip } from '@astryxdesign/core/Tooltip';

import {
  DONE_STATUSES,
  type ReplyArticle,
  type TicketAsideSlotProps,
  type TicketStatus,
} from '@isbp/module-itsm/contracts';
import { localize } from '@isbp/sdk';
import { useCan } from '@isbp/sdk/web';
import { Markdown } from '@isbp/ui/markdown';
import { Meter } from '@isbp/ui/meter';
import { AnimatedItem, AnimatedList, duration, ease, useReducedMotion } from '@isbp/ui/motion';
import { ErrorState } from '@isbp/ui/empty-state';
import { useApiMutation, useApiQuery } from '@isbp/ui/query';
import { RelativeTime } from '@isbp/ui/relative-time';
import { Skeleton } from '@isbp/ui/skeleton';
import { StatusBadge } from '@isbp/ui/status';
import {
  ArrowRightIcon,
  BookOpenIcon,
  CheckCheckIcon,
  CheckIcon,
  CircleAlertIcon,
  CircleDotIcon,
  FileTextIcon,
  HistoryIcon,
  Link2Icon,
  LinkIcon,
  LockIcon,
  NotebookPenIcon,
  PenLineIcon,
  RefreshCwIcon,
  SparklesIcon,
  TriangleAlertIcon,
  WandSparklesIcon,
  XIcon,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import Link from 'next/link';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { type ReactNode, useState } from 'react';
import {
  type Assist,
  type InsightFeedbackInput,
  type KbDraft,
  LOW_CONFIDENCE,
  type ReplyDraft,
  SHOW_FIRST,
  type TicketSummary,
  type TriageField,
  type TriageInsight,
} from '../../contracts';
import { CitationChips, ModeBadge, Section } from '../shared';
import { Button } from '@astryxdesign/core/Button';
import { IconButton } from '@astryxdesign/core/IconButton';
import { Badge } from '@astryxdesign/core/Badge';
import { Icon as AstryxIcon } from '@astryxdesign/core/Icon';

type Ticket = TicketAsideSlotProps['ticket'];
type Actions = TicketAsideSlotProps['actions'];

/** Tickets that can become knowledge articles. */
const KB_READY = ['resolved', 'fulfilled', 'closed'];
const TRIAGED = ['incident', 'service_request'];

const isDone = (ticket: Ticket) => DONE_STATUSES.includes(ticket.status as TicketStatus);

/**
 * Helpdesk AI's panel on ITSM's ticket page (agents only). Secondary to the ticket's own fields: every section is
 * collapsed except a triage suggestion that is still waiting, sections with nothing to show are left out, and a
 * change gets only its summary (and KB draft once done).
 */
export default function AssistPanel({ ticket, actions }: TicketAsideSlotProps) {
  if (ticket.viewer.role !== 'agent') return null;
  return <Panel ticket={ticket} actions={actions} />;
}

function Panel({ ticket, actions }: { ticket: Ticket; actions: Actions }) {
  const t = useTranslations('helpdesk-ai');
  const path = `/helpdesk-ai/tickets/${ticket.id}/assist`;
  const { data, isLoading, error, refetch, isFetching } = useApiQuery<Assist>(path);
  // null: follow the suggestion (open while it waits); set once the agent toggles it or applies it.
  const [triageOpen, setTriageOpen] = useState<boolean | null>(null);
  const change = ticket.type === 'change';
  const problem = ticket.type === 'problem';
  const triaged = TRIAGED.includes(ticket.type) && !isDone(ticket);
  const canTriage = triaged && (!!data?.triage || ticket.viewer.canEdit);
  const waiting = !!data?.triage && triageWaits(ticket, data.triage);

  return (
    // ITSM wraps each aside contribution in a padded card: bleed to its edges so the header spans it.
    <section aria-labelledby="hai-assist-title" className="-mx-4 -my-4 min-w-0 text-card-foreground">
      <header className="flex items-center gap-2 border-b px-4 py-2">
        <span className="grid size-6 shrink-0 place-items-center rounded-md bg-gradient-to-br from-primary to-chart-4 text-primary-foreground">
          <SparklesIcon className="size-3.5" aria-hidden />
        </span>
        <h2 id="hai-assist-title" className="text-sm font-semibold tracking-tight">
          {t('assist.title')}
        </h2>
        <div className="ml-auto flex min-w-0 items-center gap-1">
          <ModeBadge ai={data?.ai} />
          <Tooltip content={t('assist.refresh')}>
            <IconButton
              label={t('assist.refresh')}
              variant="ghost"
              size="sm"
              icon={<AstryxIcon icon={RefreshCwIcon} />}
              isDisabled={isFetching}
              className="size-7"
              onClick={() => void refetch()}
            />
          </Tooltip>
        </div>
      </header>

      {isLoading ? (
        <div className="space-y-2 p-4" role="status" aria-busy="true" aria-label={t('assist.loading')}>
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      ) : error || !data ? (
        <ErrorState error={error} onRetry={() => void refetch()} compact className="px-4 py-3" />
      ) : (
        <div className="overflow-hidden rounded-b-xl">
          {canTriage && (
            <Section
              title={t('triage.title')}
              icon={<WandSparklesIcon />}
              open={triageOpen ?? (waiting && ticket.viewer.canEdit)}
              onOpenChange={setTriageOpen}
              meta={data.triage && <TriageStatusBadge status={data.triage.status} />}
            >
              <TriageSection
                ticket={ticket}
                insight={data.triage}
                enabled={data.settings.triageEnabled}
                actions={actions}
                onSettled={() => setTriageOpen(false)}
              />
            </Section>
          )}
          {data.similar.length > 0 && (
            <Section
              title={problem ? t('similar.problemTitle') : t('similar.title')}
              icon={<HistoryIcon />}
              meta={<CountBadge n={data.similar.length} />}
            >
              <SimilarList items={data.similar} ticket={ticket} actions={actions} />
            </Section>
          )}
          {data.articles.length > 0 && (
            <Section
              title={t('articles.title')}
              icon={<BookOpenIcon />}
              meta={<CountBadge n={data.articles.length} />}
            >
              <ArticleList items={data.articles} ticket={ticket} actions={actions} />
            </Section>
          )}
          {!change && data.settings.suggestReplies && ticket.viewer.canComment && (
            <Section title={t('reply.title')} icon={<PenLineIcon />}>
              <ReplySection ticketId={ticket.id} actions={actions} />
            </Section>
          )}
          <Section title={t('summary.title')} icon={<FileTextIcon />}>
            <SummarySection ticketId={ticket.id} cached={data.summary} />
          </Section>
          {KB_READY.includes(ticket.status) && (
            <Section title={t('kb.title')} icon={<NotebookPenIcon />}>
              <KbSection ticketId={ticket.id} existing={data.kbDraft} />
            </Section>
          )}
        </div>
      )}
    </section>
  );
}

function CountBadge({ n }: { n: number }) {
  return <Badge variant="neutral" label={n} className="tabular-nums" />;
}

const STATUS_TONE = {
  suggested: 'info',
  applied: 'success',
  partially_applied: 'success',
  auto_applied: 'success',
  dismissed: 'muted',
} as const;

function TriageStatusBadge({ status }: { status: TriageInsight['status'] }) {
  const t = useTranslations('helpdesk-ai');
  const Icon = status === 'dismissed' ? XIcon : status === 'suggested' ? SparklesIcon : CheckIcon;
  return (
    <StatusBadge
      tone={STATUS_TONE[status]}
      icon={Icon}
      label={t(`insightStatus.${status}`)}
      changeKey={status}
    />
  );
}

/* ───────────────────────────── triage ───────────────────────────── */

interface Row {
  field: 'category' | 'group' | 'priority';
  fields: TriageField[];
  label: string;
  current: string | null;
  suggested: string | null;
  detail?: string;
  differs: boolean;
  patch: Record<string, unknown>;
}

function buildRows(
  ticket: Ticket,
  insight: TriageInsight,
  t: (key: string, values?: Record<string, string | number>) => string,
  locale: string,
): Row[] {
  const s = insight.data.suggestion;
  return [
    {
      field: 'category',
      fields: ['category'],
      label: t('triage.category'),
      current: ticket.category ? ticket.category.path || localize(ticket.category.name, locale) : null,
      suggested: s.categoryPath,
      differs: !!s.categoryId && s.categoryId !== ticket.category?.id,
      patch: { categoryId: s.categoryId },
    },
    {
      field: 'group',
      fields: ['group'],
      label: t('triage.group'),
      current: ticket.assignmentGroup?.name ?? null,
      suggested: s.assignmentGroupName,
      differs: !!s.assignmentGroupId && s.assignmentGroupId !== ticket.assignmentGroup?.id,
      patch: { assignmentGroupId: s.assignmentGroupId },
    },
    {
      field: 'priority',
      fields: ['impact', 'urgency'],
      label: t('triage.priority'),
      current: `P${ticket.priority}`,
      suggested: `P${s.priority}`,
      detail: t('triage.impactUrgency', { impact: s.impact, urgency: s.urgency }),
      differs: s.impact !== ticket.impact || s.urgency !== ticket.urgency,
      patch: { impact: s.impact, urgency: s.urgency },
    },
  ];
}

/** A suggestion nobody decided yet that would still change the ticket. */
function triageWaits(ticket: Ticket, insight: TriageInsight) {
  const s = insight.data.suggestion;
  return (
    insight.status === 'suggested' &&
    ((!!s.categoryId && s.categoryId !== ticket.category?.id) ||
      (!!s.assignmentGroupId && s.assignmentGroupId !== ticket.assignmentGroup?.id) ||
      s.impact !== ticket.impact ||
      s.urgency !== ticket.urgency)
  );
}

function TriageSection({
  ticket,
  insight,
  enabled,
  actions,
  onSettled,
}: {
  ticket: Ticket;
  insight: TriageInsight | null;
  enabled: boolean;
  actions: Actions;
  /** Everything was applied or dismissed: the section folds to its status. */
  onSettled: () => void;
}) {
  const t = useTranslations('helpdesk-ai');
  const locale = useLocale();
  const canEdit = ticket.viewer.canEdit;
  const invalidate = [`/helpdesk-ai/tickets/${ticket.id}`];
  const rerun = useApiMutation((api) => api.post<TriageInsight>(`/helpdesk-ai/tickets/${ticket.id}/triage`), {
    invalidate,
    success: t('triage.refreshed'),
  });
  const feedback = useApiMutation(
    (api, body: InsightFeedbackInput) =>
      api.post<TriageInsight>(`/helpdesk-ai/insights/${insight!.id}/feedback`, body),
    { invalidate, onSuccess: (r) => r.status === 'dismissed' && onSettled() },
  );
  const apply = useApiMutation(
    async (api, rows: Row[]) => {
      await api.patch(
        `/itsm/tickets/${encodeURIComponent(ticket.reference)}`,
        Object.assign({}, ...rows.map((r) => r.patch)),
      );
      const before = new Set(insight!.feedback?.fields ?? []);
      rows.forEach((r) => r.fields.forEach((f) => before.add(f)));
      const applying = new Set(rows.map((r) => r.field));
      const remaining = buildRows(ticket, insight!, t, locale).filter(
        (r) => r.differs && !applying.has(r.field),
      );
      await api.post(`/helpdesk-ai/insights/${insight!.id}/feedback`, {
        action: remaining.length ? 'partially_applied' : 'applied',
        fields: [...before] as TriageField[],
      } satisfies InsightFeedbackInput);
      return remaining.length;
    },
    {
      invalidate,
      success: t('triage.applied'),
      onSuccess: (remaining) => {
        actions.refresh();
        if (!remaining) onSettled();
      },
    },
  );

  if (!insight)
    return (
      <div className="space-y-3 text-sm">
        <p className="text-muted-foreground">{enabled ? t('triage.none') : t('triage.disabled')}</p>
        {canEdit && (
          <Button
            label={t('triage.suggest')}
            variant="secondary"
            size="sm"
            icon={<AstryxIcon icon={WandSparklesIcon} />}
            isLoading={rerun.isPending}
            onClick={() => rerun.mutate(undefined)}
          />
        )}
      </div>
    );

  const rows = buildRows(ticket, insight, t, locale);
  const pending = rows.filter((r) => r.differs);
  const decided = insight.status === 'dismissed';
  const busy = apply.isPending || feedback.isPending || rerun.isPending;
  const confidence = insight.confidence ?? 0;
  const low = confidence < LOW_CONFIDENCE;
  const offer = canEdit && !decided;

  return (
    <div className="space-y-3 text-sm">
      <dl className="grid grid-cols-1 gap-1.5">
        {rows.map((r) => (
          // dt/dd sit directly in the row (axe: definition lists); the Apply button is part of the value.
          <div key={r.field} className="min-w-0 rounded-lg border bg-background/60 px-3 py-1.5">
            <dt className="text-xs text-muted-foreground">{r.label}</dt>
            <dd className="flex min-w-0 items-center gap-2">
              <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5 gap-y-0.5">
                {r.differs ? (
                  <>
                    <span className="truncate text-muted-foreground line-through decoration-muted-foreground/50">
                      {r.current ?? t('triage.empty')}
                    </span>
                    <ArrowRightIcon
                      className="size-3 shrink-0 text-muted-foreground"
                      aria-label={t('triage.to')}
                    />
                    <span className="truncate font-medium">{r.suggested}</span>
                    {r.detail && <span className="w-full text-xs text-muted-foreground">{r.detail}</span>}
                  </>
                ) : (
                  <span className="flex min-w-0 items-center gap-1.5">
                    <CheckIcon className="size-3.5 shrink-0 text-success" aria-hidden />
                    <span className="truncate">{r.current ?? r.suggested ?? t('triage.empty')}</span>
                    <span className="sr-only">{t('triage.matches')}</span>
                  </span>
                )}
              </span>
              {r.differs && offer && (
                <Button
                  label={t('triage.apply')}
                  aria-label={t('triage.applyField', { field: r.label })}
                  variant="ghost"
                  size="sm"
                  isDisabled={busy}
                  className="h-7 shrink-0 px-2"
                  onClick={() => apply.mutate([r])}
                />
              )}
            </dd>
          </div>
        ))}
      </dl>

      <div className="space-y-1">
        <p className="text-xs text-muted-foreground">{t('triage.confidence')}</p>
        <Meter
          value={Math.round(confidence * 100)}
          label={t('triage.confidence')}
          tone={low ? 'warning' : 'primary'}
          size="sm"
          showValue
        />
        {low && pending.length > 0 && offer && (
          <p className="flex items-start gap-1.5 text-xs text-warning-foreground">
            <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden /> {t('triage.lowConfidence')}
          </p>
        )}
      </div>
      <Rationale insight={insight} />
      {insight.data.fallback && (
        <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <CircleAlertIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden /> {t('triage.fallback')}
        </p>
      )}
      {insight.feedback?.by && insight.status !== 'suggested' && (
        <p className="text-xs text-muted-foreground">
          {t('triage.decidedBy', { name: insight.feedback.by.name })} ·{' '}
          <RelativeTime date={insight.feedback.at} />
        </p>
      )}

      {canEdit && (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {pending.length > 0 && !decided && (
            <Button
              label={t('triage.applyAll')}
              size="sm"
              variant={low ? 'secondary' : 'primary'}
              icon={<AstryxIcon icon={CheckCheckIcon} />}
              isLoading={apply.isPending}
              isDisabled={busy}
              onClick={() => apply.mutate(pending)}
            />
          )}
          {insight.status === 'suggested' && (
            <Button
              label={t('triage.dismiss')}
              size="sm"
              variant={low ? 'ghost' : 'secondary'}
              icon={<AstryxIcon icon={XIcon} />}
              isDisabled={busy}
              onClick={() => feedback.mutate({ action: 'dismissed' })}
            />
          )}
          <Tooltip content={t('triage.rerun')}>
            <IconButton
              label={t('triage.rerun')}
              variant="ghost"
              size="sm"
              icon={<AstryxIcon icon={RefreshCwIcon} />}
              isDisabled={busy}
              className="ml-auto"
              onClick={() => rerun.mutate(undefined)}
            />
          </Tooltip>
        </div>
      )}
    </div>
  );
}

/**
 * Why the suggestion looks like this, in the viewer's language: the builtin vote is rendered from its data (the
 * similar tickets and keywords); a model's explanation, and older rows without that data, show the stored text.
 */
function Rationale({ insight }: { insight: TriageInsight }) {
  const t = useTranslations('helpdesk-ai');
  const format = useFormatter();
  const d = insight.data;
  const fromData = insight.mode === 'builtin' && Array.isArray(d.neighbours) && !!d.keywords;
  if (!fromData)
    return d.rationale ? (
      <p className="rounded-lg bg-muted/60 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
        {d.rationale}
      </p>
    ) : null;
  const top = d.neighbours
    .slice(0, 3)
    .map((n) => t('triage.neighbour', { reference: n.reference, percent: Math.round(n.similarity * 100) }));
  const words = [...new Set([...d.keywords.impact, ...d.keywords.urgency])].map((word) =>
    t('triage.keyword', { word }),
  );
  return (
    <ul className="space-y-0.5 rounded-lg bg-muted/60 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
      <li>
        {top.length
          ? t('triage.basedOn', { list: format.list(top, { type: 'conjunction' }) })
          : t('triage.noNeighbours')}
      </li>
      {words.length > 0 && (
        <li>{t('triage.keywords', { list: format.list(words, { type: 'conjunction' }) })}</li>
      )}
    </ul>
  );
}

/* ───────────────────────────── similar & articles ───────────────────────────── */

function Similarity({ value }: { value: number }) {
  const t = useTranslations('helpdesk-ai');
  return (
    <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
      {t('similar.match', { percent: Math.round(value * 100) })}
    </span>
  );
}

/** The first `SHOW_FIRST` items, and the rest behind "Show more" (they grow in when shown). */
function useShowMore<T>(items: readonly T[]) {
  const [all, setAll] = useState(false);
  return {
    shown: all ? items : items.slice(0, SHOW_FIRST),
    toggle: items.length > SHOW_FIRST ? { all, flip: () => setAll((a) => !a) } : null,
  };
}

function ShowMore({ toggle }: { toggle: { all: boolean; flip: () => void } | null }) {
  const t = useTranslations('helpdesk-ai');
  if (!toggle) return null;
  return (
    <Button
      label={toggle.all ? t('similar.showLess') : t('similar.showMore')}
      variant="ghost"
      size="sm"
      className="h-auto px-0 text-xs"
      onClick={toggle.flip}
      aria-expanded={toggle.all}
    />
  );
}

function SimilarList({
  items,
  ticket,
  actions,
}: {
  items: Assist['similar'];
  ticket: Ticket;
  actions: Actions;
}) {
  const t = useTranslations('helpdesk-ai');
  const { shown, toggle } = useShowMore(items);
  // On a problem, incidents can be linked to it from here ("the incident is caused by this problem").
  const canLink = ticket.type === 'problem' && ticket.viewer.canEdit;
  const linked = new Set(ticket.links.map((l) => l.ticket.reference));
  const link = useApiMutation(
    async (_api, reference: string) => {
      await actions.linkTicket(reference, { type: 'caused_by', direction: 'incoming' });
      return reference;
    },
    { success: (reference) => t('similar.linkedToast', { reference }) },
  );
  return (
    <div className="space-y-1">
      <AnimatedList className="divide-y">
        {shown.map((s) => (
          <AnimatedItem key={s.id} className="min-w-0 py-2 first:pt-0">
            <div className="flex min-w-0 items-baseline gap-2">
              <Link
                href={s.href}
                className="min-w-0 truncate text-sm font-medium outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                <span className="font-mono text-xs text-muted-foreground">{s.reference}</span> {s.title}
              </Link>
              <Similarity value={s.similarity} />
            </div>
            <div className="mt-1 flex min-w-0 flex-wrap items-center gap-2">
              {s.status ? (
                <StatusBadge
                  tone="info"
                  icon={CircleDotIcon}
                  label={
                    t.has(`ticketStatus.${s.status}`) ? t(`ticketStatus.${s.status}`) : t('similar.open')
                  }
                />
              ) : (
                s.resolutionCode && (
                  <StatusBadge
                    tone="success"
                    icon={CheckIcon}
                    label={
                      t.has(`resolution.${s.resolutionCode}`)
                        ? t(`resolution.${s.resolutionCode}`)
                        : s.resolutionCode
                    }
                  />
                )
              )}
              {canLink &&
                s.type === 'incident' &&
                (linked.has(s.reference) ? (
                  <StatusBadge
                    tone="success"
                    icon={Link2Icon}
                    label={t('similar.linked')}
                    changeKey="linked"
                  />
                ) : (
                  <Button
                    label={t('similar.link')}
                    aria-label={t('similar.linkFor', { reference: s.reference })}
                    variant="secondary"
                    size="sm"
                    icon={<AstryxIcon icon={Link2Icon} />}
                    isLoading={link.isPending && link.variables === s.reference}
                    isDisabled={link.isPending}
                    className="h-7 px-2 text-xs"
                    onClick={() => link.mutate(s.reference)}
                  />
                ))}
            </div>
            {s.snippet && (
              <p className="mt-1 line-clamp-2 min-w-0 text-xs text-muted-foreground">{s.snippet}</p>
            )}
          </AnimatedItem>
        ))}
      </AnimatedList>
      <ShowMore toggle={toggle} />
    </div>
  );
}

function ArticleList({
  items,
  ticket,
  actions,
}: {
  items: Assist['articles'];
  ticket: Ticket;
  actions: Actions;
}) {
  const t = useTranslations('helpdesk-ai');
  const { shown, toggle } = useShowMore(items);
  return (
    <div className="space-y-1">
      <AnimatedList className="divide-y">
        {shown.map((a) => (
          <AnimatedItem key={a.id} className="min-w-0 py-2 first:pt-0">
            <div className="flex min-w-0 items-baseline gap-2">
              <Link
                href={a.href}
                className="min-w-0 truncate text-sm font-medium outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                {a.title}
              </Link>
              <Similarity value={a.similarity} />
            </div>
            <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{a.summary || a.snippet}</p>
            {ticket.viewer.canComment && (
              <Button
                label={t('articles.insert')}
                aria-label={t('articles.insertFor', { title: a.title })}
                variant="ghost"
                size="sm"
                icon={<AstryxIcon icon={LinkIcon} />}
                className="mt-1 h-7 px-2 text-xs"
                onClick={() =>
                  actions.insertReply(
                    t('articles.insertText', { link: `[${a.reference} ${a.title}](${a.href})` }),
                    {
                      article: { id: a.id, reference: a.reference, title: a.title },
                    },
                  )
                }
              />
            )}
          </AnimatedItem>
        ))}
      </AnimatedList>
      <ShowMore toggle={toggle} />
    </div>
  );
}

/* ───────────────────────────── reply, summary, KB ───────────────────────────── */

/** Swaps generated content with a short cross-fade when it is regenerated (not when the panel opens). */
function Swap({ id, children, className }: { id: string; children: ReactNode; className?: string }) {
  const reduce = useReducedMotion();
  return (
    <AnimatePresence initial={false} mode="wait">
      <motion.div
        key={id}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: reduce ? 0 : duration.base, ease: ease.enter }}
        className={className}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}

function GeneratedNote({
  mode,
  model,
  fallback,
}: {
  mode: string;
  model: string | null;
  fallback?: boolean;
}) {
  const t = useTranslations('helpdesk-ai');
  return (
    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <SparklesIcon className="size-3" aria-hidden />
      {fallback
        ? t('generated.fallback')
        : mode === 'llm'
          ? t('generated.llm', { model: model ?? '' })
          : t('generated.builtin')}
    </p>
  );
}

function ReplySection({ ticketId, actions }: { ticketId: string; actions: Actions }) {
  const t = useTranslations('helpdesk-ai');
  const [draft, setDraft] = useState<ReplyDraft | null>(null);
  const [round, setRound] = useState(0);
  const generate = useApiMutation(
    (api) => api.post<ReplyDraft>(`/helpdesk-ai/tickets/${ticketId}/reply-draft`),
    {
      onSuccess: (d) => {
        setDraft(d);
        setRound((n) => n + 1);
      },
    },
  );
  const article = draft?.citations.find((c) => c.id);
  const used: ReplyArticle | undefined = article
    ? { id: article.id!, reference: article.reference, title: article.title }
    : undefined;
  return (
    <div className="space-y-3">
      {draft ? (
        <Swap id={String(round)} className="space-y-2">
          <div className="max-h-80 overflow-y-auto rounded-lg border bg-background px-3 py-2.5">
            <Markdown>{draft.text}</Markdown>
          </div>
          <CitationChips items={draft.citations} />
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <GeneratedNote mode={draft.mode} model={draft.model} fallback={draft.fallback} />
            <span className="text-xs text-muted-foreground">
              {t('reply.language', { language: t(`language.${draft.locale}`) })}
            </span>
          </div>
        </Swap>
      ) : (
        <p className="text-sm text-muted-foreground">{t('reply.hint')}</p>
      )}
      <div className="flex flex-wrap gap-2">
        {draft && (
          <Button
            label={t('reply.insert')}
            variant="primary"
            size="sm"
            icon={<AstryxIcon icon={PenLineIcon} />}
            onClick={() => actions.insertReply(draft.insertText, used ? { article: used } : undefined)}
          />
        )}
        <Button
          label={draft ? t('reply.regenerate') : t('reply.draft')}
          size="sm"
          variant={draft ? 'secondary' : 'primary'}
          icon={<AstryxIcon icon={draft ? RefreshCwIcon : SparklesIcon} />}
          isLoading={generate.isPending}
          onClick={() => generate.mutate(undefined)}
        />
      </div>
    </div>
  );
}

function SummarySection({ ticketId, cached }: { ticketId: string; cached: TicketSummary | null }) {
  const t = useTranslations('helpdesk-ai');
  const [fresh, setFresh] = useState<TicketSummary | null>(null);
  const summary = fresh ?? cached;
  const run = useApiMutation((api) => api.post<TicketSummary>(`/helpdesk-ai/tickets/${ticketId}/summary`), {
    onSuccess: (s) => setFresh(s),
  });
  return (
    <div className="space-y-3 text-sm">
      {summary ? (
        <Swap id={String(summary.generatedAt)} className="space-y-3">
          {summary.text ? (
            <Markdown>{summary.text}</Markdown>
          ) : (
            summary.sections && <Sections s={summary.sections} />
          )}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <GeneratedNote mode={summary.mode} model={summary.model} fallback={summary.fallback} />
            <span className="text-xs text-muted-foreground">
              <RelativeTime date={summary.generatedAt} />
            </span>
          </div>
        </Swap>
      ) : (
        <p className="text-muted-foreground">{t('summary.hint')}</p>
      )}
      <Button
        label={summary ? t('summary.refresh') : t('summary.run')}
        size="sm"
        variant={summary ? 'secondary' : 'primary'}
        icon={<AstryxIcon icon={FileTextIcon} />}
        isLoading={run.isPending}
        onClick={() => run.mutate(undefined)}
      />
    </div>
  );
}

function Sections({ s }: { s: NonNullable<TicketSummary['sections']> }) {
  const t = useTranslations('helpdesk-ai');
  const state = [
    t.has(`ticketStatus.${s.state.status}`) ? t(`ticketStatus.${s.state.status}`) : s.state.status,
    `P${s.state.priority}`,
    s.state.group,
    s.state.assignee,
  ].filter(Boolean);
  return (
    <dl className="space-y-3">
      <div>
        <dt className="text-xs font-medium text-muted-foreground">{t('summary.issue')}</dt>
        <dd className="mt-0.5">{s.issue}</dd>
      </div>
      <div>
        <dt className="text-xs font-medium text-muted-foreground">{t('summary.updates')}</dt>
        <dd className="mt-1">
          {s.updates.length ? (
            <ul className="space-y-1.5">
              {s.updates.map((u, i) => (
                <li key={i} className="text-xs">
                  <span className="font-medium">{u.author ?? t('summary.system')}</span>
                  {!u.public && (
                    <span className="ml-1 inline-flex items-center gap-0.5 text-muted-foreground">
                      <LockIcon className="size-3" aria-hidden /> {t('summary.internal')}
                    </span>
                  )}
                  <span className="text-muted-foreground"> · </span>
                  <RelativeTime date={u.at} className="text-muted-foreground" />
                  <p className="mt-0.5 text-muted-foreground">{u.body}</p>
                </li>
              ))}
            </ul>
          ) : (
            <span className="text-muted-foreground">{t('summary.noUpdates')}</span>
          )}
        </dd>
      </div>
      <div>
        <dt className="text-xs font-medium text-muted-foreground">{t('summary.state')}</dt>
        <dd className="mt-0.5">{state.join(' · ')}</dd>
        {s.state.resolutionNotes && (
          <dd className="mt-1 text-xs text-muted-foreground">{s.state.resolutionNotes}</dd>
        )}
      </div>
    </dl>
  );
}

function KbSection({ ticketId, existing }: { ticketId: string; existing: KbDraft | null }) {
  const t = useTranslations('helpdesk-ai');
  const canWrite = useCan('knowledge.articles.write');
  const [created, setCreated] = useState<KbDraft | null>(null);
  const draft = created ?? existing;
  const run = useApiMutation((api) => api.post<KbDraft>(`/helpdesk-ai/tickets/${ticketId}/kb-draft`), {
    onSuccess: (d) => setCreated(d),
    success: t('kb.created'),
    invalidate: [`/helpdesk-ai/tickets/${ticketId}`],
  });
  if (draft)
    return (
      <div className="space-y-2 text-sm">
        <p className="flex items-center gap-1.5">
          <CheckIcon className="size-4 text-success" aria-hidden />
          {t('kb.ready', { reference: draft.reference })}
        </p>
        <Link
          href={draft.href}
          className="flex min-w-0 items-center gap-2 rounded-lg border bg-background px-3 py-2 font-medium outline-none transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 motion-reduce:transition-none"
        >
          <NotebookPenIcon className="size-4 shrink-0 text-primary" aria-hidden />
          <span className="min-w-0 truncate">{draft.title}</span>
          <ArrowRightIcon className="ml-auto size-4 shrink-0 text-muted-foreground" aria-hidden />
        </Link>
        <GeneratedNote mode={draft.mode} model={draft.model} />
      </div>
    );
  return (
    <div className="space-y-3 text-sm">
      <p className="text-muted-foreground">{canWrite ? t('kb.hint') : t('kb.noPermission')}</p>
      {canWrite && (
        <Button
          label={t('kb.run')}
          variant="primary"
          size="sm"
          icon={<AstryxIcon icon={NotebookPenIcon} />}
          isLoading={run.isPending}
          onClick={() => run.mutate(undefined)}
        />
      )}
    </div>
  );
}
