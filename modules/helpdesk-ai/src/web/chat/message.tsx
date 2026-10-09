'use client';

import { cn } from '@isbp/ui';
import { Markdown } from '@isbp/ui/markdown';
import { AnimatedItem } from '@isbp/ui/motion';
import { SearchIcon, SparklesIcon } from 'lucide-react';
import { motion } from 'motion/react';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import type { Citation } from '../../contracts';
import { ArticleCards } from '../shared';

/*
 * Conversation turns are `AnimatedItem`s: put them in an `AnimatedList`, so a new message grows in (180 ms) while
 * the ones already there when the conversation opens don't replay.
 */

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

export function UserMessage({ content, label }: { content: string; label: string }) {
  return (
    <AnimatedItem className="flex justify-end pb-4">
      <div className="max-w-[85%] min-w-0 rounded-2xl rounded-br-md bg-primary px-3.5 py-2 text-sm whitespace-pre-wrap text-primary-foreground shadow-xs wrap-anywhere">
        <span className="sr-only">{label}: </span>
        {content}
      </div>
    </AnimatedItem>
  );
}

/**
 * An answer with the articles it is based on as cards. `numbered`: the text cites them as `[1]` (model
 * answers); builtin answers don't repeat them in the text. While the answer is on its way (`busy`) and has no
 * text yet, the bubble shows what the agent is doing — the same item then fills in, so nothing replays.
 */
export function AssistantMessage({
  content,
  citations,
  numbered,
  label,
  children,
  busy,
  tool = null,
}: {
  content: string;
  citations: readonly Citation[];
  numbered?: boolean;
  label: string;
  children?: ReactNode;
  busy?: boolean;
  /** A tool the agent is running while `busy` (searching articles, checking tickets). */
  tool?: string | null;
}) {
  const typing = busy && !content;
  return (
    // aria-busy: assistive tech waits for the stored copy instead of reading every streamed delta.
    <AnimatedItem className="flex min-w-0 gap-2.5 pb-4" aria-busy={busy || undefined}>
      <AgentAvatar />
      <div className="min-w-0 flex-1 space-y-2">
        <div
          className={cn(
            'w-fit max-w-full min-w-0 rounded-2xl rounded-tl-md border bg-card px-3.5 py-2.5 shadow-xs',
            typing && 'text-sm text-muted-foreground',
          )}
        >
          {typing ? (
            <Typing tool={tool} />
          ) : (
            <>
              <span className="sr-only">{label}: </span>
              <Markdown>{content}</Markdown>
            </>
          )}
        </div>
        <ArticleCards items={citations} numbered={numbered} className="max-w-xl" />
        {children}
      </div>
    </AnimatedItem>
  );
}

/** Three bouncing dots (static under reduced motion), or what the agent is doing. */
function Typing({ tool }: { tool: string | null }) {
  const t = useTranslations('helpdesk-ai');
  return (
    <span className="flex items-center gap-2">
      {tool ? (
        <>
          <SearchIcon className="size-3.5 animate-pulse motion-reduce:animate-none" aria-hidden />
          <span>{t(tool.startsWith('itsm.') ? 'chat.checkingTickets' : 'chat.searching')}</span>
        </>
      ) : (
        <>
          <span className="flex items-center gap-1" aria-hidden>
            {[0, 1, 2].map((i) => (
              <motion.span
                key={i}
                className={cn('size-1.5 rounded-full bg-muted-foreground/70')}
                animate={{ y: [0, -3, 0], opacity: [0.5, 1, 0.5] }}
                transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.15, ease: 'easeInOut' }}
              />
            ))}
          </span>
          <span className="sr-only">{t('chat.typing')}</span>
        </>
      )}
    </span>
  );
}
