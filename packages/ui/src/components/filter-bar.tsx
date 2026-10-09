'use client';

import { ListFilterIcon, XIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';
import { cn } from '../lib/utils';
import { Button } from './button';
import { Popover, PopoverContent, PopoverTrigger } from './popover';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from './sheet';

export interface FilterDef {
  id: string;
  /** The filter's name ("Location"); labels the control and its chip. */
  label: string;
  /** The control bound to the list state (a `Select`, picker…). Give it an `aria-label` or rely on `label`. */
  control: React.ReactNode;
  /** Display text of the applied value ("Taipei HQ"); `undefined` when the filter is not applied. */
  value?: React.ReactNode;
  /** Removes this filter (chip ✕). */
  onClear?: () => void;
  /** Shown next to the search on wider screens. At most 2. */
  primary?: boolean;
}

/**
 * The list toolbar: search + up to 2 primary filters + a **Filters** button (popover on desktop, bottom sheet on a
 * phone) holding the rest, with removable chips for applied filters and Clear all. Put it in `DataTable`'s
 * `toolbar`. On a phone, only the search and the Filters button show.
 */
export function FilterBar({
  search,
  filters = [],
  onClearAll,
  actions,
  className,
}: {
  search?: React.ReactNode;
  filters?: readonly FilterDef[];
  onClearAll?: () => void;
  /** Extra buttons at the end of the row (Export CSV…). */
  actions?: React.ReactNode;
  className?: string;
}) {
  const t = useTranslations('ui.filters');
  const [popoverOpen, setPopoverOpen] = React.useState(false);
  const [sheetOpen, setSheetOpen] = React.useState(false);
  const primary = filters.filter((f) => f.primary).slice(0, 2);
  const more = filters.filter((f) => !primary.includes(f));
  const applied = filters.filter((f) => f.value !== undefined && f.value !== null && f.value !== '');
  const appliedMore = applied.filter((f) => !primary.includes(f));

  const fieldList = (list: readonly FilterDef[]) => (
    <div className="grid gap-4">
      {list.map((f) => (
        <label key={f.id} className="grid min-w-0 gap-1.5 [&_[data-slot=select-trigger]]:w-full">
          <span className="text-sm font-medium">{f.label}</span>
          {f.control}
        </label>
      ))}
    </div>
  );

  return (
    <div data-slot="filter-bar" className={cn('flex w-full min-w-0 flex-col gap-2', className)}>
      <div className="flex w-full min-w-0 flex-wrap items-center gap-2">
        {search && <div className="min-w-0 flex-1 sm:flex-none">{search}</div>}
        {primary.map((f) => (
          <div key={f.id} className="hidden min-w-0 sm:block">
            {f.control}
          </div>
        ))}
        {more.length > 0 && (
          <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                className="hidden sm:inline-flex"
                aria-label={appliedMore.length ? t('buttonCount', { count: appliedMore.length }) : undefined}
              >
                <ListFilterIcon />
                {t('button')}
                {appliedMore.length > 0 && <Count n={appliedMore.length} />}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-80 max-w-[calc(100vw-2rem)]">
              {fieldList(more)}
              {onClearAll && applied.length > 0 && (
                <div className="mt-4 flex justify-end border-t pt-3">
                  <Button variant="ghost" size="sm" onClick={onClearAll}>
                    {t('clearAll')}
                  </Button>
                </div>
              )}
            </PopoverContent>
          </Popover>
        )}
        {filters.length > 0 && (
          <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
            <SheetTrigger asChild>
              <Button
                variant="outline"
                className="sm:hidden"
                aria-label={applied.length ? t('buttonCount', { count: applied.length }) : undefined}
              >
                <ListFilterIcon />
                {t('button')}
                {applied.length > 0 && <Count n={applied.length} />}
              </Button>
            </SheetTrigger>
            <SheetContent side="bottom" className="max-h-[85dvh] rounded-t-xl">
              <SheetHeader>
                <SheetTitle>{t('title')}</SheetTitle>
                <SheetDescription className="sr-only">{t('description')}</SheetDescription>
              </SheetHeader>
              <SheetBody className="py-2">{fieldList(filters)}</SheetBody>
              <SheetFooter>
                {onClearAll && applied.length > 0 && (
                  <Button variant="outline" onClick={onClearAll}>
                    {t('clearAll')}
                  </Button>
                )}
                <Button onClick={() => setSheetOpen(false)}>{t('done')}</Button>
              </SheetFooter>
            </SheetContent>
          </Sheet>
        )}
        {actions && <div className="ml-auto flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      {applied.length > 0 && (
        <ul aria-label={t('applied')} className="flex flex-wrap items-center gap-1.5">
          {applied.map((f) => (
            <li key={f.id} className={cn(primary.includes(f) && 'sm:hidden')}>
              <span className="inline-flex max-w-full items-center gap-1 rounded-full border bg-muted/50 py-0.5 pr-1 pl-2.5 text-xs animate-in fade-in-0 zoom-in-95 duration-(--motion-fast)">
                <span className="text-muted-foreground">{f.label}:</span>
                <span className="truncate font-medium">{f.value}</span>
                {f.onClear && (
                  <button
                    type="button"
                    onClick={f.onClear}
                    aria-label={t('remove', { label: f.label })}
                    className="grid size-5 shrink-0 place-items-center rounded-full text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  >
                    <XIcon className="size-3" aria-hidden />
                  </button>
                )}
              </span>
            </li>
          ))}
          {onClearAll && applied.length > 1 && (
            <li>
              <Button variant="link" size="sm" className="h-6 px-1 text-xs" onClick={onClearAll}>
                {t('clearAll')}
              </Button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

function Count({ n }: { n: number }) {
  return (
    <span className="grid h-5 min-w-5 place-items-center rounded-full bg-primary px-1 text-xs text-primary-foreground tabular-nums">
      {n}
    </span>
  );
}
