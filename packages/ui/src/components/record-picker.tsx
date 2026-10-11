'use client';

import { Badge } from '@astryxdesign/core/Badge';
import { Icon } from '@astryxdesign/core/Icon';
import { HStack, StackItem, VStack } from '@astryxdesign/core/Layout';
import { Link } from '@astryxdesign/core/Link';
import { Text } from '@astryxdesign/core/Text';
import { Token } from '@astryxdesign/core/Token';
import { Tokenizer } from '@astryxdesign/core/Tokenizer';
import { Typeahead } from '@astryxdesign/core/Typeahead';
import type { Condition } from '@isbp/sdk';
import { EyeOffIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo, useRef, useState } from 'react';
import { useInputAttrs } from '../lib/input-attrs';
import { useApiQuery } from './query';
import { type SearchableItem, useApiSearchSource } from './search-source';

/** A record of any module as the viewer sees it (`GET /records/search`, `/records/resolve`). */
export interface RecordOption {
  type: string;
  moduleId: string;
  id: string;
  reference: string | null;
  title: string;
  subtitle: string | null;
  /** `key` is an i18n key in the owning module's catalog. */
  status: { key: string; tone: 'neutral' | 'info' | 'success' | 'warning' | 'danger' } | null;
  href: string;
  icon: string | null;
}

const TONE = {
  neutral: 'neutral',
  info: 'info',
  success: 'success',
  warning: 'warning',
  danger: 'error',
} as const;

const refOf = (r: { type: string; id: string }) => `${r.type}:${r.id}`;
const recordName = (r: RecordOption) => (r.reference ? `${r.reference} ${r.title}` : r.title);

/** Refs held by a record field value (one ref, a list, or empty). */
export function recordRefs(value: unknown): string[] {
  const list = Array.isArray(value) ? value : value ? [value] : [];
  return list.filter((v): v is string => typeof v === 'string' && v.includes(':'));
}

/**
 * The records behind refs, resolved for the viewer (one request); refs they may not read (or that are gone) are only
 * counted as `hidden`.
 */
export function useRecords(refs: readonly string[]) {
  const key = useMemo(() => [...new Set(refs)].sort().join(','), [refs]);
  const { data, isLoading, isPlaceholderData } = useApiQuery<{ items: RecordOption[]; hidden: number }>(
    key ? '/records/resolve' : null,
    { refs: key },
  );
  // While other refs load, the previous answer is kept (no flicker) but its `hidden` count is not current.
  const loading = Boolean(key) && (isLoading || isPlaceholderData);
  return useMemo(
    () => ({
      records: new Map((key ? (data?.items ?? []) : []).map((r) => [refOf(r), r])),
      hidden: key && !loading ? (data?.hidden ?? 0) : 0,
      loading,
    }),
    [data, loading, key],
  );
}

/** A record's status from its module's catalog, with its tone — never colour-only. */
export function RecordStatus({ status }: { status: RecordOption['status'] }) {
  const root = useTranslations();
  if (!status) return null;
  return (
    <Badge
      variant={TONE[status.tone] ?? 'neutral'}
      label={root.has(status.key) ? root(status.key) : (status.key.split('.').pop() ?? status.key)}
    />
  );
}

function RecordText({ record }: { record: RecordOption }) {
  return (
    <Text maxLines={1}>
      {record.reference && (
        <>
          <Text type="code" color="secondary">
            {record.reference}
          </Text>{' '}
        </>
      )}
      {record.title}
    </Text>
  );
}

function HiddenCount({ count }: { count: number }) {
  const t = useTranslations('ui.record');
  return (
    <HStack gap={1} vAlign="center">
      <Icon icon={EyeOffIcon} />
      <Text color="secondary">{t('hidden', { count })}</Text>
    </HStack>
  );
}

/**
 * Read-only value of a `record` field: the records as links; those the viewer can't see are counted, never named.
 */
export function RecordValues({ refs, className }: { refs: readonly string[]; className?: string }) {
  const { records, hidden, loading } = useRecords(refs);
  if (loading) return <Text color="secondary">…</Text>;
  const shown = refs.map((r) => records.get(r)).filter((r): r is RecordOption => Boolean(r));
  return (
    <HStack gap={3} wrap="wrap" vAlign="center" className={className}>
      {shown.map((r) => (
        <HStack key={refOf(r)} gap={1.5} vAlign="center">
          <Link href={r.href}>
            <RecordText record={r} />
          </Link>
          <RecordStatus status={r.status} />
        </HStack>
      ))}
      {hidden > 0 && <HiddenCount count={hidden} />}
    </HStack>
  );
}

type RecordItem = SearchableItem<RecordOption>;

const toItem = (r: RecordOption): RecordItem => ({ id: refOf(r), label: recordName(r), auxiliaryData: r });

/** Stand-in for the refs the viewer can't read (or that are still loading): a token that is not removable. */
const HIDDEN_ID = '\u0000hidden';
const NO_SOURCE = { search: () => [], bootstrap: () => [] };

function RecordRow({ record }: { record: RecordOption | undefined }) {
  if (!record) return null;
  return (
    <HStack gap={2} vAlign="center">
      <StackItem size="fill">
        <VStack gap={0}>
          <RecordText record={record} />
          {record.subtitle && (
            <Text type="supporting" color="secondary" maxLines={1}>
              {record.subtitle}
            </Text>
          )}
        </VStack>
      </StackItem>
      <RecordStatus status={record.status} />
    </HStack>
  );
}

/**
 * Picks records of the given types through the platform's record search (only records the person may read; with
 * `where`, only those whose facts match). Single or multiple; keyboard operable (Astryx `Typeahead` / `Tokenizer`),
 * chosen records show as removable tokens. The accessible name is `aria-label`, else the placeholder (a visible label
 * next to it ties in through `id`).
 */
export function RecordPicker({
  value,
  onChange,
  types,
  multiple = false,
  where,
  max = 20,
  id,
  invalid,
  disabled,
  placeholder,
  className,
  'aria-describedby': describedBy,
  'aria-label': ariaLabel,
}: {
  value: readonly string[];
  onChange: (refs: string[]) => void;
  types: readonly string[];
  multiple?: boolean;
  where?: Condition;
  max?: number;
  id?: string;
  invalid?: boolean;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  'aria-describedby'?: string;
  'aria-label'?: string;
}) {
  const t = useTranslations('ui.record');
  const root = useRef<HTMLDivElement>(null);
  const full = multiple && value.length >= max;
  useInputAttrs(root, { id, describedBy, label: ariaLabel }, [full]);
  const { records, loading } = useRecords(value);
  // Records picked here are shown right away (they are resolved again with the value).
  const [known, setKnown] = useState<ReadonlyMap<string, RecordOption>>(new Map());
  const apiSource = useApiSearchSource<RecordOption>({
    path: '/records/search',
    query: (q) => ({
      q,
      types: types.join(','),
      limit: 15,
      where: where ? JSON.stringify(where) : undefined,
    }),
    toItem,
  });
  // Without record types there is nothing to search.
  const source = types.length ? apiSource : NO_SOURCE;

  const chosen = value
    .map((r) => records.get(r) ?? known.get(r))
    .filter((r): r is RecordOption => Boolean(r));
  // Refs without a record to show: still loading, or hidden from the viewer (kept as they are when others change).
  const unresolved = value.filter((r) => !records.has(r) && !known.has(r));
  const hiddenItem: RecordItem | null = unresolved.length
    ? {
        id: HIDDEN_ID,
        label: loading ? '…' : t('hidden', { count: unresolved.length }),
        auxiliaryData: undefined,
      }
    : null;
  const remember = (r: RecordOption) => setKnown((m) => new Map(m).set(refOf(r), r));

  const label = ariaLabel ?? placeholder ?? (multiple ? t('placeholderMany') : t('placeholder'));
  const status = invalid
    ? { type: 'error' as const }
    : full
      ? { type: 'warning' as const, message: t('max', { max }) }
      : undefined;

  if (!multiple) {
    const single = chosen[0];
    const item: RecordItem | null = single ? toItem(single) : hiddenItem;
    return (
      <Typeahead
        ref={root}
        className={className}
        label={label}
        isLabelHidden
        placeholder={placeholder ?? t('search')}
        searchSource={source}
        value={item}
        onChange={(next) => {
          if (next?.auxiliaryData) remember(next.auxiliaryData);
          onChange(next ? [next.id] : []);
        }}
        hasEntriesOnFocus
        isDisabled={disabled}
        status={status}
        emptySearchText={t('noResults')}
        renderItem={(r) => <RecordRow record={r.auxiliaryData} />}
      />
    );
  }

  const items = [...chosen.map(toItem), ...(hiddenItem ? [hiddenItem] : [])];
  return (
    <VStack gap={2} className={className}>
      <Tokenizer
        ref={root}
        label={label}
        isLabelHidden
        placeholder={placeholder ?? t('search')}
        searchSource={source}
        value={items}
        maxEntries={Math.max(1, max - unresolved.length + (hiddenItem ? 1 : 0))}
        onChange={(next) => {
          const real = next.filter((i) => i.id !== HIDDEN_ID);
          real.forEach((i) => i.auxiliaryData && remember(i.auxiliaryData));
          onChange([...unresolved, ...real.map((i) => i.id)]);
        }}
        hasEntriesOnFocus
        isDisabled={disabled}
        status={status}
        emptySearchText={t('noResults')}
        renderItem={(r) => <RecordRow record={r.auxiliaryData} />}
        renderToken={(item, onRemove) =>
          item.id === HIDDEN_ID ? (
            <Token key={item.id} label={item.label} icon={<Icon icon={EyeOffIcon} />} />
          ) : (
            <Token key={item.id} label={item.label} onRemove={onRemove} />
          )
        }
      />
    </VStack>
  );
}
