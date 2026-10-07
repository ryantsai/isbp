'use client';

import { Button } from '@isbp/ui/button';
import { useListState } from '@isbp/ui/data-table';
import { Label } from '@isbp/ui/label';
import { SearchInput } from '@isbp/ui/search-input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@isbp/ui/select';
import { Switch } from '@isbp/ui/switch';
import { useTranslations } from 'next-intl';
import { type ReactNode, useId } from 'react';
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

function FilterSelect({
  value,
  onChange,
  label,
  allLabel,
  children,
}: {
  value: string | undefined;
  onChange: (v: string | undefined) => void;
  label: string;
  allLabel: string;
  children: ReactNode;
}) {
  return (
    <Select value={value ?? ALL} onValueChange={(v) => onChange(v === ALL ? undefined : v)}>
      <SelectTrigger className="w-full sm:w-44" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{allLabel}</SelectItem>
        {children}
      </SelectContent>
    </Select>
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
  const switchId = useId();
  const active = KEYS.some((k) => str(k) && !(k === 'closed' && str(k) === 'true'));
  const people = project.members.filter((m) => m.role !== 'viewer');
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2" role="search" aria-label={t('label')}>
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
      >
        <SelectItem value="me">{t('me')}</SelectItem>
        <SelectItem value="none">{t('unassigned')}</SelectItem>
        {people.map((m) => (
          <SelectItem key={m.userId} value={m.userId}>
            {m.displayName}
          </SelectItem>
        ))}
      </FilterSelect>
      {project.milestones.length > 0 && (
        <FilterSelect
          value={str('milestone')}
          onChange={(v) => set({ milestone: v })}
          label={t('milestone')}
          allLabel={t('allMilestones')}
        >
          {project.milestones.map((m) => (
            <SelectItem key={m.id} value={m.id}>
              {m.name}
            </SelectItem>
          ))}
        </FilterSelect>
      )}
      {project.labels.length > 0 && (
        <FilterSelect
          value={str('label')}
          onChange={(v) => set({ label: v })}
          label={t('label')}
          allLabel={t('allLabels')}
        >
          {project.labels.map((l) => (
            <SelectItem key={l} value={l}>
              {l}
            </SelectItem>
          ))}
        </FilterSelect>
      )}
      <FilterSelect
        value={str('type')}
        onChange={(v) => set({ type: v })}
        label={t('type')}
        allLabel={t('allTypes')}
      >
        {TASK_TYPES.map((ty) => (
          <SelectItem key={ty} value={ty}>
            <TaskTypeIcon type={ty} label={false} />
            {tt(ty)}
          </SelectItem>
        ))}
      </FilterSelect>
      {children}
      {extra && (
        <div className="flex items-center gap-2 px-1">
          <Switch
            id={switchId}
            checked={extra === 'cancelled' ? str('cancelled') === 'true' : str('closed') !== 'false'}
            onCheckedChange={(on) =>
              extra === 'cancelled'
                ? set({ cancelled: on ? 'true' : undefined })
                : set({ closed: on ? undefined : 'false' })
            }
          />
          <Label htmlFor={switchId} className="text-sm font-normal">
            {extra === 'cancelled' ? t('showCancelled') : t('showClosed')}
          </Label>
        </div>
      )}
      {active && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => set(Object.fromEntries(KEYS.map((k) => [k, undefined])))}
        >
          {tc('clearFilters')}
        </Button>
      )}
    </div>
  );
}
