'use client';

import { cn } from '@isbp/ui';
import { Markdown } from '@isbp/ui/markdown';
import { SearchIcon, SparklesIcon } from 'lucide-react';
import { motion } from 'motion/react';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import type { Citation } from '../../contracts';
import { CitationChips } from '../shared';

const fadeIn = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.25, ease: [0.22, 1, 0.36, 1] as const },
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
  citations,
  label,
  children,
  busy,
}: {
  content: string;
  citations: readonly Citation[];
  label: string;
  children?: ReactNode;
  busy?: boolean;
}) {
  return (
    <motion.li {...fadeIn} className="flex min-w-0 gap-2.5" aria-busy={busy || undefined}>
      <AgentAvatar />
      <div className="min-w-0 flex-1 space-y-2">
        <div className="w-fit max-w-full min-w-0 rounded-2xl rounded-tl-md border bg-card px-3.5 py-2.5 shadow-xs">
          <span className="sr-only">{label}: </span>
          <Markdown>{content}</Markdown>
        </div>
        <CitationChips items={citations} />
        {children}
      </div>
    </motion.li>
  );
}

/** Three bouncing dots (static under reduced motion), or what the agent is doing. */
export function TypingIndicator({ tool }: { tool: string | null }) {
  const t = useTranslations('helpdesk-ai');
  return (
    <li className="flex gap-2.5" aria-busy="true">
      <AgentAvatar />
      <div className="flex items-center gap-2 rounded-2xl rounded-tl-md border bg-card px-3.5 py-2.5 text-sm text-muted-foreground shadow-xs">
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
      </div>
    </li>
  );
}
