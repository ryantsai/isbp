import type * as React from 'react';
import { cn } from '../lib/utils';

/**
 * `interactive`: a card that is one big link or button (put an `after:absolute after:inset-0` link inside, or
 * render it `asChild`-style yourself). It lifts 2 px with a shadow on hover (150 ms) and shows the focus ring of the
 * link inside; no movement with reduced motion.
 */
export function Card({
  className,
  interactive,
  ...props
}: React.ComponentProps<'div'> & { interactive?: boolean }) {
  return (
    <div
      data-slot="card"
      data-interactive={interactive || undefined}
      className={cn(
        'flex flex-col gap-4 rounded-lg border bg-card py-4 text-card-foreground',
        interactive &&
          'relative transition-[translate,box-shadow,border-color] duration-150 ease-move hover:-translate-y-px hover:border-primary/50 hover:shadow-sm has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50 motion-reduce:transition-none motion-reduce:hover:translate-y-0',
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        'grid auto-rows-min grid-rows-[auto_auto] items-start gap-1 px-4 has-data-[slot=card-action]:grid-cols-[1fr_auto]',
        className,
      )}
      {...props}
    />
  );
}

export function CardTitle({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-title"
      className={cn('text-[15px] leading-tight font-semibold', className)}
      {...props}
    />
  );
}

export function CardDescription({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div data-slot="card-description" className={cn('text-sm text-muted-foreground', className)} {...props} />
  );
}

export function CardAction({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-action"
      className={cn('col-start-2 row-span-2 row-start-1 self-start justify-self-end', className)}
      {...props}
    />
  );
}

export function CardContent({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="card-content" className={cn('px-4', className)} {...props} />;
}

export function CardFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="card-footer" className={cn('flex items-center px-4', className)} {...props} />;
}
