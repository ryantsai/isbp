'use client';

import type { ModuleInfo } from '@isbp/contracts';
import { cn } from '@isbp/ui';
import { Badge } from '@isbp/ui/badge';
import { Card, CardContent } from '@isbp/ui/card';
import { ArrowDownLeftIcon, ArrowUpRightIcon, LockIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { NavIcon } from '@/components/nav-icon';
import { ModuleSwitch } from './module-switch';
import { useManifestText } from './use-manifest-text';

export function ModuleIconTile({
  module: m,
  className,
}: {
  module: Pick<ModuleInfo, 'icon' | 'enabled'>;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'grid size-10 shrink-0 place-items-center rounded-lg transition-colors duration-300',
        m.enabled ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground',
        className,
      )}
    >
      <NavIcon name={m.icon ?? undefined} className="size-5" />
    </span>
  );
}

/** Compact counts: permissions, events out/in, AI tools, jobs. */
export function ModuleStats({ module: m, className }: { module: ModuleInfo; className?: string }) {
  const t = useTranslations('modules.stats');
  const cells = [
    {
      key: 'permissions',
      value: <span>{m.permissions.length}</span>,
      label: t('permissions', { count: m.permissions.length }),
    },
    {
      key: 'events',
      value: (
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-flex items-center">
            <ArrowUpRightIcon className="size-3 text-muted-foreground" aria-hidden />
            {m.events.emits.length}
          </span>
          <span className="inline-flex items-center">
            <ArrowDownLeftIcon className="size-3 text-muted-foreground" aria-hidden />
            {m.events.consumes.length}
          </span>
        </span>
      ),
      label: t('events'),
      sr: t('eventsDetail', { emits: m.events.emits.length, consumes: m.events.consumes.length }),
    },
    { key: 'ai', value: <span>{m.aiTools.length}</span>, label: t('aiTools', { count: m.aiTools.length }) },
    { key: 'jobs', value: <span>{m.jobs.length}</span>, label: t('jobs', { count: m.jobs.length }) },
  ];
  return (
    <dl className={cn('grid grid-cols-4 gap-2 border-t pt-3', className)}>
      {cells.map((c) => (
        <div key={c.key} className="min-w-0">
          <dt className="truncate text-[11px] text-muted-foreground">{c.label}</dt>
          <dd className="text-sm font-medium tabular-nums">
            <span aria-hidden={c.sr ? true : undefined}>{c.value}</span>
            {c.sr && <span className="sr-only">{c.sr}</span>}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** A module in the grid. The whole card opens details (stretched button); the switch sits above it. */
export function ModuleCard({
  module: m,
  all,
  onOpen,
}: {
  module: ModuleInfo;
  all: ModuleInfo[];
  onOpen: () => void;
}) {
  const t = useTranslations('modules');
  const tc = useTranslations('common');
  const text = useManifestText();
  const name = text(m.name);
  return (
    <Card
      className={cn(
        'group relative h-full gap-0 py-4 transition-[transform,box-shadow,background-color] duration-200 hover:-translate-y-0.5 hover:shadow-md has-[[data-open-details]:focus-visible]:ring-[3px] has-[[data-open-details]:focus-visible]:ring-ring/50 motion-reduce:hover:translate-y-0',
        !m.enabled && 'bg-muted/30',
      )}
    >
      <CardContent className="flex h-full flex-col gap-3 px-4">
        <div className="flex items-start gap-3">
          <ModuleIconTile module={m} />
          <div className="min-w-0 flex-1">
            <h2 className="truncate leading-tight font-medium">
              <button
                type="button"
                data-open-details
                onClick={onOpen}
                aria-label={t('openDetails', { name })}
                className="text-left outline-none after:absolute after:inset-0 after:rounded-xl after:content-['']"
              >
                {name}
              </button>
            </h2>
            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              <span className="font-mono">v{m.version}</span>
              {m.system && (
                <Badge variant="secondary" className="px-1.5 py-0">
                  <LockIcon aria-hidden /> {tc('system')}
                </Badge>
              )}
              {!m.enabled && (
                <Badge variant="muted" className="px-1.5 py-0">
                  {tc('disabled')}
                </Badge>
              )}
            </div>
          </div>
          <div className="relative z-10">
            <ModuleSwitch module={m} all={all} />
          </div>
        </div>
        <p
          className={cn(
            'line-clamp-2 text-sm',
            m.description ? 'text-muted-foreground' : 'text-muted-foreground/70 italic',
          )}
        >
          {m.description ? text(m.description) : t('noDescription')}
        </p>
        <ModuleStats module={m} className="mt-auto" />
      </CardContent>
    </Card>
  );
}
