'use client';

import { Icon } from '@astryxdesign/core/Icon';
import { Tab, TabList } from '@astryxdesign/core/TabList';
import { useListState } from '@isbp/ui/data-table';
import { PageHeader } from '@isbp/ui/page-header';
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

const panelId = (id: TabId) => `itsm-settings-${id}-panel`;

/** Service desk administration: categories, SLA policies, business calendars and the service catalog. */
export default function SettingsPage() {
  const t = useTranslations('itsm.settingsPage');
  const [state, set] = useListState();
  const tab = (TABS.some((x) => x.id === state.tab) ? state.tab : 'categories') as TabId;
  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />
      <TabList
        role="tablist"
        value={tab}
        hasDivider
        onChange={(v) => set({ tab: v === 'categories' ? undefined : v, edit: undefined, create: undefined })}
      >
        {TABS.map(({ id, icon }) => (
          <Tab
            key={id}
            value={id}
            label={t(`tabs.${id}`)}
            icon={<Icon icon={icon} />}
            panelId={panelId(id)}
          />
        ))}
      </TabList>
      {TABS.map(({ id, Body }) => (
        <div key={id} role="tabpanel" id={panelId(id)} hidden={tab !== id} className="pt-4">
          {tab === id && <Body />}
        </div>
      ))}
    </>
  );
}
