'use client';

import { Icon } from '@astryxdesign/core/Icon';
import { VStack } from '@astryxdesign/core/Layout';
import { Tab, TabList } from '@astryxdesign/core/TabList';
import { useCan } from '@isbp/sdk/web';
import { EmptyState } from '@isbp/ui/empty-state';
import { PageHeader } from '@isbp/ui/page-header';
import { LockIcon, MailIcon, RadioTowerIcon, ScrollTextIcon } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useId } from 'react';
import { ChannelsPanel } from './channels-panel';
import { DeliveriesPanel } from './deliveries-panel';
import { EmailPanel } from './email-panel';

const TABS = ['channels', 'email', 'log'] as const;
type TabId = (typeof TABS)[number];

/** Admin: where notifications go besides the in-app inbox — chat channels, email and the delivery log. */
export function NotificationsAdminView() {
  const t = useTranslations('notifications.admin');
  const ts = useTranslations('shell');
  const canManage = useCan('core.notifications.manage');
  const panelId = useId();
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const raw = sp.get('tab');
  const tab: TabId = (TABS as readonly string[]).includes(raw ?? '') ? (raw as TabId) : 'channels';

  // Switching tabs drops the delivery log's filters and paging.
  const setTab = (v: string) =>
    router.replace(v === 'channels' ? pathname : `${pathname}?tab=${v}`, { scroll: false });

  if (!canManage) return <EmptyState icon={<LockIcon />} title={ts('forbidden')} />;

  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />
      <VStack gap={4}>
        <TabList role="tablist" aria-label={t('tabs.label')} value={tab} onChange={setTab} hasDivider>
          <Tab
            value="channels"
            panelId={panelId}
            icon={<Icon icon={RadioTowerIcon} />}
            label={t('tabs.channels')}
          />
          <Tab value="email" panelId={panelId} icon={<Icon icon={MailIcon} />} label={t('tabs.email')} />
          <Tab value="log" panelId={panelId} icon={<Icon icon={ScrollTextIcon} />} label={t('tabs.log')} />
        </TabList>
        <div role="tabpanel" id={panelId} aria-label={t(`tabs.${tab}`)}>
          {tab === 'channels' ? <ChannelsPanel /> : tab === 'email' ? <EmailPanel /> : <DeliveriesPanel />}
        </div>
      </VStack>
    </>
  );
}
