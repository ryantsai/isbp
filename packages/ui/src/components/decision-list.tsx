'use client';

/**
 * "Go through a list and decide": the shared kit of stocktakes, account reviews and database access reviews, so the
 * people who take part in all of them learn one way of working.
 *
 * - `DecisionProgress`: a slim progress bar with a one-line summary (never colour alone).
 * - `DecisionViews`: the To do · Done · All tabs (with counts), each with its own `TabsContent`.
 * - `DecisionList`: one row per item — the item on the left (title wraps, facts below) and labelled decision buttons
 *   on the right (below it on a phone), optional checkboxes with a bulk bar; decided rows leave "To do" with a
 *   collapse. Items the viewer can't decide show their result instead.
 * - `DecisionDone`: the "all done" state that replaces the list when nothing is left for the person.
 *
 * The kit only lays things out: the page says what a decision does (one click, or a small dialog for a reason or a
 * date) in `onDecide`, and offers Undo in its toast where a decision is quick to reverse.
 */
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react';
import { motion } from 'motion/react';
import { useTranslations } from 'next-intl';
import * as React from 'react';
import { cn } from '../lib/utils';
import { Button } from './button';
import { Checkbox } from './checkbox';
import { ErrorState } from './empty-state';
import { Meter } from './meter';
import { AnimatedItem, AnimatedList, ease, SuccessMark, useEntranceMotion } from './motion';
import { Skeleton } from './skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './tabs';

/* ───────────────────────── progress ───────────────────────── */

/**
 * How far the list is: a slim bar (width animates) and the summary in words, plus optional status lines
 * ("Waiting for sign-off by …").
 */
export function DecisionProgress({
  done,
  total,
  label,
  valueText,
  summary,
  children,
  className,
}: {
  done: number;
  total: number;
  /** Accessible name of the bar ("Progress of Q4 access review"). */
  label: string;
  /** How the value reads ("12 of 40 decided"); shown next to the bar. */
  valueText: string;
  /** The breakdown in words ("8 kept · 4 revoked · 28 to decide"). */
  summary?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('grid min-w-0 gap-1.5', className)}>
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
        <Meter
          kind="progress"
          value={done}
          max={Math.max(total, 1)}
          label={label}
          valueText={valueText}
          size="sm"
          tone={total > 0 && done >= total ? 'success' : 'primary'}
          className="max-w-md min-w-40 flex-1"
        />
        <span className="text-sm font-medium tabular-nums">{valueText}</span>
      </div>
      {summary && <p className="text-sm text-muted-foreground">{summary}</p>}
      {children}
    </div>
  );
}

/* ───────────────────────── views ───────────────────────── */

export interface DecisionView<V extends string> {
  value: V;
  label: string;
  count?: number;
}

/**
 * To do · Done · All (at most a few tabs; finer filters belong in a select). Each tab renders a `TabsContent`, and
 * only the active one renders `children`.
 */
export function DecisionViews<V extends string>({
  value,
  onValueChange,
  views,
  label,
  actions,
  children,
  className,
}: {
  value: V;
  onValueChange: (value: V) => void;
  views: readonly DecisionView<V>[];
  /** Accessible name of the tab list. */
  label?: string;
  /** Controls next to the tabs (a filter select, search). */
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Tabs
      value={value}
      onValueChange={(v) => onValueChange(v as V)}
      className={cn('min-w-0 gap-3', className)}
    >
      <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <TabsList aria-label={label} className="max-w-full justify-start overflow-x-auto">
          {views.map((v) => (
            <TabsTrigger key={v.value} value={v.value}>
              {v.label}
              {v.count !== undefined && (
                <span className="ml-1 rounded-full bg-muted px-1.5 text-xs text-muted-foreground tabular-nums">
                  {v.count}
                </span>
              )}
            </TabsTrigger>
          ))}
        </TabsList>
        {actions && <div className="flex min-w-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {views.map((v) => (
        <TabsContent key={v.value} value={v.value} className="min-w-0">
          {v.value === value && children}
        </TabsContent>
      ))}
    </Tabs>
  );
}

/* ───────────────────────── list ───────────────────────── */

export interface DecisionOption<V extends string> {
  value: V;
  /** Short and always visible, at every width ("Keep", "Revoke", "It's right"). */
  label: string;
  icon?: React.ReactNode;
  /** Pressed in the destructive style (revoke, delete). */
  destructive?: boolean;
  /** Offered for selected items in the bulk bar (default true). */
  bulk?: boolean;
}

export interface DecisionListProps<T, V extends string> {
  /** Accessible name of the list ("Your items"). */
  label: string;
  items: readonly T[];
  getId: (item: T) => string;
  /** The item: a title that wraps, then a line or two of facts. */
  renderItem: (item: T) => React.ReactNode;
  options: readonly DecisionOption<V>[];
  /** The item's current decision: its button shows pressed. */
  decisionOf: (item: T) => V | null;
  /** Whether the viewer may decide this item. Others show `renderResult`. */
  canDecide: (item: T) => boolean;
  /** The result for people who can't decide (a badge). */
  renderResult?: (item: T) => React.ReactNode;
  /** The button's accessible name in a row, naming the item ("Keep access for Mei Lin"). */
  optionLabel?: (option: DecisionOption<V>, item: T) => string;
  /** Accessible name of a row's button group ("Decision for Mei Lin"). */
  groupLabel?: (item: T) => string;
  onDecide: (items: T[], value: V) => void;
  /** Items whose decision is being saved. */
  busy?: ReadonlySet<string>;
  selectable?: boolean;
  /** A bulk button's text ("Keep 3"). */
  bulkLabel?: (option: DecisionOption<V>, count: number) => string;
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  empty?: React.ReactNode;
  /** Server paging: shows "1–25 of 80" with previous/next when there is more than one page. */
  total?: number;
  page?: number;
  pageSize?: number;
  onPageChange?: (page: number) => void;
  className?: string;
}

/**
 * Items with inline, labelled decisions. A phone stacks the buttons under the item, so the person's own action is
 * never cut off or reduced to an icon.
 */
export function DecisionList<T, V extends string>({
  label,
  items,
  getId,
  renderItem,
  options,
  decisionOf,
  canDecide,
  renderResult,
  optionLabel,
  groupLabel,
  onDecide,
  busy,
  selectable,
  bulkLabel,
  loading,
  error,
  onRetry,
  empty,
  total,
  page = 1,
  pageSize = 25,
  onPageChange,
  className,
}: DecisionListProps<T, V>) {
  const tt = useTranslations('ui.table');
  const tc = useTranslations('common');
  const [picked, setPicked] = React.useState<ReadonlySet<string>>(() => new Set());
  const decidable = items.filter(canDecide);
  const selectableIds = new Set(decidable.map(getId));
  // Only items still on screen and decidable count as selected.
  const selected = decidable.filter((i) => picked.has(getId(i)));
  const allPicked = decidable.length > 0 && selected.length === decidable.length;
  const showChecks = Boolean(selectable) && decidable.length > 1;
  const bulk = options.filter((o) => o.bulk !== false);
  const pageCount = total !== undefined ? Math.max(1, Math.ceil(total / pageSize)) : 1;

  const toggle = (id: string, on: boolean) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  const decide = (list: T[], value: V) => {
    onDecide(list, value);
    setPicked(new Set());
  };

  if (error && !items.length)
    return (
      <div className={cn('rounded-xl border bg-card px-4 shadow-xs', className)}>
        <ErrorState compact kind="list" error={error} onRetry={onRetry} />
      </div>
    );

  return (
    <section aria-label={label} className={cn('min-w-0 rounded-xl border bg-card shadow-xs', className)}>
      {showChecks && (
        <div className="flex min-h-12 flex-wrap items-center gap-x-3 gap-y-2 border-b px-4 py-2">
          <Checkbox
            checked={allPicked ? true : selected.length ? 'indeterminate' : false}
            onCheckedChange={(v) => setPicked(v === true ? new Set(selectableIds) : new Set())}
            aria-label={tt('selectAll')}
          />
          <span className="text-sm text-muted-foreground" aria-live="polite">
            {selected.length ? tc('selectedCount', { count: selected.length }) : tt('selectAll')}
          </span>
          {selected.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              {bulk.map((o) => (
                <Button
                  key={o.value}
                  size="sm"
                  variant="outline"
                  onClick={() => decide(selected, o.value)}
                  disabled={selected.some((i) => busy?.has(getId(i)))}
                >
                  {o.icon}
                  {bulkLabel ? bulkLabel(o, selected.length) : o.label}
                </Button>
              ))}
            </div>
          )}
        </div>
      )}
      {loading && !items.length ? (
        <ul className="divide-y" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <li key={i} className="flex items-center gap-3 px-4 py-4">
              <div className="grid flex-1 gap-2">
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="h-3 w-2/3" />
              </div>
              <Skeleton className="h-8 w-40" />
            </li>
          ))}
        </ul>
      ) : !items.length ? (
        <div className="px-4 py-2">{empty}</div>
      ) : (
        <AnimatedList as="ul" className="divide-y" aria-label={label}>
          {items.map((item) => {
            const id = getId(item);
            const can = canDecide(item);
            const current = decisionOf(item);
            const saving = busy?.has(id) ?? false;
            return (
              <AnimatedItem key={id} as="li">
                <div
                  className={cn(
                    'grid min-w-0 grid-cols-[minmax(0,1fr)] items-start gap-x-3 gap-y-2.5 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center',
                    showChecks && 'grid-cols-[auto_minmax(0,1fr)] sm:grid-cols-[auto_minmax(0,1fr)_auto]',
                  )}
                >
                  {showChecks && (
                    <span className="pt-0.5 sm:pt-0">
                      {can && (
                        <Checkbox
                          checked={picked.has(id)}
                          onCheckedChange={(v) => toggle(id, v === true)}
                          aria-label={groupLabel ? groupLabel(item) : tt('selectRow')}
                        />
                      )}
                    </span>
                  )}
                  <div className="min-w-0 text-sm">{renderItem(item)}</div>
                  <div className={cn('min-w-0', showChecks && 'col-start-2 sm:col-start-auto')}>
                    {can ? (
                      <div
                        role="group"
                        aria-label={groupLabel?.(item)}
                        className="flex flex-wrap items-center gap-1.5 sm:justify-end"
                      >
                        {options.map((o) => {
                          const pressed = current === o.value;
                          return (
                            <Button
                              key={o.value}
                              size="sm"
                              variant={pressed ? (o.destructive ? 'destructive' : 'secondary') : 'outline'}
                              aria-pressed={pressed}
                              aria-label={optionLabel?.(o, item)}
                              disabled={saving}
                              onClick={() => decide([item], o.value)}
                              className={cn(pressed && !o.destructive && 'ring-1 ring-primary/40')}
                            >
                              {o.icon}
                              {o.label}
                            </Button>
                          );
                        })}
                      </div>
                    ) : (
                      renderResult?.(item)
                    )}
                  </div>
                </div>
              </AnimatedItem>
            );
          })}
        </AnimatedList>
      )}
      {total !== undefined && pageCount > 1 && onPageChange && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t px-4 py-2 text-sm text-muted-foreground">
          <span className="tabular-nums">
            {tt('showing', {
              from: (page - 1) * pageSize + 1,
              to: Math.min(page * pageSize, total),
              total,
            })}
          </span>
          <span className="flex gap-1">
            <Button
              variant="outline"
              size="icon-sm"
              aria-label={tt('previous')}
              disabled={page <= 1}
              onClick={() => onPageChange(page - 1)}
            >
              <ChevronLeftIcon />
            </Button>
            <Button
              variant="outline"
              size="icon-sm"
              aria-label={tt('next')}
              disabled={page >= pageCount}
              onClick={() => onPageChange(page + 1)}
            >
              <ChevronRightIcon />
            </Button>
          </span>
        </div>
      )}
    </section>
  );
}

/* ───────────────────────── done ───────────────────────── */

/**
 * Nothing left for the person: a drawn check, what happened and what's next. It fades and scales in (200 ms) when
 * the last item is decided; on page load it is simply there.
 */
export function DecisionDone({
  title,
  description,
  action,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  const play = useEntranceMotion();
  return (
    <motion.div
      role="status"
      initial={play ? { opacity: 0, scale: 0.97 } : false}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.2, ease: ease.enter }}
      className={cn(
        'flex min-w-0 flex-col items-start gap-3 rounded-xl border bg-card p-5 shadow-xs sm:flex-row sm:items-center',
        className,
      )}
    >
      <SuccessMark className="size-9" />
      <div className="min-w-0 flex-1">
        <p className="font-medium">{title}</p>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {action}
    </motion.div>
  );
}
