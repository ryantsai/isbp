'use client';
import { Button } from '@astryxdesign/core/Button';
import { Icon } from '@astryxdesign/core/Icon';
import { Kbd } from '@astryxdesign/core/Kbd';
import { HStack, StackItem, VStack } from '@astryxdesign/core/Layout';
import { Tab, TabList } from '@astryxdesign/core/TabList';
import { Text } from '@astryxdesign/core/Text';
import { TextArea } from '@astryxdesign/core/TextArea';
import { useApiMutation, useErrorText } from '@isbp/ui/query';
import { CheckCircle2Icon, LockIcon, type LucideIcon, MessageSquareReplyIcon, SendIcon } from 'lucide-react';
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
  icon: LucideIcon;
  /** A second action next to Send (e.g. "Send and resolve"). */
  extra?: ReactNode;
  /** Replaces "Markdown supported. Send with" (requesters don't need to know about Markdown). */
  hint?: string;
}) {
  const t = useTranslations('itsm.composer');
  // ⌘/Ctrl+Enter sends (the key event bubbles up from the text area).
  const onKeyDown = (e: KeyboardEvent<HTMLFormElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      if (value.trim() && !pending) onSend();
    }
  };
  return (
    <form
      onKeyDown={onKeyDown}
      onSubmit={(e) => {
        e.preventDefault();
        if (value.trim()) onSend();
      }}
    >
      <VStack gap={2}>
        <TextArea
          ref={textareaRef}
          label={label}
          isLabelHidden={!showLabel}
          rows={4}
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          status={error ? { type: 'error', message: error } : undefined}
          statusVariant="detached"
        />
        <HStack gap={2} wrap="wrap" vAlign="center">
          <StackItem size="fill">
            <HStack gap={1.5} wrap="wrap" vAlign="center">
              <Text type="supporting">{hint ?? t('hint')}</Text>
              <Kbd keys="mod+enter" />
            </HStack>
          </StackItem>
          {extra}
          <Button
            type="submit"
            size="sm"
            variant="primary"
            label={sendLabel}
            icon={<Icon icon={icon} />}
            isLoading={pending}
            isDisabled={!value.trim()}
          />
        </HStack>
      </VStack>
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
  const id = useId();
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
          icon={SendIcon}
        />
      </section>
    );
  }

  const tabs = [canComment && 'reply', canWorkNote && 'note'].filter(Boolean) as ComposerTab[];
  if (!tabs.length) return null;
  const active = tabs.includes(state.tab) ? state.tab : tabs[0]!;

  return (
    <section aria-label={t('label')} className="rounded-xl border bg-card p-3 sm:p-4">
      <VStack gap={3}>
        <TabList
          role="tablist"
          aria-label={t('label')}
          value={active}
          onChange={(v) => state.setTab(v as ComposerTab)}
        >
          {canComment && (
            <Tab
              value="reply"
              label={t('replyTab')}
              panelId={`${id}-reply`}
              icon={<Icon icon={MessageSquareReplyIcon} />}
            />
          )}
          {canWorkNote && (
            <Tab value="note" label={t('noteTab')} panelId={`${id}-note`} icon={<Icon icon={LockIcon} />} />
          )}
        </TabList>
        {active === 'reply' && canComment && (
          <div role="tabpanel" id={`${id}-reply`} aria-label={t('replyTab')}>
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
              icon={SendIcon}
              extra={
                resolveWith && (
                  <Button
                    label={t(resolveWith.kind === 'fulfil' ? 'sendAndFulfil' : 'sendAndResolve')}
                    variant="secondary"
                    size="sm"
                    icon={<Icon icon={CheckCircle2Icon} />}
                    isDisabled={!state.reply.trim() || send.isPending}
                    onClick={() => resolveWith.onResolve(state.reply.trim())}
                  />
                )
              }
            />
          </div>
        )}
        {active === 'note' && canWorkNote && (
          <div role="tabpanel" id={`${id}-note`} aria-label={t('noteTab')}>
            <VStack gap={2}>
              <HStack gap={1.5} vAlign="center">
                <Icon icon={LockIcon} size="sm" color="secondary" />
                <Text type="supporting">{t('noteHint')}</Text>
              </HStack>
              <Pane
                value={state.note}
                onChange={state.setNote}
                onSend={() => submit('note')}
                pending={send.isPending && send.variables?.tab === 'note'}
                placeholder={t('notePlaceholder')}
                label={t('noteTab')}
                sendLabel={t('addNote')}
                error={error?.tab === 'note' ? error.text : null}
                icon={LockIcon}
              />
            </VStack>
          </div>
        )}
      </VStack>
    </section>
  );
}
