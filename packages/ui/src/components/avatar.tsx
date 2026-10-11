'use client';

import { Avatar } from '@astryxdesign/core/Avatar';
import type { ComponentProps } from 'react';
import { cn, hueOf } from '../lib/utils';

const SIZES = [16, 20, 24, 32, 36, 40, 48, 60, 64, 72, 96, 128, 144, 180] as const;

/**
 * Tailwind `size-N` (N × 4 px) in `className` → the diameter in px (32 when there is none).
 */
function diameterOf(className?: string): number {
  const step = className?.match(/(?:^|\s)size-(\d+)(?=\s|$)/)?.[1];
  return step ? Number(step) * 4 : 32;
}

/** The nearest size Astryx's avatar supports (its type scale follows it). */
function sizeFrom(px: number): (typeof SIZES)[number] {
  return SIZES.reduce((best, s) => (Math.abs(s - px) < Math.abs(best - px) ? s : best));
}

/**
 * A person's avatar: their photo, or initials on a soft colour that is the same for the same name everywhere (and
 * adapts to dark mode). Size it with `className="size-7 text-[10px]"` (the `size-N` step sets the diameter). Built on
 * Astryx `Avatar`; it has no tooltip because the name is always shown next to it.
 */
export function UserAvatar({
  name,
  src,
  className,
  ...rest
}: Omit<ComponentProps<typeof Avatar>, 'name' | 'src' | 'size' | 'tooltip' | 'style'> & {
  name: string;
  src?: string | null;
}) {
  const px = diameterOf(className);
  return (
    <Avatar
      name={name}
      src={src ?? undefined}
      size={sizeFrom(px)}
      tooltip={false}
      {...rest}
      // Astryx adds a bare `size-<px>` class that Tailwind's `size-16`/`size-40` utilities would override: set the exact diameter.
      style={{ ['--h' as string]: hueOf(name), width: px, height: px }}
      className={cn(
        // The initials sit in Astryx's own fallback element, which paints its own tint: colour that one (AA on both).
        '[&_.astryx-avatar-fallback]:bg-[oklch(0.93_0.04_var(--h))] [&_.astryx-avatar-fallback]:text-[oklch(0.36_0.09_var(--h))]',
        'dark:[&_.astryx-avatar-fallback]:bg-[oklch(0.32_0.06_var(--h))] dark:[&_.astryx-avatar-fallback]:text-[oklch(0.92_0.05_var(--h))]',
        className,
      )}
    />
  );
}
