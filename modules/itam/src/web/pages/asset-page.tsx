'use client';

import type { Page } from '@isbp/sdk';
import { localize } from '@isbp/sdk';
import type { WebPageProps } from '@isbp/sdk/web';
import { cn } from '@isbp/ui';
import { UserAvatar } from '@isbp/ui/avatar';
import { Badge } from '@isbp/ui/badge';
import { Button } from '@isbp/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@isbp/ui/card';
import { EmptyState } from '@isbp/ui/empty-state';
import { safeUrl } from '@isbp/ui/markdown';
import { FadeIn } from '@isbp/ui/motion';
import { useApiQuery } from '@isbp/ui/query';
import { DateTime, RelativeTime } from '@isbp/ui/relative-time';
import { Skeleton } from '@isbp/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@isbp/ui/tabs';
import {
  ArchiveRestoreIcon,
  ArrowLeftIcon,
  ArrowRightLeftIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  EraserIcon,
  FileQuestionIcon,
  FileTextIcon,
  GavelIcon,
  HistoryIcon,
  type LucideIcon,
  NetworkIcon,
  PencilIcon,
  PlusCircleIcon,
  RecycleIcon,
  ShieldAlertIcon,
  StickyNoteIcon,
  CalendarClockIcon,
  Undo2Icon,
  UserPlusIcon,
  UserRoundXIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { type ReactNode, useState } from 'react';
import type { AssetDetail, AssetEvent, AssetSoftware, ContractListItem } from '../../contracts';
import { type AssetAction, AssetActionDialog } from '../asset-actions';
import { AssetFormDialog } from '../asset-form-dialog';
import {
  ApprovalBadge,
  AssetStatusBadge,
  CategoryIcon,
  CategoryLabel,
  ContractStatusBadge,
  WarrantyEnd,
  WipeBadge,
} from '../badges';
import { CustomFieldsCard } from '../custom-fields';
import { contractHref, licenseHref, modelLabel, useDay, useMoney } from '../lib';
import { DepreciationBar } from '../meters';
import { LinksAndFiles } from '../record-panels';

type Tab = 'overview' | 'software' | 'contracts' | 'history' | 'links';

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] gap-3 py-2 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 wrap-anywhere">
        {children ?? <span className="text-muted-foreground">—</span>}
      </dd>
    </div>
  );
}

const DL =
  'grid gap-x-8 sm:grid-cols-2 [&>div]:border-b [&>div:nth-last-child(-n+1)]:border-0 sm:[&>div:nth-last-child(-n+2)]:border-0';

export default function AssetPage({ params }: WebPageProps) {
  const t = useTranslations('itam');
  const money = useMoney();
  const day = useDay();
  const {
    data: asset,
    isLoading,
    error,
  } = useApiQuery<AssetDetail>(`/itam/assets/${encodeURIComponent(params.ref ?? '')}`);
  const [tab, setTab] = useState<Tab>('overview');
  const [action, setAction] = useState<AssetAction | null>(null);
  const [editing, setEditing] = useState(false);

  if (isLoading)
    return (
      <div className="space-y-6">
        <Skeleton className="h-5 w-40" />
        <div className="flex items-center gap-4">
          <Skeleton className="size-12 rounded-xl" />
          <div className="space-y-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-7 w-64" />
          </div>
        </div>
        <Skeleton className="h-72 w-full rounded-xl" />
      </div>
    );
  if (error || !asset) return <EmptyState icon={<FileQuestionIcon />} title={t('asset.notFound')} />;

  const v = asset.viewer;
  const dep = asset.depreciation;

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" asChild className="-ml-2 text-muted-foreground">
        <Link href="/itam/hardware">
          <ArrowLeftIcon /> {t('hardware.title')}
        </Link>
      </Button>

      <FadeIn y={4} className="flex flex-col gap-4 lg:flex-row lg:items-start">
        <div className="flex min-w-0 flex-1 items-start gap-4">
          <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
            <CategoryIcon category={asset.category} className="size-6" />
          </span>
          <div className="min-w-0 flex-1 space-y-1.5">
            <p className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
              <span className="font-mono">{asset.tag}</span>
              <span aria-hidden>·</span>
              <span>{t(`category.${asset.category}`)}</span>
              {asset.model && (
                <>
                  <span aria-hidden>·</span>
                  <span className="min-w-0 truncate">{modelLabel(asset.model)}</span>
                </>
              )}
            </p>
            <h1 className="text-2xl font-semibold tracking-tight wrap-anywhere">{asset.name}</h1>
            <div className="flex flex-wrap items-center gap-2">
              <AssetStatusBadge status={asset.status} />
              {asset.warrantyState === 'expiring' || asset.warrantyState === 'expired' ? (
                <Badge variant={asset.warrantyState === 'expired' ? 'destructive' : 'warning'}>
                  <ShieldAlertIcon aria-hidden />
                  {t(`warranty.badge.${asset.warrantyState}`)}
                </Badge>
              ) : null}
              <WipeBadge state={asset.wipeState} date={asset.wipeDue} />
            </div>
          </div>
        </div>
        {v.canManage && (
          <div className="flex shrink-0 flex-wrap gap-2">
            {v.canAssign && (
              <Button onClick={() => setAction('assign')}>
                {asset.assignee ? <ArrowRightLeftIcon /> : <UserPlusIcon />}
                {asset.assignee ? t('actions.reassign') : t('actions.assign')}
              </Button>
            )}
            {v.canReturn && (
              <Button variant="outline" onClick={() => setAction('return')}>
                <Undo2Icon /> {t('actions.return')}
              </Button>
            )}
            {v.transitions.length > 0 && (
              <Button variant="outline" onClick={() => setAction('status')}>
                <ArchiveRestoreIcon /> {t('actions.changeStatus')}
              </Button>
            )}
            <Button variant="outline" onClick={() => setEditing(true)}>
              <PencilIcon /> {t('actions.edit')}
            </Button>
            {v.canRecordWipe && (
              <Button variant="outline" onClick={() => setAction('wipe')}>
                <EraserIcon /> {t('wipe.action')}
              </Button>
            )}
            {v.canDispose && (
              <Button variant="outline" onClick={() => setAction('dispose')}>
                <RecycleIcon /> {t('actions.requestDisposal')}
              </Button>
            )}
          </div>
        )}
      </FadeIn>

      <Banners asset={asset} />

      <Tabs value={tab} onValueChange={(x) => setTab(x as Tab)}>
        <TabsList className="max-w-full justify-start overflow-x-auto">
          <TabsTrigger value="overview">{t('asset.tabs.overview')}</TabsTrigger>
          <TabsTrigger value="software">{t('asset.tabs.software')}</TabsTrigger>
          <TabsTrigger value="contracts">{t('asset.tabs.contracts')}</TabsTrigger>
          <TabsTrigger value="history">{t('asset.tabs.history')}</TabsTrigger>
          <TabsTrigger value="links">{t('asset.tabs.links')}</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="grid min-w-0 grid-cols-1 items-start gap-6 lg:grid-cols-3">
          <div className="min-w-0 space-y-6 lg:col-span-2">
            <Card>
              <CardHeader>
                <CardTitle>{t('asset.details')}</CardTitle>
              </CardHeader>
              <CardContent>
                <dl className={DL}>
                  <Field label={t('fields.tag')}>
                    <span className="font-mono text-xs">{asset.tag}</span>
                  </Field>
                  <Field label={t('fields.serialNumber')}>
                    {asset.serialNumber && <span className="font-mono text-xs">{asset.serialNumber}</span>}
                  </Field>
                  <Field label={t('fields.category')}>
                    <CategoryLabel category={asset.category} />
                  </Field>
                  <Field label={t('fields.model')}>{asset.model && modelLabel(asset.model)}</Field>
                  <Field label={t('fields.status')}>
                    <AssetStatusBadge status={asset.status} />
                  </Field>
                  <Field label={t('fields.department')}>{asset.department?.name}</Field>
                  <Field label={t('fields.location')}>{asset.location}</Field>
                  <Field label={t('fields.retireOn')}>{asset.retireOn && day(asset.retireOn)}</Field>
                  <Field label={t('fields.created')}>
                    <DateTime date={asset.createdAt} />
                  </Field>
                  <Field label={t('fields.updated')}>
                    <RelativeTime date={asset.updatedAt} />
                  </Field>
                </dl>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>{t('asset.finance')}</CardTitle>
                <CardDescription>{t('asset.financeHint')}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <dl className={DL}>
                  <Field label={t('fields.vendor')}>{asset.vendor?.name}</Field>
                  <Field label={t('fields.invoiceNumber')}>{asset.invoiceNumber}</Field>
                  <Field label={t('fields.purchaseDate')}>
                    {asset.purchaseDate && day(asset.purchaseDate)}
                  </Field>
                  <Field label={t('fields.purchaseCost')}>
                    {asset.purchaseCost !== null && money(asset.purchaseCost, asset.currency)}
                  </Field>
                  <Field label={t('fields.warrantyEnd')}>
                    <WarrantyEnd date={asset.warrantyEnd} state={asset.warrantyState} />
                  </Field>
                  <Field label={t('fields.bookValue')}>
                    {dep && <span className="font-medium">{money(dep.bookValue, asset.currency)}</span>}
                  </Field>
                </dl>
                {dep && asset.purchaseCost !== null && (
                  <div className="grid gap-1.5 rounded-lg border p-3">
                    <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                      <span className="font-medium">{t('finance.depreciation')}</span>
                      <span className="text-xs text-muted-foreground">
                        {t('finance.lifespan', { months: dep.lifespanMonths, age: dep.ageMonths })}
                      </span>
                    </div>
                    <DepreciationBar
                      cost={asset.purchaseCost}
                      bookValue={dep.bookValue}
                      depreciatedPercent={dep.depreciatedPercent}
                      currency={asset.currency}
                    />
                    <p className="text-xs text-muted-foreground">
                      {t('finance.fullyDepreciated', { date: day(dep.fullyDepreciatedOn) })}
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
            {asset.notes && (
              <Card>
                <CardHeader>
                  <CardTitle>{t('fields.notes')}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm leading-relaxed whitespace-pre-wrap">{asset.notes}</p>
                </CardContent>
              </Card>
            )}
            <CustomFieldsCard entityType="itam.asset" attributes={asset.attributes} />
          </div>
          <div className="min-w-0 space-y-6">
            <AssignmentCard asset={asset} onAssign={v.canAssign ? () => setAction('assign') : undefined} />
            {asset.dataBearing && (
              <WipeCard asset={asset} onRecord={v.canRecordWipe ? () => setAction('wipe') : undefined} />
            )}
            <CiCard asset={asset} />
          </div>
        </TabsContent>

        <TabsContent value="software" className="min-w-0">
          {tab === 'software' && <SoftwareTab asset={asset} />}
        </TabsContent>
        <TabsContent value="contracts" className="min-w-0">
          {tab === 'contracts' &&
            (v.canReadContracts ? (
              <ContractsTab asset={asset} />
            ) : (
              <EmptyState icon={<FileTextIcon />} title={t('asset.contractsHidden')} />
            ))}
        </TabsContent>
        <TabsContent value="history" className="min-w-0">
          {tab === 'history' && <HistoryTab asset={asset} />}
        </TabsContent>
        <TabsContent value="links" className="min-w-0">
          {tab === 'links' && <LinksAndFiles type="itam.asset" id={asset.id} />}
        </TabsContent>
      </Tabs>

      <AssetActionDialog asset={asset} action={action} onClose={() => setAction(null)} />
      {v.canManage && <AssetFormDialog open={editing} onOpenChange={setEditing} asset={asset} />}
    </div>
  );
}

function Banners({ asset }: { asset: AssetDetail }) {
  const t = useTranslations('itam.asset');
  const format = useFormatter();
  const box = 'flex items-start gap-2 rounded-lg border px-4 py-3 text-sm';
  if (asset.disposalInstanceId)
    return (
      <p className={cn(box, 'border-warning/40 bg-warning/10')}>
        <GavelIcon className="mt-0.5 size-4 shrink-0 text-warning-foreground" aria-hidden />
        <span>
          {t('disposalPending')}{' '}
          {asset.disposalNote && <span className="text-muted-foreground">“{asset.disposalNote}”</span>}
        </span>
      </p>
    );
  if (asset.status === 'disposed')
    return (
      <p className={cn(box, 'bg-muted/50 text-muted-foreground')}>
        <RecycleIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>
          {t('disposedBanner', {
            date: asset.disposedAt
              ? format.dateTime(new Date(asset.disposedAt), { dateStyle: 'medium' })
              : '—',
          })}
          {asset.disposalNote && <> “{asset.disposalNote}”</>}
        </span>
      </p>
    );
  if (asset.status === 'lost')
    return (
      <p className={cn(box, 'border-destructive/30 bg-destructive/5 text-destructive')}>
        <CircleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
        {t('lostBanner')}
      </p>
    );
  return null;
}

function AssignmentCard({ asset, onAssign }: { asset: AssetDetail; onAssign?: () => void }) {
  const t = useTranslations('itam.asset');
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('assignment')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {asset.assignee ? (
          <>
            <div className="flex min-w-0 items-center gap-3">
              <UserAvatar
                name={asset.assignee.displayName}
                src={asset.assignee.avatarUrl}
                className="size-10"
              />
              <div className="min-w-0">
                <p className="truncate font-medium">{asset.assignee.displayName}</p>
                {asset.assignee.email && (
                  <p className="truncate text-sm text-muted-foreground">{asset.assignee.email}</p>
                )}
              </div>
            </div>
            {asset.assignedAt && (
              <p className="text-sm text-muted-foreground">
                {t('since')} <RelativeTime date={asset.assignedAt} />
              </p>
            )}
          </>
        ) : (
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <UserRoundXIcon className="size-5 shrink-0" aria-hidden />
            {t('unassigned')}
          </div>
        )}
        {!asset.assignee && onAssign && (
          <Button variant="outline" size="sm" onClick={onAssign}>
            <UserPlusIcon /> {t('assignSomeone')}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

/** Data retention and wipes of a device that stores data: the pending wipe and the last recorded one. */
function WipeCard({ asset, onRecord }: { asset: AssetDetail; onRecord?: () => void }) {
  const t = useTranslations('itam.wipe');
  const tm = useTranslations('itam.wipeMethod');
  const day = useDay();
  const format = useFormatter();
  const w = asset.lastWipe;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <EraserIcon className="size-4 text-primary" aria-hidden />
          {t('cardTitle')}
        </CardTitle>
        <CardDescription>{t('cardHint')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {asset.wipeDue ? (
          <dl className="grid gap-2">
            {asset.dataRetainUntil && (
              <div className="flex flex-wrap justify-between gap-2">
                <dt className="text-muted-foreground">{t('retainUntil')}</dt>
                <dd>{day(asset.dataRetainUntil)}</dd>
              </div>
            )}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <dt className="text-muted-foreground">{t('due')}</dt>
              <dd>
                <WipeBadge state={asset.wipeState} date={asset.wipeDue} />
              </dd>
            </div>
          </dl>
        ) : (
          <p className="text-muted-foreground">{t('nonePending')}</p>
        )}
        {w ? (
          <p className="flex items-start gap-2 text-muted-foreground">
            <CircleCheckIcon className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
            <span>
              {t('last', {
                date: format.dateTime(new Date(w.at), { dateStyle: 'medium', timeStyle: 'short' }),
                method: w.method ? tm(w.method) : '—',
                name: w.by?.displayName ?? '—',
              })}
            </span>
          </p>
        ) : null}
        {onRecord && (
          <Button variant="outline" size="sm" onClick={onRecord}>
            <EraserIcon /> {t('action')}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function CiCard({ asset }: { asset: AssetDetail }) {
  const t = useTranslations('itam.asset');
  const locale = useLocale();
  const ci = asset.ciDetail;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <NetworkIcon className="size-4 text-primary" aria-hidden />
          {t('ci')}
        </CardTitle>
        <CardDescription>{t('ciHint')}</CardDescription>
      </CardHeader>
      <CardContent>
        {ci ? (
          <Link
            href={`/cmdb/${ci.reference}`}
            className="flex min-w-0 flex-col gap-1 rounded-lg border p-3 outline-none transition-colors hover:bg-accent/60 focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <span className="truncate font-medium">{ci.name}</span>
            <span className="truncate text-xs text-muted-foreground">
              <span className="font-mono">{ci.reference}</span>
              {ci.className ? ` · ${localize(ci.className, locale)}` : ''} · {t(`ciStatus.${ci.status}`)}
            </span>
          </Link>
        ) : (
          <p className="text-sm text-muted-foreground">{t('noCi')}</p>
        )}
      </CardContent>
    </Card>
  );
}

function SoftwareTab({ asset }: { asset: AssetDetail }) {
  const t = useTranslations('itam.asset');
  const tt = useTranslations('itam.licenseType');
  const { data, isLoading } = useApiQuery<AssetSoftware>(`/itam/assets/${asset.id}/software`);
  if (isLoading || !data) return <Skeleton className="h-48 w-full rounded-xl" />;
  const unlicensed = data.installations.filter((i) => i.managed && !i.licensed).length;
  return (
    <div className="grid min-w-0 grid-cols-1 items-start gap-6 lg:grid-cols-3">
      <Card className="min-w-0 lg:col-span-2">
        <CardHeader>
          <CardTitle>{t('installed')}</CardTitle>
          <CardDescription>
            {unlicensed ? t('unlicensedCount', { count: unlicensed }) : t('installedHint')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {data.installations.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('noInstalls')}</p>
          ) : (
            <ul className="divide-y">
              {data.installations.map((i) => (
                <li key={i.id} className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{i.product}</span>
                    {i.reportedAs && (
                      <span className="block truncate text-xs text-muted-foreground">
                        {t('reportedAs', { title: i.reportedAs })}
                      </span>
                    )}
                  </span>
                  <span className="text-xs text-muted-foreground tabular-nums">{i.version ?? ''}</span>
                  {i.approval !== 'allowed' && <ApprovalBadge approval={i.approval} />}
                  {i.managed ? (
                    i.licensed ? (
                      <Badge variant="success">
                        <CircleCheckIcon aria-hidden />
                        {t('licensed')}
                      </Badge>
                    ) : (
                      <Badge variant="destructive">
                        <CircleAlertIcon aria-hidden />
                        {t('unlicensed')}
                      </Badge>
                    )
                  ) : (
                    <Badge variant="muted">{t('notManaged')}</Badge>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      <Card className="min-w-0">
        <CardHeader>
          <CardTitle>{t('seats')}</CardTitle>
          <CardDescription>{t('seatsHint')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {[
            { title: t('deviceSeats'), items: data.licenses.map((l) => l.license) },
            { title: t('userSeats', { name: asset.assignee?.displayName ?? '—' }), items: data.userLicenses },
          ].map((group) => (
            <div key={group.title} className="grid gap-1">
              <h3 className="text-xs font-medium text-muted-foreground">{group.title}</h3>
              {group.items.length === 0 ? (
                <p className="text-sm text-muted-foreground">—</p>
              ) : (
                <ul className="grid gap-1">
                  {group.items.map((l) => (
                    <li key={l.id} className="min-w-0 text-sm">
                      <Link
                        href={licenseHref(l)}
                        className="block truncate hover:underline focus-visible:underline"
                      >
                        {l.product}
                      </Link>
                      <span className="text-xs text-muted-foreground">
                        <span className="font-mono">{l.reference}</span> · {tt(l.licenseType)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function ContractsTab({ asset }: { asset: AssetDetail }) {
  const t = useTranslations('itam');
  const day = useDay();
  const { data, isLoading } = useApiQuery<{ items: ContractListItem[] }>(
    `/itam/assets/${asset.id}/contracts`,
  );
  if (isLoading || !data) return <Skeleton className="h-32 w-full rounded-xl" />;
  if (!data.items.length)
    return (
      <EmptyState
        icon={<FileTextIcon />}
        title={t('asset.noContracts')}
        description={t('asset.noContractsHint')}
      />
    );
  return (
    <Card>
      <CardContent className="pt-6">
        <ul className="divide-y">
          {data.items.map((c) => (
            <li key={c.id} className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 py-3 text-sm">
              <span className="font-mono text-xs text-muted-foreground">{c.reference}</span>
              <Link
                href={contractHref(c)}
                className="min-w-0 flex-1 truncate font-medium hover:underline focus-visible:underline"
              >
                {c.title}
              </Link>
              <span className="text-muted-foreground">{c.vendor?.name}</span>
              <span className="text-muted-foreground">{t(`contractKind.${c.kind}`)}</span>
              <span className="tabular-nums">{day(c.endDate)}</span>
              <ContractStatusBadge status={c.status} />
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

const EVENT_ICON: Record<AssetEvent['kind'], LucideIcon> = {
  created: PlusCircleIcon,
  status_changed: ArchiveRestoreIcon,
  assigned: UserPlusIcon,
  returned: Undo2Icon,
  updated: PencilIcon,
  note: StickyNoteIcon,
  return_requested: UserRoundXIcon,
  disposal_requested: GavelIcon,
  disposed: RecycleIcon,
  wipe_scheduled: CalendarClockIcon,
  data_wiped: EraserIcon,
};

/** "via ServiceDesk Plus #1234": a step a sync with another system made, linking to its record there. */
function Via({ via }: { via: NonNullable<AssetEvent['via']> }) {
  const t = useTranslations('itam.history');
  const text = t('via', { system: via.connection, reference: via.ref });
  const url = via.url ? safeUrl(via.url) : '';
  return url ? (
    <a
      href={url}
      target="_blank"
      rel="noreferrer noopener"
      className="underline underline-offset-4 hover:text-foreground focus-visible:text-foreground focus-visible:outline-none"
    >
      {text}
    </a>
  ) : (
    <span>{text}</span>
  );
}

function HistoryTab({ asset }: { asset: AssetDetail }) {
  const t = useTranslations('itam');
  const day = useDay();
  const [pageSize, setPageSize] = useState(30);
  const { data, isLoading, isFetching } = useApiQuery<Page<AssetEvent>>(`/itam/assets/${asset.id}/events`, {
    pageSize,
  });
  if (isLoading || !data) return <Skeleton className="h-48 w-full rounded-xl" />;
  const statusText = (v: string | null) =>
    v && t.has(`status.${v}`) ? t(`status.${v as 'deployed'}`) : (v ?? '—');
  const sentence = (e: AssetEvent) => {
    switch (e.kind) {
      case 'created':
        return t('history.created', { status: statusText(e.toValue) });
      case 'assigned':
        return t('history.assigned', { name: e.user?.displayName ?? e.toValue ?? '—' });
      case 'returned':
        return t('history.returned', {
          name: e.user?.displayName ?? e.fromValue ?? '—',
          status: statusText(e.toValue),
        });
      case 'status_changed':
        return t('history.statusChanged', { from: statusText(e.fromValue), to: statusText(e.toValue) });
      case 'updated':
        return t('history.updated');
      case 'return_requested':
        return t('history.returnRequested', { name: e.user?.displayName ?? '—' });
      case 'disposal_requested':
        return t('history.disposalRequested');
      case 'disposed':
        return t('history.disposed');
      case 'wipe_scheduled':
        return e.fromValue
          ? t('history.wipeScheduledRetained', { retain: day(e.fromValue), due: day(e.toValue) })
          : t('history.wipeScheduled', { due: day(e.toValue) });
      case 'data_wiped':
        return t('history.dataWiped', {
          method:
            e.toValue && t.has(`wipeMethod.${e.toValue}`) ? t(`wipeMethod.${e.toValue as 'other'}`) : '—',
          name: e.user?.displayName ?? '—',
        });
      default:
        return e.toValue === 'disposal_rejected'
          ? t('history.disposalRejected')
          : e.toValue === 'disposal_cancelled'
            ? t('history.disposalCancelled')
            : t('history.note');
    }
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <HistoryIcon className="size-4 text-primary" aria-hidden />
          {t('asset.tabs.history')}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ol className="relative grid gap-5 border-l pl-6">
          {data.items.map((e) => {
            const Icon = EVENT_ICON[e.kind] ?? StickyNoteIcon;
            return (
              <li key={e.id} className="relative min-w-0">
                <span className="absolute top-0 -left-[2.15rem] grid size-7 place-items-center rounded-full border bg-card text-muted-foreground">
                  <Icon className="size-3.5" aria-hidden />
                </span>
                <p className="text-sm font-medium wrap-anywhere">{sentence(e)}</p>
                {e.kind === 'updated' && e.note && (
                  <p className="text-xs text-muted-foreground">{t('history.fields', { fields: e.note })}</p>
                )}
                {e.kind !== 'updated' && e.note && (
                  <p className="mt-0.5 text-sm whitespace-pre-wrap text-muted-foreground">{e.note}</p>
                )}
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {e.actor ? `${e.actor.displayName} · ` : `${t('history.system')} · `}
                  {e.via && (
                    <>
                      <Via via={e.via} />
                      {' · '}
                    </>
                  )}
                  {e.request && (
                    <>
                      <Link
                        href={e.request.href}
                        className="underline underline-offset-4 hover:text-foreground focus-visible:text-foreground focus-visible:outline-none"
                      >
                        {t('history.viaRequest', { reference: e.request.reference })}
                      </Link>
                      {' · '}
                    </>
                  )}
                  <RelativeTime date={e.createdAt} />
                </p>
              </li>
            );
          })}
        </ol>
        {data.total > data.items.length && (
          <Button
            variant="outline"
            size="sm"
            className="mt-4"
            loading={isFetching}
            onClick={() => setPageSize((n) => n + 30)}
          >
            {t('history.more')}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
