'use client';

import { emptyRow, type FieldDef, localize, MAX_ROWS, rowColumns } from '@isbp/sdk';
import { ArrowDownIcon, ArrowUpIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { type CSSProperties, type ReactNode, useId, useRef, useState } from 'react';
import { cn } from '../lib/utils';
import { Button } from './button';

type Row = Record<string, unknown>;

/** Props the cell's control gets so its label and error stay attached (`id`, `aria-*`). */
export interface RowCellProps {
  id: string;
  'aria-invalid'?: boolean;
  'aria-describedby'?: string;
}

const rowsOf = (value: unknown): Row[] =>
  Array.isArray(value)
    ? value.map((r) => (r && typeof r === 'object' && !Array.isArray(r) ? (r as Row) : {}))
    : [];

let keySeq = 0;
/** A key for a row added in an event handler (never during render). */
const newKey = () => `row-${++keySeq}`;

/**
 * An editable table field (`type: 'rows'`): one line per row with a control per column, rows added, removed and moved
 * with buttons (keyboard and screen reader friendly: each row is a fieldset named "Row n", each cell has a label, and
 * changes are announced). From `sm` up the columns line up under one header row (scrolling sideways inside the field
 * when they don't fit); on phones each row is a card with labelled cells.
 */
export function RowsControl({
  field,
  value,
  onChange,
  disabled,
  renderCell,
  cellError,
  id,
  invalid,
  describedBy,
}: {
  field: FieldDef;
  value: unknown;
  onChange: (rows: Row[]) => void;
  disabled?: boolean;
  /** The control of one cell (the shared field renderer's `FieldControl`). */
  renderCell: (
    column: FieldDef,
    value: unknown,
    onChange: (v: unknown) => void,
    props: RowCellProps,
  ) => ReactNode;
  /** The error text of a cell, if any. */
  cellError?: (row: number, key: string) => string | undefined;
  id?: string;
  invalid?: boolean;
  describedBy?: string;
}) {
  const t = useTranslations('ui.rows');
  const locale = useLocale();
  const uid = useId();
  const base = id ?? uid;
  const columns = rowColumns(field);
  const rows = rowsOf(value);
  const max = Math.min(field.rows?.max ?? MAX_ROWS, MAX_ROWS);
  // Stable keys per row (kept in step with add / move / remove) so pickers keep their state when rows move.
  const [keys, setKeys] = useState<string[]>(() => rows.map((_, i) => `initial-${i}`));
  const [announcement, setAnnouncement] = useState('');
  const listRef = useRef<HTMLOListElement>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  const keyOf = (i: number) => keys[i] ?? `index-${i}`;
  const labelOf = (c: FieldDef) => localize(c.label, locale) || c.key;

  const focusRow = (i: number) =>
    requestAnimationFrame(() => {
      const el = listRef.current?.querySelector<HTMLElement>(
        `[data-row="${i}"] :is(input, textarea, select, button[role="combobox"], [role="combobox"])`,
      );
      (el ?? addRef.current)?.focus();
    });

  const add = () => {
    if (rows.length >= max) return;
    setKeys((k) => [...k.slice(0, rows.length), newKey()]);
    onChange([...rows, emptyRow(field)]);
    setAnnouncement(t('added', { n: rows.length + 1 }));
    focusRow(rows.length);
  };
  const remove = (i: number) => {
    setKeys((k) => k.filter((_, j) => j !== i));
    onChange(rows.filter((_, j) => j !== i));
    setAnnouncement(t('removed', { n: i + 1 }));
    if (rows.length > 1) focusRow(Math.min(i, rows.length - 2));
    else requestAnimationFrame(() => addRef.current?.focus());
  };
  const move = (i: number, by: -1 | 1) => {
    const j = i + by;
    if (j < 0 || j >= rows.length) return;
    const swap = <T,>(list: T[]) => {
      const next = [...list];
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    };
    setKeys((k) => swap(rows.map((_, n) => k[n] ?? `index-${n}`)));
    onChange(swap(rows));
    setAnnouncement(t('moved', { n: i + 1, position: j + 1 }));
    requestAnimationFrame(() =>
      listRef.current
        ?.querySelector<HTMLButtonElement>(
          `[data-row="${j}"] [data-move="${by < 0 ? 'up' : 'down'}"]:not(:disabled)`,
        )
        ?.focus(),
    );
  };
  const setCell = (i: number, key: string, v: unknown) =>
    onChange(rows.map((r, j) => (j === i ? { ...r, [key]: v } : r)));

  const style = {
    '--rows-cols': `repeat(${columns.length}, minmax(9rem, 1fr)) auto`,
    '--rows-min': `${columns.length * 9 + 7.5}rem`,
  } as CSSProperties;

  return (
    <div
      id={id}
      role="group"
      aria-label={labelOf(field)}
      aria-describedby={describedBy}
      data-invalid={invalid || undefined}
      className="grid min-w-0 gap-2"
    >
      {rows.length > 0 ? (
        <div className="min-w-0 overflow-x-auto">
          <div className="grid gap-2 sm:min-w-[var(--rows-min)]" style={style}>
            <div
              aria-hidden
              className="hidden gap-2 px-0.5 text-xs font-medium text-muted-foreground sm:grid sm:[grid-template-columns:var(--rows-cols)]"
            >
              {columns.map((c) => (
                <span key={c.key} className="truncate">
                  {labelOf(c)}
                  {c.required && <span className="text-destructive"> *</span>}
                </span>
              ))}
              <span className="w-[7rem]" />
            </div>
            <ol ref={listRef} className="grid gap-2" aria-label={t('rows', { field: labelOf(field) })}>
              {rows.map((row, i) => (
                <li key={keyOf(i)} data-row={i}>
                  <fieldset className="grid min-w-0 gap-2 rounded-lg border p-3 sm:items-start sm:rounded-none sm:border-0 sm:p-0 sm:[grid-template-columns:var(--rows-cols)]">
                    <legend className="sr-only">{t('row', { n: i + 1 })}</legend>
                    <span aria-hidden className="text-xs font-semibold text-muted-foreground sm:hidden">
                      {t('row', { n: i + 1 })}
                    </span>
                    {columns.map((c) => {
                      const cellId = `${base}-r${i}-${c.key}`;
                      const error = cellError?.(i, c.key);
                      return (
                        <div key={c.key} className="grid min-w-0 gap-1">
                          <label htmlFor={cellId} className="text-xs font-medium sm:sr-only">
                            {labelOf(c)}
                            {c.required && (
                              <span aria-hidden className="text-destructive">
                                {' '}
                                *
                              </span>
                            )}
                          </label>
                          {renderCell(c, row[c.key], (v) => setCell(i, c.key, v), {
                            id: cellId,
                            'aria-invalid': error ? true : undefined,
                            'aria-describedby': error ? `${cellId}-error` : undefined,
                          })}
                          {error && (
                            <p id={`${cellId}-error`} className="text-xs text-destructive">
                              {error}
                            </p>
                          )}
                        </div>
                      );
                    })}
                    <div className="flex w-[7rem] shrink-0 justify-end gap-0.5 justify-self-end">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        data-move="up"
                        disabled={disabled || i === 0}
                        aria-label={t('moveUp', { n: i + 1 })}
                        onClick={() => move(i, -1)}
                      >
                        <ArrowUpIcon />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        data-move="down"
                        disabled={disabled || i === rows.length - 1}
                        aria-label={t('moveDown', { n: i + 1 })}
                        onClick={() => move(i, 1)}
                      >
                        <ArrowDownIcon />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        disabled={disabled}
                        aria-label={t('remove', { n: i + 1 })}
                        onClick={() => remove(i)}
                      >
                        <Trash2Icon />
                      </Button>
                    </div>
                  </fieldset>
                </li>
              ))}
            </ol>
          </div>
        </div>
      ) : (
        <p className="rounded-lg border border-dashed px-3 py-2.5 text-sm text-muted-foreground">
          {t('empty')}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button
          ref={addRef}
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled || rows.length >= max}
          onClick={add}
        >
          <PlusIcon /> {t('add')}
        </Button>
        <span className="text-xs text-muted-foreground">{t('count', { count: rows.length, max })}</span>
      </div>
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </div>
  );
}

/** A table field's rows, read-only: a real table (column headers, one row per row), scrolling sideways if needed. */
export function RowsTable({
  field,
  value,
  cellText,
  emptyText,
  className,
}: {
  field: FieldDef;
  value: unknown;
  cellText: (column: FieldDef, value: unknown) => ReactNode;
  emptyText?: string;
  className?: string;
}) {
  const locale = useLocale();
  const columns = rowColumns(field);
  const rows = rowsOf(value);
  return (
    <div className={cn('min-w-0 overflow-x-auto rounded-md border', className)}>
      <table className="w-full border-collapse text-sm">
        <caption className="sr-only">{localize(field.label, locale) || field.key}</caption>
        <thead className="bg-muted/40">
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                scope="col"
                className="px-2.5 py-1.5 text-left text-xs font-medium whitespace-nowrap text-muted-foreground"
              >
                {localize(c.label, locale) || c.key}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-t align-top">
              {columns.map((c) => {
                const text = cellText(c, row[c.key]);
                return (
                  <td
                    key={c.key}
                    className={cn(
                      'px-2.5 py-1.5 break-words',
                      c.type === 'textarea' && 'whitespace-pre-line',
                      (text === null || text === undefined) && 'text-muted-foreground',
                    )}
                  >
                    {text ?? emptyText ?? '—'}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
