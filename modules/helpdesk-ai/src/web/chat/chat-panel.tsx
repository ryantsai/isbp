'use client';

import { Badge } from '@astryxdesign/core/Badge';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import {
  ChatComposer,
  ChatComposerInput,
  type ChatComposerInputHandle,
  ChatSendButton,
} from '@astryxdesign/core/Chat';
import { Icon as AstryxIcon } from '@astryxdesign/core/Icon';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { Link } from '@astryxdesign/core/Link';
import { List, ListItem } from '@astryxdesign/core/List';
import { Heading, Text } from '@astryxdesign/core/Text';
import { ApiError } from '@isbp/sdk/web';
import { ErrorState } from '@isbp/ui/empty-state';
import { AnimatedList, Collapse, duration, ease, useReducedMotion } from '@isbp/ui/motion';
import { useApiQuery, useErrorText } from '@isbp/ui/query';
import { Skeleton } from '@isbp/ui/skeleton';
import {
  CircleCheckIcon,
  KeyRoundIcon,
  LifeBuoyIcon,
  ShieldCheckIcon,
  ThumbsUpIcon,
  TicketCheckIcon,
  TicketPlusIcon,
  WifiIcon,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
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
  const input = useRef<ChatComposerInputHandle>(null);
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
    if (initialQuestion) input.current?.focus();
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
          <Badge
            variant="success"
            label={t('conversationStatus.resolved')}
            icon={<AstryxIcon icon={CircleCheckIcon} size="xsm" />}
          />
        )}
        {conv?.status === 'escalated' && (
          <Badge
            variant="info"
            label={t('conversationStatus.escalated')}
            icon={<AstryxIcon icon={TicketCheckIcon} size="xsm" />}
          />
        )}
        {variant === 'sheet' && (
          <span className="ml-auto">
            <Link
              href={conversationId ? `/helpdesk-ai/chat?c=${conversationId}` : '/helpdesk-ai/chat'}
              size="xsm"
              weight="medium"
            >
              {t('chat.openFull')}
            </Link>
          </span>
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
        <div className="px-4 pb-2">
          <Banner
            status="error"
            title={
              chat.error === 'NETWORK'
                ? t('chat.networkError')
                : t.has(`chatErrors.${chat.error}`)
                  ? t(`chatErrors.${chat.error}`)
                  : errorText(new ApiError(0, chat.error, t('chat.genericError')))
            }
            collapsible={false}
            isDismissable
            dismissLabel={t('chat.dismissError')}
            onDismiss={chat.clearError}
          />
        </div>
      )}

      <div className="border-t p-3">
        <ChatComposer
          value={draft}
          onChange={(v) => setDraft(v.slice(0, 4_000))}
          onSubmit={(v) => void submit(v)}
          placeholder={disabled ? t('chat.disabled') : t('chat.placeholder')}
          isDisabled={disabled}
          density="compact"
          elevation="none"
          input={
            <ChatComposerInput
              handleRef={input}
              label={t('chat.inputLabel')}
              hasHistory={false}
              maxRows={6}
            />
          }
          sendButton={<ChatSendButton size="sm" isDisabled={!draft.trim() || chat.busy || disabled} />}
        />
        <Text as="p" display="block" type="supporting" color="secondary">
          {t('chat.hint')}
        </Text>
      </div>
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
          <span className="ml-auto">
            <Link href={`/itsm/tickets/${ref}`} weight="medium">
              {t('chat.viewTicket')}
            </Link>
          </span>
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
      <VStack gap={1.5} hAlign="center">
        <Heading level={2}>{t('chat.welcomeTitle')}</Heading>
        <Text as="p" display="block" type="supporting" color="secondary">
          {t('chat.welcomeBody')}
        </Text>
      </VStack>
      <div className="w-full text-left">
        <List hasDividers header={<Text type="label">{t('chat.starters')}</Text>}>
          {STARTERS.map(({ key, icon }) => (
            <ListItem
              key={key}
              label={t(`starters.${key}`)}
              startContent={<AstryxIcon icon={icon} />}
              isDisabled={disabled}
              onClick={() => onPick(t(`starters.${key}`))}
            />
          ))}
        </List>
      </div>
    </div>
  );
}

/** "Did this solve it? [Yes, thanks] [No, raise a ticket]" — the one way to close or escalate an answer. */
function Feedback({ onSolved, onRaise, busy }: { onSolved: () => void; onRaise: () => void; busy: boolean }) {
  const t = useTranslations('helpdesk-ai');
  return (
    <HStack gap={2} wrap="wrap" vAlign="center">
      <Text color="secondary">{t('chat.didItHelp')}</Text>
      <Button
        label={t('chat.solved')}
        variant="secondary"
        size="sm"
        icon={<AstryxIcon icon={ThumbsUpIcon} />}
        isLoading={busy}
        onClick={onSolved}
      />
      <Button
        label={t('chat.stillNeedHelp')}
        variant="secondary"
        size="sm"
        icon={<AstryxIcon icon={TicketPlusIcon} />}
        onClick={onRaise}
      />
    </HStack>
  );
}
