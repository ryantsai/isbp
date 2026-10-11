// From ReUI (reui.io, MIT, radix-mira style), adapted: square tiles to match the TEL look, no cva / Radix.
import * as React from 'react';
import { cn } from '../lib/utils';

export type IconTileVariant = 'outline' | 'soft' | 'solid';
export type IconTileSize = 'xs' | 'sm' | 'default' | 'lg';

const base = [
  'relative inline-flex shrink-0 items-center justify-center align-middle',
  'size-(--icon-tile-size) rounded-(--icon-tile-radius)',
  '[--icon-tile-radius:min(var(--radius-md),calc(var(--icon-tile-size)/3))]',
  '[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*=size-])]:size-(--icon-tile-icon-size)',
].join(' ');

const variantClass: Record<IconTileVariant, string> = {
  /** Plain bordered surface: list rows and toolbars. */
  outline: 'border border-(--color-border) bg-(--color-background-card)',
  /** Tinted double square from `currentColor`. */
  soft: [
    'isolate p-(--icon-tile-inset) text-(--color-accent) bg-current/10',
    'after:absolute after:-z-10 after:inset-(--icon-tile-inset)',
    'after:rounded-[calc(var(--icon-tile-radius)-var(--icon-tile-inset))]',
    'after:border after:border-current/20 after:bg-current/5',
  ].join(' '),
  /** Filled tone with a contrasting glyph. */
  solid: 'bg-(--color-accent) text-(--color-on-accent)',
};

const sizeClass: Record<IconTileSize, string> = {
  xs: '[--icon-tile-size:--spacing(6)] [--icon-tile-icon-size:--spacing(3.5)] [--icon-tile-inset:--spacing(0.5)]',
  sm: '[--icon-tile-size:--spacing(8)] [--icon-tile-icon-size:--spacing(4)] [--icon-tile-inset:--spacing(0.5)]',
  default:
    '[--icon-tile-size:--spacing(10)] [--icon-tile-icon-size:--spacing(4.5)] [--icon-tile-inset:--spacing(0.75)]',
  lg: '[--icon-tile-size:--spacing(12)] [--icon-tile-icon-size:--spacing(5.5)] [--icon-tile-inset:--spacing(0.75)]',
};

/** The class list of a tile; `iconTileVariants({ variant, size })` for code that styles its own element. */
export function iconTileVariants({
  variant = 'soft',
  size = 'default',
}: { variant?: IconTileVariant | null; size?: IconTileSize | null } = {}) {
  return cn(base, variantClass[variant ?? 'soft'], sizeClass[size ?? 'default']);
}

/**
 * A square that gives an icon one consistent surface: page and record headers, KPI tiles, empty states, quick links.
 * `soft` (the default here) derives its fill and ring from `currentColor`, so one text colour class retints it:
 * `text-primary` (default), `text-success`, `text-info`, `text-warning-foreground`, `text-destructive`,
 * `text-muted-foreground`. Decorative: put `aria-hidden` on it unless the icon is the only label. Astryx has no such
 * tile, so this is the one place the tint is built by hand; the colours are theme tokens.
 *
 * `asChild` puts the tile's look on the single child element instead of a wrapping `span`.
 */
export function IconTile({
  className,
  variant,
  size,
  asChild = false,
  children,
  ...props
}: React.ComponentProps<'span'> & {
  variant?: IconTileVariant | null;
  size?: IconTileSize | null;
  asChild?: boolean;
}) {
  const merged = {
    'data-slot': 'icon-tile',
    'data-variant': variant ?? 'soft',
    className: cn(iconTileVariants({ variant, size }), className),
    ...props,
  };
  if (asChild && React.isValidElement<{ className?: string }>(children)) {
    return React.cloneElement(children, {
      ...merged,
      className: cn(merged.className, children.props.className),
    });
  }
  return <span {...merged}>{children}</span>;
}
