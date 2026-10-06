'use client';

import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  type RowSelectionState,
  useReactTable,
} from '@tanstack/react-table';
import { ArrowDownIcon, ArrowUpDownIcon, ArrowUpIcon, ChevronLeftIcon, ChevronRightIcon } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useTranslations } from 'next-intl';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import * as React from 'react';
import { cn } from '../lib/utils';
import { Button } from './button';
import { Checkbox } from './checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './select';
import { Skeleton } from './skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './table';

declare module '@tanstack/react-table' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData, TValue> {
    /** Server sort key; makes the header clickable. */
    sortKey?: string;
    className?: string;
    headerClassName?: string;
  }
}

/* ───────────────────────── URL-synced list state ───────────────────────── */

export interface ListState {
  page: number;
  pageSize: number;
  sort?: string;
  q?: string;
  [filter: string]: string | number | undefined;
}

/**
 * Keeps paging, sorting, search and filters in the URL so lists are shareable and survive reloads.
 * Changing anything but the page resets to page 1.
 */
export function useListState(defaults: Partial<ListState> = {}) {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const state = React.useMemo<ListState>(() => {
    const out: ListState = { page: 1, pageSize: 25, ...defaults } as ListState;
    sp.forEach((value, key) => {
      out[key] = key === 'page' || key === 'pageSize' ? Number(value) || out[key] : value;
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sp]);
  const set = React.useCallback(
    (patch: Partial<ListState>) => {
      const next = new URLSearchParams(sp.toString());
      const resetPage = Object.keys(patch).some((k) => k !== 'page');
      for (const [k, v] of Object.entries({
        ...patch,
        ...(resetPage && !('page' in patch) ? { page: 1 } : {}),
      })) {
        if (v === undefined || v === '' || v === null || (k === 'page' && v === 1)) next.delete(k);
        else next.set(k, String(v));
      }
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [sp, router, pathname],
  );
  return [state, set] as const;
}

/* ───────────────────────── table ───────────────────────── */

export interface DataTableProps<T> {
  columns: ColumnDef<T, unknown>[];
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  sort?: string;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
  onSortChange?: (sort: string | undefined) => void;
  loading?: boolean;
  fetching?: boolean;
  getRowId?: (row: T) => string;
  onRowClick?: (row: T) => void;
  selectable?: boolean;
  selection?: RowSelectionState;
  onSelectionChange?: (selection: RowSelectionState) => void;
  empty?: React.ReactNode;
  toolbar?: React.ReactNode;
  className?: string;
  label?: string;
}

const PAGE_SIZES = [10, 25, 50, 100];

export function DataTable<T>({
  columns,
  data,
  total,
  page,
  pageSize,
  sort,
  onPageChange,
  onPageSizeChange,
  onSortChange,
  loading,
  fetching,
  getRowId,
  onRowClick,
  selectable,
  selection,
  onSelectionChange,
  empty,
  toolbar,
  className,
  label,
}: DataTableProps<T>) {
  const t = useTranslations('ui.table');
  const allColumns = React.useMemo<ColumnDef<T, unknown>[]>(() => {
    if (!selectable) return columns;
    return [
      {
        id: '__select',
        size: 36,
        header: ({ table }) => (
          <Checkbox
            checked={
              table.getIsAllPageRowsSelected()
                ? true
                : table.getIsSomePageRowsSelected()
                  ? 'indeterminate'
                  : false
            }
            onCheckedChange={(v) => table.toggleAllPageRowsSelected(!!v)}
            aria-label={t('selectAll')}
          />
        ),
        cell: ({ row }) => (
          <Checkbox
            checked={row.getIsSelected()}
            onCheckedChange={(v) => row.toggleSelected(!!v)}
            onClick={(e) => e.stopPropagation()}
            aria-label={t('selectRow')}
          />
        ),
      },
      ...columns,
    ];
  }, [columns, selectable, t]);

  const table = useReactTable({
    data,
    columns: allColumns,
    getRowId: getRowId ? (row) => getRowId(row) : undefined,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    manualSorting: true,
    rowCount: total,
    enableRowSelection: selectable,
    state: { rowSelection: selection ?? {} },
    onRowSelectionChange: (updater) => {
      const next = typeof updater === 'function' ? updater(selection ?? {}) : updater;
      onSelectionChange?.(next);
    },
  });

  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  const sortKey = sort?.replace(/^-/, '');
  const desc = sort?.startsWith('-');

  const toggleSort = (key: string) => {
    if (!onSortChange) return;
    if (sortKey !== key) onSortChange(key);
    else if (!desc) onSortChange(`-${key}`);
    else onSortChange(undefined);
  };

  return (
    <div className={cn('overflow-hidden rounded-xl border bg-card shadow-xs', className)}>
      {toolbar && <div className="flex flex-wrap items-center gap-2 border-b p-3">{toolbar}</div>}
      <div className="relative">
        <AnimatePresence>
          {fetching && !loading && (
            <motion.div
              className="absolute inset-x-0 top-0 z-10 h-0.5 origin-left bg-primary/70"
              initial={{ scaleX: 0, opacity: 1 }}
              animate={{ scaleX: 0.85, transition: { duration: 1.2, ease: 'easeOut' } }}
              exit={{ scaleX: 1, opacity: 0, transition: { duration: 0.25 } }}
            />
          )}
        </AnimatePresence>
        <Table aria-label={label} aria-busy={loading || fetching}>
          <TableHeader className="bg-muted/40">
            {table.getHeaderGroups().map((hg) => (
              <TableRow key={hg.id} className="hover:bg-transparent">
                {hg.headers.map((header) => {
                  const meta = header.column.columnDef.meta;
                  const key = meta?.sortKey;
                  const ariaSort = key && sortKey === key ? (desc ? 'descending' : 'ascending') : undefined;
                  return (
                    <TableHead
                      key={header.id}
                      aria-sort={ariaSort}
                      className={meta?.headerClassName}
                      style={
                        header.column.columnDef.size ? { width: header.column.columnDef.size } : undefined
                      }
                    >
                      {header.isPlaceholder ? null : key && onSortChange ? (
                        <button
                          type="button"
                          onClick={() => toggleSort(key)}
                          className="-ml-1.5 inline-flex items-center gap-1 rounded px-1.5 py-1 hover:bg-accent hover:text-foreground"
                        >
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          {sortKey === key ? (
                            desc ? (
                              <ArrowDownIcon className="size-3.5" />
                            ) : (
                              <ArrowUpIcon className="size-3.5" />
                            )
                          ) : (
                            <ArrowUpDownIcon className="size-3.5 opacity-40" />
                          )}
                        </button>
                      ) : (
                        flexRender(header.column.columnDef.header, header.getContext())
                      )}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {loading && !data.length ? (
              Array.from({ length: Math.min(pageSize, 8) }).map((_, i) => (
                <TableRow key={`s${i}`} className="hover:bg-transparent">
                  {allColumns.map((_c, j) => (
                    <TableCell key={j}>
                      <Skeleton className={cn('h-4', j === 0 ? 'w-40' : 'w-20')} />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : table.getRowModel().rows.length ? (
              table.getRowModel().rows.map((row, i) => (
                <motion.tr
                  key={`${page}:${row.id}`}
                  data-slot="table-row"
                  data-state={row.getIsSelected() ? 'selected' : undefined}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.22, delay: Math.min(i, 12) * 0.018, ease: [0.22, 1, 0.36, 1] }}
                  onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                  className={cn(
                    'border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-primary/5',
                    onRowClick && 'cursor-pointer',
                  )}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id} className={cell.column.columnDef.meta?.className}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </motion.tr>
              ))
            ) : (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={allColumns.length} className="p-0">
                  {empty ?? (
                    <div className="py-12 text-center text-sm text-muted-foreground">{t('empty')}</div>
                  )}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      <div className="flex flex-col gap-3 border-t px-3 py-2.5 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <div aria-live="polite">{t('showing', { from, to, total })}</div>
        <div className="flex items-center gap-3">
          {onPageSizeChange && (
            <div className="flex items-center gap-2">
              <span className="hidden sm:inline">{t('rowsPerPage')}</span>
              <Select value={String(pageSize)} onValueChange={(v) => onPageSizeChange(Number(v))}>
                <SelectTrigger size="sm" className="w-[72px]" aria-label={t('rowsPerPage')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAGE_SIZES.map((s) => (
                    <SelectItem key={s} value={String(s)}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <span className="tabular-nums">{t('pageOf', { page, pageCount })}</span>
          <div className="flex gap-1">
            <Button
              variant="outline"
              size="icon-sm"
              onClick={() => onPageChange(page - 1)}
              disabled={page <= 1}
              aria-label={t('previous')}
            >
              <ChevronLeftIcon />
            </Button>
            <Button
              variant="outline"
              size="icon-sm"
              onClick={() => onPageChange(page + 1)}
              disabled={page >= pageCount}
              aria-label={t('next')}
            >
              <ChevronRightIcon />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
