'use client';

import { useListState } from '@isbp/ui/data-table';
import { PageHeader } from '@isbp/ui/page-header';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@isbp/ui/tabs';
import { useTranslations } from 'next-intl';
import type { RunView } from '../../contracts';
import { RunsTable } from '../runs-table';

const VIEWS: RunView[] = ['all', 'failed', 'active'];

/** Every job's runs, newest first: failed and in-progress views, filters by status, trigger and period. */
export default function RunsPage() {
  const t = useTranslations('scheduler');
  const [state, set] = useListState({ pageSize: 25 });
  const view: RunView = VIEWS.includes(state.view as RunView) ? (state.view as RunView) : 'all';
  return (
    <>
      <PageHeader title={t('runs.title')} description={t('runs.description')} />
      <Tabs
        value={view}
        onValueChange={(v) => set({ view: v === 'all' ? undefined : v, status: undefined })}
        className="min-w-0"
      >
        <TabsList>
          {VIEWS.map((v) => (
            <TabsTrigger key={v} value={v}>
              {t(`runs.views.${v}`)}
            </TabsTrigger>
          ))}
        </TabsList>
        {/* Each tab only filters the same list; every tab still has its panel. */}
        {VIEWS.map((v) => (
          <TabsContent key={v} value={v} className="min-w-0">
            {v === view && <RunsTable view={view} label={t('runs.title')} />}
          </TabsContent>
        ))}
      </Tabs>
    </>
  );
}
