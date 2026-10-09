'use client';

import { localize } from '@isbp/sdk';
import { Button } from '@isbp/ui/button';
import { useListState } from '@isbp/ui/data-table';
import { EmptyState } from '@isbp/ui/empty-state';
import { PageHeader } from '@isbp/ui/page-header';
import { useApiMutation, useApiQuery } from '@isbp/ui/query';
import { Skeleton } from '@isbp/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@isbp/ui/tabs';
import {
  CalendarClockIcon,
  CircleAlertIcon,
  ClipboardCheckIcon,
  PackageIcon,
  PackageOpenIcon,
  ShieldAlertIcon,
  UsersIcon,
} from 'lucide-react';
import { DynamicIcon, type IconName } from 'lucide-react/dynamic';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { type ReactNode, useId, useMemo, useState } from 'react';
import { changeSetHref } from '../../contracts';
import { countByKind, groupByProcess, type PlanItem, planOfPackage } from '../../lib/processes';
import { useDescribe, useDescribeNames } from '../change-set/describe';
import { PermissionNamesProvider, usePermissionList } from '../change-set/permission-names';
import { Disclosure } from '../disclosure';
import { KindCounts } from '../kind-counts';
import {
  type AssistantStatusDto,
  type ChangeSetDetailDto,
  INVALIDATE,
  installPackagePath,
  isRecord,
  type PackageContentDto,
  packageContentPath,
  PACKAGES_PATH,
  type PackageInfoDto,
  type PackageListDto,
  STATUS_PATH,
  useCatalogText,
  useKindLabel,
} from '../lib';
import { ImportFile, Note, PackageError, useModuleName } from '../packages';

const TABS = ['builtin', 'file'] as const;
type Tab = (typeof TABS)[number];
const GROUP_KIND = 'core.group';
const JOB_KIND = 'scheduler.job';

/** A section of what a pack creates: a heading with its count and the lines under it. */
function Part({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="grid gap-2">
      <h5 id={id} className="flex items-center gap-2 text-sm font-semibold">
        <span className="text-muted-foreground [&_svg]:size-4" aria-hidden>
          {icon}
        </span>
        {title}
      </h5>
      {children}
    </section>
  );
}

/**
 * What a pack creates, by process: each request form with who approves it and the checklists that assign it, then
 * the groups to fill in after installing and the rest. Built from the package itself, in the reader's language.
 */
function PackContents({ pack }: { pack: PackageInfoDto }) {
  const t = useTranslations('assistant.packs');
  const locale = useLocale();
  const { data, isLoading, error } = useApiQuery<PackageContentDto>(
    packageContentPath(pack.moduleId, pack.key),
  );
  const plan = useMemo<PlanItem[]>(
    () =>
      data ? planOfPackage(data.items as never).map((p, i) => ({ ...p, label: data.items[i]!.label })) : [],
    [data],
  );
  const names = useDescribeNames(plan);
  const describe = useDescribe(plan, names);
  const grouping = useMemo(() => groupByProcess(plan), [plan]);
  const status = useApiQuery<AssistantStatusDto>(STATUS_PATH);
  const kindLabel = useKindLabel(status.data?.kinds);
  if (isLoading)
    return (
      <div className="grid gap-2" aria-busy="true">
        <Skeleton className="h-5 w-1/2" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    );
  if (error || !data) return <PackageError error={error} />;

  const byId = new Map(plan.map((p) => [p.id, p]));
  const processes = grouping.groups.filter((g) => g.type === 'process');
  const groups = plan.filter((p) => p.kind === GROUP_KIND && p.op === 'create');
  const rest = plan.filter(
    (p) =>
      !grouping.groupOf.get(p.id)?.startsWith('process:') && !(p.kind === GROUP_KIND && p.op === 'create'),
  );
  const text = (v: unknown) => (isRecord(v) ? localize(v.description as never, locale) : '');

  return (
    <div className="grid min-w-0 gap-5">
      {processes.length > 0 && (
        <Part icon={<ClipboardCheckIcon />} title={t('contents.processes', { count: processes.length })}>
          <ul className="grid gap-3">
            {processes.map((g) => {
              const form = byId.get(g.anchorId!)!;
              const jobs = g.itemIds.map((i) => byId.get(i)!).filter((i) => i.kind === JOB_KIND);
              return (
                <li key={g.id} className="grid min-w-0 gap-0.5 rounded-lg border bg-card px-3 py-2 text-sm">
                  <span className="font-medium break-words">{form.label}</span>
                  {describe(form).map((line, i) => (
                    <span key={i} className="break-words text-muted-foreground">
                      {line}
                    </span>
                  ))}
                  {jobs.map((j) => (
                    <span key={j.id} className="flex min-w-0 items-start gap-1.5 text-muted-foreground">
                      <CalendarClockIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                      <span className="min-w-0 break-words">{text(j.value) || j.label}</span>
                    </span>
                  ))}
                </li>
              );
            })}
          </ul>
        </Part>
      )}
      {groups.length > 0 && (
        <Part icon={<UsersIcon />} title={t('contents.groups', { count: groups.length })}>
          <p className="text-sm text-muted-foreground">{t('contents.groupsHint')}</p>
          <ul className="grid gap-1 text-sm">
            {groups.map((g) => (
              <li key={g.id} className="min-w-0 break-words">
                <span className="font-medium">{g.label}</span>
                {text(g.value) && <span className="text-muted-foreground"> · {text(g.value)}</span>}
              </li>
            ))}
          </ul>
        </Part>
      )}
      {rest.length > 0 && (
        <Part icon={<PackageIcon />} title={t('contents.other', { count: rest.length })}>
          <ul className="grid gap-1 text-sm">
            {rest.map((r) => (
              <li key={r.id} className="min-w-0 break-words">
                <span className="text-muted-foreground">{kindLabel(r.kind)}: </span>
                <span className="font-medium">{r.label}</span>
                {text(r.value) && <span className="text-muted-foreground"> · {text(r.value)}</span>}
              </li>
            ))}
          </ul>
        </Part>
      )}
    </div>
  );
}

/** What a pack adds up to, from its content ("21 processes · 5 groups you fill in after installing · …"). */
function PackCounts({ pack }: { pack: PackageInfoDto }) {
  const t = useTranslations('assistant.packs');
  const status = useApiQuery<AssistantStatusDto>(STATUS_PATH);
  const kindLabel = useKindLabel(status.data?.kinds);
  const { data } = useApiQuery<PackageContentDto>(packageContentPath(pack.moduleId, pack.key));
  const tally = useMemo(() => (data ? countByKind(planOfPackage(data.items as never)) : null), [data]);
  if (!tally) return <Skeleton className="h-4 w-2/3" />;
  return (
    <KindCounts
      processes={tally.processes}
      kinds={tally.kinds}
      kindLabel={kindLabel}
      overrides={{ [GROUP_KIND]: (count) => t('groupsToFill', { count }) }}
      className="text-sm"
    />
  );
}

/** One built-in pack: what it is, what it creates, whether the viewer may install it, and the way to review it. */
function PackCard({
  pack,
  onInstall,
  installing,
  disabled,
}: {
  pack: PackageInfoDto;
  onInstall: () => void;
  installing: boolean;
  disabled: boolean;
}) {
  const t = useTranslations('assistant.packs');
  const text = useCatalogText();
  const moduleName = useModuleName();
  const permissionList = usePermissionList();
  const id = useId();
  const r = pack.requirements;
  const why = [
    ...(r.missingModules.length
      ? [t('missingModules', { modules: r.missingModules.map(moduleName).join(', ') })]
      : []),
    ...(r.unknownKinds.length ? [t('unknownKinds', { kinds: r.unknownKinds.join(', ') })] : []),
    ...(r.unreadableKinds.length
      ? [t('unreadable', { permissions: permissionList(r.unreadableKinds.map((k) => k.permission)) })]
      : []),
    ...(r.unsupported.length ? [t('unsupported')] : []),
  ];
  return (
    <article
      aria-labelledby={`${id}-name`}
      className="min-w-0 overflow-hidden rounded-xl border bg-card shadow-xs"
    >
      <div className="grid gap-4 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
            {pack.icon ? (
              <DynamicIcon name={pack.icon as IconName} className="size-5" aria-hidden />
            ) : (
              <PackageIcon className="size-5" aria-hidden />
            )}
          </span>
          <div className="min-w-0 space-y-1.5">
            <h3 id={`${id}-name`} className="text-base font-semibold break-words">
              {text(pack.name)}
            </h3>
            <p className="text-xs text-muted-foreground">
              {t('from', { module: moduleName(pack.moduleId) })}
            </p>
            <p className="text-sm break-words text-muted-foreground">{text(pack.description)}</p>
            {/* What it holds, even for people who can't install it: they know what to ask for. */}
            <PackCounts pack={pack} />
            {why.map((w) => (
              <Note key={w} icon={CircleAlertIcon} tone="warning">
                {w}
              </Note>
            ))}
            {pack.canPropose && !pack.canApply && (
              <Note icon={ShieldAlertIcon} tone="info">
                {t('needsReviewer')}
              </Note>
            )}
          </div>
        </div>
        <Button
          className="justify-self-start"
          disabled={!pack.canPropose || disabled}
          loading={installing}
          aria-describedby={`${id}-name`}
          onClick={onInstall}
        >
          {t('review')}
        </Button>
      </div>
      <Disclosure title={t('contents.title')} icon={<PackageOpenIcon />} level={4}>
        <PackContents pack={pack} />
      </Disclosure>
    </article>
  );
}

/** The built-in packs of enabled modules. Installing one makes a draft change set and opens it for review. */
function BuiltinPacks({ onCreated }: { onCreated: (detail: ChangeSetDetailDto) => void }) {
  const t = useTranslations('assistant.packs');
  const list = useApiQuery<PackageListDto>(PACKAGES_PATH);
  const install = useApiMutation(
    (api, p: PackageInfoDto) => api.post<ChangeSetDetailDto>(installPackagePath(p.moduleId, p.key), {}),
    {
      invalidate: INVALIDATE,
      silent: true,
      success: (d) => t('installed', { reference: d.reference }),
      onSuccess: (d) => onCreated(d),
    },
  );
  const installing = install.isPending ? install.variables : null;

  if (list.isLoading)
    return (
      <div className="grid gap-3" aria-busy="true">
        <Skeleton className="h-32 w-full rounded-xl" />
        <Skeleton className="h-32 w-full rounded-xl" />
      </div>
    );
  if (list.error) return <PackageError error={list.error} />;
  const items = list.data?.items ?? [];
  if (!items.length)
    return (
      <div className="rounded-xl border border-dashed">
        <EmptyState icon={<PackageOpenIcon />} title={t('empty')} description={t('emptyHint')} />
      </div>
    );
  return (
    <PermissionNamesProvider roles={list.data?.permissionRoles}>
      <div className="grid gap-3">
        <ul className="grid gap-4" aria-label={t('listLabel')}>
          {items.map((p) => (
            <li key={`${p.moduleId}/${p.key}`} className="min-w-0">
              <PackCard
                pack={p}
                onInstall={() => install.mutate(p)}
                installing={installing?.moduleId === p.moduleId && installing.key === p.key}
                disabled={install.isPending}
              />
            </li>
          ))}
        </ul>
        {install.error ? <PackageError error={install.error} /> : null}
      </div>
    </PermissionNamesProvider>
  );
}

/**
 * Process packs (`/assistant/packs`): the ready-made processes modules ship — request forms, who approves them and
 * the checklists they assign — read before installing, and a package file from another environment. Either becomes a
 * draft change set that opens for review; nothing is live until someone applies it.
 */
export default function PacksPage() {
  const t = useTranslations('assistant.packs');
  const router = useRouter();
  const [state, set] = useListState();
  const urlTab: Tab = state.tab === 'file' ? 'file' : 'builtin';
  // The tab switches at once; the URL (shareable, back button) follows when the router gets there.
  const [picked, setPicked] = useState<Tab | null>(null);
  if (picked && picked === urlTab) setPicked(null);
  const tab = picked ?? urlTab;
  const created = (detail: ChangeSetDetailDto) => router.push(changeSetHref(detail.id));
  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('description')}
        back={{ href: '/assistant/change-sets', label: t('back') }}
      />
      <Tabs
        value={tab}
        onValueChange={(v) => {
          setPicked(v as Tab);
          set({ tab: v === 'builtin' ? undefined : v });
        }}
        className="min-w-0"
      >
        <TabsList aria-label={t('tabsLabel')}>
          {TABS.map((x) => (
            <TabsTrigger key={x} value={x}>
              {t(`tabs.${x}`)}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="builtin" className="min-w-0 pt-2">
          {tab === 'builtin' && <BuiltinPacks onCreated={created} />}
        </TabsContent>
        <TabsContent value="file" className="min-w-0 pt-2">
          {tab === 'file' && (
            <div className="max-w-2xl rounded-xl border bg-card p-4 shadow-xs">
              <ImportFile onCreated={created} />
            </div>
          )}
        </TabsContent>
      </Tabs>
    </>
  );
}
