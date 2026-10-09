'use client';

import { cn } from '@isbp/ui';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@isbp/ui/alert-dialog';
import { Button } from '@isbp/ui/button';
import { Checkbox } from '@isbp/ui/checkbox';
import { useListState } from '@isbp/ui/data-table';
import { useApiQuery } from '@isbp/ui/query';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@isbp/ui/select';
import { ArrowDownIcon, ArrowUpIcon, Trash2Icon } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { type ReactNode, useCallback, useId, useMemo } from 'react';
import { localize } from '@isbp/sdk';
import { type SlaPolicy, type TicketType, ticketTypeSchema } from '../../contracts';
import type { CoverageContext, CoveragePolicy } from '../../sla-coverage';
import { TYPE_ICON } from '../components/badges';
import { useCategories, useGroups } from '../lib';

/** Checkbox chips for a set of options (ticket types, pause statuses). */
export function CheckGroup<T extends string>({
  options,
  value,
  onChange,
  label,
  render,
  invalid,
  describedBy,
}: {
  options: readonly T[];
  value: readonly T[];
  onChange: (v: T[]) => void;
  label: string;
  render: (o: T) => ReactNode;
  invalid?: boolean;
  describedBy?: string;
}) {
  const id = useId();
  return (
    <div role="group" aria-labelledby={`${id}-label`} aria-describedby={describedBy} className="grid gap-2">
      <span id={`${id}-label`} className="text-sm font-medium">
        {label}
      </span>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => {
          const checked = value.includes(o);
          return (
            <label
              key={o}
              className={cn(
                'flex cursor-pointer items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring/50',
                checked ? 'border-primary/50 bg-primary/5' : 'hover:bg-muted/60',
                invalid && 'border-destructive',
              )}
            >
              <Checkbox
                checked={checked}
                aria-invalid={invalid || undefined}
                onCheckedChange={(c) => onChange(c ? [...value, o] : value.filter((x) => x !== o))}
              />
              {render(o)}
            </label>
          );
        })}
      </div>
    </div>
  );
}

export function TypeChecks({
  value,
  onChange,
  label,
  invalid,
  describedBy,
}: {
  value: readonly TicketType[];
  onChange: (v: TicketType[]) => void;
  label: string;
  invalid?: boolean;
  describedBy?: string;
}) {
  const t = useTranslations('itsm.typesPlural');
  return (
    <CheckGroup
      options={ticketTypeSchema.options}
      value={value}
      onChange={onChange}
      label={label}
      invalid={invalid}
      describedBy={describedBy}
      render={(o) => {
        const Icon = TYPE_ICON[o];
        return (
          <span className="inline-flex items-center gap-1.5">
            <Icon className="size-3.5 text-muted-foreground" aria-hidden />
            {t(o)}
          </span>
        );
      }}
    />
  );
}

/** Delete with a confirmation step. */
export function DeleteButton({
  title,
  description,
  onConfirm,
  pending,
}: {
  title: string;
  description: string;
  onConfirm: () => void;
  pending?: boolean;
}) {
  const tc = useTranslations('common');
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          className="text-destructive hover:text-destructive sm:mr-auto"
          loading={pending}
        >
          <Trash2Icon />
          {tc('delete')}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{tc('cancel')}</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            className="bg-destructive text-white hover:bg-destructive/90"
          >
            {tc('delete')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** "Move up" / "Move down" for a row of an ordered list (keyboard operable; ends are disabled, not hidden). */
export function MoveButtons({
  name,
  first,
  last,
  onMove,
  pending,
  idPrefix,
}: {
  name: string;
  first: boolean;
  last: boolean;
  onMove: (direction: -1 | 1) => void;
  pending?: boolean;
  /** Ids `<prefix>-up` / `<prefix>-down`, so focus can return to the button after the list re-renders. */
  idPrefix: string;
}) {
  const t = useTranslations('itsm.settingsPage');
  return (
    <span className="inline-flex items-center">
      <Button
        id={`${idPrefix}-up`}
        type="button"
        variant="ghost"
        size="icon-sm"
        disabled={first || pending}
        aria-label={t('moveUp', { name })}
        title={t('moveUp', { name })}
        onClick={() => onMove(-1)}
      >
        <ArrowUpIcon />
      </Button>
      <Button
        id={`${idPrefix}-down`}
        type="button"
        variant="ghost"
        size="icon-sm"
        disabled={last || pending}
        aria-label={t('moveDown', { name })}
        title={t('moveDown', { name })}
        onClick={() => onMove(1)}
      >
        <ArrowDownIcon />
      </Button>
    </span>
  );
}

/** After a reorder, focus the moved row's button again (or the other one when it reached an end). */
export function refocus(idPrefix: string, direction: -1 | 1) {
  requestAnimationFrame(() => {
    const preferred = document.getElementById(`${idPrefix}-${direction < 0 ? 'up' : 'down'}`);
    const other = document.getElementById(`${idPrefix}-${direction < 0 ? 'down' : 'up'}`);
    const target = preferred && !(preferred as HTMLButtonElement).disabled ? preferred : other;
    target?.focus();
  });
}

/** Which sheet is open, in the URL (`?create=1` / `?edit=<id>`) so it can be shared and survives a reload. */
export function useSheetParam() {
  const [state, set] = useListState();
  const editing = typeof state.edit === 'string' ? state.edit : null;
  const creating = state.create === '1';
  const openCreate = useCallback(() => set({ create: '1', edit: undefined }), [set]);
  const openEdit = useCallback((id: string) => set({ edit: id, create: undefined }), [set]);
  const close = useCallback(() => set({ edit: undefined, create: undefined }), [set]);
  return { editing, creating, open: creating || editing !== null, openCreate, openEdit, close };
}

/** Groups for a default/fulfilment group: service desk groups first, then the others. */
export function DefaultGroupSelect({
  id,
  value,
  onChange,
  'aria-describedby': describedBy,
}: {
  id: string;
  value: string | null;
  onChange: (id: string | null) => void;
  'aria-describedby'?: string;
}) {
  const t = useTranslations('itsm.settingsPage');
  const tc = useTranslations('itsm.common');
  const { groups } = useGroups();
  const working = groups.filter((g) => g.worksTickets);
  const others = groups.filter((g) => !g.worksTickets);
  return (
    <Select value={value ?? 'none'} onValueChange={(v) => onChange(v === 'none' ? null : v)}>
      <SelectTrigger id={id} className="w-full min-w-0" aria-describedby={describedBy}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="none">{tc('noGroup')}</SelectItem>
        {working.length > 0 && (
          <SelectGroup>
            <SelectLabel>{t('serviceDeskGroups')}</SelectLabel>
            {working.map((g) => (
              <SelectItem key={g.id} value={g.id}>
                {g.name}
              </SelectItem>
            ))}
          </SelectGroup>
        )}
        {others.length > 0 && (
          <SelectGroup>
            <SelectLabel>{t('otherGroups')}</SelectLabel>
            {others.map((g) => (
              <SelectItem key={g.id} value={g.id}>
                {g.name}
              </SelectItem>
            ))}
          </SelectGroup>
        )}
      </SelectContent>
    </Select>
  );
}

const NO_POLICIES: SlaPolicy[] = [];

/** SLA policies in evaluation order, the categories they can refer to, and helpers to name them. */
export function usePolicies(enabled = true) {
  const locale = useLocale();
  const q = useApiQuery<{ items: SlaPolicy[] }>(enabled ? '/itsm/sla-policies' : null);
  const { categories } = useCategories(undefined, true);
  const items = q.data?.items ?? NO_POLICIES;
  const ordered = useMemo(() => [...items].sort((a, b) => a.sortOrder - b.sortOrder), [items]);
  const coverage = useMemo<CoverageContext>(
    () => ({ categories: categories.map((c) => ({ id: c.id, key: c.key, parentId: c.parentId })) }),
    [categories],
  );
  const asCoverage = useMemo<CoveragePolicy[]>(
    () =>
      ordered.map((p) => ({
        id: p.id,
        ticketTypes: p.ticketTypes,
        condition: p.condition,
        active: p.active,
      })),
    [ordered],
  );
  const nameOf = useCallback(
    (id: string | null | undefined) => {
      const p = ordered.find((x) => x.id === id);
      return p ? localize(p.name, locale) : '';
    },
    [ordered, locale],
  );
  /** 1-based place in the evaluation order ("#2"). */
  const positionOf = useCallback(
    (id: string | null | undefined) => ordered.findIndex((x) => x.id === id) + 1,
    [ordered],
  );
  return { query: q, ordered, coverage, asCoverage, nameOf, positionOf };
}
