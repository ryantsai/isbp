'use client';

import { cn } from '@isbp/ui';
import { Markdown } from '@isbp/ui/markdown';
import { CircleCheckIcon, CircleXIcon, LoaderCircleIcon, SparklesIcon } from 'lucide-react';
import { motion } from 'motion/react';
import { useTranslations } from 'next-intl';
import { type ReactNode, useCallback } from 'react';
import type { ToolStatus } from './use-assistant-chat';

const fadeIn = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.22, ease: [0.22, 1, 0.36, 1] as const },
};

export function AgentAvatar() {
  return (
    <span
      aria-hidden
      className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-gradient-to-br from-primary to-chart-4 text-primary-foreground shadow-sm"
    >
      <SparklesIcon className="size-3.5" />
    </span>
  );
}

/** "Proposing a change" for `assistant.propose_change`; other modules' tools by module ("Looking things up in ITSM"). */
export function useToolText() {
  const t = useTranslations('assistant.tools');
  const tr = useTranslations();
  return useCallback(
    (name: string) => {
      const key = `names.${name.replace(/[.-]/g, '_')}`;
      if (t.has(key)) return t(key);
      const moduleId = name.split('.')[0] ?? name;
      const moduleName = tr.has(`${moduleId}.meta.name`) ? tr(`${moduleId}.meta.name`) : moduleId;
      return t('other', { module: moduleName });
    },
    [t, tr],
  );
}

/** What the agent did in a turn: one chip per tool call, with its outcome as icon + text. */
export function ToolChips({ tools }: { tools: readonly { name: string; status: ToolStatus }[] }) {
  const t = useTranslations('assistant.tools');
  const text = useToolText();
  if (!tools.length) return null;
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label={t('label')}>
      {tools.map((tool, i) => {
        const label = text(tool.name);
        return (
          <li
            key={`${tool.name}-${i}`}
            className={cn(
              'inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-full border bg-card px-2.5 py-1 text-xs shadow-xs',
              tool.status === 'error' && 'border-destructive/40 text-destructive',
            )}
          >
            {tool.status === 'running' ? (
              <LoaderCircleIcon
                className="size-3.5 shrink-0 text-primary motion-safe:animate-spin"
                aria-hidden
              />
            ) : tool.status === 'done' ? (
              <CircleCheckIcon className="size-3.5 shrink-0 text-success" aria-hidden />
            ) : (
              <CircleXIcon className="size-3.5 shrink-0" aria-hidden />
            )}
            <span className="truncate">
              {tool.status === 'running'
                ? t('running', { action: label })
                : tool.status === 'done'
                  ? label
                  : t('failed', { action: label })}
            </span>
            {tool.status === 'done' && <span className="sr-only">{t('doneSuffix')}</span>}
          </li>
        );
      })}
    </ul>
  );
}

export function UserMessage({ content, label }: { content: string; label: string }) {
  return (
    <motion.li {...fadeIn} className="flex justify-end">
      <div className="max-w-[85%] min-w-0 rounded-2xl rounded-br-md bg-primary px-3.5 py-2 text-sm whitespace-pre-wrap text-primary-foreground shadow-xs wrap-anywhere">
        <span className="sr-only">{label}: </span>
        {content}
      </div>
    </motion.li>
  );
}

export function AssistantMessage({
  content,
  label,
  tools,
  busy,
  children,
}: {
  content: string;
  label: string;
  tools: readonly { name: string; status: ToolStatus }[];
  busy?: boolean;
  children?: ReactNode;
}) {
  return (
    <motion.li {...fadeIn} className="flex min-w-0 gap-2.5" aria-busy={busy || undefined}>
      <AgentAvatar />
      <div className="min-w-0 flex-1 space-y-2">
        <ToolChips tools={tools} />
        {content.trim() && (
          <div className="w-fit max-w-full min-w-0 rounded-2xl rounded-tl-md border bg-card px-3.5 py-2.5 shadow-xs">
            <span className="sr-only">{label}: </span>
            <Markdown>{content}</Markdown>
          </div>
        )}
        {children}
      </div>
    </motion.li>
  );
}

/** Three bouncing dots (static under reduced motion) while the agent thinks. */
export function TypingIndicator() {
  const t = useTranslations('assistant.chat');
  return (
    <li className="flex gap-2.5" aria-busy="true">
      <AgentAvatar />
      <div className="flex items-center gap-2 rounded-2xl rounded-tl-md border bg-card px-3.5 py-2.5 text-sm text-muted-foreground shadow-xs">
        <span className="flex items-center gap-1" aria-hidden>
          {[0, 1, 2].map((i) => (
            <motion.span
              key={i}
              className="size-1.5 rounded-full bg-muted-foreground/70"
              animate={{ y: [0, -3, 0], opacity: [0.5, 1, 0.5] }}
              transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.15, ease: 'easeInOut' }}
            />
          ))}
        </span>
        <span className="sr-only">{t('typing')}</span>
      </div>
    </li>
  );
}
