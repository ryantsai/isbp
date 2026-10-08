import type * as React from 'react';
import { cn } from '../lib/utils';

export function Table({
  className,
  scrollable,
  ...props
}: React.ComponentProps<'table'> & {
  /**
   * For a table without links or buttons that may scroll sideways on a narrow screen: its scroll container becomes a
   * focusable region named like the table, so keyboard users can scroll it (WCAG 2.1.1).
   */
  scrollable?: boolean;
}) {
  return (
    <div
      data-slot="table-container"
      className={cn(
        'relative w-full overflow-x-auto',
        scrollable && 'rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
      )}
      {...(scrollable
        ? {
            role: 'region',
            tabIndex: 0,
            'aria-label': props['aria-label'],
            'aria-labelledby': props['aria-labelledby'],
          }
        : {})}
    >
      <table data-slot="table" className={cn('w-full caption-bottom text-sm', className)} {...props} />
    </div>
  );
}

export function TableHeader({ className, ...props }: React.ComponentProps<'thead'>) {
  return <thead data-slot="table-header" className={cn('[&_tr]:border-b', className)} {...props} />;
}

export function TableBody({ className, ...props }: React.ComponentProps<'tbody'>) {
  return <tbody data-slot="table-body" className={cn('[&_tr:last-child]:border-0', className)} {...props} />;
}

export function TableRow({ className, ...props }: React.ComponentProps<'tr'>) {
  return (
    <tr
      data-slot="table-row"
      className={cn('border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted', className)}
      {...props}
    />
  );
}

export function TableHead({ className, ...props }: React.ComponentProps<'th'>) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        'h-10 px-3 text-left align-middle text-xs font-medium whitespace-nowrap text-muted-foreground [&:has([role=checkbox])]:pr-0',
        className,
      )}
      {...props}
    />
  );
}

export function TableCell({ className, ...props }: React.ComponentProps<'td'>) {
  return (
    <td
      data-slot="table-cell"
      className={cn('px-3 py-2.5 align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0', className)}
      {...props}
    />
  );
}
