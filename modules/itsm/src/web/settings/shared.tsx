'use client';

import { AlertDialog } from '@astryxdesign/core/AlertDialog';
import { Button } from '@astryxdesign/core/Button';
import { CheckboxList, CheckboxListItem } from '@astryxdesign/core/CheckboxList';
import { Icon } from '@astryxdesign/core/Icon';
import { IconButton } from '@astryxdesign/core/IconButton';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { Selector, type SelectorOptionType } from '@astryxdesign/core/Selector';
import { Heading, Text } from '@astryxdesign/core/Text';
import { localize } from '@isbp/sdk';
import { useListState } from '@isbp/ui/data-table';
import { useApiQuery } from '@isbp/ui/query';
import { ArrowDownIcon, ArrowUpIcon, Trash2Icon } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { type ReactNode, useCallback, useMemo, useState } from 'react';
import { type SlaPolicy, type TicketType, ticketTypeSchema } from '../../contracts';
import type { CoverageContext, CoveragePolicy } from '../../sla-coverage';
import { TYPE_ICON } from '../components/badges';
import { useCategories, useGroups } from '../lib';

/** One tab of the settings page: a titled section with a one-line description and its primary action. */
export function SettingsSection({
  id,
  title,
  description,
  action,
  children,
}: {
  id: string;
  title: string;
  description: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <VStack as="section" gap={4} aria-labelledby={id}>
      <HStack gap={3} wrap="wrap" hAlign="between" vAlign="end">
        <VStack gap={0.5}>
          <Heading level={2} id={id}>
            {title}
          </Heading>
          <Text as="p" type="supporting">
            {description}
          </Text>
        </VStack>
        {action}
      </HStack>
      {children}
    </VStack>
  );
}

/** A short group of checkboxes (ticket types, pause statuses); `error` shows under the group. */
export function CheckGroup<T extends string>({
  options,
  value,
  onChange,
  label,
  render,
  error,
}: {
  options: readonly T[];
  value: readonly T[];
  onChange: (v: T[]) => void;
  label: string;
  render: (o: T) => ReactNode;
  error?: string;
}) {
  return (
    <CheckboxList
      label={label}
      density="compact"
      value={[...value]}
      onChange={(next) => onChange(options.filter((o) => next.includes(o)))}
      status={error ? { type: 'error', message: error } : undefined}
    >
      {options.map((o) => (
        <CheckboxListItem key={o} value={o} label={render(o)} />
      ))}
    </CheckboxList>
  );
}

export function TypeChecks({
  value,
  onChange,
  label,
  invalid,
}: {
  value: readonly TicketType[];
  onChange: (v: TicketType[]) => void;
  label: string;
  invalid?: boolean;
}) {
  const t = useTranslations('itsm.typesPlural');
  const tc = useTranslations('itsm.settingsPage.categories');
  return (
    <CheckGroup
      options={ticketTypeSchema.options}
      value={value}
      onChange={onChange}
      label={label}
      error={invalid ? tc('typesRequired') : undefined}
      render={(o) => (
        <HStack gap={1.5} vAlign="center">
          <Icon icon={TYPE_ICON[o]} size="sm" color="secondary" />
          <Text>{t(o)}</Text>
        </HStack>
      )}
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
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        label={tc('delete')}
        variant="ghost"
        icon={<Icon icon={Trash2Icon} />}
        isLoading={pending}
        className="sm:mr-auto"
        onClick={() => setOpen(true)}
      />
      <AlertDialog
        isOpen={open}
        onOpenChange={setOpen}
        title={title}
        description={description}
        actionLabel={tc('delete')}
        cancelLabel={tc('cancel')}
        onAction={() => {
          setOpen(false);
          onConfirm();
        }}
      />
    </>
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
  // `tooltip` makes Astryx disable these with aria-disabled instead of `disabled`, so the focused button keeps focus
  // while the new order is being saved (a `disabled` button drops it and the keyboard user loses their place).
  return (
    <HStack gap={0.5}>
      <IconButton
        label={t('moveUp', { name })}
        variant="ghost"
        size="sm"
        icon={<Icon icon={ArrowUpIcon} />}
        isDisabled={first || pending}
        tooltip={t('moveUp', { name })}
        id={`${idPrefix}-up`}
        onClick={() => onMove(-1)}
      />
      <IconButton
        label={t('moveDown', { name })}
        variant="ghost"
        size="sm"
        icon={<Icon icon={ArrowDownIcon} />}
        isDisabled={last || pending}
        tooltip={t('moveDown', { name })}
        id={`${idPrefix}-down`}
        onClick={() => onMove(1)}
      />
    </HStack>
  );
}

const isOff = (el: HTMLElement | null) =>
  !el || (el as HTMLButtonElement).disabled || el.getAttribute('aria-disabled') === 'true';

/** After a reorder, focus the moved row's button again (or the other one when it reached an end). */
export function refocus(idPrefix: string, direction: -1 | 1) {
  requestAnimationFrame(() => {
    const preferred = document.getElementById(`${idPrefix}-${direction < 0 ? 'up' : 'down'}`);
    const other = document.getElementById(`${idPrefix}-${direction < 0 ? 'down' : 'up'}`);
    const target = !isOff(preferred) ? preferred : other;
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

const NO_GROUP = '__none__';

/** Groups for a default/fulfilment group: service desk groups first, then the others. */
export function DefaultGroupSelect({
  label,
  description,
  value,
  onChange,
}: {
  label: string;
  description?: string;
  value: string | null;
  onChange: (id: string | null) => void;
}) {
  const t = useTranslations('itsm.settingsPage');
  const tc = useTranslations('itsm.common');
  const { groups } = useGroups();
  const working = groups.filter((g) => g.worksTickets);
  const others = groups.filter((g) => !g.worksTickets);
  const options: SelectorOptionType[] = [{ value: NO_GROUP, label: tc('noGroup') }];
  if (working.length)
    options.push({
      type: 'section',
      title: t('serviceDeskGroups'),
      options: working.map((g) => ({ value: g.id, label: g.name })),
    });
  if (others.length)
    options.push({
      type: 'section',
      title: t('otherGroups'),
      options: others.map((g) => ({ value: g.id, label: g.name })),
    });
  return (
    <Selector
      label={label}
      description={description}
      options={options}
      value={value ?? NO_GROUP}
      onChange={(v) => onChange(v === NO_GROUP ? null : v)}
    />
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
