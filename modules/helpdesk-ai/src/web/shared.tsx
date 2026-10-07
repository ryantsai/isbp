'use client';

import { cn } from '@isbp/ui';
import { Badge } from '@isbp/ui/badge';
import { Hint } from '@isbp/ui/tooltip';
import { BookOpenIcon, ChevronDownIcon, CpuIcon, SparklesIcon } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { type ReactNode, useId, useState } from 'react';
import type { AiInfo, Citation } from '../contracts';

/** Honest label of where answers come from: "Builtin · no LLM" or the model's name. */
export function ModeBadge({ ai, className }: { ai: AiInfo | null | undefined; className?: string }) {
  const t = useTranslations('helpdesk-ai');
  if (!ai) return null;
  const builtin = ai.mode === 'builtin';
  return (
    <Hint label={builtin ? t('mode.builtinHint') : t('mode.llmHint', { provider: ai.provider })}>
      <Badge
        variant={builtin ? 'muted' : 'info'}
        className={cn('max-w-full cursor-default gap-1 truncate', className)}
        tabIndex={0}
      >
        {builtin ? <CpuIcon aria-hidden /> : <SparklesIcon aria-hidden />}
        <span className="truncate">{builtin ? t('mode.builtin') : (ai.model ?? t('mode.llm'))}</span>
      </Badge>
    </Hint>
  );
}

/** Numbered knowledge-base sources, as links. */
export function CitationChips({ items, className }: { items: readonly Citation[]; className?: string }) {
  const t = useTranslations('helpdesk-ai');
  if (!items.length) return null;
  return (
    <ul className={cn('flex flex-wrap gap-1.5', className)} aria-label={t('citations.label')}>
      {items.map((c) => (
        <li key={c.n} className="min-w-0 max-w-full">
          <Link
            href={c.href}
            className="group inline-flex max-w-full items-center gap-1.5 rounded-full border bg-card px-2.5 py-1 text-xs shadow-xs outline-none transition-colors hover:border-ring/40 hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
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

/** Confidence as a meter with its percentage in text (never colour alone). */
export function ConfidenceMeter({ value, label }: { value: number; label: string }) {
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100);
  const tone = pct >= 75 ? 'bg-success' : pct >= 45 ? 'bg-primary' : 'bg-warning';
  return (
    <div className="flex items-center gap-2">
      <div
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-valuetext={`${pct}%`}
        className="h-1.5 flex-1 overflow-hidden rounded-full bg-primary/12"
      >
        <motion.div
          className={cn('h-full rounded-full', tone)}
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        />
      </div>
      <span className="w-10 text-right text-xs font-medium tabular-nums">{pct}%</span>
    </div>
  );
}

/** Accessible disclosure: a button with `aria-expanded` controlling a labelled region. */
export function Disclosure({
  title,
  icon,
  meta,
  defaultOpen = false,
  children,
}: {
  title: ReactNode;
  icon?: ReactNode;
  meta?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  const reduce = useReducedMotion();
  return (
    <section className="border-t first:border-t-0">
      <h3 className="m-0">
        <button
          type="button"
          id={`${id}-trigger`}
          aria-expanded={open}
          aria-controls={`${id}-panel`}
          onClick={() => setOpen((o) => !o)}
          className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-medium outline-none transition-colors hover:bg-accent/50 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-inset"
        >
          {icon && <span className="text-muted-foreground [&_svg]:size-4">{icon}</span>}
          <span className="min-w-0 flex-1 truncate">{title}</span>
          {meta}
          <ChevronDownIcon
            className={cn('size-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')}
            aria-hidden
          />
        </button>
      </h3>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            id={`${id}-panel`}
            role="region"
            aria-labelledby={`${id}-trigger`}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: reduce ? 0 : 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
