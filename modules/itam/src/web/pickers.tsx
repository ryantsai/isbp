'use client';

import { HStack, StackItem, VStack } from '@astryxdesign/core/Layout';
import { Selector } from '@astryxdesign/core/Selector';
import { Text } from '@astryxdesign/core/Text';
import { Typeahead } from '@astryxdesign/core/Typeahead';
import { localize } from '@isbp/sdk';
import { type SearchableItem, type SearchSource, useApiSearchSource } from '@isbp/ui/search-source';
import { useLocale, useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import type {
  AssetListItem,
  CiRef,
  ComplianceState,
  ContractListItem,
  ContractStatus,
  LicenseListItem,
  Model,
} from '../contracts';
import { AssetStatusBadge, CategoryIcon, ComplianceBadge, ContractStatusBadge } from './badges';
import { modelLabel, useDepartments, useModels, useVendors } from './lib';

export const NONE = '__none__';

/**
 * What every picker shares with the Astryx inputs: a `label` (left visually hidden when the form shows none of its
 * own: the placeholder then names the field), a hint, a status and the required/optional marker.
 */
export interface PickerFieldProps {
  label?: string;
  description?: string;
  status?: { type: 'error' | 'warning' | 'success'; message?: string };
  isRequired?: boolean;
  isOptional?: boolean;
  isDisabled?: boolean;
}

/** Lists longer than this get a search box in the dropdown. */
const SEARCH_FROM = 8;

/* ───────────────────────────── searchable server-side pickers ───────────────────────────── */

/** One searchable single pick: the typeahead frame every picker below shares. */
function RecordPicker<Aux extends { id: string }>({
  value,
  onChange,
  toItem,
  source,
  renderItem,
  label,
  placeholder,
  ...field
}: PickerFieldProps & {
  /** The picked record (`null` when nothing is picked). */
  value: Aux | null;
  onChange: (value: Aux | null) => void;
  toItem: (value: Aux) => SearchableItem<Aux>;
  source: SearchSource<SearchableItem<Aux>>;
  renderItem: (value: Aux) => ReactNode;
  placeholder: string;
}) {
  const t = useTranslations('itam.pickers');
  return (
    <Typeahead<SearchableItem<Aux>>
      {...field}
      label={label ?? placeholder}
      isLabelHidden={!label}
      placeholder={placeholder}
      searchSource={source}
      value={value ? toItem(value) : null}
      onChange={(item) => onChange(item?.auxiliaryData ?? null)}
      renderItem={(item) => (item.auxiliaryData ? renderItem(item.auxiliaryData) : item.label)}
      hasEntriesOnFocus
      hasClear
      maxMenuItems={12}
      emptySearchText={t('noMatches')}
    />
  );
}

/** Two lines in a result row: the name, and its reference (monospaced) with what else identifies it. */
function Result({
  icon,
  title,
  reference,
  detail,
  trailing,
}: {
  icon?: ReactNode;
  title: string;
  reference: string;
  detail?: string | null;
  trailing?: ReactNode;
}) {
  return (
    <HStack gap={2} vAlign="center" width="100%">
      {icon}
      <StackItem size="fill">
        <VStack>
          <Text maxLines={1}>{title}</Text>
          <Text type="supporting" maxLines={1}>
            <Text type="code" size="xsm">
              {reference}
            </Text>
            {detail ? ` · ${detail}` : ''}
          </Text>
        </VStack>
      </StackItem>
      {trailing}
    </HStack>
  );
}

export type PickedAsset = Pick<AssetListItem, 'id' | 'tag' | 'name' | 'category' | 'status'>;
/** A row of the asset list: the picked fields, and the serial number as a search hit shows it. */
type AssetRow = PickedAsset & { serialNumber?: string | null };
const assetItem = (a: AssetRow): SearchableItem<AssetRow> => ({
  id: a.id,
  label: `${a.tag} · ${a.name}`,
  auxiliaryData: a,
});

/** Hardware assets (tag, serial or name). */
export function AssetPicker({
  value,
  onChange,
  placeholder,
  excludeIds,
  query,
  ...field
}: PickerFieldProps & {
  value: PickedAsset | null;
  onChange: (asset: PickedAsset | null) => void;
  placeholder?: string;
  excludeIds?: readonly string[];
  query?: Record<string, string>;
}) {
  const t = useTranslations('itam.pickers');
  const source = useApiSearchSource<AssetRow>({
    path: '/itam/assets',
    query: (q) => ({ q: q || undefined, pageSize: 12, sort: 'name', ...query }),
    toItem: assetItem,
    exclude: (item) => Boolean(excludeIds?.includes(item.id)),
  });
  return (
    <RecordPicker<AssetRow>
      {...field}
      value={value}
      onChange={(a) =>
        onChange(a && { id: a.id, tag: a.tag, name: a.name, category: a.category, status: a.status })
      }
      toItem={assetItem}
      source={source}
      placeholder={placeholder ?? t('asset')}
      renderItem={(a) => (
        <Result
          icon={<CategoryIcon category={a.category} color="secondary" />}
          title={a.name}
          reference={a.tag}
          detail={a.serialNumber}
          trailing={<AssetStatusBadge status={a.status} />}
        />
      )}
    />
  );
}

export type PickedLicense = Pick<LicenseListItem, 'id' | 'reference' | 'product'>;
type LicenseRow = PickedLicense & { complianceState?: ComplianceState };
const licenseItem = (l: LicenseRow): SearchableItem<LicenseRow> => ({
  id: l.id,
  label: `${l.reference} · ${l.product}`,
  auxiliaryData: l,
});

export function LicensePicker({
  value,
  onChange,
  excludeIds,
  ...field
}: PickerFieldProps & {
  value: PickedLicense | null;
  onChange: (license: PickedLicense | null) => void;
  excludeIds?: readonly string[];
}) {
  const t = useTranslations('itam.pickers');
  const source = useApiSearchSource<LicenseRow>({
    path: '/itam/licenses',
    query: (q) => ({ q: q || undefined, pageSize: 12 }),
    toItem: licenseItem,
    exclude: (item) => Boolean(excludeIds?.includes(item.id)),
  });
  return (
    <RecordPicker<LicenseRow>
      {...field}
      value={value}
      onChange={(l) => onChange(l && { id: l.id, reference: l.reference, product: l.product })}
      toItem={licenseItem}
      source={source}
      placeholder={t('license')}
      renderItem={(l) => (
        <Result
          title={l.product}
          reference={l.reference}
          trailing={l.complianceState ? <ComplianceBadge state={l.complianceState} /> : undefined}
        />
      )}
    />
  );
}

export type PickedContract = Pick<ContractListItem, 'id' | 'reference' | 'title'>;
type ContractRow = PickedContract & { status?: ContractStatus };
const contractItem = (c: ContractRow): SearchableItem<ContractRow> => ({
  id: c.id,
  label: `${c.reference} · ${c.title}`,
  auxiliaryData: c,
});

export function ContractPicker({
  value,
  onChange,
  ...field
}: PickerFieldProps & {
  value: PickedContract | null;
  onChange: (contract: PickedContract | null) => void;
}) {
  const t = useTranslations('itam.pickers');
  const source = useApiSearchSource<ContractRow>({
    path: '/itam/contracts',
    query: (q) => ({ q: q || undefined, pageSize: 12 }),
    toItem: contractItem,
  });
  return (
    <RecordPicker<ContractRow>
      {...field}
      value={value}
      onChange={(c) => onChange(c && { id: c.id, reference: c.reference, title: c.title })}
      toItem={contractItem}
      source={source}
      placeholder={t('contract')}
      renderItem={(c) => (
        <Result
          title={c.title}
          reference={c.reference}
          trailing={c.status ? <ContractStatusBadge status={c.status} /> : undefined}
        />
      )}
    />
  );
}

const ciItem = (c: CiRef): SearchableItem<CiRef> => ({
  id: c.id,
  label: `${c.reference} · ${c.name}`,
  auxiliaryData: c,
});

/** CMDB configuration items (read through the Assets API, so asset managers need no CMDB role). */
export function CiPicker({
  value,
  onChange,
  ...field
}: PickerFieldProps & {
  value: Pick<CiRef, 'id' | 'reference' | 'name'> | null;
  onChange: (ci: CiRef | null) => void;
}) {
  const t = useTranslations('itam.pickers');
  const locale = useLocale();
  const source = useApiSearchSource<CiRef>({
    path: '/itam/lookups/cis',
    query: (q) => ({ q }),
    toItem: ciItem,
  });
  return (
    <RecordPicker<CiRef>
      {...field}
      value={value as CiRef | null}
      onChange={onChange}
      toItem={ciItem}
      source={source}
      placeholder={t('ci')}
      renderItem={(c) => (
        <Result
          title={c.name}
          reference={c.reference}
          detail={c.className ? localize(c.className, locale) : undefined}
        />
      )}
    />
  );
}

/* ───────────────────────────── plain selects backed by small lists ───────────────────────────── */

export function ModelSelect({
  value,
  onChange,
  category,
  label,
  ...field
}: PickerFieldProps & {
  value: string;
  onChange: (id: string, model: Model | null) => void;
  category?: string;
}) {
  const t = useTranslations('itam.pickers');
  const { models } = useModels();
  const list = models.filter((m) => (m.active || m.id === value) && (!category || m.category === category));
  return (
    <Selector
      {...field}
      label={label ?? t('model')}
      isLabelHidden={!label}
      placeholder={t('model')}
      hasSearch={list.length > SEARCH_FROM}
      value={value}
      onChange={(v) => onChange(v, models.find((m) => m.id === v) ?? null)}
      options={[
        { value: NONE, label: t('noModel') },
        ...list.map((m) => ({
          value: m.id,
          label: modelLabel(m),
          icon: <CategoryIcon category={m.category} color="secondary" />,
        })),
      ]}
    />
  );
}

export function VendorSelect({
  value,
  onChange,
  placeholder,
  label,
  ...field
}: PickerFieldProps & {
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
}) {
  const t = useTranslations('itam.pickers');
  const { vendors } = useVendors();
  const list = vendors.filter((v) => v.active || v.id === value);
  return (
    <Selector
      {...field}
      label={label ?? t('vendor')}
      isLabelHidden={!label}
      placeholder={placeholder ?? t('vendor')}
      hasSearch={list.length > SEARCH_FROM}
      value={value}
      onChange={onChange}
      options={[{ value: NONE, label: t('noVendor') }, ...list.map((v) => ({ value: v.id, label: v.name }))]}
    />
  );
}

export function DepartmentSelect({
  value,
  onChange,
  label,
  ...field
}: PickerFieldProps & {
  value: string;
  onChange: (id: string) => void;
}) {
  const t = useTranslations('itam.pickers');
  const departments = useDepartments();
  return (
    <Selector
      {...field}
      label={label ?? t('department')}
      isLabelHidden={!label}
      placeholder={t('department')}
      hasSearch={departments.length > SEARCH_FROM}
      value={value}
      onChange={onChange}
      options={[
        { value: NONE, label: t('noDepartment') },
        ...departments.map((d) => ({ value: d.id, label: d.name })),
      ]}
    />
  );
}
