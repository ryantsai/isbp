'use client';

import { Badge } from '@astryxdesign/core/Badge';
import { Icon as AstryxIcon } from '@astryxdesign/core/Icon';
import { Tooltip } from '@astryxdesign/core/Tooltip';
import { cn } from '@isbp/ui';
import { Collapse, CollapseChevron } from '@isbp/ui/motion';
import { BookOpenIcon, ChevronRightIcon, CpuIcon, SparklesIcon } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { type ReactNode, useId, useState } from 'react';
import type { AiInfo, Citation } from '../contracts';

/**
 * Where answers come from, in plain words (CLAUDE.md: the UI says which mode it is in). `people` (Ask IT):
 * "Answers from our knowledge base" / "AI answers based on our knowledge base". `agents` (assist panel, insights):
 * "Basic mode" or the model's name. The tooltip explains the mode.
 */
export function ModeBadge({
  ai,
  audience = 'agents',
  className,
}: {
  ai: AiInfo | null | undefined;
  audience?: 'people' | 'agents';
  className?: string;
}) {
  const t = useTranslations('helpdesk-ai');
  if (!ai) return null;
  const builtin = ai.mode === 'builtin';
  const label =
    audience === 'people'
      ? t(builtin ? 'mode.chatBuiltin' : 'mode.chatLlm')
      : builtin
        ? t('mode.basic')
        : (ai.model ?? t('mode.llm'));
  const icon = builtin ? (audience === 'people' ? BookOpenIcon : CpuIcon) : SparklesIcon;
  return (
    <Tooltip content={builtin ? t('mode.builtinHint') : t('mode.llmHint', { provider: ai.provider })}>
      <Badge
        variant={builtin ? 'neutral' : 'info'}
        label={label}
        icon={<AstryxIcon icon={icon} size="xsm" />}
        className={cn('cursor-default', className)}
        tabIndex={0}
      />
    </Tooltip>
  );
}

/** Numbered knowledge-base sources as compact chips — for texts that cite them as `[1]` (reply drafts). */
export function CitationChips({ items, className }: { items: readonly Citation[]; className?: string }) {
  const t = useTranslations('helpdesk-ai');
  if (!items.length) return null;
  return (
    <ul className={cn('flex flex-wrap gap-1.5', className)} aria-label={t('citations.label')}>
      {items.map((c) => (
        <li key={c.n} className="min-w-0 max-w-full">
          <Link
            href={c.href}
            className="group inline-flex max-w-full items-center gap-1.5 rounded-full border bg-card px-2.5 py-1 text-xs outline-none transition-colors hover:border-ring/40 hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
            title={`${c.reference} — ${c.title}`}
          >
            <span className="grid size-4 shrink-0 place-items-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary tabular-nums">
              {c.n}
            </span>
            <BookOpenIcon className="size-3 shrink-0 text-muted-foreground" aria-hidden />
            <span className="truncate font-medium">{c.title}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/**
 * The articles an answer is based on, as cards (title and what it covers). `numbered` when the answer's text
 * refers to them as `[1]` (model answers); builtin answers list them only here.
 */
export function ArticleCards({
  items,
  numbered = false,
  className,
}: {
  items: readonly Citation[];
  numbered?: boolean;
  className?: string;
}) {
  const t = useTranslations('helpdesk-ai');
  if (!items.length) return null;
  return (
    <ul className={cn('grid gap-2', className)} aria-label={t('citations.label')}>
      {items.map((c) => (
        <li key={c.n} className="min-w-0">
          <Link
            href={c.href}
            className="group flex min-w-0 items-start gap-3 rounded-xl border bg-card px-3 py-2.5 outline-none transition-colors hover:border-ring/40 hover:bg-accent/60 focus-visible:ring-[3px] focus-visible:ring-ring/50 motion-reduce:transition-none"
          >
            <span
              aria-hidden
              className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg bg-primary/10 text-xs font-semibold text-primary tabular-nums"
            >
              {numbered ? c.n : <BookOpenIcon className="size-3.5" />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium group-hover:underline">{c.title}</span>
              {c.snippet && (
                <span className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground">{c.snippet}</span>
              )}
            </span>
            <ChevronRightIcon className="mt-1.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
          </Link>
        </li>
      ))}
    </ul>
  );
}

/**
 * A collapsible section of the assist panel: a heading button (`aria-expanded`) over a `Collapse` region.
 * Controlled with `open`/`onOpenChange`, or uncontrolled with `defaultOpen`.
 */
export function Section({
  title,
  icon,
  meta,
  defaultOpen = false,
  open: openProp,
  onOpenChange,
  children,
}: {
  title: ReactNode;
  icon?: ReactNode;
  meta?: ReactNode;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: ReactNode;
}) {
  const [inner, setInner] = useState(defaultOpen);
  const open = openProp ?? inner;
  const id = useId();
  return (
    <section className="border-t first:border-t-0">
      <h3 className="m-0">
        <button
          type="button"
          id={`${id}-trigger`}
          aria-expanded={open}
          aria-controls={`${id}-panel`}
          onClick={() => {
            setInner(!open);
            onOpenChange?.(!open);
          }}
          className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm font-medium outline-none transition-colors hover:bg-accent/50 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-inset motion-reduce:transition-none"
        >
          {icon && <span className="text-muted-foreground [&_svg]:size-4">{icon}</span>}
          <span className="min-w-0 flex-1 truncate">{title}</span>
          {meta}
          <CollapseChevron open={open} />
        </button>
      </h3>
      <Collapse id={`${id}-panel`} open={open} role="region" aria-labelledby={`${id}-trigger`}>
        {/* relative: visually hidden (absolutely positioned) text is clipped with the section while it's closed. */}
        <div className="relative px-4 pb-4">{children}</div>
      </Collapse>
    </section>
  );
}
