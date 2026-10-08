'use client';

import type { Page } from '@isbp/sdk';
import { localize } from '@isbp/sdk';
import { Button } from '@isbp/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@isbp/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@isbp/ui/popover';
import { useApiQuery } from '@isbp/ui/query';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@isbp/ui/select';
import { CheckIcon, ChevronsUpDownIcon, NetworkIcon, XIcon } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { type ReactNode, useEffect, useState } from 'react';
import type { AssetListItem, CiRef, ContractListItem, LicenseListItem, Model } from '../contracts';
import { AssetStatusBadge, CategoryIcon, ComplianceBadge, ContractStatusBadge } from './badges';
import { modelLabel, useDepartments, useModels, useVendors } from './lib';

export const NONE = '__none__';

function useDebounced(value: string, ms = 200) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const h = setTimeout(() => setDebounced(value.trim()), ms);
    return () => clearTimeout(h);
  }, [value, ms]);
  return debounced;
}

/** A searchable server-side combobox (assets, licences, CIs). */
function SearchCombobox<T extends { id: string }>({
  id,
  invalid,
  placeholder,
  value,
  renderValue,
  path,
  query,
  items,
  renderItem,
  onSelect,
  clearLabel,
  onClear,
  searchWhenEmpty = true,
  describedBy,
}: {
  id?: string;
  invalid?: boolean;
  placeholder: string;
  value: { id: string } | null;
  renderValue: () => ReactNode;
  path: string;
  query: (q: string) => Record<string, string | number | undefined>;
  items: (data: unknown) => T[];
  renderItem: (item: T) => ReactNode;
  onSelect: (item: T) => void;
  clearLabel?: string;
  onClear?: () => void;
  searchWhenEmpty?: boolean;
  describedBy?: string;
}) {
  const t = useTranslations('itam.pickers');
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const debounced = useDebounced(q);
  const enabled = open && (searchWhenEmpty || Boolean(debounced));
  const { data, isFetching } = useApiQuery<unknown>(enabled ? path : null, query(debounced));
  const results = data ? items(data) : [];
  return (
    <div className="flex min-w-0 items-center gap-1">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy}
            className="w-full min-w-0 flex-1 justify-between font-normal"
          >
            {value ? (
              <span className="flex min-w-0 items-center gap-2">{renderValue()}</span>
            ) : (
              <span className="truncate text-muted-foreground">{placeholder}</span>
            )}
            <ChevronsUpDownIcon className="opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-(--radix-popover-trigger-width) min-w-72 p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput value={q} onValueChange={setQ} placeholder={placeholder} />
            <CommandList>
              <CommandEmpty>
                {!enabled ? t('typeToSearch') : isFetching ? t('searching') : t('noMatches')}
              </CommandEmpty>
              {results.length > 0 && (
                <CommandGroup>
                  {results.map((item) => (
                    <CommandItem
                      key={item.id}
                      value={item.id}
                      onSelect={() => {
                        onSelect(item);
                        setOpen(false);
                      }}
                    >
                      {renderItem(item)}
                      {value?.id === item.id && <CheckIcon />}
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {value && onClear && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={clearLabel ?? t('clear')}
          onClick={onClear}
        >
          <XIcon />
        </Button>
      )}
    </div>
  );
}

export type PickedAsset = Pick<AssetListItem, 'id' | 'tag' | 'name' | 'category' | 'status'>;

/** Hardware assets (tag, serial or name). */
export function AssetPicker({
  value,
  onChange,
  id,
  invalid,
  placeholder,
  excludeIds,
  query,
}: {
  value: PickedAsset | null;
  onChange: (asset: PickedAsset | null) => void;
  id?: string;
  invalid?: boolean;
  placeholder?: string;
  excludeIds?: readonly string[];
  query?: Record<string, string>;
}) {
  const t = useTranslations('itam.pickers');
  return (
    <SearchCombobox<AssetListItem>
      id={id}
      invalid={invalid}
      placeholder={placeholder ?? t('asset')}
      value={value}
      renderValue={() => (
        <>
          <CategoryIcon category={value!.category} className="text-muted-foreground" />
          <span className="font-mono text-xs text-muted-foreground">{value!.tag}</span>
          <span className="truncate">{value!.name}</span>
        </>
      )}
      path="/itam/assets"
      query={(q) => ({ q: q || undefined, pageSize: 12, sort: 'name', ...query })}
      items={(d) => (d as Page<AssetListItem>).items.filter((a) => !excludeIds?.includes(a.id))}
      renderItem={(a) => (
        <>
          <CategoryIcon category={a.category} className="text-muted-foreground" />
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="truncate">{a.name}</span>
            <span className="truncate font-mono text-xs text-muted-foreground">
              {a.tag}
              {a.serialNumber ? ` · ${a.serialNumber}` : ''}
            </span>
          </div>
          <AssetStatusBadge status={a.status} />
        </>
      )}
      onSelect={(a) =>
        onChange({ id: a.id, tag: a.tag, name: a.name, category: a.category, status: a.status })
      }
      onClear={() => onChange(null)}
    />
  );
}

export type PickedLicense = Pick<LicenseListItem, 'id' | 'reference' | 'product'>;

export function LicensePicker({
  value,
  onChange,
  id,
  excludeIds,
}: {
  value: PickedLicense | null;
  onChange: (license: PickedLicense | null) => void;
  id?: string;
  excludeIds?: readonly string[];
}) {
  const t = useTranslations('itam.pickers');
  return (
    <SearchCombobox<LicenseListItem>
      id={id}
      placeholder={t('license')}
      value={value}
      renderValue={() => (
        <>
          <span className="font-mono text-xs text-muted-foreground">{value!.reference}</span>
          <span className="truncate">{value!.product}</span>
        </>
      )}
      path="/itam/licenses"
      query={(q) => ({ q: q || undefined, pageSize: 12 })}
      items={(d) => (d as Page<LicenseListItem>).items.filter((l) => !excludeIds?.includes(l.id))}
      renderItem={(l) => (
        <>
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="truncate">{l.product}</span>
            <span className="font-mono text-xs text-muted-foreground">{l.reference}</span>
          </div>
          <ComplianceBadge state={l.complianceState} />
        </>
      )}
      onSelect={(l) => onChange({ id: l.id, reference: l.reference, product: l.product })}
      onClear={() => onChange(null)}
    />
  );
}

export type PickedContract = Pick<ContractListItem, 'id' | 'reference' | 'title'>;

export function ContractPicker({
  value,
  onChange,
  id,
}: {
  value: PickedContract | null;
  onChange: (contract: PickedContract | null) => void;
  id?: string;
}) {
  const t = useTranslations('itam.pickers');
  return (
    <SearchCombobox<ContractListItem>
      id={id}
      placeholder={t('contract')}
      value={value}
      renderValue={() => (
        <>
          <span className="font-mono text-xs text-muted-foreground">{value!.reference}</span>
          <span className="truncate">{value!.title}</span>
        </>
      )}
      path="/itam/contracts"
      query={(q) => ({ q: q || undefined, pageSize: 12 })}
      items={(d) => (d as Page<ContractListItem>).items}
      renderItem={(c) => (
        <>
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="truncate">{c.title}</span>
            <span className="font-mono text-xs text-muted-foreground">{c.reference}</span>
          </div>
          <ContractStatusBadge status={c.status} />
        </>
      )}
      onSelect={(c) => onChange({ id: c.id, reference: c.reference, title: c.title })}
      onClear={() => onChange(null)}
    />
  );
}

/** CMDB configuration items (read through the Assets API, so asset managers need no CMDB role). */
export function CiPicker({
  value,
  onChange,
  id,
}: {
  value: Pick<CiRef, 'id' | 'reference' | 'name'> | null;
  onChange: (ci: CiRef | null) => void;
  id?: string;
}) {
  const t = useTranslations('itam.pickers');
  const locale = useLocale();
  return (
    <SearchCombobox<CiRef>
      id={id}
      placeholder={t('ci')}
      value={value}
      renderValue={() => (
        <>
          <NetworkIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="font-mono text-xs text-muted-foreground">{value!.reference}</span>
          <span className="truncate">{value!.name}</span>
        </>
      )}
      path="/itam/lookups/cis"
      query={(q) => ({ q })}
      items={(d) => (d as { items: CiRef[] }).items}
      renderItem={(c) => (
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate">{c.name}</span>
          <span className="truncate text-xs text-muted-foreground">
            <span className="font-mono">{c.reference}</span>
            {c.className ? ` · ${localize(c.className, locale)}` : ''}
          </span>
        </div>
      )}
      onSelect={onChange}
      onClear={() => onChange(null)}
    />
  );
}

/** Plain selects backed by small lists (models, vendors, departments). */
export function ModelSelect({
  value,
  onChange,
  id,
  invalid,
  category,
}: {
  value: string;
  onChange: (id: string, model: Model | null) => void;
  id?: string;
  invalid?: boolean;
  category?: string;
}) {
  const t = useTranslations('itam.pickers');
  const { models } = useModels();
  const list = models.filter((m) => (m.active || m.id === value) && (!category || m.category === category));
  return (
    <Select value={value} onValueChange={(v) => onChange(v, models.find((m) => m.id === v) ?? null)}>
      <SelectTrigger id={id} className="w-full" aria-invalid={invalid || undefined}>
        <SelectValue placeholder={t('model')} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>
          <span className="text-muted-foreground">{t('noModel')}</span>
        </SelectItem>
        {list.map((m) => (
          <SelectItem key={m.id} value={m.id}>
            <CategoryIcon category={m.category} className="text-muted-foreground" />
            {modelLabel(m)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function VendorSelect({
  value,
  onChange,
  id,
  placeholder,
}: {
  value: string;
  onChange: (id: string) => void;
  id?: string;
  placeholder?: string;
}) {
  const t = useTranslations('itam.pickers');
  const { vendors } = useVendors();
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger id={id} className="w-full">
        <SelectValue placeholder={placeholder ?? t('vendor')} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>
          <span className="text-muted-foreground">{t('noVendor')}</span>
        </SelectItem>
        {vendors
          .filter((v) => v.active || v.id === value)
          .map((v) => (
            <SelectItem key={v.id} value={v.id}>
              {v.name}
            </SelectItem>
          ))}
      </SelectContent>
    </Select>
  );
}

export function DepartmentSelect({
  value,
  onChange,
  id,
}: {
  value: string;
  onChange: (id: string) => void;
  id?: string;
}) {
  const t = useTranslations('itam.pickers');
  const departments = useDepartments();
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger id={id} className="w-full">
        <SelectValue placeholder={t('department')} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>
          <span className="text-muted-foreground">{t('noDepartment')}</span>
        </SelectItem>
        {departments.map((d) => (
          <SelectItem key={d.id} value={d.id}>
            {d.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
