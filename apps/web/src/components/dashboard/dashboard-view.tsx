'use client';

import type { MyWork } from '@isbp/contracts';
import { Slot, usePlatform } from '@isbp/sdk/web';
import { cn } from '@isbp/ui';
import { useApiQuery } from '@isbp/ui/query';
import { IconTile } from '@isbp/ui/icon-tile';
import {
  CircleCheckIcon,
  ClipboardListIcon,
  LaptopIcon,
  LifeBuoyIcon,
  MessageCircleQuestionIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useFormatter, useNow, useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { WORK_PATH } from '../my-work/my-work-view';
import { NeedsYou, YourRequests } from './my-work';

interface QuickAction {
  id: string;
  href: string;
  icon: ReactNode;
  label: string;
  hint: string;
}

/** The jobs people come for: ask, report, request, and their own devices — each only when the person can. */
function useQuickActions(): QuickAction[] {
  const t = useTranslations('dashboard.actions');
  const { enabledModules, permissions } = usePlatform();
  const has = (module: string, permission: string) =>
    enabledModules.includes(module) && permissions.hasAny(permission);
  const icon = 'size-5';
  const actions: (QuickAction | false)[] = [
    has('helpdesk-ai', 'helpdesk-ai.chat.use') && {
      id: 'ask',
      href: '/helpdesk-ai/chat',
      icon: <MessageCircleQuestionIcon className={icon} />,
      label: t('askIt'),
      hint: t('askItHint'),
    },
    has('itsm', 'itsm.tickets.create') && {
      id: 'report',
      href: '/itsm/report',
      icon: <LifeBuoyIcon className={icon} />,
      label: t('report'),
      hint: t('reportHint'),
    },
    {
      id: 'request',
      href: '/requests',
      icon: <ClipboardListIcon className={icon} />,
      label: t('request'),
      hint: t('requestHint'),
    },
    has('itam', 'itam.self.read') && {
      id: 'devices',
      href: '/itam/mine',
      icon: <LaptopIcon className={icon} />,
      label: t('devices'),
      hint: t('devicesHint'),
    },
  ];
  return actions.filter((a): a is QuickAction => Boolean(a));
}

function QuickActions() {
  const t = useTranslations('dashboard.actions');
  const actions = useQuickActions();
  return (
    <section aria-label={t('label')}>
      <ul className={cn('grid grid-cols-2 gap-2 sm:gap-3', actions.length >= 4 && 'xl:grid-cols-4')}>
        {actions.map((a) => (
          <li key={a.id} className="min-w-0">
            <Link
              href={a.href}
              className="group flex h-full min-w-0 items-center gap-3 rounded-lg border bg-card px-3 py-2.5 outline-none transition-[translate,box-shadow,border-color] duration-(--motion-base) hover:-translate-y-px hover:border-primary/50 hover:shadow-sm focus-visible:ring-[3px] focus-visible:ring-ring/50 motion-reduce:transition-none motion-reduce:hover:translate-y-0"
            >
              <IconTile aria-hidden size="sm" className="sm:size-10">
                {a.icon}
              </IconTile>
              <span className="min-w-0">
                <span className="block font-medium">{a.label}</span>
                <span className="hidden text-xs text-muted-foreground sm:block">{a.hint}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Home: a personal start page. What needs the person (My work), their requests, the jobs they come for, news, and —
 * for people who own an area — that area's attention cards. Platform figures live on the Administration hub.
 */
export function DashboardView({ initialWork }: { initialWork: MyWork | null }) {
  const t = useTranslations('dashboard');
  const format = useFormatter();
  const now = useNow();
  const { user } = usePlatform();
  const { data: work = initialWork ?? undefined } = useApiQuery<MyWork>(WORK_PATH, { limit: 5 });

  const hour = now.getHours();
  const greeting = hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
  const waiting = work?.total ?? 0;

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-1">
        <p className="text-sm text-muted-foreground">
          {format.dateTime(now, { weekday: 'long', month: 'long', day: 'numeric' })}
        </p>
        <h1 className="text-xl font-semibold tracking-tight">
          {t(`greeting.${greeting}`, { name: user.displayName })}
        </h1>
        {work && waiting === 0 ? (
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <CircleCheckIcon className="size-4 text-success" aria-hidden />
            {work.tasks ? t('onlyTasks', { count: work.tasks }) : t('allClear')}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            {waiting ? t('waiting', { count: waiting }) : t('subtitle')}
          </p>
        )}
      </header>

      <QuickActions />

      <div className="grid grid-cols-1 gap-4 empty:hidden lg:grid-cols-2">
        <NeedsYou work={work} />
        <YourRequests />
      </div>

      {/* Areas the person owns (the service desk queue for agents, asset attention for asset managers…). */}
      <div className="grid grid-cols-1 gap-4 empty:hidden lg:grid-cols-2">
        <Slot name="core.dashboard.work" props={{}} />
      </div>

      <div className="empty:hidden">
        <Slot name="core.home.news" props={{}} />
      </div>
    </div>
  );
}
