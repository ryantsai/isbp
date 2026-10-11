'use client';

import { Tab, TabList } from '@astryxdesign/core/TabList';
import { useListState } from '@isbp/ui/data-table';
import { useTranslations } from 'next-intl';
import { useId } from 'react';
import type { RunView } from '../../contracts';
import { RunsTable } from '../runs-table';
import { SchedulerHeader } from '../section-header';

const VIEWS: RunView[] = ['all', 'failed', 'active'];

/** Every job's runs, newest first: failed and in-progress views, filters by status, trigger and period. */
export default function RunsPage() {
  const t = useTranslations('scheduler');
  const [state, set] = useListState({ pageSize: 25 });
  const panelId = useId();
  const view: RunView = VIEWS.includes(state.view as RunView) ? (state.view as RunView) : 'all';
  return (
    <>
      <SchedulerHeader description={t('runs.description')} />
      <TabList
        role="tablist"
        value={view}
        onChange={(v) => set({ view: v === 'all' ? undefined : v, status: undefined })}
      >
        {VIEWS.map((v) => (
          <Tab key={v} value={v} label={t(`runs.views.${v}`)} panelId={panelId} />
        ))}
      </TabList>
      {/* Each tab only filters the same list, so one panel serves them all. */}
      <div role="tabpanel" id={panelId} aria-label={t(`runs.views.${view}`)} className="min-w-0">
        <RunsTable view={view} label={t('runs.title')} />
      </div>
    </>
  );
}
