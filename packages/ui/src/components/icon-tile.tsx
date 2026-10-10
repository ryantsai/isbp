// From ReUI (reui.io, MIT, radix-mira style), adapted: square tiles to match the TEL look.
import { cva, type VariantProps } from 'class-variance-authority';
import { Slot } from 'radix-ui';
import type * as React from 'react';
import { cn } from '../lib/utils';

/**
 * A square that gives an icon one consistent surface: page and record headers, KPI tiles, empty states, quick links.
 * `soft` (the default here) derives its fill and ring from `currentColor`, so one text colour class retints it:
 * `text-primary` (default), `text-success`, `text-info`, `text-warning-foreground`, `text-destructive`,
 * `text-muted-foreground`. Decorative: put `aria-hidden` on it unless the icon is the only label.
 */
export const iconTileVariants = cva(
  [
    'relative inline-flex shrink-0 items-center justify-center align-middle',
    'size-(--icon-tile-size) rounded-(--icon-tile-radius)',
    '[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*=size-])]:size-(--icon-tile-icon-size)',
  ],
  {
    variants: {
      variant: {
        /** Plain bordered surface: list rows and toolbars. */
        outline: 'border border-border bg-card dark:bg-input/30',
        /** Tinted double square from `currentColor`. */
        soft: [
          'isolate p-(--icon-tile-inset) text-primary bg-current/10',
          'after:absolute after:-z-10 after:inset-(--icon-tile-inset)',
          'after:rounded-[calc(var(--icon-tile-radius)-var(--icon-tile-inset))]',
          'after:border after:border-current/20 after:bg-current/5',
        ],
        /** Filled tone with a contrasting glyph. */
        solid: 'bg-primary text-primary-foreground',
      },
      size: {
        xs: '[--icon-tile-size:--spacing(6)] [--icon-tile-icon-size:--spacing(3.5)] [--icon-tile-inset:--spacing(0.5)]',
        sm: '[--icon-tile-size:--spacing(8)] [--icon-tile-icon-size:--spacing(4)] [--icon-tile-inset:--spacing(0.5)]',
        default:
          '[--icon-tile-size:--spacing(10)] [--icon-tile-icon-size:--spacing(4.5)] [--icon-tile-inset:--spacing(0.75)]',
        lg: '[--icon-tile-size:--spacing(12)] [--icon-tile-icon-size:--spacing(5.5)] [--icon-tile-inset:--spacing(0.75)]',
      },
    },
    defaultVariants: { variant: 'soft', size: 'default' },
  },
);

export function IconTile({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<'span'> & VariantProps<typeof iconTileVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : 'span';
  return (
    <Comp
      data-slot="icon-tile"
      data-variant={variant ?? 'soft'}
      className={cn(
        iconTileVariants({ variant, size }),
        '[--icon-tile-radius:min(var(--radius-md),calc(var(--icon-tile-size)/3))]',
        className,
      )}
      {...props}
    />
  );
}
