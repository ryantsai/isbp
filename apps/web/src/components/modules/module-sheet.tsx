'use client';

import type { ModuleInfo } from '@isbp/contracts';
import { cn } from '@isbp/ui';
import { EmptyState } from '@isbp/ui/empty-state';
import { Stagger, StaggerItem } from '@isbp/ui/motion';
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@isbp/ui/sheet';
import { IconTile } from '@isbp/ui/icon-tile';
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
import { type ReactNode, useId, useState } from 'react';
import { DateTime, RelativeTime } from '@/components/relative-time';
import { NavIcon } from '@/components/nav-icon';
import { parseCron } from '@/components/idp/cron';
import { ModuleIconTile } from './module-card';
import { ModuleSettingsForm } from './module-settings-form';
import { ModuleSwitch } from './module-switch';
import { useManifestText } from './use-manifest-text';
import { Badge } from '@astryxdesign/core/Badge';
import { Button } from '@astryxdesign/core/Button';
import { Icon } from '@astryxdesign/core/Icon';
import { Tab, TabList } from '@astryxdesign/core/TabList';

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
      <h3 className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
        {title}
        {count !== undefined && (
          <Badge variant="neutral" label={count} className="px-1.5 py-0 tabular-nums" />
        )}
      </h3>
      {children}
    </section>
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
        <IconTile aria-hidden size="sm">
          <BotIcon className="size-4" aria-hidden />
        </IconTile>
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
    return <Badge variant="neutral" label={id} className="font-mono font-normal" />;
  }
  return (
    <Button
      variant="secondary"
      size="sm"
      label={target.enabled ? text(target.name) : `${text(target.name)} · ${t('off')}`}
      icon={<NavIcon name={target.icon ?? undefined} />}
      onClick={() => onNavigate(id)}
    />
  );
}

/** The three tabs of the module sheet (a fresh instance per module, so it opens on the right tab). */
function ModuleTabs({
  module: m,
  all,
  onNavigate,
}: {
  module: ModuleInfo;
  all: ModuleInfo[];
  onNavigate: (id: string) => void;
}) {
  const t = useTranslations('modules');
  const text = useManifestText();
  const scheduleText = useScheduleText();
  const panelId = useId();
  const [tab, setTab] = useState(m.settings.length > 0 ? 'settings' : 'overview');

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-5">
        <TabList role="tablist" value={tab} onChange={setTab} hasDivider layout="fill">
          {m.settings.length > 0 && <Tab value="settings" label={t('tabs.settings')} panelId={panelId} />}
          <Tab value="overview" label={t('tabs.overview')} panelId={panelId} />
          <Tab value="technical" label={t('tabs.technical')} panelId={panelId} />
        </TabList>
      </div>
      <SheetBody className="pt-5">
        <div role="tabpanel" id={panelId} aria-label={t(`tabs.${tab}`)}>
          {tab === 'overview' && (
            <div className="space-y-5 pb-6">
              <dl className="divide-y">
                <Row label={t('overview.lastChanged')}>
                  {m.enabledChangedAt ? (
                    <RelativeTime date={m.enabledChangedAt} />
                  ) : (
                    <span className="text-muted-foreground">{t('overview.neverChanged')}</span>
                  )}
                </Row>
              </dl>
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
            </div>
          )}
          {tab === 'technical' && (
            <div className="space-y-5 pb-6">
              <p className="text-sm text-muted-foreground">{t('technicalHint')}</p>
              <dl className="divide-y">
                <Row label={t('overview.id')}>
                  <code className="font-mono text-xs">{m.id}</code>
                </Row>
                <Row label={t('overview.version')}>{m.version}</Row>
                <Row label={t('overview.installed')}>
                  <DateTime date={m.installedAt} />
                </Row>
                <Row label={t('overview.navigation')}>
                  {t('overview.navEntries', { count: m.navigation })}
                </Row>
              </dl>
              {m.permissions.length > 0 && (
                <Section title={t('tabs.permissions')} count={m.permissions.length}>
                  <p className="text-sm text-muted-foreground">{t('permissions.hint')}</p>
                  <Stagger className="divide-y rounded-lg border">
                    {m.permissions.map((p) => (
                      <StaggerItem key={p.key} className="flex flex-col gap-1 px-3 py-2.5">
                        <span className="text-sm">{text(p.description)}</span>
                        <code className="font-mono text-xs text-muted-foreground">{p.key}</code>
                      </StaggerItem>
                    ))}
                  </Stagger>
                </Section>
              )}
              {m.events.emits.length + m.events.consumes.length > 0 && (
                <Section title={t('tabs.events')}>
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
                </Section>
              )}
              {(m.aiTools.length > 0 || m.aiAgent) && (
                <Section title={m.aiTools.length > 0 ? t('tabs.aiTools') : t('tabs.ai')}>
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
                            <Badge
                              variant="warning"
                              label={t('ai.requiresConfirmation')}
                              icon={<Icon icon={TriangleAlertIcon} size="xsm" />}
                            />
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
                </Section>
              )}
              {m.jobs.length > 0 && (
                <Section title={t('tabs.jobs')} count={m.jobs.length}>
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
                          <Badge
                            variant={job.schedule ? 'info' : 'neutral'}
                            label={scheduleText(job.schedule)}
                          />
                          {job.schedule && !job.schedule.startsWith('every ') && (
                            <code className="mt-1 block font-mono text-[11px] text-muted-foreground">
                              {job.schedule}
                            </code>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                </Section>
              )}
            </div>
          )}
          {tab === 'settings' && (
            <div className="pb-6">
              {m.settings.length ? (
                <ModuleSettingsForm module={m} />
              ) : (
                <EmptyState title={t('settings.none')} />
              )}
            </div>
          )}
        </div>
      </SheetBody>
    </div>
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

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="gap-0 sm:max-w-xl" closeLabel={tc('close')}>
        {m && (
          <>
            <SheetHeader className="gap-3 pb-4">
              <div className="flex items-start gap-3 pr-8">
                <ModuleIconTile module={m} size="lg" />
                <div className="min-w-0 flex-1">
                  <SheetTitle className="truncate">{text(m.name)}</SheetTitle>
                  {m.system && (
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                      <Badge
                        variant="neutral"
                        label={tc('system')}
                        icon={<Icon icon={LockIcon} size="xsm" />}
                        className="px-1.5 py-0"
                      />
                    </div>
                  )}
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

            <ModuleTabs key={m.id} module={m} all={all} onNavigate={onNavigate} />
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
