'use client';

import { cn } from '@isbp/ui';

/**
 * "IS" on TEL blue, closed by the green square of the TEL logo. The one hand-made visual in the shell: it is the
 * product's logo, not a control.
 */
export function BrandMark({ className = 'size-8' }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'relative grid shrink-0 place-items-center rounded-[5px] bg-primary text-[13px] font-bold tracking-tight text-primary-foreground',
        className,
      )}
    >
      <span className="-translate-x-[3px]">IS</span>
      <span className="absolute right-[14%] bottom-[29%] size-[15%] bg-brand-green" />
    </span>
  );
}
