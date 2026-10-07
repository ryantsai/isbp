'use client';

import { cn } from '@isbp/ui';
import { CheckIcon } from 'lucide-react';
import { motion } from 'motion/react';
import { type ReactNode, useId } from 'react';

export interface RadioCardOption<T extends string> {
  value: T;
  label: string;
  hint: string;
  icon: ReactNode;
}

/**
 * Single choice as a row of cards. Each card is a real (visually hidden) radio input inside its label,
 * so arrow keys, form semantics and screen readers work natively; the selection shows a check mark,
 * not only a colour.
 */
export function RadioCards<T extends string>({
  name,
  value,
  onChange,
  options,
  labelledBy,
  className,
}: {
  name: string;
  value: T;
  onChange: (value: T) => void;
  options: RadioCardOption<T>[];
  labelledBy: string;
  className?: string;
}) {
  const id = useId();
  return (
    <div role="radiogroup" aria-labelledby={labelledBy} className={cn('grid gap-2', className)}>
      {options.map((o) => {
        const selected = value === o.value;
        const hintId = `${id}-${o.value}-hint`;
        return (
          <label
            key={o.value}
            className={cn(
              'relative flex min-w-0 cursor-pointer items-start gap-3 rounded-lg border p-3 pr-8 text-sm transition-[border-color,background-color] duration-200 hover:bg-accent/50 has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50',
              selected && 'border-primary bg-primary/5 hover:bg-primary/5',
            )}
          >
            <input
              type="radio"
              name={name}
              value={o.value}
              checked={selected}
              onChange={() => onChange(o.value)}
              aria-describedby={hintId}
              className="sr-only"
            />
            <span
              className={cn(
                'grid size-8 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground transition-colors [&_svg]:size-4',
                selected && 'bg-primary/10 text-primary',
              )}
              aria-hidden
            >
              {o.icon}
            </span>
            <span className="min-w-0">
              <span className="block font-medium">{o.label}</span>
              <span id={hintId} className="mt-0.5 block text-xs text-muted-foreground">
                {o.hint}
              </span>
            </span>
            {selected && (
              <motion.span
                layoutId={`${id}-check`}
                className="absolute top-2 right-2 grid size-4 place-items-center rounded-full bg-primary text-primary-foreground"
                aria-hidden
              >
                <CheckIcon className="size-2.5" strokeWidth={3} />
              </motion.span>
            )}
          </label>
        );
      })}
    </div>
  );
}
