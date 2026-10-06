'use client';

import { Avatar as AvatarPrimitive } from 'radix-ui';
import type * as React from 'react';
import { cn, hueOf, initials } from '../lib/utils';

export function Avatar({ className, ...props }: React.ComponentProps<typeof AvatarPrimitive.Root>) {
  return (
    <AvatarPrimitive.Root
      data-slot="avatar"
      className={cn('relative flex size-8 shrink-0 overflow-hidden rounded-full', className)}
      {...props}
    />
  );
}

export function AvatarImage({ className, ...props }: React.ComponentProps<typeof AvatarPrimitive.Image>) {
  return (
    <AvatarPrimitive.Image
      data-slot="avatar-image"
      className={cn('aspect-square size-full object-cover', className)}
      {...props}
    />
  );
}

export function AvatarFallback({
  className,
  ...props
}: React.ComponentProps<typeof AvatarPrimitive.Fallback>) {
  return (
    <AvatarPrimitive.Fallback
      data-slot="avatar-fallback"
      className={cn(
        'flex size-full items-center justify-center rounded-full bg-muted text-xs leading-none font-medium whitespace-nowrap',
        className,
      )}
      {...props}
    />
  );
}

/** Avatar with a deterministic, theme-aware colour derived from the person's name. */
export function UserAvatar({
  name,
  src,
  className,
}: {
  name: string;
  src?: string | null;
  className?: string;
}) {
  const hue = hueOf(name);
  return (
    <Avatar className={className}>
      {src ? <AvatarImage src={src} alt="" /> : null}
      <AvatarFallback
        style={{ ['--h' as string]: hue }}
        className="bg-[oklch(0.93_0.04_var(--h))] text-[oklch(0.38_0.09_var(--h))] dark:bg-[oklch(0.32_0.06_var(--h))] dark:text-[oklch(0.9_0.05_var(--h))]"
      >
        {initials(name)}
      </AvatarFallback>
    </Avatar>
  );
}
