'use client';

import type { RecordPanelSlotProps } from '@isbp/contracts';
import { Slot, useApi, useCan, usePlatform } from '@isbp/sdk/web';
import { Card, CardContent, CardHeader, CardTitle } from '@isbp/ui/card';
import { Markdown } from '@isbp/ui/markdown';
import { DetailHeader, type DetailAction } from '@isbp/ui/page-header';
import { useApiMutation } from '@isbp/ui/query';
import { Skeleton } from '@isbp/ui/skeleton';
import { BugIcon, HandIcon, PencilIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useNow, useTranslations } from 'next-intl';
import { type ReactNode, useCallback, useMemo, useRef, useState } from 'react';
import type { ReplyArticle, TicketAsideSlotProps, TicketDetail, TicketStatus } from '../../contracts';
import { MajorBadge, PriorityBadge, TicketStatusBadge, TypeIcon } from '../components/badges';
import { INVALIDATE, recordRef, ticketApi } from '../lib';
import { listOf, nextStep, windowProblem } from '../logic';
import { isDone, NEEDS_CODE } from '../statuses';
import { AcceptancePanel } from './acceptance-panel';
import {
  EditDialog,
  NextStepButton,
  ResolveDialog,
  type ResolveIntent,
  StatusMenu,
  useTransition,
  useTransitionError,
} from './actions';
import { DetailsCard, RelatedCard } from './aside-cards';
import { CabAttention, ChangeCard, type PlanMode } from './change-card';
import { Composer, type ComposerState, type ComposerTab } from './composer';
import { ConfirmPanel } from './confirm-panel';
import { CustomFieldsCard } from './custom-fields-card';
import { NewProblemDialog } from './new-problem';
import { AnswersCard, MajorBanner, ResolutionCard, SlaTimers, SourceChip } from './parts';
import { ProblemCard } from './problem-card';
import { Timeline, useActivities } from './timeline';

/** Contributions that render nothing (e.g. ALM's panel on non-change tickets) leave no empty card behind. */
const wrapSlot = (node: ReactNode) => (
  <Card className="min-w-0 gap-0 py-4 has-[[data-slot=card-content]:empty]:hidden">
    <CardContent className="px-4">{node}</CardContent>
  </Card>
);

/**
 * The agent workspace for one ticket. Header: the next lifecycle step as the primary button, side exits in "Other
 * status". What needs the viewer (acceptance, "is it fixed?") sits right under it. Main column: the work (resolution,
 * description, plan, conversation). Aside: the fields agents edit first, then AI assist, related items and the rest.
 */
export function AgentView({ ticket, refetch }: { ticket: TicketDetail; refetch: () => void }) {
  const t = useTranslations('itsm.ticket');
  const tt = useTranslations('itsm');
  const ta = useTranslations('itsm.actions');
  const { user } = usePlatform();
  const router = useRouter();
  const api = useApi();
  const now = useNow({ updateInterval: 60_000 });
  const activities = useActivities(ticket.reference);
  const [tab, setTab] = useState<ComposerTab>('reply');
  const [reply, setReply] = useState('');
  const [note, setNote] = useState('');
  const replyRef = useRef<HTMLTextAreaElement | null>(null);
  const composer: ComposerState = { tab, setTab, reply, setReply, note, setNote, replyRef };
  const refetchActivities = activities.refetch;
  const [articles, setArticles] = useState<ReplyArticle[]>([]);
  const [resolving, setResolving] = useState<ResolveIntent | null>(null);
  const [editing, setEditing] = useState(false);
  const [plan, setPlan] = useState<PlanMode>(null);
  const [problemOpen, setProblemOpen] = useState(false);
  const canProblems = useCan('itsm.problems.manage');
  const canChanges = useCan('itsm.changes.manage');

  const insertReply = useCallback((text: string, meta?: { article?: ReplyArticle }) => {
    const article = meta?.article;
    if (article) setArticles((prev) => [...prev.filter((a) => a.id !== article.id), article]);
    setTab('reply');
    setReply((prev) => (prev.trim() ? `${prev.trimEnd()}\n\n${text}` : text));
    // After the tab renders: bring the composer into view for review.
    requestAnimationFrame(() => {
      replyRef.current?.focus();
      replyRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
  }, []);
  const refresh = useCallback(() => {
    refetch();
    void refetchActivities();
  }, [refetch, refetchActivities]);
  const linkTicket = useCallback<TicketAsideSlotProps['actions']['linkTicket']>(
    async (reference, link) => {
      await api.post(`${ticketApi(ticket.reference)}/links`, { target: reference, ...link });
      refresh();
    },
    [api, ticket.reference, refresh],
  );
  const slotProps = useMemo<TicketAsideSlotProps>(
    () => ({ ticket, actions: { insertReply, refresh, linkTicket } }),
    [ticket, insertReply, refresh, linkTicket],
  );

  const transition = useTransition(ticket);
  const onTransitionError = useTransitionError();
  const assign = useApiMutation((a) => a.post<TicketDetail>(`${ticketApi(ticket.reference)}/assign-to-me`), {
    invalidate: INVALIDATE,
    success: ta('assignedToMe'),
  });

  const done = isDone(ticket.status);
  const editable = ticket.viewer.canEdit;
  const step = nextStep({
    type: ticket.type,
    status: ticket.status,
    signOff: ticket.signOff,
    transitions: ticket.viewer.transitions,
  });
  const finish = ticket.viewer.transitions.find((s) => s === 'resolved' || s === 'fulfilled');
  // Problems that are still investigated can also be resolved straight away (secondary).
  const secondaryResolve = ticket.type === 'problem' && finish && step?.to !== finish ? finish : null;
  const menu = ticket.viewer.transitions.filter(
    (s) => s !== step?.to && s !== secondaryResolve && !(ticket.type === 'change' && s === 'assessment'),
  );
  const acceptanceBlocks =
    step?.key === 'closeChange' && ticket.acceptance?.required && ticket.acceptance.state !== 'accepted';

  const go = (status: TicketStatus) => {
    if (NEEDS_CODE.includes(status)) {
      setResolving({ status, article: articles.at(-1) ?? null });
      return;
    }
    // Submitting needs a planned window that hasn't started: open the plan instead of failing.
    if (status === 'authorization' && ticket.change && windowProblem(ticket.change, now)) {
      setPlan('submit');
      return;
    }
    transition.mutate({ status }, { onError: (err) => onTransitionError(err, () => setPlan('submit')) });
  };

  const back = listOf(ticket.type);
  const actions: DetailAction[] = [];
  if (secondaryResolve)
    actions.push({
      id: 'resolve',
      label: ta('next.resolve'),
      onSelect: () => go(secondaryResolve),
    });
  if (editable && !done && ticket.assignee?.id !== user.id)
    actions.push({
      id: 'assign',
      label: ta('assignToMe'),
      icon: <HandIcon />,
      onSelect: () => assign.mutate(undefined),
    });
  const more: DetailAction[] = [];
  if (editable && !done)
    more.push({
      id: 'edit',
      label: ta('editButton'),
      icon: <PencilIcon />,
      onSelect: () => setEditing(true),
    });
  if (ticket.type === 'change' && editable && canChanges && !done)
    more.push({ id: 'plan', label: ta('editPlan'), icon: <PencilIcon />, onSelect: () => setPlan('edit') });
  if (ticket.type === 'incident' && canProblems)
    more.push({
      id: 'problem',
      label: ta('createProblem'),
      icon: <BugIcon />,
      onSelect: () => setProblemOpen(true),
    });

  const resolveKind =
    !done && finish && (ticket.type === 'incident' || ticket.type === 'service_request')
      ? finish === 'fulfilled'
        ? 'fulfil'
        : 'resolve'
      : null;

  return (
    <div className="grid gap-4">
      <DetailHeader
        className="pb-0"
        back={{ href: back.href, label: tt(`ticket.backTo.${back.key}`), highlight: ticket.id }}
        reference={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <span className="inline-flex items-center gap-1.5 font-mono font-medium text-foreground">
              <TypeIcon type={ticket.type} />
              {ticket.reference}
            </span>
            <span>{tt(`types.${ticket.type}`)}</span>
            <SourceChip ticket={ticket} />
          </span>
        }
        title={ticket.title}
        status={<TicketStatusBadge status={ticket.status} signOff={Boolean(ticket.signOff)} animate />}
        badges={
          <>
            <PriorityBadge priority={ticket.priority} long />
            {ticket.major && <MajorBadge />}
          </>
        }
        meta={<SlaTimers ticket={ticket} />}
        primaryAction={
          step ? (
            <NextStepButton
              step={step}
              pending={transition.isPending && !resolving}
              disabledHint={acceptanceBlocks ? ta('waitingForAcceptance') : null}
              onClick={() => go(step.to)}
            />
          ) : null
        }
        actions={actions}
        menu={more}
      >
        <StatusMenu ticket={ticket} statuses={menu} pending={transition.isPending && !step} onSelect={go} />
      </DetailHeader>
      {ticket.major && <MajorBanner />}
      <ConfirmPanel ticket={ticket} />
      {ticket.type === 'change' && <CabAttention ticket={ticket} />}
      {ticket.type === 'change' && ticket.viewer.canAccept && <AcceptancePanel ticket={ticket} />}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="grid min-w-0 grid-cols-1 content-start gap-4">
          <ResolutionCard ticket={ticket} />
          <Card className="gap-4">
            <CardHeader>
              <CardTitle>{t('description')}</CardTitle>
            </CardHeader>
            <CardContent>
              {ticket.description ? (
                <Markdown>{ticket.description}</Markdown>
              ) : (
                <p className="text-sm text-muted-foreground">{t('noDescription')}</p>
              )}
            </CardContent>
          </Card>
          <AnswersCard ticket={ticket} />
          {ticket.type === 'problem' && <ProblemCard ticket={ticket} />}
          {ticket.type === 'change' && <ChangeCard ticket={ticket} plan={plan} onPlanChange={setPlan} />}
          {ticket.type === 'change' && !ticket.viewer.canAccept && <AcceptancePanel ticket={ticket} />}
          <section aria-labelledby="itsm-activity" className="grid gap-4">
            <h2 id="itsm-activity" className="text-base font-semibold">
              {t('activity')}
            </h2>
            <Timeline
              ticket={ticket}
              items={activities.items}
              total={activities.total}
              isLoading={activities.isLoading}
            />
            <Composer
              ticketRef={ticket.reference}
              state={composer}
              canComment={ticket.viewer.canComment}
              canWorkNote={ticket.viewer.canWorkNote}
              resolveWith={
                resolveKind && finish
                  ? {
                      kind: resolveKind,
                      onResolve: (text) =>
                        setResolving({ status: finish, notes: text, article: articles.at(-1) }),
                    }
                  : null
              }
            />
          </section>
        </div>
        <aside className="grid min-w-0 grid-cols-1 content-start gap-4" aria-label={t('aside')}>
          <DetailsCard ticket={ticket} />
          <Slot
            name="itsm.ticket.aside"
            props={slotProps}
            fallback={<Skeleton className="h-24 w-full rounded-lg" />}
            wrap={wrapSlot}
          />
          <RelatedCard ticket={ticket} />
          <CustomFieldsCard ticket={ticket} />
          <Slot<RecordPanelSlotProps> name="core.record.files" props={{ record: recordRef(ticket) }} />
        </aside>
      </div>
      <ResolveDialog
        ticket={ticket}
        intent={resolving}
        onOpenChange={(o) => !o && setResolving(null)}
        onResolved={() => {
          if (resolving?.notes) setReply('');
          setArticles([]);
        }}
      />
      <EditDialog ticket={ticket} open={editing} onOpenChange={setEditing} />
      {ticket.type === 'incident' && canProblems && (
        <NewProblemDialog
          open={problemOpen}
          onOpenChange={setProblemOpen}
          from={ticket}
          onCreated={(ref) => router.push(`/itsm/tickets/${encodeURIComponent(ref)}`)}
        />
      )}
    </div>
  );
}
