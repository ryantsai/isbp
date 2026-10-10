import type * as React from 'react';
import { cn } from '../lib/utils';

export function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden
      className={cn('skeleton-shimmer rounded-md bg-muted', className)}
      {...props}
    />
  );
}

/** The generic page placeholder (title, description, a content block) while a page loads. */
export function PageSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn('space-y-4', className)} aria-busy="true">
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-4 w-96 max-w-full" />
      <Skeleton className="h-64 w-full rounded-lg" />
    </div>
  );
}
