import { Card as AstryxCard } from '@astryxdesign/core/Card';
import { Text } from '@astryxdesign/core/Text';
import type * as React from 'react';
import { cn } from '../lib/utils';

/*
 * Astryx's `Card` is a bare surface. Page code needs the usual card anatomy (header with title, description and an
 * action, content, footer), so this file adds it on top: the surface and the type are Astryx, the spacing is the
 * product's (16 px padding, 16 px between parts). Don't add your own padding on top (no `p-6` cards).
 */

/**
 * `interactive`: a card that is one big link or button (put an `after:absolute after:inset-0` link inside). It lifts
 * 1 px with a border hint on hover (150 ms) and shows the focus ring of the link inside; no movement with reduced
 * motion. (For a card that is *only* a link, Astryx `ClickableCard` is the primitive.)
 */
export function Card({
  className,
  interactive,
  ...props
}: Omit<React.ComponentProps<'div'>, 'color'> & { interactive?: boolean }) {
  return (
    <AstryxCard
      padding={0}
      data-slot="card"
      data-interactive={interactive || undefined}
      className={cn(
        'flex flex-col gap-4 py-4',
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

/** The title text. `className` lays out the title itself (`flex items-center gap-2` puts an icon beside the text). */
export function CardTitle({ className, children, ...props }: React.ComponentProps<'div'>) {
  return (
    <div data-slot="card-title" className={className} {...props}>
      <Text as="div" size="base" weight="semibold" className="contents">
        {children}
      </Text>
    </div>
  );
}

export function CardDescription({ className, children, ...props }: React.ComponentProps<'div'>) {
  return (
    <div data-slot="card-description" className={className} {...props}>
      <Text as="div" type="supporting" color="secondary" className="contents">
        {children}
      </Text>
    </div>
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
