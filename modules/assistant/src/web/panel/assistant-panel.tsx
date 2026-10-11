'use client';

import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import {
  ChatComposer,
  ChatComposerInput,
  type ChatComposerInputHandle,
  ChatSendButton,
} from '@astryxdesign/core/Chat';
import { DropdownMenu, type DropdownMenuItemData } from '@astryxdesign/core/DropdownMenu';
import { Icon as AstryxIcon } from '@astryxdesign/core/Icon';
import { IconButton } from '@astryxdesign/core/IconButton';
import { List, ListItem } from '@astryxdesign/core/List';
import { VStack } from '@astryxdesign/core/Layout';
import { Heading, Text } from '@astryxdesign/core/Text';
import { ApiError, usePageContext } from '@isbp/sdk/web';
import { EmptyState } from '@isbp/ui/empty-state';
import { useApiQuery, useErrorText } from '@isbp/ui/query';
import { RelativeTime } from '@isbp/ui/relative-time';
import { Skeleton } from '@isbp/ui/skeleton';
import {
  CheckIcon,
  FileTextIcon,
  FormInputIcon,
  GitPullRequestArrowIcon,
  HistoryIcon,
  LockIcon,
  SparklesIcon,
  SquarePenIcon,
  WorkflowIcon,
} from 'lucide-react';
import { motion } from 'motion/react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { ModeBadge } from '../badges';
import { type AssistantStatusDto, CONVERSATIONS_PATH, type ConversationDto, STATUS_PATH } from '../lib';
import { ChangeSetCard } from './change-set-card';
import { ConfirmationCard } from './confirmation-card';
import { TemplatesView } from './templates';
import { AssistantMessage, TypingIndicator, UserMessage } from './thread';
import { type AssistantChat, toPageContext } from './use-assistant-chat';

const STARTERS = [
  { key: 'approval', icon: WorkflowIcon },
  { key: 'field', icon: FormInputIcon },
  { key: 'form', icon: FileTextIcon },
] as const;

/** Recent conversations to switch to, and a fresh one. */
function ConversationMenu({
  current,
  onPick,
}: {
  current: string | null;
  onPick: (id: string | null) => void;
}) {
  const t = useTranslations('assistant.panel');
  const [open, setOpen] = useState(false);
  const { data, isLoading } = useApiQuery<{ items: ConversationDto[] }>(open ? CONVERSATIONS_PATH : null);
  const items = data?.items ?? [];
  const entries: DropdownMenuItemData[] = isLoading
    ? [
        { id: 'loading-1', label: <Skeleton className="h-8 w-full" />, isDisabled: true },
        { id: 'loading-2', label: <Skeleton className="h-8 w-full" />, isDisabled: true },
      ]
    : items.length === 0
      ? [{ id: 'empty', label: t('historyEmpty'), isDisabled: true }]
      : items.map((c) => ({
          id: c.id,
          label: c.title || t('untitled'),
          description: (
            <>
              {t('messages', { count: c.messageCount })} · <RelativeTime date={c.updatedAt} />
            </>
          ),
          // The conversation in view is marked (the mark is decorative: the list is a plain pick-one menu).
          endContent: c.id === current ? <AstryxIcon icon={CheckIcon} /> : undefined,
          onClick: () => onPick(c.id),
        }));
  return (
    <DropdownMenu
      renderTrigger={(props) => (
        <IconButton
          {...props}
          label={t('history')}
          variant="ghost"
          size="sm"
          icon={<AstryxIcon icon={HistoryIcon} />}
        />
      )}
      onOpenChange={setOpen}
      alignment="end"
      menuWidth="min(20rem, calc(100vw - 2rem))"
      items={[{ type: 'section', title: t('history'), items: entries }]}
    />
  );
}

/** First screen of a conversation. Configuration starters only for people who can customise something. */
function Welcome({ onPick, customise }: { onPick: (text: string) => void; customise: boolean }) {
  const t = useTranslations('assistant.chat');
  if (!customise)
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-4 py-4 text-center">
        <span
          className="grid size-11 place-items-center rounded-xl bg-gradient-to-br from-primary to-chart-4 text-primary-foreground shadow-md"
          aria-hidden
        >
          <SparklesIcon className="size-5" />
        </span>
        <VStack gap={1.5}>
          <Heading level={3}>{t('workTitle')}</Heading>
          <Text color="secondary">{t('workBody')}</Text>
        </VStack>
      </div>
    );
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 py-4 text-center">
      <motion.span
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.25 }}
        className="grid size-11 place-items-center rounded-xl bg-gradient-to-br from-primary to-chart-4 text-primary-foreground shadow-md"
        aria-hidden
      >
        <GitPullRequestArrowIcon className="size-5" />
      </motion.span>
      <VStack gap={1.5}>
        <Heading level={3}>{t('welcomeTitle')}</Heading>
        <Text color="secondary">{t('welcomeBody')}</Text>
      </VStack>
      <div className="w-full text-start">
        <List aria-label={t('starters')} hasDividers>
          {STARTERS.map(({ key, icon }) => (
            <ListItem
              key={key}
              label={t(`starter.${key}`)}
              startContent={<AstryxIcon icon={icon} color="accent" />}
              onClick={() => onPick(t(`starter.${key}`))}
            />
          ))}
        </List>
      </div>
    </div>
  );
}

/**
 * The conversation (model mode): messages, tool activity, the conversation's change set and the composer.
 * `customise` is false for people who can't read any customisation kind: they chat about everyday work only.
 */
function ChatView({
  chat,
  onNavigate,
  customise,
}: {
  chat: AssistantChat;
  onNavigate: () => void;
  customise: boolean;
}) {
  const t = useTranslations('assistant.chat');
  const errorText = useErrorText();
  const page = usePageContext();
  const [draft, setDraft] = useState('');
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<ChatComposerInputHandle>(null);
  const messages = chat.messages;
  const streamed = chat.pendingAnswer?.text.length ?? 0;
  const toolCount = chat.pendingAnswer?.tools.length ?? 0;
  const confirmCount = chat.pendingAnswer?.confirmations.length ?? 0;

  // Keep the newest content in view while answers stream in, and once they settle (a confirmation card included).
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [messages.length, streamed, toolCount, confirmCount, chat.pendingQuestion, chat.busy]);

  const submit = async (text: string) => {
    if (!text.trim() || chat.busy) return;
    setDraft('');
    const ok = await chat.send(text, toPageContext(page));
    if (!ok) setDraft(text);
    input.current?.focus();
  };

  const where = page.record?.label || page.title || page.path;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        ref={scroller}
        // Keyboard users can scroll a long conversation (it may hold no links or buttons).
        tabIndex={0}
        className="min-h-0 flex-1 overflow-y-auto px-4 py-4 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-inset"
      >
        {chat.loading ? (
          <div className="space-y-4" aria-busy="true">
            <Skeleton className="ml-auto h-10 w-2/3 rounded-2xl" />
            <Skeleton className="h-24 w-3/4 rounded-2xl" />
          </div>
        ) : chat.loadError ? (
          <Banner status="error" title={t('loadError')} collapsible={false} />
        ) : !messages.length && !chat.pendingQuestion ? (
          <Welcome
            customise={customise}
            onPick={(text) => {
              setDraft(text);
              input.current?.focus();
            }}
          />
        ) : (
          <div role="log" aria-live="polite" aria-relevant="additions" aria-label={t('log')}>
            <ol className="space-y-4">
              {messages.map((m) =>
                m.role === 'user' ? (
                  <UserMessage key={m.id} content={m.content} label={t('you')} />
                ) : (
                  <AssistantMessage
                    key={m.id}
                    content={m.content}
                    label={t('assistant')}
                    tools={m.tools.map((x) => ({ name: x.name, status: x.ok ? 'done' : 'error' }))}
                  >
                    {(m.confirmations ?? []).map((c) => {
                      const mine = chat.decide.variables?.toolCallId === c.toolCallId;
                      return (
                        <ConfirmationCard
                          key={c.toolCallId}
                          confirmation={c}
                          deciding={chat.decide.isPending && mine}
                          disabled={chat.busy || (chat.decide.isPending && !mine)}
                          error={mine ? chat.decide.error : null}
                          onDecide={(approve) => chat.confirm(c.toolCallId, approve)}
                          onNavigate={onNavigate}
                        />
                      );
                    })}
                  </AssistantMessage>
                ),
              )}
              {chat.pendingQuestion && (
                <UserMessage key="pending-q" content={chat.pendingQuestion} label={t('you')} />
              )}
              {chat.pendingAnswer &&
                (chat.pendingAnswer.text ||
                chat.pendingAnswer.tools.length ||
                chat.pendingAnswer.confirmations.length ? (
                  // aria-busy: assistive tech waits for the stored copy instead of reading every delta.
                  <AssistantMessage
                    key="pending-a"
                    content={chat.pendingAnswer.text}
                    label={t('assistant')}
                    tools={chat.pendingAnswer.tools}
                    busy
                  >
                    {chat.pendingAnswer.confirmations.map((c) => (
                      // Answered once the turn is stored (the buttons wait until then).
                      <ConfirmationCard
                        key={c.toolCallId}
                        confirmation={c}
                        deciding={false}
                        disabled
                        onDecide={() => undefined}
                        onNavigate={onNavigate}
                      />
                    ))}
                  </AssistantMessage>
                ) : (
                  <TypingIndicator key="typing" />
                ))}
            </ol>
          </div>
        )}
      </div>

      {chat.changeSetId && (
        <div className="border-t px-4 py-3">
          <ChangeSetCard id={chat.changeSetId} summary={chat.changeSet} onNavigate={onNavigate} />
        </div>
      )}

      {chat.error && (
        <div className="px-4 pb-2">
          <Banner
            status="error"
            title={
              chat.error === 'NETWORK'
                ? t('networkError')
                : errorText(new ApiError(0, chat.error, t('genericError')))
            }
            isDismissable
            onDismiss={chat.clearError}
            dismissLabel={t('dismissError')}
            collapsible={false}
          />
        </div>
      )}

      <div className="border-t p-3">
        <ChatComposer
          value={draft}
          onChange={(v) => setDraft(v.slice(0, 8_000))}
          onSubmit={(text) => void submit(text)}
          elevation="none"
          headerContext={
            <Text type="supporting" maxLines={1} hasTruncateTooltip>
              {t('context', { page: where })}
            </Text>
          }
          input={
            <ChatComposerInput
              handleRef={input}
              label={t('inputLabel')}
              placeholder={customise ? t('placeholder') : t('placeholderWork')}
              hasHistory={false}
            />
          }
          sendButton={<ChatSendButton isDisabled={!draft.trim() || chat.busy} />}
        />
        <Text type="supporting">{t('hint')}</Text>
      </div>
    </div>
  );
}

/**
 * The assistant's side panel: the mode it is in (and honestly so), conversations with the agent in model mode,
 * guided templates in builtin mode, and the change set being built.
 */
export function AssistantPanel({
  chat,
  conversationId,
  onConversation,
  templateChangeSet,
  onTemplateChangeSet,
  onNavigate,
}: {
  chat: AssistantChat;
  conversationId: string | null;
  onConversation: (id: string | null) => void;
  templateChangeSet: string | null;
  onTemplateChangeSet: (id: string | null) => void;
  onNavigate: () => void;
}) {
  const t = useTranslations('assistant.panel');
  const status = useApiQuery<AssistantStatusDto>(STATUS_PATH);
  const s = status.data;
  const customise = Boolean(s?.kinds.length);
  // A chat model works for everyday tools too; guided templates (builtin mode) only exist for customisation kinds.
  const canChat = s?.mode === 'llm' && (customise || s.tools > 0);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-11 min-w-0 items-center gap-2 border-b px-4 py-2">
        {s ? <ModeBadge mode={s.mode} model={s.model} /> : <Skeleton className="h-5 w-28" />}
        <div className="ml-auto flex shrink-0 items-center gap-1">
          {canChat && (
            <>
              <ConversationMenu current={conversationId} onPick={onConversation} />
              <IconButton
                label={t('newConversation')}
                variant="ghost"
                size="sm"
                icon={<AstryxIcon icon={SquarePenIcon} />}
                isDisabled={!conversationId || chat.busy}
                onClick={() => onConversation(null)}
              />
            </>
          )}
          <Button
            label={t('changeSets')}
            variant="ghost"
            size="sm"
            icon={<AstryxIcon icon={GitPullRequestArrowIcon} />}
            href="/assistant/change-sets"
            onClick={onNavigate}
            className="text-xs"
          />
        </div>
      </div>

      {status.isLoading ? (
        <div className="grid gap-3 p-4" role="status" aria-busy="true" aria-label={t('loading')}>
          <Skeleton className="h-16 w-full rounded-xl" />
          <Skeleton className="h-16 w-full rounded-xl" />
        </div>
      ) : !s ? (
        <div className="p-4">
          <Banner status="error" title={t('loadError')} collapsible={false} />
        </div>
      ) : canChat ? (
        <ChatView chat={chat} onNavigate={onNavigate} customise={customise} />
      ) : s.mode === 'llm' ? (
        <EmptyState icon={<LockIcon />} title={t('noTools')} description={t('noToolsHint')} />
      ) : !customise ? (
        <EmptyState icon={<LockIcon />} title={t('noKinds')} description={t('noKindsHint')} />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          <TemplatesView
            kinds={s.kinds}
            changeSetId={templateChangeSet}
            onChangeSet={onTemplateChangeSet}
            onNavigate={onNavigate}
          />
        </div>
      )}
    </div>
  );
}
