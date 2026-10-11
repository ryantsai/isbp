'use client';

import { Badge } from '@astryxdesign/core/Badge';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Icon } from '@astryxdesign/core/Icon';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { Tab, TabList } from '@astryxdesign/core/TabList';
import { Heading, Text } from '@astryxdesign/core/Text';
import type { Application } from '@isbp/contracts';
import { useCan } from '@isbp/sdk/web';
import { UserAvatar } from '@isbp/ui/avatar';
import { EmptyState } from '@isbp/ui/empty-state';
import { FadeIn } from '@isbp/ui/motion';
import { BackLink } from '@isbp/ui/page-header';
import { Skeleton } from '@isbp/ui/skeleton';
import {
  AppWindowIcon,
  ArrowRightIcon,
  ExternalLinkIcon,
  KeyRoundIcon,
  LayoutDashboardIcon,
  ScanSearchIcon,
  ShieldCheckIcon,
  UsersIcon,
} from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useId } from 'react';
import { useApiQuery } from '@/lib/api';
import { AppAccessPanel } from './app-access-panel';
import { AppTile, useAppText } from './app-parts';
import { AppPermissionsPanel } from './app-permissions-panel';
import { AppRolesPanel } from './app-roles-panel';
import { AppOverviewPanel } from './overview-panel';
import { RoleQueryConsole } from './role-query-console';

const TABS = ['overview', 'roles', 'permissions', 'access', 'query'] as const;
type Tab = (typeof TABS)[number];

const TAB_ICONS = {
  overview: LayoutDashboardIcon,
  roles: ShieldCheckIcon,
  permissions: KeyRoundIcon,
  access: UsersIcon,
  query: ScanSearchIcon,
} as const;

/** List state of the "People with access" table — dropped when switching tabs. */
const LIST_KEYS = ['page', 'pageSize', 'sort', 'q', 'roleId'];

export function ApplicationDetailView({ id }: { id: string }) {
  const t = useTranslations('applications');
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const panelId = useId();
  const appText = useAppText();
  const { data: app, isLoading, error } = useApiQuery<Application>(`/applications/${id}`);
  const canQuery = useCan('core.role-query.read', { recordType: 'application', recordId: id });
  const raw = sp.get('tab') as Tab | null;
  const tab: Tab = raw && TABS.includes(raw) && (raw !== 'query' || canQuery) ? raw : 'overview';

  const setTab = (next: string) => {
    const params = new URLSearchParams(sp.toString());
    for (const k of LIST_KEYS) params.delete(k);
    if (next === 'overview') params.delete('tab');
    else params.set('tab', next);
    router.replace(params.size ? `${pathname}?${params}` : pathname, { scroll: false });
  };

  const back = <BackLink href="/admin/applications" label={t('title')} />;

  if (isLoading) {
    return (
      <div className="space-y-5" aria-busy>
        {back}
        <div className="flex items-center gap-4">
          <Skeleton className="size-14 rounded-xl" />
          <div className="space-y-2">
            <Skeleton className="h-6 w-56" />
            <Skeleton className="h-4 w-72" />
          </div>
        </div>
        <Skeleton className="h-9 w-full max-w-xl" />
        <Skeleton className="h-72 w-full rounded-xl" />
      </div>
    );
  }
  if (error || !app) {
    return (
      <div className="space-y-5">
        {back}
        <EmptyState
          icon={<AppWindowIcon />}
          title={t('detail.notFound')}
          description={t('detail.notFoundDescription')}
        />
      </div>
    );
  }

  const { name, description } = appText(app);
  const counts: Partial<Record<Tab, number>> = {
    roles: app.counts.roles,
    permissions: app.counts.permissions,
    access: app.counts.members,
  };

  return (
    <div className="space-y-5">
      {back}

      <FadeIn y={4} className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <AppTile app={app} size="lg" />
        <div className="min-w-0 flex-1">
          <VStack gap={1.5}>
            <HStack gap={2} wrap="wrap" vAlign="center">
              <Heading level={1}>{name}</Heading>
              {app.isSystem && <Badge variant="info" label={t('platform.badge')} />}
            </HStack>
            <HStack gap={3} wrap="wrap" vAlign="center">
              <Text type="code">{app.key}</Text>
              {app.owner && (
                <HStack gap={1.5} vAlign="center">
                  <UserAvatar
                    name={app.owner.displayName}
                    src={app.owner.avatarUrl}
                    className="size-5 text-[9px]"
                  />
                  <Text type="supporting">{t('card.owner', { name: app.owner.displayName })}</Text>
                </HStack>
              )}
            </HStack>
            {description && <Text color="secondary">{description}</Text>}
          </VStack>
        </div>
        {app.homepageUrl && (
          <Button
            label={t('detail.openApp')}
            variant="secondary"
            icon={<Icon icon={ExternalLinkIcon} />}
            href={app.homepageUrl}
            target="_blank"
            rel="noopener noreferrer"
            tooltip={t('detail.newTab')}
          />
        )}
      </FadeIn>

      {app.isSystem ? (
        <FadeIn delay={0.05}>
          <Banner
            status="info"
            title={t('platform.title')}
            description={t('platform.notice')}
            endContent={
              <Button
                label={t('platform.manage')}
                variant="primary"
                endContent={<Icon icon={ArrowRightIcon} />}
                href="/admin/roles"
              />
            }
            collapsible={false}
          />
        </FadeIn>
      ) : (
        <VStack gap={4}>
          <TabList role="tablist" aria-label={name} value={tab} onChange={setTab} hasDivider>
            {TABS.filter((key) => key !== 'query' || canQuery).map((key) => (
              <Tab
                key={key}
                value={key}
                label={t(`tabs.${key}`)}
                icon={<Icon icon={TAB_ICONS[key]} />}
                panelId={panelId}
                endContent={
                  counts[key] !== undefined ? (
                    <Badge variant="neutral" label={counts[key].toLocaleString()} />
                  ) : undefined
                }
              />
            ))}
          </TabList>
          <div role="tabpanel" id={panelId} aria-label={t(`tabs.${tab}`)}>
            {tab === 'overview' && <AppOverviewPanel app={app} onTab={setTab} />}
            {tab === 'roles' && <AppRolesPanel app={app} />}
            {tab === 'permissions' && <AppPermissionsPanel app={app} />}
            {tab === 'access' && <AppAccessPanel app={app} />}
            {tab === 'query' && canQuery && <RoleQueryConsole app={app} />}
          </div>
        </VStack>
      )}
    </div>
  );
}
