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
import { Icon } from '@astryxdesign/core/Icon';
import { IconButton } from '@astryxdesign/core/IconButton';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { Link } from '@astryxdesign/core/Link';
import { Heading, Text } from '@astryxdesign/core/Text';
import type { WebPageProps } from '@isbp/sdk/web';
import { EmptyState } from '@isbp/ui/empty-state';
import { Markdown } from '@isbp/ui/markdown';
import { AnimatedList, useReducedMotion } from '@isbp/ui/motion';
import { Skeleton } from '@isbp/ui/skeleton';
import {
  ArrowLeftIcon,
  BookOpenIcon,
  CircleCheckIcon,
  LogInIcon,
  MessageSquareOffIcon,
  SparklesIcon,
  SquarePenIcon,
  ThumbsUpIcon,
  TicketCheckIcon,
  TicketPlusIcon,
  XIcon,
} from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import type { ChatMessage, Citation, PublishedArticle } from '../../contracts';
import { AgentAvatar, AssistantMessage, UserMessage } from '../chat/message';
import { ProposalCard } from '../chat/proposal-card';
import { usePublishedChat } from './use-published-chat';

/** Asks the website around the chat to close it (the `embed.js` bubble listens for this, from this frame only). */
function askToClose() {
  window.parent.postMessage({ type: 'isbp-chat:close' }, '*');
}

/**
 * Ask IT published outside the platform (`/p/helpdesk-ai/chat/<token>`): opened as a link or in another website's
 * frame (`?embed=1`). Visitors of a chat for anyone read the chosen public articles in place; people of a chat for
 * signed-in users sign in once (in a window, when framed) and can raise tickets.
 */
export default function PublishedChatPage({ params }: WebPageProps) {
  const token = params.token ?? '';
  const t = useTranslations('helpdesk-ai');
  const embedded = useSearchParams().get('embed') === '1';
  const chat = usePublishedChat(token);
  const [draft, setDraft] = useState('');
  const [reading, setReading] = useState<{
    citation: Citation;
    article: PublishedArticle | null;
    failed: boolean;
  } | null>(null);
  const [proposalOpen, setProposalOpen] = useState<string | null>(null);
  const [needsHelp, setNeedsHelp] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<ChatComposerInputHandle>(null);
  const reduce = useReducedMotion();
  const { info, state, conversation: conv } = chat;
  const tickets = info?.tickets ?? false;
  const title = info?.title || t('chat.title');
  const messages = chat.messages;
  const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant') ?? null;
  const lastIsAssistant = messages.at(-1)?.role === 'assistant' && !chat.pendingQuestion;
  const open = !conv || conv.status === 'open';
  const asking = !!chat.pendingQuestion;
  const streamed = chat.pendingAnswer?.text.length ?? 0;

  useEffect(() => {
    document.title = title;
  }, [title]);

  // Escape closes the chat on the website around it.
  useEffect(() => {
    if (!embedded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) askToClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [embedded]);

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: reduce ? 'auto' : 'smooth' });
  }, [messages.length, streamed, asking, reduce]);

  const submit = async (text: string) => {
    if (!text.trim() || chat.busy) return;
    setDraft('');
    setNeedsHelp(false);
    const ok = await chat.send(text);
    if (!ok) setDraft(text);
    input.current?.focus();
  };

  const openArticle = async (citation: Citation) => {
    setReading({ citation, article: null, failed: false });
    try {
      if (!citation.id) throw new Error('no article id');
      setReading({ citation, article: await chat.article(citation.id), failed: false });
    } catch {
      setReading({ citation, article: null, failed: true });
    }
  };

  const stillNeedHelp = (m: ChatMessage) => {
    if (tickets && m.proposal) setProposalOpen(m.id);
    else if (tickets) void submit(t('chat.stillNeedHelpMessage'));
    else setNeedsHelp(true);
  };

  return (
    <div className="flex h-dvh min-h-0 flex-col">
      <header className="flex min-h-12 flex-wrap items-center gap-2 border-b px-4 py-2">
        <AgentAvatar />
        <VStack gap={0} className="min-w-0 flex-1">
          <Heading level={4} accessibilityLevel={1} maxLines={1}>
            {title}
          </Heading>
          {chat.userName && (
            <Text type="supporting" color="secondary" className="truncate">
              {t('published.signedInAs', { name: chat.userName })}
            </Text>
          )}
        </VStack>
        {info && (
          <Badge
            variant={info.mode === 'builtin' ? 'neutral' : 'info'}
            label={t(info.mode === 'builtin' ? 'mode.chatBuiltin' : 'mode.chatLlm')}
            icon={<Icon icon={info.mode === 'builtin' ? BookOpenIcon : SparklesIcon} size="xsm" />}
          />
        )}
        {state.status === 'ready' && messages.length > 0 && (
          <IconButton
            label={t('published.newConversation')}
            icon={<Icon icon={SquarePenIcon} />}
            variant="ghost"
            size="sm"
            isDisabled={chat.busy}
            onClick={() => {
              setReading(null);
              setNeedsHelp(false);
              chat.restart();
            }}
          />
        )}
        {embedded && (
          <IconButton
            label={t('published.close')}
            icon={<Icon icon={XIcon} />}
            variant="ghost"
            size="sm"
            onClick={askToClose}
          />
        )}
      </header>

      {reading ? (
        <ArticleReader reading={reading} onBack={() => setReading(null)} />
      ) : (
        <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {state.status === 'loading' ? (
            <div className="space-y-4" role="status" aria-busy="true" aria-label={t('published.loading')}>
              <Skeleton className="h-6 w-1/2" />
              <Skeleton className="h-20 w-full" />
            </div>
          ) : state.status === 'unavailable' ? (
            <EmptyState
              icon={<MessageSquareOffIcon />}
              title={t('published.unavailable')}
              description={t('published.unavailableBody')}
            />
          ) : state.status === 'sign_in' ? (
            <EmptyState
              icon={<LogInIcon />}
              title={t('published.signInTitle')}
              description={state.popupBlocked ? t('published.popupBlocked') : t('published.signInBody')}
              action={
                <VStack gap={2} hAlign="center">
                  <Button
                    label={t('published.signIn')}
                    variant="primary"
                    icon={<Icon icon={LogInIcon} />}
                    onClick={chat.signIn}
                  />
                  {state.popupBlocked && (
                    <Link href={`/p/helpdesk-ai/chat/${encodeURIComponent(token)}`} target="_blank">
                      {t('published.openInTab')}
                    </Link>
                  )}
                </VStack>
              }
            />
          ) : !messages.length && !chat.pendingQuestion ? (
            <VStack gap={2} hAlign="center" className="mx-auto max-w-lg py-6 text-center">
              <Heading level={2}>{t('chat.welcomeTitle')}</Heading>
              <Text as="p" display="block" type="supporting" color="secondary">
                {info?.welcome || t('chat.welcomeBody')}
              </Text>
              {!tickets && (
                <Text as="p" display="block" type="supporting" color="secondary">
                  {t('published.visitorNote')}
                </Text>
              )}
            </VStack>
          ) : (
            <div role="log" aria-live="polite" aria-relevant="additions" aria-label={t('chat.log')}>
              <AnimatedList as="ol" key={conv?.id ?? 'new'}>
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
                      onOpenArticle={(c) => void openArticle(c)}
                    >
                      {m.id === lastAssistant?.id && lastIsAssistant && !chat.busy && open && (
                        <>
                          {proposalOpen === m.id && m.proposal ? (
                            <ProposalCard
                              key={m.id}
                              proposal={m.proposal}
                              onDismiss={() => setProposalOpen(null)}
                              onCreate={(p) => void chat.escalate(p)}
                              creating={chat.busyAction === 'escalate'}
                            />
                          ) : needsHelp ? (
                            <Text as="p" display="block" type="supporting" color="secondary">
                              {t('published.noTickets')}
                            </Text>
                          ) : (
                            <HStack gap={2} wrap="wrap" vAlign="center">
                              <Text color="secondary">{t('chat.didItHelp')}</Text>
                              <Button
                                label={t('chat.solved')}
                                variant="secondary"
                                size="sm"
                                icon={<Icon icon={ThumbsUpIcon} />}
                                isLoading={chat.busyAction === 'resolve'}
                                onClick={() => void chat.resolve()}
                              />
                              <Button
                                label={tickets ? t('chat.stillNeedHelp') : t('published.stillNeedHelp')}
                                variant="secondary"
                                size="sm"
                                icon={<Icon icon={TicketPlusIcon} />}
                                onClick={() => stillNeedHelp(m)}
                              />
                            </HStack>
                          )}
                        </>
                      )}
                    </AssistantMessage>
                  ),
                )}
                {chat.pendingQuestion && (
                  <UserMessage key={messages.length} content={chat.pendingQuestion} label={t('chat.you')} />
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
              {conv?.status === 'resolved' && !chat.busy && (
                <HStack gap={2} vAlign="center" role="status">
                  <Icon icon={CircleCheckIcon} color="success" />
                  <Text color="secondary">{t('chat.resolved')}</Text>
                </HStack>
              )}
              {conv?.status === 'escalated' && conv.ticketRef && !chat.busy && (
                <HStack gap={2} vAlign="center" role="status" wrap="wrap">
                  <Icon icon={TicketCheckIcon} color="blue" />
                  <Text>{t('chat.ticketRaised', { reference: conv.ticketRef })}</Text>
                  <Link href={`/itsm/tickets/${conv.ticketRef}`} target="_blank" weight="medium">
                    {t('chat.viewTicket')}
                  </Link>
                </HStack>
              )}
            </div>
          )}
        </div>
      )}

      {chat.error && (
        <div className="px-4 pb-2">
          <Banner
            status="error"
            title={
              chat.error === 'NETWORK' || chat.error === 'NETWORK_ERROR'
                ? t('chat.networkError')
                : t.has(`chatErrors.${chat.error}`)
                  ? t(`chatErrors.${chat.error}`)
                  : t('chat.genericError')
            }
            collapsible={false}
            isDismissable
            dismissLabel={t('chat.dismissError')}
            onDismiss={chat.clearError}
          />
        </div>
      )}

      {state.status === 'ready' && !reading && (
        <div className="border-t p-3">
          <ChatComposer
            value={draft}
            onChange={(v) => setDraft(v.slice(0, 4_000))}
            onSubmit={(v) => void submit(v)}
            placeholder={t('chat.placeholder')}
            density="compact"
            elevation="none"
            input={
              <ChatComposerInput
                handleRef={input}
                label={t('chat.inputLabel')}
                hasHistory={false}
                maxRows={5}
              />
            }
            sendButton={<ChatSendButton size="sm" isDisabled={!draft.trim() || chat.busy} />}
          />
          <Text as="p" display="block" type="supporting" color="secondary">
            {t('chat.hint')}
          </Text>
        </div>
      )}
    </div>
  );
}

/** A cited article, read in place (with a way back to the conversation). */
function ArticleReader({
  reading,
  onBack,
}: {
  reading: { citation: Citation; article: PublishedArticle | null; failed: boolean };
  onBack: () => void;
}) {
  const t = useTranslations('helpdesk-ai');
  const format = useFormatter();
  const back = useRef<HTMLButtonElement>(null);
  useEffect(() => back.current?.focus(), []);
  const { citation, article, failed } = reading;
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
      <VStack gap={3}>
        <div>
          <Button
            ref={back}
            label={t('published.back')}
            variant="ghost"
            size="sm"
            icon={<Icon icon={ArrowLeftIcon} />}
            onClick={onBack}
          />
        </div>
        <Heading level={2}>{article?.title ?? citation.title}</Heading>
        {failed ? (
          <Banner status="error" title={t('published.articleError')} collapsible={false} />
        ) : !article ? (
          <div className="space-y-2" role="status" aria-busy="true" aria-label={t('published.loading')}>
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        ) : (
          <>
            <Text type="supporting" color="secondary">
              {article.reference} ·{' '}
              {t('published.articleUpdated', {
                date: format.dateTime(new Date(article.updatedAt), { dateStyle: 'medium' }),
              })}
            </Text>
            <Markdown>{article.body}</Markdown>
          </>
        )}
      </VStack>
    </div>
  );
}
