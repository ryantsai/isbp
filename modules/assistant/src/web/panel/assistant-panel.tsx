'use client';

import { ApiError, usePageContext } from '@isbp/sdk/web';
import { Button } from '@isbp/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@isbp/ui/dropdown-menu';
import { EmptyState } from '@isbp/ui/empty-state';
import { useApiQuery, useErrorText } from '@isbp/ui/query';
import { RelativeTime } from '@isbp/ui/relative-time';
import { Skeleton } from '@isbp/ui/skeleton';
import { Textarea } from '@isbp/ui/textarea';
import {
  ArrowUpIcon,
  CircleAlertIcon,
  FileTextIcon,
  FormInputIcon,
  GitPullRequestArrowIcon,
  HistoryIcon,
  LockIcon,
  MapPinIcon,
  SparklesIcon,
  SquarePenIcon,
  WorkflowIcon,
  XIcon,
} from 'lucide-react';
import { motion } from 'motion/react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useRef, useState } from 'react';
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
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={t('history')}>
          <HistoryIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[min(20rem,calc(100vw-2rem))]">
        <DropdownMenuLabel>{t('history')}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {isLoading ? (
          <div className="grid gap-1.5 p-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : items.length === 0 ? (
          <p className="px-2 py-3 text-sm text-muted-foreground">{t('historyEmpty')}</p>
        ) : (
          items.map((c) => (
            <DropdownMenuItem
              key={c.id}
              onSelect={() => onPick(c.id)}
              aria-current={c.id === current ? 'true' : undefined}
              className="flex flex-col items-start gap-0.5"
            >
              <span className="w-full truncate font-medium">{c.title || t('untitled')}</span>
              <span className="text-xs text-muted-foreground">
                {t('messages', { count: c.messageCount })} · <RelativeTime date={c.updatedAt} />
              </span>
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
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
        <div className="space-y-1.5">
          <h3 className="text-base font-semibold tracking-tight">{t('workTitle')}</h3>
          <p className="text-sm text-muted-foreground">{t('workBody')}</p>
        </div>
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
      <div className="space-y-1.5">
        <h3 className="text-base font-semibold tracking-tight">{t('welcomeTitle')}</h3>
        <p className="text-sm text-muted-foreground">{t('welcomeBody')}</p>
      </div>
      <ul className="grid w-full grid-cols-1 gap-2" aria-label={t('starters')}>
        {STARTERS.map(({ key, icon: Icon }) => (
          <li key={key} className="min-w-0">
            <button
              type="button"
              onClick={() => onPick(t(`starter.${key}`))}
              className="flex w-full min-w-0 items-center gap-2.5 rounded-xl border bg-card px-3 py-2.5 text-left text-sm shadow-xs outline-none transition-colors hover:border-ring/40 hover:bg-accent/40 focus-visible:ring-[3px] focus-visible:ring-ring/50 motion-reduce:transition-none"
            >
              <Icon className="size-4 shrink-0 text-primary" aria-hidden />
              <span className="min-w-0">{t(`starter.${key}`)}</span>
            </button>
          </li>
        ))}
      </ul>
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
  const input = useRef<HTMLTextAreaElement>(null);
  const inputId = useId();
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
          <p role="alert" className="text-sm text-destructive">
            {t('loadError')}
          </p>
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
        <div
          role="alert"
          className="mx-4 mb-2 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/8 px-3 py-2 text-sm text-destructive"
        >
          <CircleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1">
            {chat.error === 'NETWORK'
              ? t('networkError')
              : errorText(new ApiError(0, chat.error, t('genericError')))}
          </span>
          <button
            type="button"
            onClick={chat.clearError}
            className="rounded-sm opacity-70 outline-none hover:opacity-100 focus-visible:ring-[3px] focus-visible:ring-ring/50"
            aria-label={t('dismissError')}
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
        <p className="mb-2 flex min-w-0 items-center gap-1.5 px-1 text-xs text-muted-foreground">
          <MapPinIcon className="size-3.5 shrink-0" aria-hidden />
          <span className="truncate" title={where}>
            {t('context', { page: where })}
          </span>
        </p>
        <label htmlFor={inputId} className="sr-only">
          {t('inputLabel')}
        </label>
        <div className="flex items-end gap-2 rounded-xl border bg-background px-2 py-1.5 shadow-xs transition-shadow focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50 motion-reduce:transition-none">
          <Textarea
            id={inputId}
            ref={input}
            value={draft}
            rows={1}
            maxLength={8_000}
            placeholder={customise ? t('placeholder') : t('placeholderWork')}
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
            disabled={!draft.trim() || chat.busy}
            aria-label={t('send')}
          >
            <ArrowUpIcon />
          </Button>
        </div>
        <p id={`${inputId}-hint`} className="mt-1.5 px-1 text-[11px] text-muted-foreground">
          {t('hint')}
        </p>
      </form>
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
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t('newConversation')}
                disabled={!conversationId || chat.busy}
                onClick={() => onConversation(null)}
              >
                <SquarePenIcon />
              </Button>
            </>
          )}
          <Button variant="ghost" size="sm" asChild className="text-xs">
            <Link href="/assistant/change-sets" onClick={onNavigate}>
              <GitPullRequestArrowIcon /> {t('changeSets')}
            </Link>
          </Button>
        </div>
      </div>

      {status.isLoading ? (
        <div className="grid gap-3 p-4" role="status" aria-busy="true" aria-label={t('loading')}>
          <Skeleton className="h-16 w-full rounded-xl" />
          <Skeleton className="h-16 w-full rounded-xl" />
        </div>
      ) : !s ? (
        <p role="alert" className="p-4 text-sm text-destructive">
          {t('loadError')}
        </p>
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
