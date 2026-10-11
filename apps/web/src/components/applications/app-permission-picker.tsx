'use client';

import { Icon } from '@astryxdesign/core/Icon';
import { Token } from '@astryxdesign/core/Token';
import { Tokenizer } from '@astryxdesign/core/Tokenizer';
import { Tooltip } from '@astryxdesign/core/Tooltip';
import { type SearchableItem, type SearchSource, TypeaheadItem } from '@astryxdesign/core/Typeahead';
import { type AppPermission, appPermissionPatternSchema } from '@isbp/contracts';
import { matchPermission } from '@isbp/sdk';
import { AsteriskIcon, PlusIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useRef } from 'react';

export const isAppPattern = (value: string) => appPermissionPatternSchema.safeParse(value).success;

/** Catalog keys a pattern covers (exact keys cover themselves). */
export function coveredKeys(pattern: string, catalog: readonly AppPermission[]) {
  return catalog.filter((p) => matchPermission(pattern, p.key)).map((p) => p.key);
}

/** A permission or pattern chip; wildcards get an asterisk glyph and their reach as a tooltip. */
export function PermissionChip({
  value,
  catalog,
  onRemove,
}: {
  value: string;
  catalog?: readonly AppPermission[];
  onRemove?: () => void;
}) {
  const t = useTranslations('applications.permissionPicker');
  const wildcard = value.includes('*');
  const covers = wildcard && catalog ? coveredKeys(value, catalog).length : null;
  const unknown = !wildcard && catalog && !catalog.some((p) => p.key === value);
  const note = covers !== null ? t('covers', { count: covers }) : unknown ? t('notInCatalog') : undefined;
  const token = (
    <Token
      label={value}
      size="sm"
      color={wildcard ? 'blue' : unknown ? 'orange' : 'default'}
      icon={wildcard ? <Icon icon={AsteriskIcon} size="xsm" /> : undefined}
      description={note}
      onRemove={onRemove}
    />
  );
  return note ? <Tooltip content={note}>{token}</Tooltip> : token;
}

type Kind = 'wildcard' | 'permission' | 'custom';
type PermissionItem = SearchableItem<{ kind: Kind; description?: string; covers?: number }>;

/**
 * Searchable multi-select over the application's permission catalog that also takes wildcard patterns
 * (`invoices.*`) — typed freely or picked from the suggested "everything under…" groups.
 */
export function AppPermissionPicker({
  catalog,
  value,
  onChange,
  label,
  isLabelHidden,
  description,
  status,
  isDisabled,
}: {
  catalog: readonly AppPermission[];
  value: string[];
  onChange: (next: string[]) => void;
  label: string;
  isLabelHidden?: boolean;
  /** Defaults to the wildcard hint. */
  description?: string;
  status?: { type: 'error' | 'warning' | 'success'; message?: string };
  isDisabled?: boolean;
}) {
  const t = useTranslations('applications.permissionPicker');
  const selected = useRef(value);
  useEffect(() => {
    selected.current = value;
  });

  // Patterns that cover more than one catalog key ("invoices.*"), offered as "Everything under…".
  const prefixes = useMemo(() => {
    const out = new Map<string, number>();
    for (const p of catalog) {
      const segs = p.key.split('.');
      for (let i = 1; i < segs.length; i++) {
        const pattern = `${segs.slice(0, i).join('.')}.*`;
        out.set(pattern, (out.get(pattern) ?? 0) + 1);
      }
    }
    return [...out.entries()].filter(([, n]) => n > 1).map(([pattern, n]) => ({ pattern, n }));
  }, [catalog]);

  const source = useMemo<SearchSource<PermissionItem>>(() => {
    const run = (q: string): PermissionItem[] => {
      const needle = q.trim().toLowerCase();
      const typed = needle && isAppPattern(needle) && !selected.current.includes(needle) ? needle : null;
      const typedIsCatalog = typed !== null && catalog.some((p) => p.key === typed);
      const typedIsPrefix = typed !== null && prefixes.some((p) => p.pattern === typed);
      const items: PermissionItem[] = [];
      if (typed && !typedIsCatalog && !typedIsPrefix) {
        items.push({
          id: typed,
          label: typed,
          auxiliaryData: {
            kind: 'custom',
            covers: typed.includes('*') ? coveredKeys(typed, catalog).length : undefined,
          },
        });
      }
      for (const { pattern, n } of prefixes) {
        if (!needle || pattern.includes(needle))
          items.push({ id: pattern, label: pattern, auxiliaryData: { kind: 'wildcard', covers: n } });
      }
      for (const p of catalog) {
        if (!needle || p.key.includes(needle) || p.description.toLowerCase().includes(needle))
          items.push({
            id: p.key,
            label: p.key,
            auxiliaryData: { kind: 'permission', description: p.description },
          });
      }
      return items;
    };
    return { search: run, bootstrap: () => run('') };
  }, [catalog, prefixes]);

  const items = useMemo<PermissionItem[]>(
    () =>
      value.map((v) => ({
        id: v,
        label: v,
        auxiliaryData: { kind: v.includes('*') ? 'wildcard' : 'permission' },
      })),
    [value],
  );
  const impliedBy = (key: string) =>
    value.find((v) => v !== key && v.includes('*') && matchPermission(v, key));

  return (
    <Tokenizer<PermissionItem>
      label={label}
      isLabelHidden={isLabelHidden}
      description={description ?? t('typeHint')}
      status={status}
      isDisabled={isDisabled}
      placeholder={value.length === 0 ? t('search') : undefined}
      searchSource={source}
      value={items}
      onChange={(next) => onChange(next.map((i) => i.id))}
      hasEntriesOnFocus
      maxMenuItems={200}
      emptySearchText={catalog.length ? t('noMatch') : t('emptyCatalog')}
      renderToken={(item, onRemove) => (
        <PermissionChip
          key={item.id}
          value={item.id}
          catalog={catalog}
          onRemove={isDisabled ? undefined : onRemove}
        />
      )}
      renderItem={(item) => {
        const aux = item.auxiliaryData;
        const via = aux?.kind === 'permission' ? impliedBy(item.id) : undefined;
        const note =
          aux?.kind === 'wildcard'
            ? t('covers', { count: aux.covers ?? 0 })
            : aux?.kind === 'custom'
              ? aux.covers !== undefined
                ? t('covers', { count: aux.covers })
                : t('notInCatalog')
              : via
                ? t('includedBy', { pattern: via })
                : aux?.description || '—';
        return (
          <TypeaheadItem
            item={item}
            icon={
              aux?.kind === 'custom' ? (
                <Icon icon={PlusIcon} />
              ) : aux?.kind === 'wildcard' ? (
                <Icon icon={AsteriskIcon} />
              ) : undefined
            }
            group={
              aux?.kind === 'custom' ? t('custom') : aux?.kind === 'wildcard' ? t('wildcards') : t('catalog')
            }
            description={note}
          />
        );
      }}
    />
  );
}
