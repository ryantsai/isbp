'use client';

import type { Application } from '@isbp/contracts';
import { useCan } from '@isbp/sdk/web';
import { UserAvatar } from '@isbp/ui/avatar';
import { Badge } from '@isbp/ui/badge';
import { Button } from '@isbp/ui/button';
import { EmptyState } from '@isbp/ui/empty-state';
import { FadeIn } from '@isbp/ui/motion';
import { Skeleton } from '@isbp/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@isbp/ui/tabs';
import {
  AppWindowIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  ExternalLinkIcon,
  KeyRoundIcon,
  LayoutDashboardIcon,
  ScanSearchIcon,
  ShieldCheckIcon,
  UsersIcon,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useApiQuery } from '@/lib/api';
import { AppAccessPanel } from './app-access-panel';
import { AppTile, useAppText } from './app-parts';
import { AppPermissionsPanel } from './app-permissions-panel';
import { AppRolesPanel } from './app-roles-panel';
import { AppOverviewPanel } from './overview-panel';
import { RoleQueryConsole } from './role-query-console';

const TABS = ['overview', 'roles', 'permissions', 'access', 'query'] as const;
type Tab = (typeof TABS)[number];

/** List state of the "People with access" table — dropped when switching tabs. */
const LIST_KEYS = ['page', 'pageSize', 'sort', 'q', 'roleId'];

function CountBadge({ value }: { value: number }) {
  return (
    <Badge variant="muted" className="px-1.5 tabular-nums">
      {value.toLocaleString()}
    </Badge>
  );
}

export function ApplicationDetailView({ id }: { id: string }) {
  const t = useTranslations('applications');
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
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

  const back = (
    <Button variant="ghost" size="sm" asChild className="-ml-2 text-muted-foreground">
      <Link href="/admin/applications">
        <ArrowLeftIcon /> {t('title')}
      </Link>
    </Button>
  );

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

  return (
    <div className="space-y-5">
      {back}

      <FadeIn y={4} className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <AppTile app={app} size="lg" />
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="min-w-0 truncate text-xl font-semibold tracking-tight">{name}</h1>
            {app.isSystem && <Badge>{t('platform.badge')}</Badge>}
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{app.key}</code>
            {app.owner && (
              <span className="inline-flex min-w-0 items-center gap-1.5">
                <UserAvatar
                  name={app.owner.displayName}
                  src={app.owner.avatarUrl}
                  className="size-5 text-[9px]"
                />
                <span className="truncate">{t('card.owner', { name: app.owner.displayName })}</span>
              </span>
            )}
          </div>
          {description && <p className="max-w-3xl text-sm text-muted-foreground">{description}</p>}
        </div>
        {app.homepageUrl && (
          <Button variant="outline" asChild className="shrink-0 self-start">
            <a href={app.homepageUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLinkIcon /> {t('detail.openApp')}
              <span className="sr-only"> ({t('detail.newTab')})</span>
            </a>
          </Button>
        )}
      </FadeIn>

      {app.isSystem ? (
        <FadeIn
          delay={0.05}
          className="flex flex-col items-start gap-3 rounded-xl border bg-muted/40 p-4 sm:flex-row sm:items-center"
        >
          <div className="min-w-0 flex-1 space-y-1">
            <p className="font-medium">{t('platform.title')}</p>
            <p className="text-sm text-muted-foreground">{t('platform.notice')}</p>
          </div>
          <Button asChild>
            <Link href="/admin/roles">
              {t('platform.manage')} <ArrowRightIcon />
            </Link>
          </Button>
        </FadeIn>
      ) : (
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="w-full sm:w-fit">
            <TabsTrigger value="overview">
              <LayoutDashboardIcon /> {t('tabs.overview')}
            </TabsTrigger>
            <TabsTrigger value="roles">
              <ShieldCheckIcon /> {t('tabs.roles')}
              <CountBadge value={app.counts.roles} />
            </TabsTrigger>
            <TabsTrigger value="permissions">
              <KeyRoundIcon /> {t('tabs.permissions')}
              <CountBadge value={app.counts.permissions} />
            </TabsTrigger>
            <TabsTrigger value="access">
              <UsersIcon /> {t('tabs.access')}
              <CountBadge value={app.counts.members} />
            </TabsTrigger>
            {canQuery && (
              <TabsTrigger value="query">
                <ScanSearchIcon /> {t('tabs.query')}
              </TabsTrigger>
            )}
          </TabsList>
          <TabsContent value="overview">
            <AppOverviewPanel app={app} onTab={setTab} />
          </TabsContent>
          <TabsContent value="roles">
            <AppRolesPanel app={app} />
          </TabsContent>
          <TabsContent value="permissions">
            <AppPermissionsPanel app={app} />
          </TabsContent>
          <TabsContent value="access">
            <AppAccessPanel app={app} />
          </TabsContent>
          {canQuery && (
            <TabsContent value="query">
              <RoleQueryConsole app={app} />
            </TabsContent>
          )}
        </Tabs>
      )}
    </div>
  );
}
