'use client';

import type { Application } from '@isbp/contracts';
import { UserAvatar } from '@isbp/ui/avatar';
import { Card, CardContent } from '@isbp/ui/card';
import { useListState } from '@isbp/ui/data-table';
import { EmptyState } from '@isbp/ui/empty-state';
import { Stagger, StaggerItem } from '@isbp/ui/motion';
import { PageHeader } from '@isbp/ui/page-header';
import { SearchInput } from '@isbp/ui/search-input';
import { Skeleton } from '@isbp/ui/skeleton';
import {
  AppWindowIcon,
  ArrowRightIcon,
  KeyRoundIcon,
  PlugIcon,
  PlusIcon,
  SearchXIcon,
  ShieldCheckIcon,
  UsersIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { useApiQuery } from '@/lib/api';
import { AppTile, useAppText, useCanGlobal } from './app-parts';
import { ApplicationFormDialog } from './application-form';
import { Button } from '@astryxdesign/core/Button';
import { Badge } from '@astryxdesign/core/Badge';
import { Icon } from '@astryxdesign/core/Icon';

const GRID = 'grid gap-4 sm:grid-cols-2 xl:grid-cols-3';

function Stat({ icon, value, label }: { icon: ReactNode; value: number; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5" title={label}>
      <span className="text-muted-foreground [&_svg]:size-3.5" aria-hidden>
        {icon}
      </span>
      <span className="font-medium text-foreground tabular-nums">{value.toLocaleString()}</span>
      <span className="sr-only">{label}</span>
      <span aria-hidden className="hidden truncate sm:inline">
        {label}
      </span>
    </span>
  );
}

function Counts({ app }: { app: Application }) {
  const t = useTranslations('applications.card');
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 border-t pt-3 text-xs text-muted-foreground">
      <Stat
        icon={<ShieldCheckIcon />}
        value={app.counts.roles}
        label={t('roles', { count: app.counts.roles })}
      />
      <Stat
        icon={<KeyRoundIcon />}
        value={app.counts.permissions}
        label={t('permissions', { count: app.counts.permissions })}
      />
      <Stat
        icon={<UsersIcon />}
        value={app.counts.members}
        label={t('members', { count: app.counts.members })}
      />
      <Stat
        icon={<PlugIcon />}
        value={app.counts.clients}
        label={t('clients', { count: app.counts.clients })}
      />
    </div>
  );
}

const cardLink =
  'group block h-full rounded-xl outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50';
const cardHover =
  'h-full gap-0 py-0 transition-all duration-200 group-hover:-translate-y-0.5 group-hover:border-ring/30 group-hover:shadow-md motion-reduce:group-hover:translate-y-0';

function PlatformCard({ app }: { app: Application }) {
  const t = useTranslations('applications');
  const appText = useAppText();
  const { name, description } = appText(app);
  return (
    <StaggerItem className="h-full">
      <Link href="/admin/roles" className={cardLink}>
        <Card
          className={`${cardHover} border-primary/30 bg-gradient-to-br from-primary/[0.07] via-card to-card`}
        >
          <CardContent className="flex h-full flex-col gap-3 p-4">
            <div className="flex items-start gap-3">
              <AppTile app={app} className="transition-transform duration-200 group-hover:scale-105" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <h3 className="truncate font-medium">{name}</h3>
                  <Badge variant="info" label={t('platform.badge')} className="shrink-0" />
                </div>
                <code className="block truncate font-mono text-xs text-muted-foreground">{app.key}</code>
              </div>
            </div>
            <p className="line-clamp-2 text-sm text-muted-foreground">{description}</p>
            <span className="mt-auto inline-flex items-center gap-1 text-sm font-medium text-primary">
              {t('platform.manage')}
              <ArrowRightIcon
                className="size-4 transition-transform duration-200 group-hover:translate-x-0.5"
                aria-hidden
              />
            </span>
            <Counts app={app} />
          </CardContent>
        </Card>
      </Link>
    </StaggerItem>
  );
}

function AppCard({ app }: { app: Application }) {
  const t = useTranslations('applications');
  return (
    <StaggerItem className="h-full">
      <Link href={`/admin/applications/${app.id}`} className={cardLink}>
        <Card className={cardHover}>
          <CardContent className="flex h-full flex-col gap-3 p-4">
            <div className="flex items-start gap-3">
              <AppTile app={app} className="transition-transform duration-200 group-hover:scale-105" />
              <div className="min-w-0 flex-1">
                <h3 className="truncate font-medium">{app.name}</h3>
                <code className="block truncate font-mono text-xs text-muted-foreground">{app.key}</code>
              </div>
            </div>
            <p className="line-clamp-2 text-sm text-muted-foreground">
              {app.description || t('card.noDescription')}
            </p>
            <div className="mt-auto flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
              {app.owner ? (
                <>
                  <UserAvatar
                    name={app.owner.displayName}
                    src={app.owner.avatarUrl}
                    className="size-5 text-[9px]"
                  />
                  <span className="truncate">{t('card.owner', { name: app.owner.displayName })}</span>
                </>
              ) : (
                <span>{t('card.noOwner')}</span>
              )}
            </div>
            <Counts app={app} />
          </CardContent>
        </Card>
      </Link>
    </StaggerItem>
  );
}

/** `/admin/applications`: the platform card plus one card per external application; `?create=1` opens "Register". */
export function ApplicationsView() {
  const t = useTranslations('applications');
  const router = useRouter();
  const sp = useSearchParams();
  const [state, set] = useListState();
  const canCreate = useCanGlobal('core.applications.manage');
  const { data, isLoading } = useApiQuery<{ items: Application[] }>('/applications', { q: state.q });

  const createOpen = canCreate && sp.get('create') === '1';
  const setCreateOpen = (open: boolean) => {
    const next = new URLSearchParams(sp.toString());
    if (open) next.set('create', '1');
    else next.delete('create');
    router.replace(`/admin/applications${next.size ? `?${next}` : ''}`, { scroll: false });
  };

  const items = data?.items ?? [];
  const platform = items.find((a) => a.isSystem);
  const apps = items.filter((a) => !a.isSystem);
  const q = state.q ?? '';

  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={
          canCreate && (
            <Button
              label={t('register')}
              variant="primary"
              icon={<Icon icon={PlusIcon} />}
              onClick={() => setCreateOpen(true)}
            />
          )
        }
      />
      <div className="space-y-5">
        <SearchInput value={q} onChange={(v) => set({ q: v || undefined })} placeholder={t('search')} />

        {isLoading || !data ? (
          <div className={GRID} aria-busy>
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-56 rounded-xl" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <Card className="py-0">
            {q ? (
              <EmptyState icon={<SearchXIcon />} title={t('noMatch', { q })} />
            ) : (
              <EmptyState
                icon={<AppWindowIcon />}
                title={t('empty.title')}
                description={t('empty.description')}
                action={
                  canCreate && (
                    <Button
                      label={t('register')}
                      variant="secondary"
                      icon={<Icon icon={PlusIcon} />}
                      onClick={() => setCreateOpen(true)}
                    />
                  )
                }
              />
            )}
          </Card>
        ) : (
          <Stagger className={GRID} key={q}>
            {platform && <PlatformCard app={platform} />}
            {apps.map((a) => (
              <AppCard key={a.id} app={a} />
            ))}
            {!q && apps.length === 0 && (
              <StaggerItem className="h-full">
                <Card className="h-full border-dashed py-0 shadow-none">
                  <EmptyState
                    icon={<AppWindowIcon />}
                    title={t('empty.title')}
                    description={t('empty.description')}
                    action={
                      canCreate && (
                        <Button
                          label={t('register')}
                          variant="secondary"
                          size="sm"
                          icon={<Icon icon={PlusIcon} />}
                          onClick={() => setCreateOpen(true)}
                        />
                      )
                    }
                    className="py-6"
                  />
                </Card>
              </StaggerItem>
            )}
          </Stagger>
        )}
      </div>
      {canCreate && <ApplicationFormDialog open={createOpen} onOpenChange={setCreateOpen} />}
    </>
  );
}
