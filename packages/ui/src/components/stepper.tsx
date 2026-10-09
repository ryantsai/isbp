'use client';

import { CheckIcon } from 'lucide-react';
import { motion } from 'motion/react';
import { useTranslations } from 'next-intl';
import type * as React from 'react';
import { cn } from '../lib/utils';
import { duration, ease } from './motion';

export { StepTransition } from './motion';

export interface StepperStep {
  id: string;
  label: React.ReactNode;
}

/**
 * Wizard progress: numbered steps, done ones checked, the connector filling as you move on (180 ms). On a phone it
 * shows "Step 2 of 4 · Label". Pass `onStepClick` to let people go back to a finished step. Pair it with
 * `StepTransition` for the step content.
 */
export function Stepper({
  steps,
  current,
  label,
  onStepClick,
  className,
}: {
  steps: readonly StepperStep[];
  /** Index of the current step (0-based). `steps.length` means everything is done. */
  current: number;
  /** Accessible name of the progress list (default "Progress"). */
  label?: string;
  onStepClick?: (index: number) => void;
  className?: string;
}) {
  const t = useTranslations('ui.stepper');
  const total = steps.length;
  const currentStep = steps[Math.min(current, total - 1)];
  return (
    <nav aria-label={label ?? t('label')} className={cn('space-y-2', className)}>
      <ol className="flex items-center gap-2">
        {steps.map((step, i) => {
          const done = i < current;
          const active = i === current;
          const clickable = done && !!onStepClick;
          const dot = (
            <span
              className={cn(
                'grid size-7 shrink-0 place-items-center rounded-full border text-xs font-semibold tabular-nums transition-colors duration-(--motion-base) motion-reduce:transition-none',
                done && 'border-primary bg-primary text-primary-foreground',
                active && 'border-primary text-primary ring-[3px] ring-primary/15',
                !done && !active && 'text-muted-foreground',
              )}
            >
              {done ? <CheckIcon className="size-3.5" aria-hidden /> : i + 1}
            </span>
          );
          const text = (
            <span
              className={cn(
                'hidden min-w-0 truncate text-sm sm:inline',
                active ? 'font-medium text-foreground' : 'text-muted-foreground',
              )}
            >
              {step.label}
            </span>
          );
          const state = done ? t('completed') : active ? t('current') : undefined;
          return (
            <li
              key={step.id}
              aria-current={active ? 'step' : undefined}
              className={cn('flex min-w-0 items-center gap-2', i < total - 1 && 'flex-1')}
            >
              {clickable ? (
                <button
                  type="button"
                  onClick={() => onStepClick(i)}
                  className="flex min-w-0 items-center gap-2 rounded-md outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                  {dot}
                  {text}
                  <span className="sr-only">
                    {step.label} ({state})
                  </span>
                </button>
              ) : (
                <span className="flex min-w-0 items-center gap-2">
                  {dot}
                  {text}
                  <span className="sr-only">
                    {step.label}
                    {state ? ` (${state})` : ''}
                  </span>
                </span>
              )}
              {i < total - 1 && (
                <span
                  aria-hidden
                  className="relative h-0.5 min-w-4 flex-1 overflow-hidden rounded-full bg-border"
                >
                  <motion.span
                    className="absolute inset-0 origin-left rounded-full bg-primary"
                    initial={false}
                    animate={{ scaleX: done ? 1 : 0 }}
                    transition={{ duration: duration.base, ease: ease.move }}
                  />
                </span>
              )}
            </li>
          );
        })}
      </ol>
      {currentStep && (
        <p className="text-sm text-muted-foreground sm:hidden" aria-hidden>
          {t('progress', { current: Math.min(current + 1, total), total })} ·{' '}
          <span className="font-medium text-foreground">{currentStep.label}</span>
        </p>
      )}
    </nav>
  );
}
