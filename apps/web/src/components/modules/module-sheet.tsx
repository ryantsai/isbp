'use client';

import type { ModuleInfo } from '@isbp/contracts';
import { cn } from '@isbp/ui';
import { Badge } from '@isbp/ui/badge';
import { EmptyState } from '@isbp/ui/empty-state';
import { Stagger, StaggerItem } from '@isbp/ui/motion';
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@isbp/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@isbp/ui/tabs';
import {
  ArrowDownLeftIcon,
  ArrowUpRightIcon,
  BotIcon,
  CalendarClockIcon,
  KeyRoundIcon,
  LockIcon,
  SparklesIcon,
  TriangleAlertIcon,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type ReactNode, useId } from 'react';
import { DateTime, RelativeTime } from '@/components/relative-time';
import { NavIcon } from '@/components/nav-icon';
import { parseCron } from '@/components/idp/cron';
import { ModuleIconTile, ModuleStats } from './module-card';
import { ModuleSettingsForm } from './module-settings-form';
import { ModuleSwitch } from './module-switch';
import { useManifestText } from './use-manifest-text';

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,9rem)_1fr] gap-3 py-2.5 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

function Section({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  return (
    <section className="space-y-2.5">
      <h3 className="flex items-center gap-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {title}
        {count !== undefined && (
          <Badge variant="muted" className="px-1.5 py-0 tabular-nums">
            {count}
          </Badge>
        )}
      </h3>
      {children}
    </section>
  );
}

function CountBadge({ n }: { n: number }) {
  return (
    <Badge variant="muted" className="px-1.5 py-0 tabular-nums">
      {n}
    </Badge>
  );
}

/** Human text for a job schedule: the API sends a cron expression or `every <n>s`. */
function useScheduleText() {
  const t = useTranslations('modules.jobs');
  return (schedule: string | null): string => {
    if (!schedule) return t('onDemand');
    const every = /^every (\d+)s$/.exec(schedule);
    if (every) {
      const s = Number(every[1]);
      if (s % 3600 === 0) return t('everyHours', { count: s / 3600 });
      if (s % 60 === 0) return t('everyMinutes', { count: s / 60 });
      return t('everySeconds', { count: s });
    }
    const c = parseCron(schedule);
    if (!c) return t('cron');
    switch (c.kind) {
      case 'everyMinutes':
        return t('everyMinutes', { count: c.n });
      case 'hourly':
        return t('everyHours', { count: 1 });
      case 'hourlyAt':
        return t('hourlyAt', { minute: c.minute });
      case 'everyHours':
        return t('everyHours', { count: c.n });
      case 'dailyAt':
        return t('dailyAt', { time: c.time });
    }
  };
}

/** The identity a module's background AI work runs as, with the permissions it holds (least privilege). */
function AiAgentCard({ agent }: { agent: NonNullable<ModuleInfo['aiAgent']> }) {
  const t = useTranslations('modules.ai');
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className="rounded-lg border p-3">
      <div className="flex items-start gap-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
          <BotIcon className="size-4" aria-hidden />
        </span>
        <div className="min-w-0 space-y-1">
          <h3 id={titleId} className="text-sm font-medium">
            {t('agentTitle', { name: agent.name })}
          </h3>
          <p className="text-sm text-muted-foreground">{t('agentHint')}</p>
        </div>
      </div>
      <ul className="mt-3 flex flex-wrap gap-1.5" aria-label={t('agentPermissions')}>
        {agent.permissions.map((p) => (
          <li key={p}>
            <code className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] break-all">
              <KeyRoundIcon className="size-3 shrink-0 text-muted-foreground" aria-hidden />
              {p}
            </code>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ModuleChip({
  id,
  all,
  onNavigate,
}: {
  id: string;
  all: ModuleInfo[];
  onNavigate: (id: string) => void;
}) {
  const t = useTranslations('modules');
  const text = useManifestText();
  const target = all.find((x) => x.id === id);
  if (!target) {
    return (
      <Badge variant="outline" className="font-mono font-normal">
        {id}
      </Badge>
    );
  }
  return (
    <button
      type="button"
      onClick={() => onNavigate(id)}
      className="inline-flex items-center gap-1.5 rounded-md border bg-card px-2 py-1 text-xs font-medium shadow-xs transition-colors outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      <NavIcon name={target.icon ?? undefined} className="size-3.5 text-muted-foreground" />
      {text(target.name)}
      {!target.enabled && <span className="font-normal text-muted-foreground">· {t('off')}</span>}
    </button>
  );
}

/** Right-hand sheet with everything a module declares in its manifest. */
export function ModuleSheet({
  module: m,
  all,
  open,
  onOpenChange,
  onNavigate,
}: {
  module: ModuleInfo | null;
  all: ModuleInfo[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onNavigate: (id: string) => void;
}) {
  const t = useTranslations('modules');
  const tc = useTranslations('common');
  const text = useManifestText();
  const scheduleText = useScheduleText();

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="gap-0 sm:max-w-xl" closeLabel={tc('close')}>
        {m && (
          <>
            <SheetHeader className="gap-3 pb-4">
              <div className="flex items-start gap-3 pr-8">
                <ModuleIconTile module={m} className="size-11" />
                <div className="min-w-0 flex-1">
                  <SheetTitle className="truncate">{text(m.name)}</SheetTitle>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                    <code className="font-mono">{m.id}</code>
                    <span aria-hidden>·</span>
                    <span className="font-mono">v{m.version}</span>
                    {m.system && (
                      <Badge variant="secondary" className="px-1.5 py-0">
                        <LockIcon aria-hidden /> {tc('system')}
                      </Badge>
                    )}
                  </div>
                </div>
              </div>
              <SheetDescription className={cn(!m.description && 'sr-only')}>
                {m.description ? text(m.description) : t('noDescription')}
              </SheetDescription>
              <div className="flex items-center justify-between gap-3 rounded-lg border bg-muted/30 px-3 py-2">
                <span className="text-sm">
                  {m.system ? t('systemHint') : m.enabled ? t('statusOn') : t('statusOff')}
                </span>
                <ModuleSwitch module={m} all={all} showLabel />
              </div>
            </SheetHeader>

            <Tabs key={m.id} defaultValue="overview" className="min-h-0 flex-1 gap-0">
              <div className="px-5">
                <TabsList className="w-full">
                  <TabsTrigger value="overview">{t('tabs.overview')}</TabsTrigger>
                  {m.permissions.length > 0 && (
                    <TabsTrigger value="permissions">
                      {t('tabs.permissions')} <CountBadge n={m.permissions.length} />
                    </TabsTrigger>
                  )}
                  {m.events.emits.length + m.events.consumes.length > 0 && (
                    <TabsTrigger value="events">
                      {t('tabs.events')} <CountBadge n={m.events.emits.length + m.events.consumes.length} />
                    </TabsTrigger>
                  )}
                  {(m.aiTools.length > 0 || m.aiAgent) && (
                    <TabsTrigger value="ai">
                      {m.aiTools.length > 0 ? t('tabs.aiTools') : t('tabs.ai')}
                      {m.aiTools.length > 0 && <CountBadge n={m.aiTools.length} />}
                    </TabsTrigger>
                  )}
                  {m.jobs.length > 0 && (
                    <TabsTrigger value="jobs">
                      {t('tabs.jobs')} <CountBadge n={m.jobs.length} />
                    </TabsTrigger>
                  )}
                  {m.settings.length > 0 && <TabsTrigger value="settings">{t('tabs.settings')}</TabsTrigger>}
                </TabsList>
              </div>
              <SheetBody className="pt-5">
                <TabsContent value="overview" className="space-y-6 pb-6">
                  <dl className="divide-y">
                    <Row label={t('overview.id')}>
                      <code className="font-mono text-xs">{m.id}</code>
                    </Row>
                    <Row label={t('overview.version')}>{m.version}</Row>
                    <Row label={t('overview.installed')}>
                      <DateTime date={m.installedAt} />
                    </Row>
                    <Row label={t('overview.lastChanged')}>
                      {m.enabledChangedAt ? (
                        <RelativeTime date={m.enabledChangedAt} />
                      ) : (
                        <span className="text-muted-foreground">{t('overview.neverChanged')}</span>
                      )}
                    </Row>
                    <Row label={t('overview.navigation')}>
                      {t('overview.navEntries', { count: m.navigation })}
                    </Row>
                  </dl>
                  <ModuleStats module={m} />
                  <Section title={t('overview.dependsOn')}>
                    {m.dependsOn.length ? (
                      <div className="flex flex-wrap gap-1.5">
                        {m.dependsOn.map((id) => (
                          <ModuleChip key={id} id={id} all={all} onNavigate={onNavigate} />
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">{t('overview.noDependencies')}</p>
                    )}
                  </Section>
                  <Section title={t('overview.dependents')}>
                    {m.dependents.length ? (
                      <div className="flex flex-wrap gap-1.5">
                        {m.dependents.map((id) => (
                          <ModuleChip key={id} id={id} all={all} onNavigate={onNavigate} />
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">{t('overview.noDependents')}</p>
                    )}
                  </Section>
                </TabsContent>

                <TabsContent value="permissions" className="space-y-3 pb-6">
                  <p className="text-sm text-muted-foreground">{t('permissions.hint')}</p>
                  <Stagger className="divide-y rounded-lg border">
                    {m.permissions.map((p) => (
                      <StaggerItem key={p.key} className="flex flex-col gap-1 px-3 py-2.5">
                        <span className="text-sm">{text(p.description)}</span>
                        <code className="font-mono text-xs text-muted-foreground">{p.key}</code>
                      </StaggerItem>
                    ))}
                  </Stagger>
                </TabsContent>

                <TabsContent value="events" className="space-y-6 pb-6">
                  <p className="text-sm text-muted-foreground">{t('events.hint')}</p>
                  <Section title={t('events.emits')} count={m.events.emits.length}>
                    {m.events.emits.length ? (
                      <ul className="divide-y rounded-lg border">
                        {m.events.emits.map((e) => (
                          <li key={e.name} className="flex items-start gap-2.5 px-3 py-2.5">
                            <ArrowUpRightIcon className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                            <div className="min-w-0">
                              <code className="font-mono text-xs break-all">{e.name}</code>
                              {e.description && (
                                <p className="mt-0.5 text-sm text-muted-foreground">{text(e.description)}</p>
                              )}
                            </div>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-sm text-muted-foreground">{t('events.noEmits')}</p>
                    )}
                  </Section>
                  <Section title={t('events.consumes')} count={m.events.consumes.length}>
                    {m.events.consumes.length ? (
                      <ul className="divide-y rounded-lg border">
                        {m.events.consumes.map((name) => (
                          <li key={name} className="flex items-center gap-2.5 px-3 py-2.5">
                            <ArrowDownLeftIcon className="size-4 shrink-0 text-info" aria-hidden />
                            <code className="font-mono text-xs break-all">{name}</code>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-sm text-muted-foreground">{t('events.noConsumes')}</p>
                    )}
                  </Section>
                </TabsContent>

                <TabsContent value="ai" className="space-y-4 pb-6">
                  {m.aiAgent && <AiAgentCard agent={m.aiAgent} />}
                  {m.aiTools.length > 0 && (
                    <div className="flex gap-3 rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm">
                      <SparklesIcon className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                      <p>{t('ai.hint')}</p>
                    </div>
                  )}
                  <Stagger className="space-y-2">
                    {m.aiTools.map((tool) => (
                      <StaggerItem key={tool.name} className="rounded-lg border p-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <code className="font-mono text-sm font-medium">{tool.name}</code>
                          {tool.destructive && (
                            <Badge variant="warning">
                              <TriangleAlertIcon aria-hidden /> {t('ai.requiresConfirmation')}
                            </Badge>
                          )}
                        </div>
                        <p className="mt-1.5 text-sm text-muted-foreground">{text(tool.description)}</p>
                        <div className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                          <KeyRoundIcon className="size-3.5" aria-hidden />
                          <span>{t('ai.permission')}</span>
                          <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]">
                            {tool.permission}
                          </code>
                        </div>
                      </StaggerItem>
                    ))}
                  </Stagger>
                </TabsContent>

                <TabsContent value="jobs" className="pb-6">
                  <ul className="divide-y rounded-lg border">
                    {m.jobs.map((job) => (
                      <li key={job.name} className="flex items-start gap-3 px-3 py-3">
                        <CalendarClockIcon
                          className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                          aria-hidden
                        />
                        <div className="min-w-0 flex-1">
                          <code className="font-mono text-sm font-medium">{job.name}</code>
                          {job.description && (
                            <p className="mt-0.5 text-sm text-muted-foreground">{text(job.description)}</p>
                          )}
                        </div>
                        <div className="shrink-0 text-right">
                          <Badge variant={job.schedule ? 'info' : 'muted'}>
                            {scheduleText(job.schedule)}
                          </Badge>
                          {job.schedule && !job.schedule.startsWith('every ') && (
                            <code className="mt-1 block font-mono text-[11px] text-muted-foreground">
                              {job.schedule}
                            </code>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                </TabsContent>

                <TabsContent value="settings">
                  {m.settings.length ? (
                    <ModuleSettingsForm module={m} />
                  ) : (
                    <EmptyState title={t('settings.none')} />
                  )}
                </TabsContent>
              </SheetBody>
            </Tabs>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
