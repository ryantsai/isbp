'use client';

import { Button } from '@astryxdesign/core/Button';
import { Card as SurfaceCard } from '@astryxdesign/core/Card';
import { Collapsible } from '@astryxdesign/core/Collapsible';
import { Icon } from '@astryxdesign/core/Icon';
import { HStack, StackItem, VStack } from '@astryxdesign/core/Layout';
import { List, ListItem } from '@astryxdesign/core/List';
import { Selector } from '@astryxdesign/core/Selector';
import { Text } from '@astryxdesign/core/Text';
import type { Role } from '@isbp/contracts';
import { Card } from '@isbp/ui/card';
import { useListState } from '@isbp/ui/data-table';
import { EmptyState, ErrorState } from '@isbp/ui/empty-state';
import { FilterBar, type FilterDef } from '@isbp/ui/filter-bar';
import { IconTile } from '@isbp/ui/icon-tile';
import { SearchInput } from '@isbp/ui/search-input';
import { Skeleton } from '@isbp/ui/skeleton';
import { PlusIcon, ShieldCheckIcon, ShieldIcon, UsersIcon } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { type ReactNode, useState } from 'react';
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
  // Beside the name on wide screens, under the description on a phone (where the name would shrink to nothing).
  const summary = (
    <HStack gap={1.5} wrap="wrap" vAlign="center" hAlign="end">
      <RequestBadges role={role} />
      <HStack gap={1} vAlign="center">
        <Icon icon={UsersIcon} size="sm" color="secondary" />
        <Text type="supporting">
          {t('list.assigned', { count: role.assignmentCount, n: format.number(role.assignmentCount) })}
        </Text>
      </HStack>
    </HStack>
  );
  return (
    <ListItem
      href={`/admin/roles/${role.id}`}
      label={name}
      description={
        <VStack gap={1}>
          <span>{description || t('card.noDescription')}</span>
          <span className="sm:hidden">{summary}</span>
        </VStack>
      }
      startContent={
        <IconTile size="xs" aria-hidden className={role.isSystem ? 'text-muted-foreground' : undefined}>
          {role.isSystem ? <ShieldIcon /> : <ShieldCheckIcon />}
        </IconTile>
      }
      endContent={<span className="hidden sm:block">{summary}</span>}
    />
  );
}

function Area({
  title,
  count,
  open,
  onToggle,
  children,
}: {
  title: string;
  count: number;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  const t = useTranslations('roles.list');
  return (
    <SurfaceCard padding={0}>
      <Collapsible
        isOpen={open}
        onOpenChange={onToggle}
        trigger={
          <HStack gap={2} vAlign="center" padding={3}>
            <StackItem size="fill">
              <Text weight="semibold" maxLines={1}>
                {title}
              </Text>
            </StackItem>
            <Text type="supporting" hasTabularNumbers>
              {t('count', { count })}
            </Text>
          </HStack>
        }
      >
        {children}
      </Collapsible>
    </SurfaceCard>
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
        <Selector
          label={t('list.type')}
          isLabelHidden
          width={160}
          value={type ?? ALL}
          onChange={(v) => set({ type: v === ALL ? undefined : v })}
          options={[
            { value: ALL, label: t('list.types.all') },
            { type: 'divider' },
            ...TYPES.map((v) => ({ value: v, label: t(`list.types.${v}`) })),
          ]}
        />
      ),
    },
    {
      id: 'requestable',
      label: t('list.requestable'),
      primary: true,
      value: requestable ? t(`list.requestables.${requestable}`) : undefined,
      onClear: () => set({ requestable: undefined }),
      control: (
        <Selector
          label={t('list.requestable')}
          isLabelHidden
          width={192}
          value={requestable ?? ALL}
          onChange={(v) => set({ requestable: v === ALL ? undefined : v })}
          options={[
            { value: ALL, label: t('list.requestables.all') },
            { type: 'divider' },
            ...REQUESTABLE.map((v) => ({ value: v, label: t(`list.requestables.${v}`) })),
          ]}
        />
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
            label={allOpen ? t('list.collapseAll') : t('list.expandAll')}
            variant="ghost"
            size="sm"
            onClick={() => setOpened(allOpen ? new Set() : new Set(order))}
          />
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
                <Button
                  label={t('newRole')}
                  variant="secondary"
                  icon={<Icon icon={PlusIcon} />}
                  onClick={onCreate}
                />
              )
            }
          />
        </Card>
      )}

      <div className="space-y-2">
        {order.map((area) => (
          <Area
            key={area}
            title={areaName(area)}
            count={areas.get(area)!.length}
            // While filtering, every area with a match is open.
            open={filtering || opened.has(area)}
            onToggle={() => toggle(area)}
          >
            <List hasDividers>
              {areas.get(area)!.map((r) => (
                <RoleRow key={r.id} role={r} />
              ))}
            </List>
          </Area>
        ))}
      </div>
    </div>
  );
}
