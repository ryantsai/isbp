import { VStack } from '@astryxdesign/core/Layout';
import { Skeleton as AstryxSkeleton } from '@astryxdesign/core/Skeleton';
import type * as React from 'react';

/**
 * A placeholder shaped like the content it stands in for. Astryx's `Skeleton` paints it; the size comes from layout
 * classes (`h-4 w-32`) or the Astryx `width`/`height` props.
 */
export function Skeleton({ className, ...props }: React.ComponentProps<typeof AstryxSkeleton>) {
  return <AstryxSkeleton data-slot="skeleton" aria-hidden className={className} {...props} />;
}

/** The generic page placeholder (title, description, a content block) while a page loads. */
export function PageSkeleton({ className }: { className?: string }) {
  return (
    <VStack gap={4} className={className} aria-busy="true">
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-4 w-96 max-w-full" />
      <Skeleton className="h-64 w-full" />
    </VStack>
  );
}
