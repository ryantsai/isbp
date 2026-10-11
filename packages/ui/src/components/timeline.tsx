'use client';

// From ReUI (reui.io, MIT, radix-mira style), adapted: vertical only, the indicator size is one variable (so an
// `IconTile` can be the indicator), `step`/`value` are optional (histories have no "current step"), no Radix, text in
// Astryx `Text`. Astryx has no timeline, so the indicator and connector line are the one hand-built part.
import { Text } from '@astryxdesign/core/Text';
import * as React from 'react';
import { cn } from '../lib/utils';

/** Gives `props` to the single child element instead of a wrapper (what Radix's `Slot` did). */
function withChild(children: React.ReactNode, props: Record<string, unknown> & { className?: string }) {
  const child = React.Children.only(children) as React.ReactElement<{ className?: string }>;
  return React.cloneElement(child, { ...props, className: cn(props.className, child.props.className) });
}

const TimelineContext = React.createContext<{ activeStep: number | undefined }>({ activeStep: undefined });

/**
 * A vertical list of events or steps, each with an indicator on a connecting line:
 *
 * ```tsx
 * <Timeline>
 *   <TimelineItem>
 *     <TimelineHeader>
 *       <TimelineSeparator />
 *       <TimelineIndicator asChild><IconTile size="xs" className="text-success"><CheckIcon /></IconTile></TimelineIndicator>
 *       <TimelineTitle>Approved by Mei Lin</TimelineTitle>
 *     </TimelineHeader>
 *     <TimelineContent>…</TimelineContent>
 *   </TimelineItem>
 * </Timeline>
 * ```
 *
 * With `value` (the current step) items with `step <= value` are marked `data-completed` and their line is primary.
 */
export function Timeline({ value, className, ...props }: React.ComponentProps<'ol'> & { value?: number }) {
  return (
    <TimelineContext.Provider value={{ activeStep: value }}>
      <ol
        data-slot="timeline"
        className={cn('group/timeline flex flex-col [--timeline-indicator:1.5rem]', className)}
        {...props}
      />
    </TimelineContext.Provider>
  );
}

export function TimelineItem({ step, className, ...props }: React.ComponentProps<'li'> & { step?: number }) {
  const { activeStep } = React.use(TimelineContext);
  return (
    <li
      data-slot="timeline-item"
      data-completed={(step !== undefined && activeStep !== undefined && step <= activeStep) || undefined}
      className={cn(
        'group/timeline-item relative ms-[calc(var(--timeline-indicator)+0.625rem)] flex flex-1 flex-col gap-0.5 not-last:pb-4',
        'has-[+[data-completed]]:**:data-[slot=timeline-separator]:bg-(--color-accent)',
        className,
      )}
      {...props}
    />
  );
}

export function TimelineHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div data-slot="timeline-header" className={cn('min-h-(--timeline-indicator)', className)} {...props} />
  );
}

export function TimelineIndicator({
  asChild = false,
  className,
  children,
  ...props
}: React.ComponentProps<'span'> & { asChild?: boolean }) {
  const merged = {
    'aria-hidden': true,
    'data-slot': 'timeline-indicator',
    className: cn(
      'absolute top-0 -left-[calc(var(--timeline-indicator)+0.625rem)] size-(--timeline-indicator)',
      !asChild &&
        'rounded-[3px] border-2 border-(--color-accent)/25 bg-(--color-background-body) group-data-completed/timeline-item:border-(--color-accent)',
      className,
    ),
    ...props,
  };
  return asChild ? withChild(children, merged) : <span {...merged}>{children}</span>;
}

export function TimelineSeparator({ className, ...props }: React.ComponentProps<'span'>) {
  return (
    <span
      aria-hidden
      data-slot="timeline-separator"
      className={cn(
        'absolute top-[calc(var(--timeline-indicator)+0.25rem)] -left-[calc(var(--timeline-indicator)/2+0.625rem)] h-[calc(100%-var(--timeline-indicator)-0.5rem)] w-px -translate-x-1/2 bg-(--color-border) group-last/timeline-item:hidden',
        className,
      )}
      {...props}
    />
  );
}

export function TimelineTitle({ className, children }: { className?: string; children?: React.ReactNode }) {
  return (
    <Text as="p" weight="medium" data-slot="timeline-title" className={cn('pt-0.5 leading-5', className)}>
      {children}
    </Text>
  );
}

export function TimelineContent({ className, children }: { className?: string; children?: React.ReactNode }) {
  return (
    <Text as="div" type="supporting" data-slot="timeline-content" className={className}>
      {children}
    </Text>
  );
}

export function TimelineDate({
  asChild = false,
  className,
  children,
  ...props
}: React.ComponentProps<'time'> & { asChild?: boolean }) {
  const merged = { 'data-slot': 'timeline-date', className: cn('block', className), ...props };
  return asChild ? (
    withChild(children, merged)
  ) : (
    <time {...merged}>
      <Text type="supporting" size="xsm">
        {children}
      </Text>
    </time>
  );
}
