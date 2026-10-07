'use client';

import { Button } from '@isbp/ui/button';
import { Kbd } from '@isbp/ui/kbd';
import { useApiMutation, useErrorText } from '@isbp/ui/query';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@isbp/ui/tabs';
import { Textarea } from '@isbp/ui/textarea';
import { LockIcon, MessageSquareReplyIcon, SendIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type KeyboardEvent, type ReactNode, type RefObject, useId, useState } from 'react';
import type { Activity, CommentInput } from '../../contracts';
import { INVALIDATE, ticketApi } from '../lib';

export type ComposerTab = 'reply' | 'note';

export interface ComposerState {
  tab: ComposerTab;
  setTab: (tab: ComposerTab) => void;
  reply: string;
  setReply: (v: string) => void;
  note: string;
  setNote: (v: string) => void;
  replyRef: RefObject<HTMLTextAreaElement | null>;
}

function Pane({
  value,
  onChange,
  onSend,
  pending,
  placeholder,
  label,
  sendLabel,
  textareaRef,
  error,
  icon,
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  pending: boolean;
  placeholder: string;
  label: string;
  sendLabel: string;
  textareaRef?: RefObject<HTMLTextAreaElement | null>;
  error: string | null;
  icon: ReactNode;
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
      <label htmlFor={id} className="sr-only">
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
          {t('hint')} <Kbd>{t('shortcut')}</Kbd>
        </p>
        <Button type="submit" size="sm" loading={pending} disabled={!value.trim()}>
          {icon}
          {sendLabel}
        </Button>
      </div>
      <p id={`${id}-error`} role="alert" className="text-sm text-destructive empty:hidden">
        {error}
      </p>
    </form>
  );
}

/** Reply to the requester (public) or add an internal work note; ⌘/Ctrl+Enter sends. */
export function Composer({
  ticketRef,
  state,
  canComment,
  canWorkNote,
}: {
  ticketRef: string;
  state: ComposerState;
  canComment: boolean;
  canWorkNote: boolean;
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
      success: (a) => (a.public ? t('sent') : t('noteAdded')),
      onSuccess: (_a, vars) => {
        setError(null);
        if (vars.tab === 'reply') state.setReply('');
        else state.setNote('');
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
  const tabs = [canComment && 'reply', canWorkNote && 'note'].filter(Boolean) as ComposerTab[];
  if (!tabs.length) return null;
  const active = tabs.includes(state.tab) ? state.tab : tabs[0]!;

  return (
    <section aria-label={t('label')} className="rounded-xl border bg-card p-3 shadow-xs sm:p-4">
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
