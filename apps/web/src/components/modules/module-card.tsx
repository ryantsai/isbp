'use client';

import type { ModuleInfo } from '@isbp/contracts';
import { cn } from '@isbp/ui';
import { Badge } from '@isbp/ui/badge';
import { Card, CardContent } from '@isbp/ui/card';
import { LockIcon, SlidersHorizontalIcon } from 'lucide-react';
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
            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground empty:hidden">
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
        {m.enabled && m.settings.length > 0 && (
          <p className="mt-auto flex items-center gap-1.5 border-t pt-3 text-xs text-muted-foreground">
            <SlidersHorizontalIcon className="size-3.5" aria-hidden />
            {t('hasSettings', { count: m.settings.length })}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
