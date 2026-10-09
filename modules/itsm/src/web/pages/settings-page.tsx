'use client';

import { useListState } from '@isbp/ui/data-table';
import { PageHeader } from '@isbp/ui/page-header';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@isbp/ui/tabs';
import { CalendarClockIcon, FolderTreeIcon, StoreIcon, TimerIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { CalendarsTab } from '../settings/calendars-tab';
import { CatalogTab } from '../settings/catalog-tab';
import { CategoriesTab } from '../settings/categories-tab';
import { SlaTab } from '../settings/sla-tab';

const TABS = [
  { id: 'categories', icon: FolderTreeIcon, Body: CategoriesTab },
  { id: 'sla', icon: TimerIcon, Body: SlaTab },
  { id: 'calendars', icon: CalendarClockIcon, Body: CalendarsTab },
  { id: 'catalog', icon: StoreIcon, Body: CatalogTab },
] as const;
type TabId = (typeof TABS)[number]['id'];

/** Service desk administration: categories, SLA policies, business calendars and the service catalog. */
export default function SettingsPage() {
  const t = useTranslations('itsm.settingsPage');
  const [state, set] = useListState();
  const tab = (TABS.some((x) => x.id === state.tab) ? state.tab : 'categories') as TabId;
  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />
      <Tabs
        value={tab}
        onValueChange={(v) =>
          set({ tab: v === 'categories' ? undefined : v, edit: undefined, create: undefined })
        }
      >
        <TabsList>
          {TABS.map(({ id, icon: Icon }) => (
            <TabsTrigger key={id} value={id}>
              <Icon aria-hidden />
              {t(`tabs.${id}`)}
            </TabsTrigger>
          ))}
        </TabsList>
        {TABS.map(({ id, Body }) => (
          <TabsContent key={id} value={id}>
            {tab === id && <Body />}
          </TabsContent>
        ))}
      </Tabs>
    </>
  );
}
