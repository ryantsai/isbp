'use client';

import type { Dashboard, NavItem } from '@isbp/contracts';
import { useCan } from '@isbp/sdk/web';
import { Button } from '@isbp/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@isbp/ui/card';
import { EmptyState, ErrorState } from '@isbp/ui/empty-state';
import { PageHeader } from '@isbp/ui/page-header';
import { useApiQuery } from '@isbp/ui/query';
import { SearchInput } from '@isbp/ui/search-input';
import { StatTile } from '@isbp/ui/stat-tile';
import {
  BlocksIcon,
  ClockAlertIcon,
  MonitorSmartphoneIcon,
  NetworkIcon,
  SearchXIcon,
  SettingsIcon,
  ShieldCheckIcon,
  UserPlusIcon,
  UserRoundCheckIcon,
  UsersIcon,
  UsersRoundIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import { AuditIcon, useActionLabel } from '@/components/audit-action';
import { RelativeTime } from '@/components/relative-time';
import { ActivityChart } from '../dashboard/activity-chart';
import { NavIcon } from '../nav-icon';

const AREAS = ['people', 'automation', 'modules', 'integrations', 'platform'] as const;

/** One line of live context on a card, from the platform figures (core cards only). */
function useCardStatus(data: Dashboard | undefined) {
  const t = useTranslations('admin.status');
  return (item: NavItem): string | null => {
    if (!data) return null;
    const c = data.counts;
    switch (item.id) {
      case 'core.users':
        return c.pendingUsers
          ? t('peoplePending', { active: c.activeUsers, pending: c.pendingUsers })
          : t('people', { active: c.activeUsers });
      case 'core.groups':
        return t('groups', { count: c.groups });
      case 'core.roles':
        return c.expiringAssignments
          ? t('expiring', { count: c.expiringAssignments })
          : t('roles', { count: c.roles });
      case 'core.departments':
        return t('departments', { count: c.departments });
      case 'core.modules':
        return t('modules', { enabled: c.enabledModules, total: c.modules });
      default:
        return null;
    }
  };
}

function AdminCard({ item, status }: { item: NavItem; status: string | null }) {
  const t = useTranslations();
  const label = (k?: string) => (k ? (t.has(k) ? t(k) : k) : '');
  return (
    <li className="min-w-0">
      <Link
        href={item.href}
        className="group flex h-full min-w-0 items-start gap-3 rounded-xl border bg-card p-4 shadow-xs outline-none transition-[translate,box-shadow,border-color] duration-(--motion-base) hover:-translate-y-0.5 hover:border-ring/40 hover:shadow-md focus-visible:ring-[3px] focus-visible:ring-ring/50 motion-reduce:transition-none motion-reduce:hover:translate-y-0"
      >
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
          <NavIcon name={item.icon} className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-medium group-hover:underline">{label(item.label)}</span>
          {item.description && (
            <span className="mt-0.5 block text-sm text-muted-foreground">{label(item.description)}</span>
          )}
          {status && <span className="mt-1.5 block text-xs font-medium text-foreground/80">{status}</span>}
        </span>
      </Link>
    </li>
  );
}

/** Directory and platform figures, moved here from Home: for the people who administer people or the platform. */
function PlatformFigures({ data }: { data: Dashboard }) {
  const t = useTranslations('dashboard');
  const c = data.counts;
  const canModules = useCan('core.modules.read');
  return (
    <section aria-labelledby="admin-figures" className="grid gap-3">
      <h2 id="admin-figures" className="text-base font-semibold">
        {t('figures')}
      </h2>
      <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 lg:grid-cols-4">
        <StatTile
          icon={<UsersIcon />}
          label={t('kpi.people')}
          value={c.activeUsers}
          hint={t('kpi.peopleHint', { total: c.users })}
          href="/admin/users?status=active"
        />
        <StatTile
          icon={<UserRoundCheckIcon />}
          label={t('kpi.pending')}
          value={c.pendingUsers}
          hint={t('kpi.pendingHint')}
          href="/admin/users?status=pending"
          tone={c.pendingUsers ? 'warning' : 'default'}
        />
        <StatTile
          icon={<ClockAlertIcon />}
          label={t('kpi.expiring')}
          value={c.expiringAssignments}
          hint={t('kpi.expiringHint')}
          href="/admin/roles"
          tone={c.expiringAssignments ? 'warning' : 'default'}
        />
        <StatTile icon={<MonitorSmartphoneIcon />} label={t('kpi.sessions')} value={c.activeSessions} />
        <StatTile icon={<UsersRoundIcon />} label={t('kpi.groups')} value={c.groups} href="/admin/groups" />
        <StatTile icon={<ShieldCheckIcon />} label={t('kpi.roles')} value={c.roles} href="/admin/roles" />
        <StatTile
          icon={<NetworkIcon />}
          label={t('kpi.departments')}
          value={c.departments}
          href="/admin/departments"
        />
        <StatTile
          icon={<BlocksIcon />}
          label={t('kpi.modules')}
          value={c.enabledModules}
          hint={t('kpi.modulesHint', { total: c.modules })}
          href={canModules ? '/admin/modules' : undefined}
        />
      </div>
    </section>
  );
}

function PlatformActivity({ data }: { data: Dashboard }) {
  const t = useTranslations('dashboard');
  const tc = useTranslations('common');
  const format = useFormatter();
  const actionLabel = useActionLabel();
  const canAudit = useCan('core.audit.read');
  const canPeople = useCan('core.users.read');
  const sourceTotal = data.usersBySource.reduce((n, s) => n + s.count, 0) || 1;
  if (!canAudit && !(canPeople && data.usersBySource.length)) return null;
  return (
    <section aria-labelledby="admin-activity" className="grid gap-3">
      <h2 id="admin-activity" className="text-base font-semibold">
        {t('activity.section')}
      </h2>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        {canAudit && (
          <Card className="min-w-0 xl:col-span-2">
            <CardHeader>
              <CardTitle>{t('activity.title')}</CardTitle>
              <CardDescription>{t('activity.description')}</CardDescription>
            </CardHeader>
            <CardContent>
              <ActivityChart data={data.activity} />
            </CardContent>
          </Card>
        )}
        {canPeople && data.usersBySource.length > 0 && (
          <Card className="min-w-0">
            <CardHeader>
              <CardTitle>{t('sources.title')}</CardTitle>
              <CardDescription>{t('sources.description')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {[...data.usersBySource]
                .sort((a, b) => b.count - a.count)
                .map((s) => (
                  <div key={s.source} className="space-y-1.5">
                    <div className="flex items-baseline justify-between text-sm">
                      <span>{tc(`source_values.${s.source}` as 'source_values.local')}</span>
                      <span className="tabular-nums text-muted-foreground">
                        <span className="font-medium text-foreground">{format.number(s.count)}</span> ·{' '}
                        {format.number(s.count / sourceTotal, { style: 'percent' })}
                      </span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-chart-1"
                        style={{ width: `${(s.count / sourceTotal) * 100}%` }}
                      />
                    </div>
                  </div>
                ))}
            </CardContent>
          </Card>
        )}
        {canAudit && (
          <Card className="min-w-0 xl:col-span-3">
            <CardHeader>
              <CardTitle>{t('recent.title')}</CardTitle>
              <CardAction>
                <Button variant="ghost" size="sm" asChild>
                  <Link href="/admin/audit">{tc('viewAll')}</Link>
                </Button>
              </CardAction>
            </CardHeader>
            <CardContent>
              {data.recent.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('recent.empty')}</p>
              ) : (
                <ol className="relative space-y-4 before:absolute before:top-2 before:bottom-2 before:left-4 before:w-px before:bg-border">
                  {data.recent.map((log) => (
                    <li key={log.seq} className="relative flex items-start gap-3">
                      <AuditIcon log={log} className="ring-4 ring-card" />
                      <div className="min-w-0 flex-1 pt-1 text-sm [overflow-wrap:anywhere]">
                        <span className="font-medium">{log.actorName ?? tc('system')}</span>{' '}
                        <span className="text-muted-foreground">{actionLabel(log.action)}</span>
                        {log.entityLabel && log.entityId !== log.actorId && (
                          <span className="font-medium"> · {log.entityLabel}</span>
                        )}
                      </div>
                      <RelativeTime
                        date={log.occurredAt}
                        className="shrink-0 pt-1 text-xs text-muted-foreground"
                      />
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </section>
  );
}

/**
 * Administration: every configuration page the person may open, as cards in five sections (people and access,
 * requests and automation, module settings, integrations, platform), with a filter and the platform's figures.
 */
export function AdminHub({ entries, initialStats }: { entries: NavItem[]; initialStats: Dashboard | null }) {
  const t = useTranslations('admin');
  const tAll = useTranslations();
  const [filter, setFilter] = useState('');
  const canPeople = useCan('core.users.read');
  const canAudit = useCan('core.audit.read');
  const canCreate = useCan('core.users.create');
  const canAssign = useCan('core.roles.assign');
  const stats = useApiQuery<Dashboard>(canPeople || canAudit ? '/platform/dashboard' : null);
  const statsData = stats.data ?? initialStats ?? undefined;
  const status = useCardStatus(statsData);
  const label = (k?: string) => (k ? (tAll.has(k) ? tAll(k) : k) : '');
  const needle = filter.trim().toLowerCase();
  const shown = needle
    ? entries.filter((e) =>
        `${label(e.label)} ${label(e.description)} ${label(e.keywords)}`.toLowerCase().includes(needle),
      )
    : entries;

  return (
    <div>
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={
          (canCreate || canAssign) && (
            <>
              {canAssign && (
                <Button asChild variant="outline">
                  <Link href="/admin/roles?assign=1">
                    <ShieldCheckIcon /> {t('grantRole')}
                  </Link>
                </Button>
              )}
              {canCreate && (
                <Button asChild>
                  <Link href="/admin/users?create=1">
                    <UserPlusIcon /> {t('addPerson')}
                  </Link>
                </Button>
              )}
            </>
          )
        }
      />
      {!entries.length ? (
        <EmptyState
          icon={<SettingsIcon />}
          title={t('noneTitle')}
          description={t('noneDescription')}
          className="rounded-xl border border-dashed"
        />
      ) : (
        <div className="grid gap-8">
          {stats.error && !statsData ? (
            <ErrorState error={stats.error} onRetry={() => void stats.refetch()} compact />
          ) : (
            statsData && canPeople && <PlatformFigures data={statsData} />
          )}
          <SearchInput
            value={filter}
            onChange={setFilter}
            placeholder={t('filter')}
            delay={0}
            className="sm:w-80"
          />
          {!shown.length && (
            <EmptyState
              icon={<SearchXIcon />}
              title={t('noMatch')}
              className="rounded-xl border border-dashed"
            />
          )}
          {AREAS.map((area) => {
            const cards = shown.filter((e) => (e.area ?? 'modules') === area);
            if (!cards.length) return null;
            return (
              <section key={area} aria-labelledby={`admin-area-${area}`} className="grid gap-3">
                <h2 id={`admin-area-${area}`} className="text-base font-semibold">
                  {t(`areas.${area}`)}
                </h2>
                <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {cards.map((e) => (
                    <AdminCard key={e.id} item={e} status={status(e)} />
                  ))}
                </ul>
              </section>
            );
          })}
          {statsData && !needle && <PlatformActivity data={statsData} />}
        </div>
      )}
    </div>
  );
}
