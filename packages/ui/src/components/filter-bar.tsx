'use client';

import { Badge } from '@astryxdesign/core/Badge';
import { Button } from '@astryxdesign/core/Button';
import { Icon } from '@astryxdesign/core/Icon';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { Popover } from '@astryxdesign/core/Popover';
import { Text } from '@astryxdesign/core/Text';
import { Token } from '@astryxdesign/core/Token';
import { ListFilterIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';
import { cn } from '../lib/utils';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from './sheet';

export interface FilterDef {
  id: string;
  /** The filter's name ("Location"); labels the control and its chip. */
  label: string;
  /** The control bound to list state. Give it a hidden `label` or `aria-label` matching the filter's label. */
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
  const [sheetOpen, setSheetOpen] = React.useState(false);
  const primary = filters.filter((f) => f.primary).slice(0, 2);
  const more = filters.filter((f) => !primary.includes(f));
  const applied = filters.filter((f) => f.value !== undefined && f.value !== null && f.value !== '');
  const appliedMore = applied.filter((f) => !primary.includes(f));

  const fieldList = (list: readonly FilterDef[]) => (
    <VStack gap={3}>
      {list.map((f) => (
        <div key={f.id} className="grid min-w-0 gap-1.5 [&>*]:w-full [&>*]:max-w-none">
          <Text type="label">{f.label}</Text>
          {f.control}
        </div>
      ))}
    </VStack>
  );

  /** The "Filters" button with the number of applied filters. */
  const filtersButton = (count: number, extra?: { className?: string; onClick?: () => void }) => (
    <Button
      label={t('button')}
      aria-label={count ? t('buttonCount', { count }) : undefined}
      variant="secondary"
      icon={<Icon icon={ListFilterIcon} />}
      endContent={count > 0 ? <Badge variant="info" label={count} /> : undefined}
      {...extra}
    />
  );

  return (
    <VStack gap={2} data-slot="filter-bar" className={cn('w-full min-w-0', className)}>
      <HStack gap={2} wrap="wrap" vAlign="center" className="w-full min-w-0">
        {search && <div className="min-w-0 flex-1 sm:flex-none">{search}</div>}
        {primary.map((f) => (
          <div key={f.id} className="hidden min-w-0 sm:block">
            {f.control}
          </div>
        ))}
        {more.length > 0 && (
          <div className="hidden sm:block">
            <Popover
              label={t('title')}
              placement="below"
              alignment="start"
              content={
                <VStack gap={4} className="w-72 max-w-full">
                  {fieldList(more)}
                  {onClearAll && applied.length > 0 && (
                    <HStack hAlign="end">
                      <Button label={t('clearAll')} variant="ghost" size="sm" onClick={onClearAll} />
                    </HStack>
                  )}
                </VStack>
              }
            >
              {filtersButton(appliedMore.length)}
            </Popover>
          </div>
        )}
        {filters.length > 0 && (
          <>
            {filtersButton(applied.length, { className: 'sm:hidden', onClick: () => setSheetOpen(true) })}
            <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
              <SheetContent side="bottom" className="max-h-[85dvh] rounded-t-xl">
                <SheetHeader>
                  <SheetTitle>{t('title')}</SheetTitle>
                  <SheetDescription className="sr-only">{t('description')}</SheetDescription>
                </SheetHeader>
                <SheetBody className="py-2">{fieldList(filters)}</SheetBody>
                <SheetFooter>
                  {onClearAll && applied.length > 0 && (
                    <Button label={t('clearAll')} variant="secondary" onClick={onClearAll} />
                  )}
                  <Button label={t('done')} variant="primary" onClick={() => setSheetOpen(false)} />
                </SheetFooter>
              </SheetContent>
            </Sheet>
          </>
        )}
        {actions && (
          <HStack gap={2} vAlign="center" hAlign="end" wrap="wrap" className="ml-auto shrink-0 max-sm:w-full">
            {actions}
          </HStack>
        )}
      </HStack>
      {applied.length > 0 && (
        <HStack as="ul" gap={1.5} wrap="wrap" vAlign="center" aria-label={t('applied')}>
          {applied.map((f) => {
            const text = typeof f.value === 'string' || typeof f.value === 'number' ? String(f.value) : null;
            return (
              <li key={f.id} className={cn(primary.includes(f) && 'sm:hidden')}>
                <Token
                  size="sm"
                  label={text === null ? f.label : `${f.label}: ${text}`}
                  endContent={text === null ? f.value : undefined}
                  onRemove={f.onClear}
                />
              </li>
            );
          })}
          {onClearAll && applied.length > 1 && (
            <li>
              <Button label={t('clearAll')} variant="ghost" size="sm" onClick={onClearAll} />
            </li>
          )}
        </HStack>
      )}
    </VStack>
  );
}
