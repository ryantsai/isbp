'use client';

import { Button } from '@astryxdesign/core/Button';
import { Divider } from '@astryxdesign/core/Divider';
import { Icon } from '@astryxdesign/core/Icon';
import { IconButton } from '@astryxdesign/core/IconButton';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { proportional, Table } from '@astryxdesign/core/Table';
import { Text } from '@astryxdesign/core/Text';
import { VisuallyHidden } from '@astryxdesign/core/VisuallyHidden';
import { useTranslator } from '@astryxdesign/core/i18n';
import { emptyRow, type FieldDef, localize, MAX_ROWS, rowColumns } from '@isbp/sdk';
import { ArrowDownIcon, ArrowUpIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { type CSSProperties, type ReactNode, useId, useRef, useState } from 'react';
import { useLatest } from '../lib/use-latest';
import { cn } from '../lib/utils';

type Row = Record<string, unknown>;

/** Props the cell's control gets so its label and error stay attached (`id`, `aria-*`, the error text). */
export interface RowCellProps {
  id: string;
  'aria-invalid'?: boolean;
  'aria-describedby'?: string;
  /** The cell's error text, for the control to draw in its own frame. */
  error?: string;
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
  const required = useTranslator()('@astryx.field.required');
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
  const keyAt = (list: readonly string[], n: number) => list[n] ?? `index-${n}`;
  const keyOf = (i: number) => keyAt(keys, i);
  const labelOf = (c: FieldDef) => localize(c.label, locale) || c.key;

  // The rows and keys as the last change left them. A cell control commits when it is left (a number on blur), which
  // can land after another change (a row moved) and before the next render: every change starts from here, not from
  // what the render that created the handler saw, and addresses a row by its key, not by its place.
  const latest = useLatest({ rows, keys });
  const emit = (nextRows: Row[], nextKeys: string[] = latest.get().keys) => {
    latest.set({ rows: nextRows, keys: nextKeys });
    setKeys(nextKeys);
    onChange(nextRows);
  };
  const currentKeys = () => latest.get().rows.map((_, n) => keyAt(latest.get().keys, n));

  const focusRow = (i: number) =>
    requestAnimationFrame(() => {
      const el = listRef.current?.querySelector<HTMLElement>(
        `[data-row="${i}"] :is(input, textarea, select, button[role="combobox"], [role="combobox"])`,
      );
      (el ?? addRef.current)?.focus();
    });

  const add = () => {
    const { rows: current } = latest.get();
    if (current.length >= max) return;
    emit([...current, emptyRow(field)], [...currentKeys(), newKey()]);
    setAnnouncement(t('added', { n: current.length + 1 }));
    focusRow(current.length);
  };
  const remove = (i: number) => {
    const { rows: current } = latest.get();
    emit(
      current.filter((_, j) => j !== i),
      currentKeys().filter((_, j) => j !== i),
    );
    setAnnouncement(t('removed', { n: i + 1 }));
    if (current.length > 1) focusRow(Math.min(i, current.length - 2));
    else requestAnimationFrame(() => addRef.current?.focus());
  };
  const move = (i: number, by: -1 | 1) => {
    const { rows: current } = latest.get();
    const j = i + by;
    if (j < 0 || j >= current.length) return;
    const swap = <T,>(list: T[]) => {
      const next = [...list];
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    };
    emit(swap(current), swap(currentKeys()));
    setAnnouncement(t('moved', { n: i + 1, position: j + 1 }));
    requestAnimationFrame(() =>
      listRef.current
        ?.querySelector<HTMLButtonElement>(
          `[data-row="${j}"] [data-move="${by < 0 ? 'up' : 'down'}"]:not(:disabled)`,
        )
        ?.focus(),
    );
  };
  const setCell = (rowKey: string, key: string, v: unknown) => {
    const { rows: current } = latest.get();
    const keysNow = currentKeys();
    emit(current.map((r, j) => (keysNow[j] === rowKey ? { ...r, [key]: v } : r)));
  };

  const style = {
    '--rows-cols': `repeat(${columns.length}, minmax(9rem, 1fr)) auto`,
    '--rows-min': `${columns.length * 9 + 7.5}rem`,
  } as CSSProperties;

  return (
    <VStack
      id={id}
      role="group"
      aria-label={labelOf(field)}
      aria-describedby={describedBy}
      data-invalid={invalid ? 'true' : undefined}
      gap={2}
      className="min-w-0"
    >
      {rows.length > 0 ? (
        <div className="min-w-0 overflow-x-auto">
          <div className="grid gap-2 sm:min-w-[var(--rows-min)]" style={style}>
            <div
              aria-hidden
              className="hidden gap-2 px-0.5 sm:grid sm:[grid-template-columns:var(--rows-cols)]"
            >
              {columns.map((c) => (
                <Text key={c.key} type="supporting" weight="medium" maxLines={1}>
                  {labelOf(c)}
                  {c.required && <> ({required})</>}
                </Text>
              ))}
              <span className="w-[7rem]" />
            </div>
            <ol ref={listRef} className="grid gap-2" aria-label={t('rows', { field: labelOf(field) })}>
              {rows.map((row, i) => (
                <li key={keyOf(i)} data-row={i}>
                  {i > 0 && <Divider className="mb-2 sm:hidden" />}
                  <fieldset className="grid min-w-0 gap-2 sm:items-start sm:[grid-template-columns:var(--rows-cols)]">
                    <VisuallyHidden as="legend">{t('row', { n: i + 1 })}</VisuallyHidden>
                    <Text type="label" aria-hidden className="sm:hidden">
                      {t('row', { n: i + 1 })}
                    </Text>
                    {columns.map((c) => {
                      const cellId = `${base}-r${i}-${c.key}`;
                      const error = cellError?.(i, c.key);
                      return (
                        <VStack key={c.key} gap={1} className="min-w-0">
                          <Text type="supporting" weight="medium" aria-hidden className="sm:hidden">
                            {labelOf(c)}
                            {c.required && <> ({required})</>}
                          </Text>
                          {renderCell(c, row[c.key], (v) => setCell(keyOf(i), c.key, v), {
                            id: cellId,
                            'aria-invalid': error ? true : undefined,
                            error,
                          })}
                        </VStack>
                      );
                    })}
                    <HStack gap={0.5} hAlign="end" className="w-[7rem] shrink-0 justify-self-end">
                      <IconButton
                        label={t('moveUp', { n: i + 1 })}
                        variant="ghost"
                        size="sm"
                        icon={<Icon icon={ArrowUpIcon} />}
                        isDisabled={disabled || i === 0}
                        type="button"
                        data-move="up"
                        onClick={() => move(i, -1)}
                      />
                      <IconButton
                        label={t('moveDown', { n: i + 1 })}
                        variant="ghost"
                        size="sm"
                        icon={<Icon icon={ArrowDownIcon} />}
                        isDisabled={disabled || i === rows.length - 1}
                        type="button"
                        data-move="down"
                        onClick={() => move(i, 1)}
                      />
                      <IconButton
                        label={t('remove', { n: i + 1 })}
                        variant="ghost"
                        size="sm"
                        icon={<Icon icon={Trash2Icon} />}
                        isDisabled={disabled}
                        type="button"
                        onClick={() => remove(i)}
                      />
                    </HStack>
                  </fieldset>
                </li>
              ))}
            </ol>
          </div>
        </div>
      ) : (
        <Text color="secondary">{t('empty')}</Text>
      )}
      <HStack gap={2} hAlign="between" vAlign="center" wrap="wrap">
        <Button
          label={t('add')}
          variant="secondary"
          size="sm"
          icon={<Icon icon={PlusIcon} />}
          isDisabled={disabled || rows.length >= max}
          ref={addRef}
          type="button"
          onClick={add}
        />
        <Text type="supporting" color="secondary">
          {t('count', { count: rows.length, max })}
        </Text>
      </HStack>
      <VisuallyHidden as="p" aria-live="polite">
        {announcement}
      </VisuallyHidden>
    </VStack>
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
  const rows = rowsOf(value).map((row, i) => ({ ...row, __row: i }));
  return (
    <div className={cn('min-w-0', className)}>
      <Table
        aria-label={localize(field.label, locale) || field.key}
        data={rows}
        idKey="__row"
        density="compact"
        verticalAlign="top"
        textOverflow="wrap"
        columns={columns.map((c) => ({
          key: c.key,
          header: localize(c.label, locale) || c.key,
          width: proportional(1, { minWidth: 112 }),
          resizable: false,
          renderCell: (row) => {
            const text = cellText(c, row[c.key]);
            return text === null || text === undefined ? (
              <Text color="secondary">{emptyText ?? '—'}</Text>
            ) : typeof text === 'string' || typeof text === 'number' ? (
              <Text className={c.type === 'textarea' ? 'whitespace-pre-line' : undefined}>{text}</Text>
            ) : (
              text
            );
          },
        }))}
      />
    </div>
  );
}
