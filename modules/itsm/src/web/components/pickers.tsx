'use client';

import { localize } from '@isbp/sdk';
import { cn } from '@isbp/ui';
import { Badge } from '@isbp/ui/badge';
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
import { BookOpenIcon, CheckIcon, ChevronsUpDownIcon, ServerIcon, TicketIcon, XIcon } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import type { ResolvedRecordInfo } from '@isbp/contracts';
import type { Page } from '@isbp/sdk';
import type { PersonRef, TicketStatus, TicketType } from '../../contracts';
import { useCategories, useGroupAgents, useGroups } from '../lib';
import type { CmdbCiOption, CmdbService } from '../types';

export const NONE = '__none__';

type TriggerProps = {
  id?: string;
  className?: string;
  disabled?: boolean;
  'aria-label'?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
  size?: 'sm' | 'default';
};

function useDebounced(value: string, ms = 200) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const h = setTimeout(() => setDebounced(value.trim()), ms);
    return () => clearTimeout(h);
  }, [value, ms]);
  return debounced;
}

/* ───────────────────────────── categories ───────────────────────────── */

/** Category tree select (filtered by ticket type); `noneLabel` adds a "no category" option. */
export function CategorySelect({
  value,
  onChange,
  type,
  noneLabel,
  includeInactive,
  excludeId,
  ...trigger
}: {
  value: string | null | undefined;
  onChange: (id: string | null) => void;
  type?: TicketType;
  noneLabel?: string;
  includeInactive?: boolean;
  /** Hide a category and its descendants (choosing a parent for it). */
  excludeId?: string;
} & TriggerProps) {
  const t = useTranslations('itsm.common');
  const { tree } = useCategories(type, includeInactive);
  const hidden = new Set<string>();
  if (excludeId) {
    hidden.add(excludeId);
    for (const n of tree) if (n.category.ancestors.some((a) => a.id === excludeId)) hidden.add(n.category.id);
  }
  return (
    <Select value={value ?? NONE} onValueChange={(v) => onChange(v === NONE ? null : v)}>
      <SelectTrigger
        id={trigger.id}
        size={trigger.size}
        disabled={trigger.disabled}
        aria-label={trigger['aria-label']}
        aria-describedby={trigger['aria-describedby']}
        aria-invalid={trigger['aria-invalid']}
        className={cn('w-full min-w-0', trigger.className)}
      >
        <SelectValue placeholder={t('chooseCategory')} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>{noneLabel ?? t('noCategory')}</SelectItem>
        {tree
          .filter((n) => !hidden.has(n.category.id))
          .map((n) => (
            <SelectItem key={n.category.id} value={n.category.id}>
              <span className="truncate">
                {n.depth > 0 && (
                  <span className="text-muted-foreground">{n.path.slice(0, -n.name.length)}</span>
                )}
                {n.name}
                {!n.category.active && <span className="text-muted-foreground"> ({t('inactive')})</span>}
              </span>
            </SelectItem>
          ))}
      </SelectContent>
    </Select>
  );
}

/* ───────────────────────────── groups & agents ───────────────────────────── */

export function GroupSelect({
  value,
  onChange,
  noneLabel,
  ...trigger
}: {
  value: string | null | undefined;
  onChange: (id: string | null) => void;
  noneLabel?: string;
} & TriggerProps) {
  const t = useTranslations('itsm.common');
  const { groups } = useGroups();
  return (
    <Select value={value ?? NONE} onValueChange={(v) => onChange(v === NONE ? null : v)}>
      <SelectTrigger
        id={trigger.id}
        size={trigger.size}
        disabled={trigger.disabled}
        aria-label={trigger['aria-label']}
        aria-describedby={trigger['aria-describedby']}
        className={cn('w-full min-w-0', trigger.className)}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>{noneLabel ?? t('noGroup')}</SelectItem>
        {groups.map((g) => (
          <SelectItem key={g.id} value={g.id}>
            {g.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Agents of the chosen group (keeps showing the current assignee even if they left the group). */
export function AssigneeSelect({
  groupId,
  value,
  current,
  onChange,
  ...trigger
}: {
  groupId: string | null | undefined;
  value: string | null | undefined;
  current?: PersonRef | null;
  onChange: (id: string | null) => void;
} & TriggerProps) {
  const t = useTranslations('itsm.common');
  const { agents } = useGroupAgents(groupId);
  const list = current && !agents.some((a) => a.id === current.id) ? [current, ...agents] : agents;
  return (
    <Select value={value ?? NONE} onValueChange={(v) => onChange(v === NONE ? null : v)}>
      <SelectTrigger
        id={trigger.id}
        size={trigger.size}
        disabled={trigger.disabled || (!groupId && !current)}
        aria-label={trigger['aria-label']}
        aria-describedby={trigger['aria-describedby']}
        className={cn('w-full min-w-0', trigger.className)}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>{t('unassigned')}</SelectItem>
        {list.map((a) => (
          <SelectItem key={a.id} value={a.id}>
            {a.displayName}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/* ───────────────────────────── CIs ───────────────────────────── */

export const ciReference = (ci: { number: number; reference?: string | null }) =>
  ci.reference || `CI-${String(ci.number).padStart(5, '0')}`;

/** Multi-select combobox over the CMDB (`GET /api/v1/cmdb/cis?q=`). */
export function CiPicker({
  value,
  onChange,
  id,
  max = 20,
  'aria-describedby': describedBy,
  'aria-label': ariaLabel,
}: {
  value: CmdbCiOption[];
  onChange: (cis: CmdbCiOption[]) => void;
  id?: string;
  max?: number;
  'aria-describedby'?: string;
  'aria-label'?: string;
}) {
  const t = useTranslations('itsm.common.ciPicker');
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const debounced = useDebounced(q);
  const { data, isFetching } = useApiQuery<Page<CmdbCiOption>>(open ? '/cmdb/cis' : null, {
    q: debounced || undefined,
    pageSize: 10,
  });
  const chosen = new Set(value.map((c) => c.id));
  const toggle = (ci: CmdbCiOption) =>
    onChange(chosen.has(ci.id) ? value.filter((c) => c.id !== ci.id) : [...value, ci].slice(0, max));

  return (
    <div className="grid gap-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            aria-describedby={describedBy}
            aria-label={ariaLabel}
            className="w-full justify-between font-normal"
          >
            <span className="truncate text-muted-foreground">
              {value.length ? t('selected', { count: value.length }) : t('placeholder')}
            </span>
            <ChevronsUpDownIcon className="opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-(--radix-popover-trigger-width) min-w-72 p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput value={q} onValueChange={setQ} placeholder={t('search')} />
            <CommandList>
              <CommandEmpty>{isFetching ? t('loading') : t('noResults')}</CommandEmpty>
              {(data?.items.length ?? 0) > 0 && (
                <CommandGroup>
                  {data!.items.map((ci) => (
                    <CommandItem key={ci.id} value={ci.id} onSelect={() => toggle(ci)}>
                      <ServerIcon />
                      <div className="flex min-w-0 flex-col">
                        <span className="truncate">{ci.name}</span>
                        <span className="truncate text-xs text-muted-foreground">
                          {ciReference(ci)}
                          {ci.class ? ` · ${localize(ci.class.name, locale)}` : ''}
                        </span>
                      </div>
                      {chosen.has(ci.id) && <CheckIcon className="ml-auto" />}
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {value.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label={t('chosen')}>
          {value.map((ci) => (
            <li key={ci.id}>
              <Badge variant="secondary" className="gap-1 py-0.5 pr-0.5 font-normal">
                <ServerIcon aria-hidden />
                <span className="max-w-48 truncate">{ci.name}</span>
                <button
                  type="button"
                  onClick={() => onChange(value.filter((c) => c.id !== ci.id))}
                  aria-label={t('remove', { name: ci.name })}
                  className="rounded-sm p-0.5 text-muted-foreground hover:bg-background hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                >
                  <XIcon className="size-3" />
                </button>
              </Badge>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ───────────────────────────── services ───────────────────────────── */

/** Single business-service combobox (`GET /api/v1/cmdb/services?q=`; everyone may read it). */
export function ServicePicker({
  value,
  onChange,
  id,
  'aria-describedby': describedBy,
}: {
  value: CmdbService | null;
  onChange: (service: CmdbService | null) => void;
  id?: string;
  'aria-describedby'?: string;
}) {
  const t = useTranslations('itsm.common.servicePicker');
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const debounced = useDebounced(q);
  const { data, isFetching } = useApiQuery<{ items: CmdbService[] }>(open ? '/cmdb/services' : null, {
    q: debounced || undefined,
    limit: 50,
  });
  const items = data?.items ?? [];
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <div className="relative min-w-0">
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            aria-describedby={describedBy}
            className="h-auto min-h-9 w-full min-w-0 justify-between py-2 text-left font-normal whitespace-normal"
          >
            {value ? (
              <span className="flex min-w-0 items-center gap-2">
                <ServerIcon className="text-muted-foreground" aria-hidden />
                <span className="truncate">{value.name}</span>
              </span>
            ) : (
              <span className="text-muted-foreground">{t('placeholder')}</span>
            )}
            <ChevronsUpDownIcon className="opacity-50" />
          </Button>
        </PopoverTrigger>
        {value && (
          <button
            type="button"
            onClick={() => onChange(null)}
            aria-label={t('clear')}
            className="absolute top-1/2 right-8 -translate-y-1/2 rounded-sm p-0.5 text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            <XIcon className="size-3.5" />
          </button>
        )}
      </div>
      <PopoverContent className="w-(--radix-popover-trigger-width) min-w-72 p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput value={q} onValueChange={setQ} placeholder={t('search')} />
          <CommandList>
            <CommandEmpty>{isFetching ? t('loading') : t('noResults')}</CommandEmpty>
            {items.length > 0 && (
              <CommandGroup>
                {items.map((s) => (
                  <CommandItem
                    key={s.id}
                    value={s.id}
                    onSelect={() => {
                      onChange(s);
                      setOpen(false);
                    }}
                  >
                    <ServerIcon />
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate">{s.name}</span>
                      {s.description && (
                        <span className="line-clamp-1 text-xs text-muted-foreground">{s.description}</span>
                      )}
                    </div>
                    {value?.id === s.id && <CheckIcon className="ml-auto" />}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/* ───────────────────────────── knowledge articles ───────────────────────────── */

export interface ArticleOption {
  id: string;
  reference: string | null;
  title: string;
}

/**
 * Single knowledge-article combobox. It searches the record registry (`GET /records/search`), so it lists only
 * the articles the person may read, and never calls the knowledge module's own API.
 */
export function ArticlePicker({
  value,
  onChange,
  id,
  disabled,
  'aria-describedby': describedBy,
}: {
  value: ArticleOption | null;
  onChange: (article: ArticleOption | null) => void;
  id?: string;
  disabled?: boolean;
  'aria-describedby'?: string;
}) {
  const t = useTranslations('itsm.common.articlePicker');
  const root = useTranslations();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const debounced = useDebounced(q);
  const { data, isFetching } = useApiQuery<{ items: ResolvedRecordInfo[] }>(open ? '/records/search' : null, {
    q: debounced,
    types: 'knowledge.article',
    limit: 15,
  });
  const items = data?.items ?? [];
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <div className="relative min-w-0">
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            aria-describedby={describedBy}
            disabled={disabled}
            className="h-auto min-h-9 w-full min-w-0 justify-between py-2 text-left font-normal whitespace-normal"
          >
            {value ? (
              <span className="flex min-w-0 items-center gap-2 pr-6">
                <BookOpenIcon className="text-muted-foreground" aria-hidden />
                <span className="truncate">
                  {value.reference && (
                    <span className="mr-1.5 font-mono text-xs text-muted-foreground">{value.reference}</span>
                  )}
                  {value.title}
                </span>
              </span>
            ) : (
              <span className="text-muted-foreground">{t('placeholder')}</span>
            )}
            <ChevronsUpDownIcon className="opacity-50" />
          </Button>
        </PopoverTrigger>
        {value && !disabled && (
          <button
            type="button"
            onClick={() => onChange(null)}
            aria-label={t('clear')}
            className="absolute top-1/2 right-8 -translate-y-1/2 rounded-sm p-0.5 text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            <XIcon className="size-3.5" />
          </button>
        )}
      </div>
      <PopoverContent className="w-(--radix-popover-trigger-width) min-w-72 p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput value={q} onValueChange={setQ} placeholder={t('search')} />
          <CommandList>
            <CommandEmpty>{isFetching ? t('loading') : t('noResults')}</CommandEmpty>
            {items.length > 0 && (
              <CommandGroup>
                {items.map((a) => {
                  const status = a.status && root.has(a.status.key) ? root(a.status.key) : null;
                  return (
                    <CommandItem
                      key={a.id}
                      value={a.id}
                      onSelect={() => {
                        onChange({ id: a.id, reference: a.reference, title: a.title });
                        setOpen(false);
                      }}
                    >
                      <BookOpenIcon />
                      <div className="flex min-w-0 flex-col">
                        <span className="truncate">{a.title}</span>
                        <span className="truncate text-xs text-muted-foreground">
                          {[a.reference, status].filter(Boolean).join(' · ')}
                        </span>
                      </div>
                      {value?.id === a.id && <CheckIcon className="ml-auto" />}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
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

/**
 * Multi-select of tickets by number or title (`GET /itsm/tickets?q=`), so nobody types references. `types` narrows
 * the search (on a problem: incidents and requests); `exclude` hides the ticket itself and what is linked already.
 */
export function TicketPicker({
  value,
  onChange,
  types,
  exclude = [],
  id,
  max = 20,
  'aria-describedby': describedBy,
  'aria-label': ariaLabel,
}: {
  value: TicketOption[];
  onChange: (tickets: TicketOption[]) => void;
  types?: readonly TicketType[];
  exclude?: readonly string[];
  id?: string;
  max?: number;
  'aria-describedby'?: string;
  'aria-label'?: string;
}) {
  const t = useTranslations('itsm.common.ticketPicker');
  const ts = useTranslations('itsm.status');
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const debounced = useDebounced(q);
  const { data, isFetching } = useApiQuery<Page<TicketOption>>(open ? '/itsm/tickets' : null, {
    q: debounced || undefined,
    types: types?.join(','),
    view: 'all',
    sort: '-createdAt',
    pageSize: 10,
  });
  const chosen = new Set(value.map((x) => x.id));
  const hidden = new Set(exclude);
  const items = (data?.items ?? []).filter((x) => !hidden.has(x.id));
  const toggle = (it: TicketOption) =>
    onChange(
      chosen.has(it.id)
        ? value.filter((x) => x.id !== it.id)
        : [
            ...value,
            { id: it.id, type: it.type, reference: it.reference, title: it.title, status: it.status },
          ].slice(0, max),
    );
  return (
    <div className="grid gap-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            aria-describedby={describedBy}
            aria-label={ariaLabel}
            className="w-full justify-between font-normal"
          >
            <span className="truncate text-muted-foreground">
              {value.length ? t('selected', { count: value.length }) : t('placeholder')}
            </span>
            <ChevronsUpDownIcon className="opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-(--radix-popover-trigger-width) min-w-72 p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput value={q} onValueChange={setQ} placeholder={t('search')} />
            <CommandList>
              <CommandEmpty>{isFetching ? t('loading') : t('noResults')}</CommandEmpty>
              {items.length > 0 && (
                <CommandGroup>
                  {items.map((it) => (
                    <CommandItem key={it.id} value={it.id} onSelect={() => toggle(it)}>
                      <TicketIcon />
                      <div className="flex min-w-0 flex-col">
                        <span className="truncate">{it.title}</span>
                        <span className="truncate text-xs text-muted-foreground">
                          {it.reference} · {ts(it.status)}
                        </span>
                      </div>
                      {chosen.has(it.id) && <CheckIcon className="ml-auto" />}
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {value.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label={t('chosen')}>
          {value.map((it) => (
            <li key={it.id}>
              <Badge variant="secondary" className="gap-1 py-0.5 pr-0.5 font-normal">
                <span className="font-mono text-xs">{it.reference}</span>
                <span className="max-w-48 truncate">{it.title}</span>
                <button
                  type="button"
                  onClick={() => onChange(value.filter((x) => x.id !== it.id))}
                  aria-label={t('remove', { reference: it.reference })}
                  className="rounded-sm p-0.5 text-muted-foreground hover:bg-background hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                >
                  <XIcon className="size-3" />
                </button>
              </Badge>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
