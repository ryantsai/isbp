'use client';

import { Button } from '@isbp/ui/button';
import { Kbd } from '@isbp/ui/kbd';
import { useApiMutation, useErrorText } from '@isbp/ui/query';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@isbp/ui/tabs';
import { Textarea } from '@isbp/ui/textarea';
import { CheckCircle2Icon, LockIcon, MessageSquareReplyIcon, SendIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import {
  type Dispatch,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  type SetStateAction,
  useId,
  useState,
} from 'react';
import type { Activity, CommentInput } from '../../contracts';
import { INVALIDATE, ticketApi } from '../lib';

export type ComposerTab = 'reply' | 'note';

export interface ComposerState {
  tab: ComposerTab;
  setTab: (tab: ComposerTab) => void;
  reply: string;
  setReply: Dispatch<SetStateAction<string>>;
  note: string;
  setNote: Dispatch<SetStateAction<string>>;
  replyRef: RefObject<HTMLTextAreaElement | null>;
}

function Pane({
  value,
  onChange,
  onSend,
  pending,
  placeholder,
  label,
  showLabel,
  sendLabel,
  textareaRef,
  error,
  icon,
  extra,
  hint,
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  pending: boolean;
  placeholder: string;
  label: string;
  /** Show the label above the field (single-pane composer); otherwise the tab names it. */
  showLabel?: boolean;
  sendLabel: string;
  textareaRef?: RefObject<HTMLTextAreaElement | null>;
  error: string | null;
  icon: ReactNode;
  /** A second action next to Send (e.g. "Send and resolve"). */
  extra?: ReactNode;
  /** Replaces "Markdown supported. Send with" (requesters don't need to know about Markdown). */
  hint?: string;
}) {
  const t = useTranslations('itsm.composer');
  const id = useId();
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      if (value.trim() && !pending) onSend();
    }
  };
  return (
    <form
      className="grid gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (value.trim()) onSend();
      }}
    >
      <label htmlFor={id} className={showLabel ? 'text-sm font-medium' : 'sr-only'}>
        {label}
      </label>
      <Textarea
        id={id}
        ref={textareaRef}
        rows={4}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        aria-invalid={error ? true : undefined}
        aria-describedby={`${id}-hint ${id}-error`}
        className="min-h-24 resize-y"
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint ?? t('hint')} <Kbd>{t('shortcut')}</Kbd>
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {extra}
          <Button type="submit" size="sm" loading={pending} disabled={!value.trim()}>
            {icon}
            {sendLabel}
          </Button>
        </div>
      </div>
      <p id={`${id}-error`} role="alert" className="text-sm text-destructive empty:hidden">
        {error}
      </p>
    </form>
  );
}

/**
 * Agents: reply to the requester (public) or add an internal work note; ⌘/Ctrl+Enter sends. "Send and resolve"
 * turns the reply into the resolution (one message to the requester). Requesters: one pane, "Message the service
 * desk".
 */
export function Composer({
  ticketRef,
  state,
  canComment,
  canWorkNote,
  audience = 'agent',
  resolveWith,
}: {
  ticketRef: string;
  state: ComposerState;
  canComment: boolean;
  canWorkNote: boolean;
  audience?: 'agent' | 'requester';
  /** The reply can resolve the ticket: `kind` names the button, `onResolve` opens the resolve dialog with it. */
  resolveWith?: { kind: 'resolve' | 'fulfil'; onResolve: (reply: string) => void } | null;
}) {
  const t = useTranslations('itsm.composer');
  const errorText = useErrorText();
  const [error, setError] = useState<{ tab: ComposerTab; text: string } | null>(null);
  const send = useApiMutation(
    (api, vars: CommentInput & { tab: ComposerTab }) =>
      api.post<Activity>(`${ticketApi(ticketRef)}/comments`, { body: vars.body, public: vars.public }),
    {
      invalidate: INVALIDATE,
      silent: true,
      success: (a) =>
        audience === 'requester' ? t('requester.sent') : a.public ? t('sent') : t('noteAdded'),
      onSuccess: (_a, vars) => {
        setError(null);
        // Clear what was sent, not what the person started typing while it was on its way (the next message).
        const sent = (current: string) => (current.trim() === vars.body ? '' : current);
        if (vars.tab === 'reply') state.setReply(sent);
        else state.setNote(sent);
      },
    },
  );
  const submit = (tab: ComposerTab) => {
    const body = (tab === 'reply' ? state.reply : state.note).trim();
    if (!body) return;
    send.mutate(
      { body, public: tab === 'reply', tab },
      { onError: (err) => setError({ tab, text: errorText(err) }) },
    );
  };

  if (audience === 'requester') {
    if (!canComment) return null;
    return (
      <section aria-label={t('requester.label')} className="rounded-xl border bg-card p-3 sm:p-4">
        <Pane
          value={state.reply}
          onChange={state.setReply}
          onSend={() => submit('reply')}
          pending={send.isPending}
          placeholder={t('requester.placeholder')}
          label={t('requester.label')}
          showLabel
          sendLabel={t('requester.send')}
          hint={t('requester.hint')}
          textareaRef={state.replyRef}
          error={error?.tab === 'reply' ? error.text : null}
          icon={<SendIcon />}
        />
      </section>
    );
  }

  const tabs = [canComment && 'reply', canWorkNote && 'note'].filter(Boolean) as ComposerTab[];
  if (!tabs.length) return null;
  const active = tabs.includes(state.tab) ? state.tab : tabs[0]!;

  return (
    <section aria-label={t('label')} className="rounded-xl border bg-card p-3 sm:p-4">
      <Tabs value={active} onValueChange={(v) => state.setTab(v as ComposerTab)} className="gap-3">
        <TabsList>
          {canComment && (
            <TabsTrigger value="reply">
              <MessageSquareReplyIcon aria-hidden />
              {t('replyTab')}
            </TabsTrigger>
          )}
          {canWorkNote && (
            <TabsTrigger value="note">
              <LockIcon aria-hidden />
              {t('noteTab')}
            </TabsTrigger>
          )}
        </TabsList>
        {canComment && (
          <TabsContent value="reply">
            <Pane
              value={state.reply}
              onChange={state.setReply}
              onSend={() => submit('reply')}
              pending={send.isPending && send.variables?.tab === 'reply'}
              placeholder={t('replyPlaceholder')}
              label={t('replyTab')}
              sendLabel={t('send')}
              textareaRef={state.replyRef}
              error={error?.tab === 'reply' ? error.text : null}
              icon={<SendIcon />}
              extra={
                resolveWith && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={!state.reply.trim() || send.isPending}
                    onClick={() => resolveWith.onResolve(state.reply.trim())}
                  >
                    <CheckCircle2Icon aria-hidden />
                    {t(resolveWith.kind === 'fulfil' ? 'sendAndFulfil' : 'sendAndResolve')}
                  </Button>
                )
              }
            />
          </TabsContent>
        )}
        {canWorkNote && (
          <TabsContent value="note">
            <div className="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground">
              <LockIcon className="size-3.5" aria-hidden />
              {t('noteHint')}
            </div>
            <Pane
              value={state.note}
              onChange={state.setNote}
              onSend={() => submit('note')}
              pending={send.isPending && send.variables?.tab === 'note'}
              placeholder={t('notePlaceholder')}
              label={t('noteTab')}
              sendLabel={t('addNote')}
              error={error?.tab === 'note' ? error.text : null}
              icon={<LockIcon />}
            />
          </TabsContent>
        )}
      </Tabs>
    </section>
  );
}
