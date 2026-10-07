'use client';

import { ApiError } from '@isbp/sdk/web';
import { cn } from '@isbp/ui';
import { Badge } from '@isbp/ui/badge';
import { Button } from '@isbp/ui/button';
import { useApiQuery, useErrorText } from '@isbp/ui/query';
import { Skeleton } from '@isbp/ui/skeleton';
import { Textarea } from '@isbp/ui/textarea';
import {
  ArrowUpIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  KeyRoundIcon,
  LifeBuoyIcon,
  ShieldCheckIcon,
  ThumbsUpIcon,
  TicketCheckIcon,
  WifiIcon,
  XIcon,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useRef, useState } from 'react';
import type { ChatMessage, HelpdeskAiStatus, TicketProposal } from '../../contracts';
import { ModeBadge } from '../shared';
import { AgentAvatar, AssistantMessage, TypingIndicator, UserMessage } from './message';
import { ProposalCard } from './proposal-card';
import { useChat } from './use-chat';

const STARTERS = [
  { key: 'vpn', icon: WifiIcon },
  { key: 'password', icon: KeyRoundIcon },
  { key: 'mfa', icon: ShieldCheckIcon },
  { key: 'access', icon: LifeBuoyIcon },
] as const;

/**
 * The virtual agent conversation, shared by the full-page chat and the "Ask IT" sheet: streamed answers
 * with citations, "that solved it" / "I still need help", and the ticket proposal the user confirms.
 */
export function ChatPanel({
  conversationId,
  onConversationChange,
  variant = 'page',
}: {
  conversationId: string | null;
  onConversationChange: (id: string) => void;
  variant?: 'page' | 'sheet';
}) {
  const t = useTranslations('helpdesk-ai');
  const errorText = useErrorText();
  const status = useApiQuery<HelpdeskAiStatus>('/helpdesk-ai/status');
  const chat = useChat(conversationId, onConversationChange);
  const [draft, setDraft] = useState('');
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [created, setCreated] = useState<{ reference: string; href: string } | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const inputId = useId();
  const conv = chat.conversation;
  const disabled = status.data ? !status.data.virtualAgentEnabled : false;

  const messages = chat.messages;
  const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant') ?? null;
  const lastIsAssistant = messages.at(-1)?.role === 'assistant' && !chat.pendingQuestion;
  const open = conv?.status !== 'escalated';

  // Keep the newest content in view while answers stream in.
  const streamed = chat.pendingAnswer?.text.length ?? 0;
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [messages.length, streamed, chat.pendingQuestion]);

  const submit = async (text: string) => {
    if (!text.trim() || chat.busy || disabled) return;
    setDraft('');
    setCreated(null);
    const ok = await chat.send(text);
    if (!ok) setDraft(text);
    input.current?.focus();
  };

  const needHelp = (m: ChatMessage) => {
    if (m.proposal) setExpanded((s) => new Set(s).add(m.id));
    else void submit(t('chat.stillNeedHelpMessage'));
  };

  const create = (p: TicketProposal) => {
    if (!conv) return;
    chat.escalate.mutate(
      { id: conv.id, proposal: p },
      {
        onSuccess: (r) =>
          setCreated({ reference: r.ticket.reference, href: `/itsm/tickets/${r.ticket.reference}` }),
      },
    );
  };

  const ticketLink =
    created ??
    (conv?.ticketRef ? { reference: conv.ticketRef, href: `/itsm/tickets/${conv.ticketRef}` } : null);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex min-h-11 items-center gap-2 border-b px-4 py-2">
        <ModeBadge ai={status.data?.ai} />
        {conv?.status === 'resolved' && (
          <Badge variant="success">
            <CircleCheckIcon aria-hidden /> {t('conversationStatus.resolved')}
          </Badge>
        )}
        {conv?.status === 'escalated' && (
          <Badge variant="info">
            <TicketCheckIcon aria-hidden /> {t('conversationStatus.escalated')}
          </Badge>
        )}
        {variant === 'sheet' && (
          <Link
            href={conversationId ? `/helpdesk-ai/chat?c=${conversationId}` : '/helpdesk-ai/chat'}
            className="ml-auto text-xs font-medium text-primary hover:underline"
          >
            {t('chat.openFull')}
          </Link>
        )}
      </div>

      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {chat.loading ? (
          <div className="space-y-4" aria-busy="true" aria-label={t('chat.loading')}>
            <Skeleton className="ml-auto h-10 w-2/3 rounded-2xl" />
            <Skeleton className="h-24 w-3/4 rounded-2xl" />
          </div>
        ) : !messages.length && !chat.pendingQuestion ? (
          <Welcome onPick={(q) => void submit(q)} disabled={disabled || chat.busy} />
        ) : (
          <div role="log" aria-live="polite" aria-relevant="additions" aria-label={t('chat.log')}>
            <ol className="space-y-4">
              {messages.map((m) =>
                m.role === 'user' ? (
                  <UserMessage key={m.id} content={m.content} label={t('chat.you')} />
                ) : (
                  <AssistantMessage
                    key={m.id}
                    content={m.content}
                    citations={m.citations}
                    label={t('chat.agent')}
                  >
                    {m.id === lastAssistant?.id && lastIsAssistant && !chat.busy && (
                      <>
                        {m.proposal && open && !dismissed.has(m.id) && (
                          <ProposalCard
                            key={m.id}
                            proposal={m.proposal}
                            expanded={expanded.has(m.id) || m.mode === 'llm'}
                            onExpand={() => setExpanded((s) => new Set(s).add(m.id))}
                            onDismiss={() => setDismissed((s) => new Set(s).add(m.id))}
                            onCreate={create}
                            creating={chat.escalate.isPending}
                          />
                        )}
                        {conv?.status === 'open' && (
                          <Feedback
                            onSolved={() => chat.resolve.mutate(conv.id)}
                            onNeedHelp={() => needHelp(m)}
                            busy={chat.resolve.isPending}
                          />
                        )}
                      </>
                    )}
                  </AssistantMessage>
                ),
              )}
              {chat.pendingQuestion && (
                <UserMessage key="pending-q" content={chat.pendingQuestion} label={t('chat.you')} />
              )}
              {chat.pendingAnswer &&
                (chat.pendingAnswer.text ? (
                  // aria-busy: assistive tech waits for the stored copy instead of reading every delta.
                  <AssistantMessage
                    key="pending-a"
                    content={chat.pendingAnswer.text}
                    citations={[]}
                    label={t('chat.agent')}
                    busy
                  />
                ) : (
                  <TypingIndicator key="typing" tool={chat.pendingAnswer.tool} />
                ))}
            </ol>
          </div>
        )}

        <AnimatePresence>
          {conv?.status === 'resolved' && !chat.busy && (
            <motion.p
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-4 flex items-center gap-2 text-sm text-muted-foreground"
              role="status"
            >
              <CircleCheckIcon className="size-4 text-success" aria-hidden /> {t('chat.resolved')}
            </motion.p>
          )}
          {ticketLink && conv?.status === 'escalated' && (
            <motion.div
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              role="status"
              className="mt-4 flex flex-wrap items-center gap-2 rounded-xl border bg-info/8 px-3 py-2 text-sm"
            >
              <TicketCheckIcon className="size-4 text-info" aria-hidden />
              <span>{t('chat.ticketRaised', { reference: ticketLink.reference })}</span>
              <Link href={ticketLink.href} className="ml-auto font-medium text-primary hover:underline">
                {t('chat.viewTicket')}
              </Link>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {chat.error && (
        <div
          role="alert"
          className="mx-4 mb-2 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/8 px-3 py-2 text-sm text-destructive"
        >
          <CircleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1">
            {chat.error === 'NETWORK'
              ? t('chat.networkError')
              : t.has(`chatErrors.${chat.error}`)
                ? t(`chatErrors.${chat.error}`)
                : errorText(new ApiError(0, chat.error, t('chat.genericError')))}
          </span>
          <button
            type="button"
            onClick={chat.clearError}
            className="rounded-sm opacity-70 outline-none hover:opacity-100 focus-visible:ring-[3px] focus-visible:ring-ring/50"
            aria-label={t('chat.dismissError')}
          >
            <XIcon className="size-4" />
          </button>
        </div>
      )}

      <form
        className="border-t bg-card/60 p-3"
        onSubmit={(e) => {
          e.preventDefault();
          void submit(draft);
        }}
      >
        <label htmlFor={inputId} className="sr-only">
          {t('chat.inputLabel')}
        </label>
        <div className="flex items-end gap-2 rounded-xl border bg-background px-2 py-1.5 shadow-xs transition-shadow focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50">
          <Textarea
            id={inputId}
            ref={input}
            value={draft}
            rows={1}
            maxLength={4_000}
            disabled={disabled}
            placeholder={disabled ? t('chat.disabled') : t('chat.placeholder')}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              // Enter sends; Shift+Enter adds a line; never while an IME is composing (zh / ja input).
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void submit(draft);
              }
            }}
            aria-describedby={`${inputId}-hint`}
            className="max-h-40 min-h-9 resize-none border-0 bg-transparent px-1.5 py-1.5 shadow-none focus-visible:ring-0 dark:bg-transparent"
          />
          <Button
            type="submit"
            size="icon-sm"
            className="mb-0.5 rounded-lg"
            disabled={!draft.trim() || chat.busy || disabled}
            aria-label={t('chat.send')}
          >
            <ArrowUpIcon />
          </Button>
        </div>
        <p id={`${inputId}-hint`} className="mt-1.5 px-1 text-[11px] text-muted-foreground">
          {t('chat.hint')}
        </p>
      </form>
    </div>
  );
}

function Welcome({ onPick, disabled }: { onPick: (q: string) => void; disabled: boolean }) {
  const t = useTranslations('helpdesk-ai');
  return (
    <div className="mx-auto flex max-w-lg flex-col items-center gap-5 py-6 text-center">
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.3 }}
      >
        <div className="relative">
          <div
            aria-hidden
            className="absolute -inset-3 rounded-full bg-gradient-to-br from-primary/25 to-chart-4/20 blur-xl"
          />
          <div className="relative scale-150">
            <AgentAvatar />
          </div>
        </div>
      </motion.div>
      <div className="space-y-1.5">
        <h2 className="text-lg font-semibold tracking-tight">{t('chat.welcomeTitle')}</h2>
        <p className="text-sm text-muted-foreground">{t('chat.welcomeBody')}</p>
      </div>
      <ul className="grid w-full grid-cols-1 gap-2 sm:grid-cols-2" aria-label={t('chat.starters')}>
        {STARTERS.map(({ key, icon: Icon }, i) => (
          <motion.li
            key={key}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 * i + 0.1 }}
            className="min-w-0"
          >
            <button
              type="button"
              disabled={disabled}
              onClick={() => onPick(t(`starters.${key}`))}
              className={cn(
                'flex h-full w-full min-w-0 items-center gap-2.5 rounded-xl border bg-card px-3 py-2.5 text-left text-sm shadow-xs outline-none transition-all',
                'hover:-translate-y-0.5 hover:border-ring/40 hover:shadow-sm focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 motion-reduce:hover:translate-y-0',
              )}
            >
              <Icon className="size-4 shrink-0 text-primary" aria-hidden />
              <span className="min-w-0">{t(`starters.${key}`)}</span>
            </button>
          </motion.li>
        ))}
      </ul>
    </div>
  );
}

function Feedback({
  onSolved,
  onNeedHelp,
  busy,
}: {
  onSolved: () => void;
  onNeedHelp: () => void;
  busy: boolean;
}) {
  const t = useTranslations('helpdesk-ai');
  return (
    <div className="flex flex-wrap items-center gap-2 pt-1">
      <span className="text-xs text-muted-foreground">{t('chat.didItHelp')}</span>
      <Button size="sm" variant="outline" className="h-7 px-2.5 text-xs" onClick={onSolved} loading={busy}>
        <ThumbsUpIcon /> {t('chat.solved')}
      </Button>
      <Button size="sm" variant="ghost" className="h-7 px-2.5 text-xs" onClick={onNeedHelp}>
        <LifeBuoyIcon /> {t('chat.stillNeedHelp')}
      </Button>
    </div>
  );
}
