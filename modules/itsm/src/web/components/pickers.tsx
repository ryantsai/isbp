'use client';

import { Icon } from '@astryxdesign/core/Icon';
import { Selector } from '@astryxdesign/core/Selector';
import { Tokenizer } from '@astryxdesign/core/Tokenizer';
import { type SearchableItem, Typeahead, TypeaheadItem } from '@astryxdesign/core/Typeahead';
import type { ResolvedRecordInfo } from '@isbp/contracts';
import { localize } from '@isbp/sdk';
import { useApiSearchSource } from '@isbp/ui/search-source';
import { BookOpenIcon, ServerIcon, TicketIcon } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { memo, useMemo } from 'react';
import type { PersonRef, TicketStatus, TicketType } from '../../contracts';
import { useCategories, useGroupAgents, useGroups } from '../lib';
import type { CmdbCiOption, CmdbService } from '../types';

export const NONE = '__none__';

export type FieldStatus = { type: 'error' | 'warning' | 'success'; message?: string };

/**
 * What every picker takes besides its value: the Astryx field props. The label is a prop now (no separate `<Label>`);
 * pass `isLabelHidden` when the page already shows the caption.
 */
export type PickerFieldProps = {
  /** The field's label. Without one, `aria-label` (or the picker's own wording) becomes a visually hidden label. */
  label?: string;
  isLabelHidden?: boolean;
  isRequired?: boolean;
  isOptional?: boolean;
  description?: string;
  status?: FieldStatus;
  isDisabled?: boolean;
  /** Names the control when the page shows no caption of its own (filters). Same as `label` + `isLabelHidden`. */
  'aria-label'?: string;
  /** @deprecated Ignored: Astryx fields wire their own label, hint and error. Pass `label` / `description` / `status`. */
  id?: string;
  /** @deprecated Ignored: size the field with `width`, or the layout around it. */
  className?: string;
  /** @deprecated Use `isDisabled`. */
  disabled?: boolean;
  /** @deprecated Ignored: pass `description` / `status`. */
  'aria-describedby'?: string;
  /** @deprecated Ignored: pass `status`. */
  'aria-invalid'?: boolean;
};

export type SelectFieldProps = PickerFieldProps & {
  size?: 'sm' | 'md' | 'default';
  /** CSS width of the field (number = px). */
  width?: number | string;
};

/** The field props shared by every picker, with the label resolved (a hidden one when only `aria-label` is given). */
export function fieldProps(p: PickerFieldProps, fallbackLabel: string) {
  const label = p.label ?? p['aria-label'] ?? fallbackLabel;
  return {
    label,
    isLabelHidden: p.isLabelHidden ?? !p.label,
    isRequired: p.isRequired,
    isOptional: p.isOptional,
    description: p.description,
    status: p.status,
    isDisabled: p.isDisabled ?? p.disabled,
  };
}

export const selectorSize = (size: SelectFieldProps['size']) => (size === 'sm' ? 'sm' : 'md');

/* ───────────────────────────── categories ───────────────────────────── */

/** Category tree select (filtered by ticket type); `noneLabel` adds a "no category" option. */
export function CategorySelect({
  value,
  onChange,
  type,
  noneLabel,
  includeInactive,
  excludeId,
  size,
  width,
  ...field
}: {
  value: string | null | undefined;
  onChange: (id: string | null) => void;
  type?: TicketType;
  noneLabel?: string;
  includeInactive?: boolean;
  /** Hide a category and its descendants (choosing a parent for it). */
  excludeId?: string;
} & SelectFieldProps) {
  const t = useTranslations('itsm.common');
  const { tree } = useCategories(type, includeInactive);
  const hidden = new Set<string>();
  if (excludeId) {
    hidden.add(excludeId);
    for (const n of tree) if (n.category.ancestors.some((a) => a.id === excludeId)) hidden.add(n.category.id);
  }
  const options = [
    { value: NONE, label: noneLabel ?? t('noCategory') },
    ...tree
      .filter((n) => !hidden.has(n.category.id))
      .map((n) => ({
        value: n.category.id,
        label: `${n.path}${n.category.active ? '' : ` (${t('inactive')})`}`,
      })),
  ];
  return (
    <Selector
      {...fieldProps(field, t('chooseCategory'))}
      size={selectorSize(size)}
      width={width}
      hasSearch={options.length > 8}
      placeholder={t('chooseCategory')}
      options={options}
      value={value ?? NONE}
      onChange={(v) => onChange(v === NONE ? null : v)}
    />
  );
}

/* ───────────────────────────── groups & agents ───────────────────────────── */

export function GroupSelect({
  value,
  onChange,
  noneLabel,
  size,
  width,
  ...field
}: {
  value: string | null | undefined;
  onChange: (id: string | null) => void;
  noneLabel?: string;
} & SelectFieldProps) {
  const t = useTranslations('itsm.common');
  const { groups } = useGroups();
  const options = [
    { value: NONE, label: noneLabel ?? t('noGroup') },
    ...groups.map((g) => ({ value: g.id, label: g.name })),
  ];
  return (
    <Selector
      {...fieldProps(field, t('noGroup'))}
      size={selectorSize(size)}
      width={width}
      hasSearch={options.length > 8}
      options={options}
      value={value ?? NONE}
      onChange={(v) => onChange(v === NONE ? null : v)}
    />
  );
}

/** Agents of the chosen group (keeps showing the current assignee even if they left the group). */
export function AssigneeSelect({
  groupId,
  value,
  current,
  onChange,
  size,
  width,
  ...field
}: {
  groupId: string | null | undefined;
  value: string | null | undefined;
  current?: PersonRef | null;
  onChange: (id: string | null) => void;
} & SelectFieldProps) {
  const t = useTranslations('itsm.common');
  const { agents } = useGroupAgents(groupId);
  const list = current && !agents.some((a) => a.id === current.id) ? [current, ...agents] : agents;
  const options = [
    { value: NONE, label: t('unassigned') },
    ...list.map((a) => ({ value: a.id, label: a.displayName })),
  ];
  const props = fieldProps(field, t('unassigned'));
  return (
    <Selector
      {...props}
      isDisabled={props.isDisabled || (!groupId && !current)}
      size={selectorSize(size)}
      width={width}
      hasSearch={options.length > 8}
      options={options}
      value={value ?? NONE}
      onChange={(v) => onChange(v === NONE ? null : v)}
    />
  );
}

/* ───────────────────────────── CIs ───────────────────────────── */

export const ciReference = (ci: { number: number; reference?: string | null }) =>
  ci.reference || `CI-${String(ci.number).padStart(5, '0')}`;

type CiItem = SearchableItem<CmdbCiOption>;

const toCiItem = (ci: CmdbCiOption): CiItem => ({ id: ci.id, label: ci.name, auxiliaryData: ci });

/** Multi-select over the CMDB (`GET /api/v1/cmdb/cis?q=`). Memoized: typing elsewhere in a form skips it. */
export const CiPicker = memo(function CiPicker({
  value,
  onChange,
  max = 20,
  ...field
}: {
  value: CmdbCiOption[];
  onChange: (cis: CmdbCiOption[]) => void;
  max?: number;
} & PickerFieldProps) {
  const t = useTranslations('itsm.common.ciPicker');
  const locale = useLocale();
  const source = useApiSearchSource<CmdbCiOption>({
    path: '/cmdb/cis',
    query: (q) => ({ q: q || undefined, pageSize: 10 }),
    toItem: toCiItem,
  });
  const items = useMemo<CiItem[]>(() => value.map(toCiItem), [value]);
  return (
    <Tokenizer<CiItem>
      {...fieldProps(field, t('placeholder'))}
      searchSource={source}
      value={items}
      onChange={(next) => onChange(next.flatMap((i) => (i.auxiliaryData ? [i.auxiliaryData] : [])))}
      placeholder={t('search')}
      maxEntries={max}
      hasEntriesOnFocus
      emptySearchText={t('noResults')}
      renderItem={(item) => {
        const ci = item.auxiliaryData!;
        return (
          <TypeaheadItem
            item={item}
            icon={<Icon icon={ServerIcon} />}
            description={`${ciReference(ci)}${ci.class ? ` · ${localize(ci.class.name, locale)}` : ''}`}
          />
        );
      }}
    />
  );
});

/* ───────────────────────────── services ───────────────────────────── */

type ServiceItem = SearchableItem<CmdbService>;

const toServiceItem = (s: CmdbService): ServiceItem => ({ id: s.id, label: s.name, auxiliaryData: s });

/** Single business-service picker (`GET /api/v1/cmdb/services?q=`; everyone may read it). */
export function ServicePicker({
  value,
  onChange,
  ...field
}: {
  value: CmdbService | null;
  onChange: (service: CmdbService | null) => void;
} & PickerFieldProps) {
  const t = useTranslations('itsm.common.servicePicker');
  const source = useApiSearchSource<CmdbService>({
    path: '/cmdb/services',
    query: (q) => ({ q: q || undefined, limit: 50 }),
    toItem: toServiceItem,
  });
  const selected = useMemo(() => (value ? toServiceItem(value) : null), [value]);
  return (
    <Typeahead<ServiceItem>
      {...fieldProps(field, t('placeholder'))}
      searchSource={source}
      value={selected}
      onChange={(item) => onChange(item?.auxiliaryData ?? null)}
      placeholder={t('placeholder')}
      hasEntriesOnFocus
      startIcon={ServerIcon}
      emptySearchText={t('noResults')}
      renderItem={(item) => (
        <TypeaheadItem
          item={item}
          icon={<Icon icon={ServerIcon} />}
          description={item.auxiliaryData?.description ?? undefined}
        />
      )}
    />
  );
}

/* ───────────────────────────── knowledge articles ───────────────────────────── */

export interface ArticleOption {
  id: string;
  reference: string | null;
  title: string;
}

type ArticleAux = ArticleOption & { status: string | null };
type ArticleItem = SearchableItem<ArticleAux>;

const articleLabel = (a: { reference?: string | null; title: string }) =>
  [a.reference, a.title].filter(Boolean).join(' · ');

/**
 * Single knowledge-article picker. It searches the record registry (`GET /records/search`), so it lists only
 * the articles the person may read, and never calls the knowledge module's own API.
 */
export function ArticlePicker({
  value,
  onChange,
  ...field
}: {
  value: ArticleOption | null;
  onChange: (article: ArticleOption | null) => void;
} & PickerFieldProps) {
  const t = useTranslations('itsm.common.articlePicker');
  const root = useTranslations();
  const source = useApiSearchSource<ResolvedRecordInfo, ArticleAux>({
    path: '/records/search',
    query: (q) => ({ q, types: 'knowledge.article', limit: 15 }),
    toItem: (a) => ({
      id: a.id,
      label: articleLabel(a),
      auxiliaryData: {
        id: a.id,
        reference: a.reference ?? null,
        title: a.title,
        status: a.status && root.has(a.status.key) ? root(a.status.key) : null,
      },
    }),
  });
  const selected = useMemo<ArticleItem | null>(
    () =>
      value ? { id: value.id, label: articleLabel(value), auxiliaryData: { ...value, status: null } } : null,
    [value],
  );
  return (
    <Typeahead<ArticleItem>
      {...fieldProps(field, t('placeholder'))}
      searchSource={source}
      value={selected}
      onChange={(item) =>
        onChange(
          item?.auxiliaryData
            ? {
                id: item.auxiliaryData.id,
                reference: item.auxiliaryData.reference,
                title: item.auxiliaryData.title,
              }
            : null,
        )
      }
      placeholder={t('placeholder')}
      hasEntriesOnFocus
      startIcon={BookOpenIcon}
      emptySearchText={t('noResults')}
      renderItem={(item) => (
        <TypeaheadItem
          item={item}
          icon={<Icon icon={BookOpenIcon} />}
          description={item.auxiliaryData?.status ?? undefined}
        />
      )}
    />
  );
}

/* ───────────────────────────── tickets ───────────────────────────── */

/** A ticket as the picker shows it. */
export interface TicketOption {
  id: string;
  type: TicketType;
  reference: string;
  title: string;
  status: TicketStatus;
}

type TicketItem = SearchableItem<TicketOption>;

const toTicketItem = (it: TicketOption): TicketItem => ({
  id: it.id,
  label: `${it.reference} · ${it.title}`,
  auxiliaryData: { id: it.id, type: it.type, reference: it.reference, title: it.title, status: it.status },
});

/**
 * Multi-select of tickets by number or title (`GET /itsm/tickets?q=`), so nobody types references. `types` narrows
 * the search (on a problem: incidents and requests); `exclude` hides the ticket itself and what is linked already.
 */
export function TicketPicker({
  value,
  onChange,
  types,
  exclude = [],
  max = 20,
  ...field
}: {
  value: TicketOption[];
  onChange: (tickets: TicketOption[]) => void;
  types?: readonly TicketType[];
  exclude?: readonly string[];
  max?: number;
} & PickerFieldProps) {
  const t = useTranslations('itsm.common.ticketPicker');
  const ts = useTranslations('itsm.status');
  const hidden = new Set(exclude);
  const typesKey = types?.join(',');
  const source = useApiSearchSource<TicketOption>({
    path: '/itsm/tickets',
    query: (q) => ({ q: q || undefined, types: typesKey, view: 'all', sort: '-createdAt', pageSize: 10 }),
    toItem: toTicketItem,
    exclude: (item) => hidden.has(item.id),
  });
  const items = useMemo(() => value.map(toTicketItem), [value]);
  return (
    <Tokenizer<TicketItem>
      {...fieldProps(field, t('placeholder'))}
      searchSource={source}
      value={items}
      onChange={(next) => onChange(next.flatMap((i) => (i.auxiliaryData ? [i.auxiliaryData] : [])))}
      placeholder={t('placeholder')}
      maxEntries={max}
      emptySearchText={t('noResults')}
      renderItem={(item) => (
        <TypeaheadItem
          item={{ ...item, label: item.auxiliaryData?.title ?? item.label }}
          icon={<Icon icon={TicketIcon} />}
          description={
            item.auxiliaryData
              ? `${item.auxiliaryData.reference} · ${ts(item.auxiliaryData.status)}`
              : undefined
          }
        />
      )}
    />
  );
}
