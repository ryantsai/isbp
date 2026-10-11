'use client';

import { Button } from '@astryxdesign/core/Button';
import { HStack } from '@astryxdesign/core/Layout';
import { Selector } from '@astryxdesign/core/Selector';
import { Switch } from '@astryxdesign/core/Switch';
import { useListState } from '@isbp/ui/data-table';
import { SearchInput } from '@isbp/ui/search-input';
import { useTranslations } from 'next-intl';
import type { ComponentProps, ReactNode } from 'react';
import { type ProjectDetail, TASK_TYPES } from '../../contracts';
import { TaskTypeIcon } from '../components/badges';

const ALL = '__all__';
const KEYS = [
  'q',
  'assignee',
  'milestone',
  'label',
  'type',
  'status',
  'priority',
  'cancelled',
  'closed',
] as const;

/** Board, list and timeline share one set of filters, kept in the URL. */
export function useTaskFilters() {
  const [state, set] = useListState();
  const str = (k: string) => (state[k] as string | undefined) || undefined;
  const query = {
    q: str('q'),
    assignee: str('assignee'),
    milestone: str('milestone'),
    label: str('label'),
    type: str('type'),
  };
  return { state, set, str, query };
}

type Option = { value: string; label: string; icon?: ReactNode };

/** A filter dropdown whose first entry means "no filter" (the URL parameter is removed). */
export function FilterSelect({
  value,
  onChange,
  label,
  allLabel,
  options,
  width = 176,
}: {
  value: string | undefined;
  onChange: (v: string | undefined) => void;
  label: string;
  allLabel: string;
  options: Option[];
  width?: ComponentProps<typeof Selector>['width'];
}) {
  return (
    <Selector
      label={label}
      isLabelHidden
      width={width}
      value={value ?? ALL}
      onChange={(v) => onChange(v === ALL ? undefined : v)}
      options={[{ value: ALL, label: allLabel }, ...options]}
    />
  );
}

export function TaskFilters({
  project,
  extra,
  children,
}: {
  project: ProjectDetail;
  /** A switch for `cancelled` (board) or `closed` (timeline) work. */
  extra?: 'cancelled' | 'closed';
  children?: ReactNode;
}) {
  const t = useTranslations('projects.filters');
  const tt = useTranslations('projects.taskType');
  const tc = useTranslations('common');
  const { state, set, str } = useTaskFilters();
  const active = KEYS.some((k) => str(k) && !(k === 'closed' && str(k) === 'true'));
  const people = project.members.filter((m) => m.role !== 'viewer');
  return (
    <HStack gap={2} vAlign="center" wrap="wrap" role="search" aria-label={t('label')}>
      <SearchInput
        value={state.q ?? ''}
        onChange={(q) => set({ q })}
        placeholder={t('search')}
        className="sm:w-60"
      />
      <FilterSelect
        value={str('assignee')}
        onChange={(v) => set({ assignee: v })}
        label={t('assignee')}
        allLabel={t('anyone')}
        options={[
          { value: 'me', label: t('me') },
          { value: 'none', label: t('unassigned') },
          ...people.map((m) => ({ value: m.userId, label: m.displayName })),
        ]}
      />
      {project.milestones.length > 0 && (
        <FilterSelect
          value={str('milestone')}
          onChange={(v) => set({ milestone: v })}
          label={t('milestone')}
          allLabel={t('allMilestones')}
          options={project.milestones.map((m) => ({ value: m.id, label: m.name }))}
        />
      )}
      {project.labels.length > 0 && (
        <FilterSelect
          value={str('label')}
          onChange={(v) => set({ label: v })}
          label={t('label')}
          allLabel={t('allLabels')}
          options={project.labels.map((l) => ({ value: l, label: l }))}
        />
      )}
      <FilterSelect
        value={str('type')}
        onChange={(v) => set({ type: v })}
        label={t('type')}
        allLabel={t('allTypes')}
        options={TASK_TYPES.map((ty) => ({
          value: ty,
          label: tt(ty),
          icon: <TaskTypeIcon type={ty} label={false} />,
        }))}
      />
      {children}
      {extra && (
        <Switch
          label={extra === 'cancelled' ? t('showCancelled') : t('showClosed')}
          value={extra === 'cancelled' ? str('cancelled') === 'true' : str('closed') !== 'false'}
          onChange={(on) =>
            extra === 'cancelled'
              ? set({ cancelled: on ? 'true' : undefined })
              : set({ closed: on ? undefined : 'false' })
          }
        />
      )}
      {active && (
        <Button
          label={tc('clearFilters')}
          variant="ghost"
          size="sm"
          onClick={() => set(Object.fromEntries(KEYS.map((k) => [k, undefined])))}
        />
      )}
    </HStack>
  );
}
