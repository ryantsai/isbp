'use client';

import { useCan } from '@isbp/sdk/web';
import { EmptyState } from '@isbp/ui/empty-state';
import { PageHeader } from '@isbp/ui/page-header';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@isbp/ui/tabs';
import { LockIcon, MailIcon, RadioTowerIcon, ScrollTextIcon } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ChannelsPanel } from './channels-panel';
import { DeliveriesPanel } from './deliveries-panel';
import { EmailPanel } from './email-panel';

const TABS = ['channels', 'email', 'log'] as const;
type Tab = (typeof TABS)[number];

/** Admin: where notifications go besides the in-app inbox — chat channels, email and the delivery log. */
export function NotificationsAdminView() {
  const t = useTranslations('notifications.admin');
  const ts = useTranslations('shell');
  const canManage = useCan('core.notifications.manage');
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const raw = sp.get('tab');
  const tab: Tab = (TABS as readonly string[]).includes(raw ?? '') ? (raw as Tab) : 'channels';

  // Switching tabs drops the delivery log's filters and paging.
  const setTab = (v: string) =>
    router.replace(v === 'channels' ? pathname : `${pathname}?tab=${v}`, { scroll: false });

  if (!canManage) return <EmptyState icon={<LockIcon />} title={ts('forbidden')} />;

  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList aria-label={t('tabs.label')}>
          <TabsTrigger value="channels">
            <RadioTowerIcon /> {t('tabs.channels')}
          </TabsTrigger>
          <TabsTrigger value="email">
            <MailIcon /> {t('tabs.email')}
          </TabsTrigger>
          <TabsTrigger value="log">
            <ScrollTextIcon /> {t('tabs.log')}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="channels">
          <ChannelsPanel />
        </TabsContent>
        <TabsContent value="email">
          <EmailPanel />
        </TabsContent>
        <TabsContent value="log">
          <DeliveriesPanel />
        </TabsContent>
      </Tabs>
    </>
  );
}
