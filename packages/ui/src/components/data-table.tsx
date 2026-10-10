'use client';

import {
  type ColumnDef,
  columnSizingFeature,
  flexRender,
  functionalUpdate,
  metaHelper,
  type RowData,
  type RowSelectionState,
  rowSelectionFeature,
  tableFeatures,
  useTable,
} from '@tanstack/react-table';
import { ArrowDownIcon, ArrowUpDownIcon, ArrowUpIcon, ChevronLeftIcon, ChevronRightIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { usePathname, useSearchParams } from 'next/navigation';
import * as React from 'react';
import { rememberListQuery, rememberOpenedRow, takeOpenedRow } from '../lib/list-memory';
import { cn } from '../lib/utils';
import { Button } from './button';
import { Checkbox } from './checkbox';
import { ErrorState } from './empty-state';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './select';
import { Skeleton } from './skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './table';

/** Column `meta` understood by `DataTable`. */
export interface DataTableColumnMeta {
  /** Server sort key; makes the header clickable. */
  sortKey?: string;
  /**
   * How much the column matters when the table is narrow (measured on the table itself, not the viewport):
   * `1` (default) always shown: the identifying column and status; `2` hidden below 672 px of table width (phones);
   * `3` hidden below 1,200 px (a 1,440 px laptop with the sidebar open). Put a priority-2 column's essentials into the
   * identifying cell with `DataTableSummary` so phones keep them.
   */
  priority?: 1 | 2 | 3;
  /** Let the cell's text wrap (the identifying column of a table that must fit a phone). */
  wrap?: boolean;
  className?: string;
  headerClassName?: string;
}

const PRIORITY_CLASS: Record<number, string> = {
  2: 'hidden @2xl/table:table-cell',
  3: 'hidden @min-[75rem]/table:table-cell',
};

/**
 * Secondary facts (status, priority, owner…) shown as a muted line inside the identifying cell **only while the
 * table is too narrow for the priority-2 columns** that normally show them.
 */
export function DataTableSummary({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="data-table-summary"
      className={cn(
        'mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs whitespace-normal text-muted-foreground @2xl/table:hidden',
        className,
      )}
      {...props}
    />
  );
}

/**
 * The one feature set every `DataTable` is built with. Sorting and paging happen on the server (URL state), so no
 * client row models are registered and rows render exactly as given. `columnSizingFeature` provides a column's
 * `size` (default 150, used as the header width) and `rowSelectionFeature` the checkbox column.
 */
const dataTableFeatures = tableFeatures({
  columnSizingFeature,
  rowSelectionFeature,
  columnMeta: metaHelper<DataTableColumnMeta>(),
});

export type DataTableFeatures = typeof dataTableFeatures;

/**
 * A `DataTable` column. Apps and modules type their column arrays with this and never import
 * `@tanstack/react-table` themselves.
 */
export type DataTableColumn<TData extends RowData, TValue = unknown> = ColumnDef<
  DataTableFeatures,
  TData,
  TValue
>;

/** Selected rows, keyed by row id (`getRowId`). */
export type DataTableSelection = RowSelectionState;

const NO_SELECTION: DataTableSelection = {};

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
  const pathname = usePathname();
  const state = React.useMemo<ListState>(() => {
    const out: ListState = { page: 1, pageSize: 25, ...defaults } as ListState;
    sp.forEach((value, key) => {
      out[key] = key === 'page' || key === 'pageSize' ? Number(value) || out[key] : value;
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sp]);
  React.useEffect(() => {
    // Back links on detail pages return to the list as it was (`BackLink`).
    rememberListQuery(pathname, sp.toString());
  }, [sp, pathname]);
  const set = React.useCallback(
    (patch: Partial<ListState>) => {
      // Build on the live URL, not on this hook's `sp`: a page can hold several of these hooks (tabs, a table, a
      // search box), and `useSearchParams` reaches each of them a render later. Starting from a stale copy would undo
      // what another one just set (switch a tab, then a filter resets on mount, and the tab is lost).
      const live = window.location.pathname === pathname ? window.location.search : `?${sp.toString()}`;
      const next = new URLSearchParams(live);
      const resetPage = Object.keys(patch).some((k) => k !== 'page');
      for (const [k, v] of Object.entries({
        ...patch,
        ...(resetPage && !('page' in patch) ? { page: 1 } : {}),
      })) {
        if (v === undefined || v === '' || v === null || (k === 'page' && v === 1)) next.delete(k);
        else next.set(k, String(v));
      }
      const qs = next.toString();
      // The native History API: Next.js syncs it into `useSearchParams` without a server round trip (no flicker while
      // lists filter), and it is synchronous, so the next `set` sees it at once. `null`, not the current state:
      // Next.js adds its own, and passing its state back skips the sync.
      window.history.replaceState(null, '', qs ? `${pathname}?${qs}` : pathname);
    },
    [sp, pathname],
  );
  return [state, set] as const;
}

/* ───────────────────────── table ───────────────────────── */

export interface DataTableProps<T extends RowData> {
  columns: DataTableColumn<T>[];
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
  selection?: DataTableSelection;
  onSelectionChange?: (selection: DataTableSelection) => void;
  empty?: React.ReactNode;
  /** The query's error: shown instead of `empty` (never a false "nothing here"). */
  error?: unknown;
  /** Retry after an error (usually the query's `refetch`). */
  onRetry?: () => void;
  /**
   * Row id (`getRowId`) to flash once, e.g. the record just created. The row a person opened from this list is
   * highlighted automatically when they come back.
   */
  highlightId?: string;
  toolbar?: React.ReactNode;
  className?: string;
  label?: string;
}

const PAGE_SIZES = [10, 25, 50, 100];

export function DataTable<T extends RowData>({
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
  error,
  onRetry,
  highlightId,
  toolbar,
  className,
  label,
}: DataTableProps<T>) {
  const t = useTranslations('ui.table');
  const pathname = usePathname();
  const flash = useRowFlash(pathname, highlightId, data, getRowId);
  const allColumns = React.useMemo<DataTableColumn<T>[]>(() => {
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

  const table = useTable({
    features: dataTableFeatures,
    data,
    columns: allColumns,
    getRowId: getRowId ? (row) => getRowId(row) : undefined,
    enableRowSelection: selectable,
    state: { rowSelection: selection ?? NO_SELECTION },
    onRowSelectionChange: (updater) => {
      onSelectionChange?.(functionalUpdate(updater, selection ?? NO_SELECTION));
    },
  });

  // With a wrapping (identifying) column, the others take just their content's width and it gets the rest: titles
  // stay on one or two lines instead of being squeezed between half-empty status columns.
  const hasWrap = columns.some((c) => c.meta?.wrap);
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

  const failed = !!error && !loading && !data.length;
  const staleAfterError = !!error && data.length > 0;

  return (
    <div className={cn('@container/table overflow-hidden rounded-lg border bg-card', className)}>
      {toolbar && <div className="flex flex-wrap items-center gap-2 border-b p-2">{toolbar}</div>}
      {staleAfterError && (
        <ErrorState
          compact
          kind="list"
          error={error}
          onRetry={onRetry}
          title={t('refreshFailed')}
          className="border-b px-3"
        />
      )}
      <div className="relative">
        {fetching && !loading && (
          <div
            aria-hidden
            className="indeterminate-track absolute inset-x-0 top-0 z-10 h-0.5 overflow-hidden"
          >
            <div className="indeterminate-bar h-full w-1/3 rounded-full bg-primary/70" />
          </div>
        )}
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
                      className={cn(
                        meta?.priority && PRIORITY_CLASS[meta.priority],
                        hasWrap && !meta?.wrap && !header.column.columnDef.size && 'w-px',
                        meta?.headerClassName,
                      )}
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
                  {allColumns.map((c, j) => (
                    // Hidden like the real cells, and shrinking to fit: a loading table never scrolls sideways.
                    <TableCell
                      key={j}
                      className={cn(c.meta?.priority && PRIORITY_CLASS[c.meta.priority], c.meta?.className)}
                    >
                      <Skeleton className={cn('h-4 w-full', j === 0 ? 'max-w-40' : 'max-w-20')} />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : table.getRowModel().rows.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={`${page}:${row.id}`}
                  data-state={row.getIsSelected() ? 'selected' : undefined}
                  onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                  onClickCapture={
                    getRowId
                      ? (e) => {
                          if (onRowClick || (e.target as Element).closest('a[href]'))
                            rememberOpenedRow(pathname, row.id);
                        }
                      : undefined
                  }
                  data-highlighted={flash === row.id || undefined}
                  className={cn(
                    'animate-in fade-in-0 duration-(--motion-fast) data-[state=selected]:bg-primary/5',
                    flash === row.id && 'highlight-flash',
                    onRowClick && 'cursor-pointer',
                  )}
                >
                  {row.getAllCells().map((cell) => {
                    const meta = cell.column.columnDef.meta;
                    return (
                      <TableCell
                        key={cell.id}
                        className={cn(
                          meta?.priority && PRIORITY_CLASS[meta.priority],
                          meta?.wrap && 'min-w-40 whitespace-normal wrap-break-word',
                          meta?.className,
                        )}
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))
            ) : (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={allColumns.length} className="p-0 whitespace-normal">
                  {failed ? (
                    <ErrorState kind="list" error={error} onRetry={onRetry} />
                  ) : (
                    (empty ?? (
                      <div className="py-10 text-center text-sm text-muted-foreground">{t('empty')}</div>
                    ))
                  )}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      <div
        hidden={failed}
        className="flex flex-col gap-2 border-t px-3 py-1.5 text-[13px] text-muted-foreground sm:flex-row sm:items-center sm:justify-between"
      >
        <div aria-live="polite">{failed ? null : t('showing', { from, to, total })}</div>
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

/**
 * The row to flash: `highlightId`, or the row this list's person opened before navigating away (remembered on
 * click). Scrolls it into view once it's on the page, then clears after the 1 s flash.
 */
function useRowFlash<T>(
  pathname: string,
  highlightId: string | undefined,
  data: T[],
  getRowId: ((row: T) => string) | undefined,
) {
  const [opened, setOpened] = React.useState<string | null>(null);
  const [done, setDone] = React.useState<string | null>(null);
  // Taken once per path; the ref keeps it across the development double effect run.
  const taken = React.useRef<{ path: string; id: string | null } | null>(null);
  React.useEffect(() => {
    if (taken.current?.path !== pathname) taken.current = { path: pathname, id: takeOpenedRow(pathname) };
    setOpened(taken.current.id);
  }, [pathname]);
  const wanted = highlightId ?? opened;
  const present = !!wanted && !!getRowId && data.some((row) => getRowId(row) === wanted);
  const flash = present && done !== wanted ? wanted : null;
  React.useEffect(() => {
    if (!flash) return;
    const row = document.querySelector(`tr[data-highlighted]`);
    row?.scrollIntoView({ block: 'nearest' });
    const timer = setTimeout(() => setDone(flash), 1100);
    return () => clearTimeout(timer);
  }, [flash]);
  return flash;
}
