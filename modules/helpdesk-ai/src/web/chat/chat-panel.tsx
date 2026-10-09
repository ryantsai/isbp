'use client';

import { ApiError } from '@isbp/sdk/web';
import { cn } from '@isbp/ui';
import { Badge } from '@isbp/ui/badge';
import { Button } from '@isbp/ui/button';
import { AnimatedList, Collapse, duration, ease, useReducedMotion } from '@isbp/ui/motion';
import { ErrorState } from '@isbp/ui/empty-state';
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
  TicketPlusIcon,
  WifiIcon,
  XIcon,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useRef, useState } from 'react';
import type { ChatMessage, ConversationDetail, HelpdeskAiStatus, TicketProposal } from '../../contracts';
import { ModeBadge } from '../shared';
import { AgentAvatar, AssistantMessage, UserMessage } from './message';
import { ProposalCard } from './proposal-card';
import { useChat } from './use-chat';

const STARTERS = [
  { key: 'vpn', icon: WifiIcon },
  { key: 'password', icon: KeyRoundIcon },
  { key: 'mfa', icon: ShieldCheckIcon },
  { key: 'access', icon: LifeBuoyIcon },
] as const;

/**
 * The virtual agent conversation, shared by the full-page chat and the "Ask IT" sheet: streamed answers with the
 * articles they are based on, one "Did this solve it? Yes, thanks / No, raise a ticket" row, and the ticket draft
 * the user confirms (it opens in place under the answer).
 */
export function ChatPanel({
  conversationId,
  onConversationChange,
  variant = 'page',
  initialQuestion,
}: {
  conversationId: string | null;
  onConversationChange: (id: string) => void;
  variant?: 'page' | 'sheet';
  /** A question handed over by another page (`?q=`, e.g. the command palette): put in the box for the person to send. */
  initialQuestion?: string;
}) {
  const t = useTranslations('helpdesk-ai');
  const errorText = useErrorText();
  const status = useApiQuery<HelpdeskAiStatus>('/helpdesk-ai/status');
  const chat = useChat(conversationId, onConversationChange);
  const [draft, setDraft] = useState(initialQuestion ?? '');
  // A new question handed over while the page is open (the palette again) replaces the text in the box.
  const [handedOver, setHandedOver] = useState(initialQuestion);
  if (initialQuestion !== handedOver) {
    setHandedOver(initialQuestion);
    if (initialQuestion) setDraft(initialQuestion);
  }
  // Drafts the user opened ("No, raise a ticket") or closed ("Not now"), by message id.
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set());
  const [focusDraft, setFocusDraft] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const inputId = useId();
  const reduce = useReducedMotion();
  const conv = chat.conversation;
  const disabled = status.data ? !status.data.virtualAgentEnabled : false;

  // "I've raised INC-…" is stored in the conversation; here the ticket card below says it, with its link.
  const note = chat.messages.at(-1);
  const raisedNote =
    !!conv?.ticketRef &&
    note?.role === 'assistant' &&
    note.mode === 'builtin' &&
    !note.citations.length &&
    !note.proposal &&
    note.content.includes(conv.ticketRef);
  const messages = raisedNote ? chat.messages.slice(0, -1) : chat.messages;
  const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant') ?? null;
  const lastIsAssistant = messages.at(-1)?.role === 'assistant' && !chat.pendingQuestion;
  const open = conv?.status === 'open';

  // A handed-over question: the cursor waits at its end, ready to send or edit.
  useEffect(() => {
    const el = input.current;
    if (!initialQuestion || !el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [initialQuestion]);

  // Keep the newest content in view while answers stream in.
  const streamed = chat.pendingAnswer?.text.length ?? 0;
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: reduce ? 'auto' : 'smooth' });
  }, [messages.length, streamed, chat.pendingQuestion, reduce]);

  const submit = async (text: string) => {
    if (!text.trim() || chat.busy || disabled) return;
    setDraft('');
    const ok = await chat.send(text);
    if (!ok) setDraft(text);
    input.current?.focus();
  };

  /** The model offered a ticket, or nothing was found: the draft is open from the start. */
  const draftOpen = (m: ChatMessage) =>
    !!m.proposal && !closed.has(m.id) && (opened.has(m.id) || m.mode === 'llm' || m.citations.length === 0);

  const raiseTicket = (m: ChatMessage) => {
    if (!m.proposal) {
      void submit(t('chat.stillNeedHelpMessage'));
      return;
    }
    setClosed((s) => without(s, m.id));
    setOpened((s) => new Set(s).add(m.id));
    setFocusDraft(m.id);
  };

  const create = (p: TicketProposal) => {
    if (conv) chat.escalate.mutate({ id: conv.id, proposal: p });
  };

  /** Once the draft has opened: bring it into view and put the cursor in its title. */
  const draftShown = (el: HTMLElement | null, id: string) => {
    if (!el) return;
    el.scrollIntoView({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' });
    if (focusDraft === id) {
      el.querySelector<HTMLInputElement>('input')?.focus({ preventScroll: true });
      setFocusDraft(null);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex min-h-11 flex-wrap items-center gap-2 border-b px-4 py-2">
        <ModeBadge ai={status.data?.ai} audience="people" />
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
        {chat.loadError && !conv && !chat.pendingQuestion && !chat.pendingAnswer ? (
          <ErrorState error={chat.loadError} onRetry={chat.reload} />
        ) : chat.loading ? (
          <div className="space-y-4" role="status" aria-busy="true" aria-label={t('chat.loading')}>
            <Skeleton className="ml-auto h-10 w-2/3 rounded-2xl" />
            <Skeleton className="h-24 w-3/4 rounded-2xl" />
          </div>
        ) : !messages.length && !chat.pendingQuestion ? (
          <Welcome onPick={(q) => void submit(q)} disabled={disabled || chat.busy} />
        ) : (
          <div role="log" aria-live="polite" aria-relevant="additions" aria-label={t('chat.log')}>
            {/* Keyed by position, so the streamed copy and the stored one are the same item (no replay). */}
            <AnimatedList as="ol" key={conversationId ?? 'new'}>
              {messages.map((m, i) =>
                m.role === 'user' ? (
                  <UserMessage key={i} content={m.content} label={t('chat.you')} />
                ) : (
                  <AssistantMessage
                    key={i}
                    content={m.content}
                    citations={m.citations}
                    numbered={m.mode === 'llm'}
                    label={t('chat.agent')}
                  >
                    {m.id === lastAssistant?.id && lastIsAssistant && !chat.busy && open && (
                      <>
                        {!draftOpen(m) && (
                          <Feedback
                            onSolved={() => conv && chat.resolve.mutate(conv.id)}
                            onRaise={() => raiseTicket(m)}
                            busy={chat.resolve.isPending}
                          />
                        )}
                        {m.proposal && (
                          <Collapse
                            open={draftOpen(m)}
                            onOpened={() => draftShown(document.getElementById(`hai-draft-${m.id}`), m.id)}
                          >
                            {/* relative: the form's visually hidden radios are clipped with it while it's closed. */}
                            <div id={`hai-draft-${m.id}`} className="relative pt-1">
                              <ProposalCard
                                key={m.id}
                                proposal={m.proposal}
                                onDismiss={() => {
                                  setOpened((s) => without(s, m.id));
                                  setClosed((s) => new Set(s).add(m.id));
                                }}
                                onCreate={create}
                                creating={chat.escalate.isPending}
                              />
                            </div>
                          </Collapse>
                        )}
                      </>
                    )}
                  </AssistantMessage>
                ),
              )}
              {chat.pendingQuestion && (
                <UserMessage
                  key={chat.messages.length}
                  content={chat.pendingQuestion}
                  label={t('chat.you')}
                />
              )}
              {chat.pendingAnswer && (
                <AssistantMessage
                  key={chat.pendingAnswer.base + 1}
                  content={chat.pendingAnswer.text}
                  citations={[]}
                  label={t('chat.agent')}
                  tool={chat.pendingAnswer.tool}
                  busy
                />
              )}
            </AnimatedList>
          </div>
        )}

        {conv && !chat.busy && <Outcome key={conv.id} conv={conv} />}
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
        <div className="flex items-end gap-2 rounded-xl border bg-background px-2 py-1.5 shadow-xs transition-shadow focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50 motion-reduce:transition-none">
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

function without(set: ReadonlySet<string>, id: string): ReadonlySet<string> {
  const next = new Set(set);
  next.delete(id);
  return next;
}

/**
 * "Glad that helped" or "Ticket INC-… was raised". Mounted with the loaded conversation, so it appears with a
 * short fade only when the outcome changes while the person is here, not on every visit.
 */
function Outcome({ conv }: { conv: ConversationDetail }) {
  const t = useTranslations('helpdesk-ai');
  const reduce = useReducedMotion();
  const fade = {
    initial: reduce ? false : { opacity: 0, y: 4 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: duration.base, ease: ease.enter },
  } as const;
  const ref = conv.status === 'escalated' ? conv.ticketRef : null;
  return (
    <AnimatePresence initial={false}>
      {conv.status === 'resolved' && (
        <motion.p
          key="resolved"
          {...fade}
          className="flex items-center gap-2 text-sm text-muted-foreground"
          role="status"
        >
          <CircleCheckIcon className="size-4 text-success" aria-hidden /> {t('chat.resolved')}
        </motion.p>
      )}
      {ref && (
        <motion.div
          key="escalated"
          {...fade}
          role="status"
          className="flex flex-wrap items-center gap-2 rounded-xl border bg-info/8 px-3 py-2 text-sm"
        >
          <TicketCheckIcon className="size-4 text-info" aria-hidden />
          <span>{t('chat.ticketRaised', { reference: ref })}</span>
          <Link href={`/itsm/tickets/${ref}`} className="ml-auto font-medium text-primary hover:underline">
            {t('chat.viewTicket')}
          </Link>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Welcome({ onPick, disabled }: { onPick: (q: string) => void; disabled: boolean }) {
  const t = useTranslations('helpdesk-ai');
  return (
    <div className="mx-auto flex max-w-lg flex-col items-center gap-5 py-6 text-center">
      <div className="relative">
        <div
          aria-hidden
          className="absolute -inset-3 rounded-full bg-gradient-to-br from-primary/25 to-chart-4/20 blur-xl"
        />
        <div className="relative scale-150">
          <AgentAvatar />
        </div>
      </div>
      <div className="space-y-1.5">
        <h2 className="text-lg font-semibold tracking-tight">{t('chat.welcomeTitle')}</h2>
        <p className="text-sm text-muted-foreground">{t('chat.welcomeBody')}</p>
      </div>
      <ul className="grid w-full grid-cols-1 gap-2 sm:grid-cols-2" aria-label={t('chat.starters')}>
        {STARTERS.map(({ key, icon: Icon }) => (
          <li key={key} className="min-w-0">
            <button
              type="button"
              disabled={disabled}
              onClick={() => onPick(t(`starters.${key}`))}
              className={cn(
                'flex h-full w-full min-w-0 items-center gap-2.5 rounded-xl border bg-card px-3 py-2.5 text-left text-sm shadow-xs outline-none transition-colors',
                'hover:border-ring/40 hover:bg-accent/40 focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none',
              )}
            >
              <Icon className="size-4 shrink-0 text-primary" aria-hidden />
              <span className="min-w-0">{t(`starters.${key}`)}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** "Did this solve it? [Yes, thanks] [No, raise a ticket]" — the one way to close or escalate an answer. */
function Feedback({ onSolved, onRaise, busy }: { onSolved: () => void; onRaise: () => void; busy: boolean }) {
  const t = useTranslations('helpdesk-ai');
  return (
    <div className="flex flex-wrap items-center gap-2 pt-1">
      <span className="text-sm text-muted-foreground">{t('chat.didItHelp')}</span>
      <Button size="sm" variant="outline" onClick={onSolved} loading={busy}>
        <ThumbsUpIcon /> {t('chat.solved')}
      </Button>
      <Button size="sm" variant="outline" onClick={onRaise}>
        <TicketPlusIcon /> {t('chat.stillNeedHelp')}
      </Button>
    </div>
  );
}
