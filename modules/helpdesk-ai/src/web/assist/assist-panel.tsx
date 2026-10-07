'use client';

import type { TicketAsideSlotProps } from '@isbp/module-itsm/contracts';
import { localize } from '@isbp/sdk';
import { useCan } from '@isbp/sdk/web';
import { Badge } from '@isbp/ui/badge';
import { Button } from '@isbp/ui/button';
import { Markdown } from '@isbp/ui/markdown';
import { useApiMutation, useApiQuery, useErrorText } from '@isbp/ui/query';
import { RelativeTime } from '@isbp/ui/relative-time';
import { Skeleton } from '@isbp/ui/skeleton';
import { Hint } from '@isbp/ui/tooltip';
import {
  ArrowRightIcon,
  BookOpenIcon,
  CheckCheckIcon,
  CheckIcon,
  CircleAlertIcon,
  FileTextIcon,
  HistoryIcon,
  LinkIcon,
  LockIcon,
  NotebookPenIcon,
  PenLineIcon,
  RefreshCwIcon,
  SparklesIcon,
  WandSparklesIcon,
  XIcon,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import type {
  Assist,
  InsightFeedbackInput,
  KbDraft,
  ReplyDraft,
  TicketSummary,
  TriageField,
  TriageInsight,
} from '../../contracts';
import { CitationChips, ConfidenceMeter, Disclosure, ModeBadge } from '../shared';

type Ticket = TicketAsideSlotProps['ticket'];
type Actions = TicketAsideSlotProps['actions'];

const DONE = ['resolved', 'fulfilled', 'closed'];

/** Helpdesk AI's panel on ITSM's ticket page (agents only): triage, similar work, articles, drafts. */
export default function AssistPanel({ ticket, actions }: TicketAsideSlotProps) {
  if (ticket.viewer.role !== 'agent') return null;
  return <Panel ticket={ticket} actions={actions} />;
}

function Panel({ ticket, actions }: { ticket: Ticket; actions: Actions }) {
  const t = useTranslations('helpdesk-ai');
  const errorText = useErrorText();
  const path = `/helpdesk-ai/tickets/${ticket.id}/assist`;
  const { data, isLoading, error, refetch, isFetching } = useApiQuery<Assist>(path);

  return (
    // ITSM wraps each aside contribution in a padded card: bleed to its edges so the header spans it.
    <section aria-labelledby="hai-assist-title" className="-mx-4 -my-4 min-w-0 text-card-foreground">
      <header className="relative flex items-center gap-2.5 overflow-hidden rounded-t-xl border-b px-4 py-3">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-gradient-to-br from-primary/14 via-chart-4/8 to-transparent"
        />
        <span className="relative grid size-7 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-primary to-chart-4 text-primary-foreground shadow-sm">
          <SparklesIcon className="size-3.5" aria-hidden />
        </span>
        <h2 id="hai-assist-title" className="relative text-sm font-semibold tracking-tight">
          {t('assist.title')}
        </h2>
        <div className="relative ml-auto flex min-w-0 items-center gap-1">
          <ModeBadge ai={data?.ai} />
          <Hint label={t('assist.refresh')}>
            <Button
              variant="ghost"
              size="icon-sm"
              className="size-7"
              onClick={() => void refetch()}
              aria-label={t('assist.refresh')}
              disabled={isFetching}
            >
              <RefreshCwIcon className={isFetching ? 'animate-spin motion-reduce:animate-none' : ''} />
            </Button>
          </Hint>
        </div>
      </header>

      {isLoading ? (
        <div className="space-y-3 p-4" aria-busy="true" aria-label={t('assist.loading')}>
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : error || !data ? (
        <div className="flex flex-col items-start gap-2 p-4 text-sm">
          <p className="flex items-center gap-2 text-destructive">
            <CircleAlertIcon className="size-4" aria-hidden /> {errorText(error)}
          </p>
          <Button variant="outline" size="sm" onClick={() => void refetch()}>
            {t('assist.retry')}
          </Button>
        </div>
      ) : (
        <div className="overflow-hidden rounded-b-xl">
          <Disclosure
            title={t('triage.title')}
            icon={<WandSparklesIcon />}
            defaultOpen={!data.triage || data.triage.status === 'suggested'}
            meta={data.triage && <TriageStatusBadge status={data.triage.status} />}
          >
            <TriageSection
              ticket={ticket}
              insight={data.triage}
              enabled={data.settings.triageEnabled}
              actions={actions}
            />
          </Disclosure>
          <Disclosure
            title={t('similar.title')}
            icon={<HistoryIcon />}
            meta={<CountBadge n={data.similar.length} />}
            defaultOpen={data.similar.length > 0}
          >
            <SimilarList items={data.similar} />
          </Disclosure>
          <Disclosure
            title={t('articles.title')}
            icon={<BookOpenIcon />}
            meta={<CountBadge n={data.articles.length} />}
            defaultOpen={data.articles.length > 0}
          >
            <ArticleList items={data.articles} actions={actions} />
          </Disclosure>
          {data.settings.suggestReplies && ticket.viewer.canComment && (
            <Disclosure title={t('reply.title')} icon={<PenLineIcon />}>
              <ReplySection ticketId={ticket.id} actions={actions} />
            </Disclosure>
          )}
          <Disclosure title={t('summary.title')} icon={<FileTextIcon />} defaultOpen={!!data.summary}>
            <SummarySection ticketId={ticket.id} cached={data.summary} />
          </Disclosure>
          {DONE.includes(ticket.status) && (
            <Disclosure title={t('kb.title')} icon={<NotebookPenIcon />} defaultOpen={!!data.kbDraft}>
              <KbSection ticketId={ticket.id} existing={data.kbDraft} />
            </Disclosure>
          )}
        </div>
      )}
    </section>
  );
}

function CountBadge({ n }: { n: number }) {
  return (
    <Badge variant="muted" className="tabular-nums">
      {n}
    </Badge>
  );
}

const STATUS_VARIANT = {
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
    <Badge variant={STATUS_VARIANT[status]}>
      <Icon aria-hidden /> {t(`insightStatus.${status}`)}
    </Badge>
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

function TriageSection({
  ticket,
  insight,
  enabled,
  actions,
}: {
  ticket: Ticket;
  insight: TriageInsight | null;
  enabled: boolean;
  actions: Actions;
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
    { invalidate, silent: false },
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
    },
    {
      invalidate,
      success: t('triage.applied'),
      onSuccess: () => actions.refresh(),
    },
  );

  if (!insight)
    return (
      <div className="space-y-3 text-sm">
        <p className="text-muted-foreground">{enabled ? t('triage.none') : t('triage.disabled')}</p>
        {canEdit && (
          <Button
            size="sm"
            variant="outline"
            loading={rerun.isPending}
            onClick={() => rerun.mutate(undefined)}
          >
            <WandSparklesIcon /> {t('triage.suggest')}
          </Button>
        )}
      </div>
    );

  const rows = buildRows(ticket, insight, t, locale);
  const pending = rows.filter((r) => r.differs);
  const decided = insight.status === 'dismissed';
  const busy = apply.isPending || feedback.isPending || rerun.isPending;
  const confidence = insight.confidence ?? 0;

  return (
    <div className="space-y-3 text-sm">
      <dl className="grid grid-cols-1 gap-2">
        {rows.map((r) => (
          <div key={r.field} className="min-w-0 rounded-lg border bg-background/60 px-3 py-2">
            <dt className="text-xs text-muted-foreground">{r.label}</dt>
            <dd className="mt-0.5 flex min-w-0 items-center gap-2">
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
                  </>
                ) : (
                  <span className="flex min-w-0 items-center gap-1.5">
                    <CheckIcon className="size-3.5 shrink-0 text-success" aria-hidden />
                    <span className="truncate">{r.current ?? r.suggested ?? t('triage.empty')}</span>
                    <span className="sr-only">{t('triage.matches')}</span>
                  </span>
                )}
                {r.detail && r.differs && (
                  <span className="w-full text-xs text-muted-foreground">{r.detail}</span>
                )}
              </span>
              {r.differs && canEdit && !decided && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 shrink-0 px-2"
                  disabled={busy}
                  onClick={() => apply.mutate([r])}
                  aria-label={t('triage.applyField', { field: r.label })}
                >
                  {t('triage.apply')}
                </Button>
              )}
            </dd>
          </div>
        ))}
      </dl>

      <div className="space-y-1">
        <p className="text-xs text-muted-foreground">{t('triage.confidence')}</p>
        <ConfidenceMeter value={confidence} label={t('triage.confidence')} />
      </div>
      {insight.data.rationale && (
        <p className="rounded-lg bg-muted/60 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
          {insight.data.rationale}
        </p>
      )}
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
            <Button size="sm" loading={apply.isPending} disabled={busy} onClick={() => apply.mutate(pending)}>
              <CheckCheckIcon /> {t('triage.applyAll')}
            </Button>
          )}
          {insight.status === 'suggested' && (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => feedback.mutate({ action: 'dismissed' })}
            >
              <XIcon /> {t('triage.dismiss')}
            </Button>
          )}
          <Hint label={t('triage.rerun')}>
            <Button
              size="icon-sm"
              variant="ghost"
              className="ml-auto"
              disabled={busy}
              onClick={() => rerun.mutate(undefined)}
              aria-label={t('triage.rerun')}
            >
              <RefreshCwIcon className={rerun.isPending ? 'animate-spin motion-reduce:animate-none' : ''} />
            </Button>
          </Hint>
        </div>
      )}
    </div>
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

function SimilarList({ items }: { items: Assist['similar'] }) {
  const t = useTranslations('helpdesk-ai');
  if (!items.length) return <p className="text-sm text-muted-foreground">{t('similar.none')}</p>;
  return (
    <ul className="space-y-2.5">
      {items.map((s) => (
        <li key={s.id} className="min-w-0">
          <div className="flex min-w-0 items-baseline gap-2">
            <Link
              href={s.href}
              className="min-w-0 truncate text-sm font-medium outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <span className="font-mono text-xs text-muted-foreground">{s.reference}</span> {s.title}
            </Link>
            <Similarity value={s.similarity} />
          </div>
          <div className="mt-1 flex min-w-0 items-start gap-2">
            {s.resolutionCode && (
              <Badge variant="success" className="shrink-0">
                <CheckIcon aria-hidden />
                {t.has(`resolution.${s.resolutionCode}`)
                  ? t(`resolution.${s.resolutionCode}`)
                  : s.resolutionCode}
              </Badge>
            )}
            <p className="line-clamp-2 min-w-0 text-xs text-muted-foreground">{s.snippet}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}

function ArticleList({ items, actions }: { items: Assist['articles']; actions: Actions }) {
  const t = useTranslations('helpdesk-ai');
  if (!items.length) return <p className="text-sm text-muted-foreground">{t('articles.none')}</p>;
  return (
    <ul className="space-y-3">
      {items.map((a) => (
        <li key={a.id} className="min-w-0">
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
          <Button
            size="sm"
            variant="ghost"
            className="mt-1 h-7 px-2 text-xs"
            onClick={() =>
              actions.insertReply(
                t('articles.insertText', { link: `[${a.reference} ${a.title}](${a.href})` }),
              )
            }
            aria-label={t('articles.insertFor', { title: a.title })}
          >
            <LinkIcon /> {t('articles.insert')}
          </Button>
        </li>
      ))}
    </ul>
  );
}

/* ───────────────────────────── reply, summary, KB ───────────────────────────── */

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
  const generate = useApiMutation(
    (api) => api.post<ReplyDraft>(`/helpdesk-ai/tickets/${ticketId}/reply-draft`),
    { onSuccess: (d) => setDraft(d) },
  );
  return (
    <div className="space-y-3">
      {!draft && <p className="text-sm text-muted-foreground">{t('reply.hint')}</p>}
      <AnimatePresence initial={false}>
        {draft && (
          <motion.div
            key="draft"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="space-y-2"
          >
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
          </motion.div>
        )}
      </AnimatePresence>
      <div className="flex flex-wrap gap-2">
        {draft && (
          <Button size="sm" onClick={() => actions.insertReply(draft.insertText)}>
            <PenLineIcon /> {t('reply.insert')}
          </Button>
        )}
        <Button
          size="sm"
          variant={draft ? 'outline' : 'default'}
          loading={generate.isPending}
          onClick={() => generate.mutate(undefined)}
        >
          {draft ? <RefreshCwIcon /> : <SparklesIcon />} {draft ? t('reply.regenerate') : t('reply.draft')}
        </Button>
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
        <motion.div
          key={String(summary.generatedAt)}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="space-y-3"
        >
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
        </motion.div>
      ) : (
        <p className="text-muted-foreground">{t('summary.hint')}</p>
      )}
      <Button
        size="sm"
        variant={summary ? 'outline' : 'default'}
        loading={run.isPending}
        onClick={() => run.mutate(undefined)}
      >
        <FileTextIcon /> {summary ? t('summary.refresh') : t('summary.run')}
      </Button>
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
          className="flex min-w-0 items-center gap-2 rounded-lg border bg-background px-3 py-2 font-medium outline-none transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
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
        <Button size="sm" loading={run.isPending} onClick={() => run.mutate(undefined)}>
          <NotebookPenIcon /> {t('kb.run')}
        </Button>
      )}
    </div>
  );
}
