'use client';

import type { Role } from '@isbp/contracts';
import { cn } from '@isbp/ui';
import { Button } from '@isbp/ui/button';
import { Card } from '@isbp/ui/card';
import { useListState } from '@isbp/ui/data-table';
import { EmptyState, ErrorState } from '@isbp/ui/empty-state';
import { type FilterDef, FilterBar } from '@isbp/ui/filter-bar';
import { Collapse, CollapseChevron } from '@isbp/ui/motion';
import { SearchInput } from '@isbp/ui/search-input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@isbp/ui/select';
import { Skeleton } from '@isbp/ui/skeleton';
import { PlusIcon, ShieldCheckIcon, ShieldIcon, UsersIcon } from 'lucide-react';
import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import { useApiQuery } from '@/lib/api';
import { RequestBadges } from './request-settings';
import { useRoleText } from './role-utils';

const ALL = '__all__';
const CUSTOM = '__custom__';
const TYPES = ['system', 'custom'] as const;
const REQUESTABLE = ['yes', 'no'] as const;

function RoleRow({ role }: { role: Role }) {
  const t = useTranslations('roles');
  const format = useFormatter();
  const roleText = useRoleText();
  const { name, description } = roleText(role);
  return (
    <li>
      <Link
        href={`/admin/roles/${role.id}`}
        className="group flex min-w-0 flex-col gap-1.5 px-3 py-2.5 outline-none hover:bg-accent/50 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-inset sm:flex-row sm:items-center sm:gap-3"
      >
        <span className="flex min-w-0 flex-1 items-start gap-3">
          <span
            aria-hidden
            className={cn(
              'mt-0.5 grid size-7 shrink-0 place-items-center rounded-md',
              role.isSystem ? 'bg-muted text-muted-foreground' : 'bg-primary/10 text-primary',
            )}
          >
            {role.isSystem ? <ShieldIcon className="size-3.5" /> : <ShieldCheckIcon className="size-3.5" />}
          </span>
          <span className="min-w-0">
            <span className="block font-medium wrap-break-word group-hover:underline">{name}</span>
            <span className="line-clamp-2 text-xs text-muted-foreground sm:line-clamp-1">
              {description || t('card.noDescription')}
            </span>
          </span>
        </span>
        <span className="flex min-w-0 flex-wrap items-center gap-1.5 pl-10 text-xs text-muted-foreground sm:shrink-0 sm:justify-end sm:pl-0">
          <RequestBadges role={role} />
          <span className="inline-flex items-center gap-1 whitespace-nowrap">
            <UsersIcon className="size-3.5" aria-hidden />
            {t('list.assigned', { count: role.assignmentCount, n: format.number(role.assignmentCount) })}
          </span>
        </span>
      </Link>
    </li>
  );
}

function Area({
  id,
  title,
  count,
  open,
  onToggle,
  children,
}: {
  id: string;
  title: string;
  count: number;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  const t = useTranslations('roles.list');
  const contentId = `role-area-${id}`;
  return (
    <section aria-labelledby={`${contentId}-title`} className="overflow-hidden rounded-xl border bg-card">
      <h2 id={`${contentId}-title`} className="text-sm">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={contentId}
          onClick={onToggle}
          className="flex w-full items-center gap-2 px-3 py-2.5 text-left outline-none hover:bg-accent/40 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-inset"
        >
          <span className="min-w-0 flex-1 truncate font-semibold">{title}</span>
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{t('count', { count })}</span>
          <CollapseChevron open={open} />
        </button>
      </h2>
      <Collapse id={contentId} open={open}>
        <div className="border-t">{children}</div>
      </Collapse>
    </section>
  );
}

/**
 * Roles tab: roles grouped by area (custom roles first, then the platform, then each module), each area
 * collapsible, one compact row per role. Filters (search, System/Custom, Requestable) live in the URL. No keys or
 * permission codes here: they are on the role's page.
 */
export function RoleGrid({ onCreate }: { onCreate?: () => void }) {
  const t = useTranslations('roles');
  const tr = useTranslations();
  const roleText = useRoleText();
  const [state, set] = useListState();
  const [opened, setOpened] = useState<Set<string>>(() => new Set([CUSTOM]));
  const { data, isLoading, error, refetch } = useApiQuery<{ items: Role[] }>('/roles');

  const str = (k: string) => (typeof state[k] === 'string' && state[k] ? (state[k] as string) : undefined);
  const q = str('q') ?? '';
  const type = TYPES.find((v) => v === str('type'));
  const requestable = REQUESTABLE.find((v) => v === str('requestable'));
  const filtering = Boolean(q.trim() || type || requestable);
  const clearAll = () => set({ q: undefined, type: undefined, requestable: undefined });

  const filters: FilterDef[] = [
    {
      id: 'type',
      label: t('list.type'),
      primary: true,
      value: type ? t(`list.types.${type}`) : undefined,
      onClear: () => set({ type: undefined }),
      control: (
        <Select value={type ?? ALL} onValueChange={(v) => set({ type: v === ALL ? undefined : v })}>
          <SelectTrigger className="w-full sm:w-40" aria-label={t('list.type')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t('list.types.all')}</SelectItem>
            <SelectSeparator />
            {TYPES.map((v) => (
              <SelectItem key={v} value={v}>
                {t(`list.types.${v}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ),
    },
    {
      id: 'requestable',
      label: t('list.requestable'),
      primary: true,
      value: requestable ? t(`list.requestables.${requestable}`) : undefined,
      onClear: () => set({ requestable: undefined }),
      control: (
        <Select
          value={requestable ?? ALL}
          onValueChange={(v) => set({ requestable: v === ALL ? undefined : v })}
        >
          <SelectTrigger className="w-full sm:w-48" aria-label={t('list.requestable')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t('list.requestables.all')}</SelectItem>
            <SelectSeparator />
            {REQUESTABLE.map((v) => (
              <SelectItem key={v} value={v}>
                {t(`list.requestables.${v}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ),
    },
  ];

  const toolbar = (
    <FilterBar
      search={<SearchInput value={q} onChange={(v) => set({ q: v })} placeholder={t('searchRoles')} />}
      filters={filters}
      onClearAll={filtering ? clearAll : undefined}
    />
  );

  if (isLoading) {
    return (
      <div className="space-y-3" aria-busy>
        <Skeleton className="h-9 w-full sm:w-72" />
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-11 rounded-xl" />
        ))}
      </div>
    );
  }
  if (error || !data) return <ErrorState error={error} onRetry={() => void refetch()} />;

  const needle = q.trim().toLowerCase();
  const roles = data.items.filter((r) => {
    if (type === 'system' && !r.isSystem) return false;
    if (type === 'custom' && r.isSystem) return false;
    if (requestable && r.requestable !== (requestable === 'yes')) return false;
    if (!needle) return true;
    const { name, description } = roleText(r);
    return [name, r.name, description ?? ''].some((s) => s.toLowerCase().includes(needle));
  });

  const areaOf = (r: Role) => (r.moduleId === null || !r.isSystem ? CUSTOM : r.moduleId);
  const areaName = (area: string) =>
    area === CUSTOM
      ? t('customRoles')
      : area === 'core'
        ? t('list.platform')
        : tr.has(`${area}.meta.name`)
          ? tr(`${area}.meta.name`)
          : area;
  const areas = new Map<string, Role[]>();
  for (const r of roles) areas.set(areaOf(r), [...(areas.get(areaOf(r)) ?? []), r]);
  // Custom roles first (the ones your organisation made), then the platform, then modules by name.
  const order = [...areas.keys()].sort((a, b) =>
    a === CUSTOM
      ? -1
      : b === CUSTOM
        ? 1
        : a === 'core'
          ? -1
          : b === 'core'
            ? 1
            : areaName(a).localeCompare(areaName(b)),
  );
  const showCustomEmpty = !filtering && !areas.has(CUSTOM);
  const allOpen = order.every((a) => opened.has(a));
  const toggle = (area: string) =>
    setOpened((prev) => {
      const next = new Set(prev);
      if (next.has(area)) next.delete(area);
      else next.add(area);
      return next;
    });

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">{toolbar}</div>
        {!filtering && order.length > 1 && (
          <Button
            variant="ghost"
            size="sm"
            className="self-start"
            onClick={() => setOpened(allOpen ? new Set() : new Set(order))}
          >
            {allOpen ? t('list.collapseAll') : t('list.expandAll')}
          </Button>
        )}
      </div>

      {filtering && roles.length === 0 && <EmptyState variant="filtered" onClearFilters={clearAll} />}

      {showCustomEmpty && (
        <Card className="py-0">
          <EmptyState
            icon={<ShieldCheckIcon />}
            title={t('noCustomRoles.title')}
            description={t('noCustomRoles.description')}
            action={
              onCreate && (
                <Button variant="outline" onClick={onCreate}>
                  <PlusIcon /> {t('newRole')}
                </Button>
              )
            }
          />
        </Card>
      )}

      <div className="space-y-2">
        {order.map((area) => (
          <Area
            key={area}
            id={area === CUSTOM ? 'custom' : area}
            title={areaName(area)}
            count={areas.get(area)!.length}
            // While filtering, every area with a match is open.
            open={filtering || opened.has(area)}
            onToggle={() => toggle(area)}
          >
            <ul className="divide-y">
              {areas.get(area)!.map((r) => (
                <RoleRow key={r.id} role={r} />
              ))}
            </ul>
          </Area>
        ))}
      </div>
    </div>
  );
}
