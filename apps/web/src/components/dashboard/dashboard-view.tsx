'use client';

import type { Dashboard } from '@isbp/contracts';
import { useCan, usePlatform } from '@isbp/sdk/web';
import { Button } from '@isbp/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@isbp/ui/card';
import { AnimatedNumber, FadeIn, Stagger, StaggerItem } from '@isbp/ui/motion';
import {
  ArrowRightIcon,
  BlocksIcon,
  ClockAlertIcon,
  KeyRoundIcon,
  MonitorSmartphoneIcon,
  NetworkIcon,
  ScrollTextIcon,
  ShieldCheckIcon,
  UserPlusIcon,
  UsersIcon,
  UsersRoundIcon,
  UserRoundCheckIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useFormatter, useNow, useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { AuditIcon, useActionLabel } from '@/components/audit-action';
import { RelativeTime } from '@/components/relative-time';
import { useApiQuery } from '@/lib/api';
import { ActivityChart } from './activity-chart';

function Kpi({
  icon,
  label,
  value,
  hint,
  href,
  tone = 'primary',
}: {
  icon: ReactNode;
  label: string;
  value: number;
  hint?: string;
  href?: string;
  tone?: 'primary' | 'warning';
}) {
  const body = (
    <Card className="group h-full gap-3 py-4 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md motion-reduce:hover:translate-y-0">
      <CardContent className="flex items-start justify-between gap-3 px-4">
        <div className="min-w-0 space-y-1">
          <p className="truncate text-sm text-muted-foreground">{label}</p>
          <p className="text-2xl font-semibold tracking-tight">
            <AnimatedNumber value={value} />
          </p>
          {hint && <p className="truncate text-xs text-muted-foreground">{hint}</p>}
        </div>
        <span
          className={`grid size-9 shrink-0 place-items-center rounded-lg transition-transform duration-200 group-hover:scale-110 ${tone === 'warning' ? 'bg-warning/15 text-warning-foreground' : 'bg-primary/10 text-primary'}`}
        >
          {icon}
        </span>
      </CardContent>
    </Card>
  );
  return (
    <StaggerItem>
      {href ? (
        <Link
          href={href}
          className="block rounded-xl outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          {body}
        </Link>
      ) : (
        body
      )}
    </StaggerItem>
  );
}

export function DashboardView({ initial }: { initial: Dashboard }) {
  const t = useTranslations('dashboard');
  const tc = useTranslations('common');
  const format = useFormatter();
  const now = useNow();
  const { user } = usePlatform();
  const actionLabel = useActionLabel();
  const canPeople = useCan('core.users.read');
  const canAudit = useCan('core.audit.read');
  const canCreate = useCan('core.users.create');
  const canAssign = useCan('core.roles.assign');
  const canIdp = useCan('core.idp.manage');
  const canModules = useCan('core.modules.read');
  const { data = initial } = useApiQuery<Dashboard>('/platform/dashboard', undefined, {
    refetchInterval: 60_000,
  });
  const c = data.counts;

  const hour = now.getHours();
  const greeting = hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
  const sourceTotal = data.usersBySource.reduce((n, s) => n + s.count, 0) || 1;

  return (
    <div className="space-y-6">
      <FadeIn y={4} className="flex flex-col gap-1">
        <p className="text-sm text-muted-foreground">
          {format.dateTime(now, { weekday: 'long', month: 'long', day: 'numeric' })}
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">
          {t(`greeting.${greeting}`, { name: user.displayName })}
        </h1>
        <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
      </FadeIn>

      {canPeople ? (
        <Stagger className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Kpi
            icon={<UsersIcon className="size-4" />}
            label={t('kpi.people')}
            value={c.activeUsers}
            hint={t('kpi.peopleHint', { total: c.users })}
            href="/admin/users?status=active"
          />
          <Kpi
            icon={<UserRoundCheckIcon className="size-4" />}
            label={t('kpi.pending')}
            value={c.pendingUsers}
            hint={t('kpi.pendingHint')}
            href="/admin/users?status=pending"
            tone={c.pendingUsers ? 'warning' : 'primary'}
          />
          <Kpi
            icon={<ClockAlertIcon className="size-4" />}
            label={t('kpi.expiring')}
            value={c.expiringAssignments}
            hint={t('kpi.expiringHint')}
            href="/admin/roles"
            tone={c.expiringAssignments ? 'warning' : 'primary'}
          />
          <Kpi
            icon={<MonitorSmartphoneIcon className="size-4" />}
            label={t('kpi.sessions')}
            value={c.activeSessions}
          />
          <Kpi
            icon={<UsersRoundIcon className="size-4" />}
            label={t('kpi.groups')}
            value={c.groups}
            href="/admin/groups"
          />
          <Kpi
            icon={<ShieldCheckIcon className="size-4" />}
            label={t('kpi.roles')}
            value={c.roles}
            href="/admin/roles"
          />
          <Kpi
            icon={<NetworkIcon className="size-4" />}
            label={t('kpi.departments')}
            value={c.departments}
            href="/admin/departments"
          />
          <Kpi
            icon={<BlocksIcon className="size-4" />}
            label={t('kpi.modules')}
            value={c.enabledModules}
            hint={t('kpi.modulesHint', { total: c.modules })}
            href={canModules ? '/admin/modules' : undefined}
          />
        </Stagger>
      ) : (
        <FadeIn>
          <Card>
            <CardHeader>
              <CardTitle>{t('welcome.title')}</CardTitle>
              <CardDescription>{t('welcome.body')}</CardDescription>
            </CardHeader>
          </Card>
        </FadeIn>
      )}

      <div className="grid gap-6 xl:grid-cols-3">
        {canAudit && (
          <FadeIn delay={0.1} className="xl:col-span-2">
            <Card className="h-full">
              <CardHeader>
                <CardTitle>{t('activity.title')}</CardTitle>
                <CardDescription>{t('activity.description')}</CardDescription>
              </CardHeader>
              <CardContent>
                <ActivityChart data={data.activity} />
              </CardContent>
            </Card>
          </FadeIn>
        )}

        <FadeIn delay={0.15} className={canAudit ? '' : 'xl:col-span-3'}>
          <Card className="h-full">
            <CardHeader>
              <CardTitle>{t('quick.title')}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2">
              {[
                canCreate && {
                  href: '/admin/users?create=1',
                  icon: <UserPlusIcon />,
                  label: t('quick.createUser'),
                },
                canAssign && {
                  href: '/admin/roles?assign=1',
                  icon: <ShieldCheckIcon />,
                  label: t('quick.grantAccess'),
                },
                canAudit && { href: '/admin/audit', icon: <ScrollTextIcon />, label: t('quick.reviewAudit') },
                canIdp && {
                  href: '/admin/identity-providers',
                  icon: <KeyRoundIcon />,
                  label: t('quick.configureSso'),
                },
              ]
                .filter((a) => a !== false)
                .map((a) => (
                  <Button key={a.href} variant="outline" className="group justify-start" asChild>
                    <Link href={a.href}>
                      {a.icon}
                      {a.label}
                      <ArrowRightIcon className="ml-auto opacity-0 transition-all duration-200 group-hover:translate-x-0.5 group-hover:opacity-60" />
                    </Link>
                  </Button>
                ))}
            </CardContent>
          </Card>
        </FadeIn>
      </div>

      {(canAudit || canPeople) && (
        <div className="grid gap-6 xl:grid-cols-3">
          {canAudit && (
            <FadeIn delay={0.2} className="xl:col-span-2">
              <Card className="h-full">
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
                          <div className="min-w-0 flex-1 pt-1 text-sm">
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
            </FadeIn>
          )}
          {canPeople && data.usersBySource.length > 0 && (
            <FadeIn delay={0.25} className={canAudit ? '' : 'xl:col-span-3'}>
              <Card className="h-full">
                <CardHeader>
                  <CardTitle>{t('sources.title')}</CardTitle>
                  <CardDescription>{t('sources.description')}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {[...data.usersBySource]
                    .sort((a, b) => b.count - a.count)
                    .map((s, i) => (
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
                            className="h-full origin-left rounded-full bg-chart-1 transition-transform duration-700 ease-out"
                            style={{
                              width: `${(s.count / sourceTotal) * 100}%`,
                              transitionDelay: `${i * 80}ms`,
                            }}
                          />
                        </div>
                      </div>
                    ))}
                </CardContent>
              </Card>
            </FadeIn>
          )}
        </div>
      )}
    </div>
  );
}
