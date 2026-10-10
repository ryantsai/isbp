'use client';

import type { WebPageProps } from '@isbp/sdk/web';
import { UserAvatar } from '@isbp/ui/avatar';
import { Badge } from '@isbp/ui/badge';
import { Button } from '@isbp/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@isbp/ui/card';
import { EmptyState } from '@isbp/ui/empty-state';
import { Markdown } from '@isbp/ui/markdown';
import { FadeIn } from '@isbp/ui/motion';
import { useApiMutation, useApiQuery } from '@isbp/ui/query';
import { RelativeTime } from '@isbp/ui/relative-time';
import { Skeleton } from '@isbp/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@isbp/ui/tabs';
import {
  ArrowLeftIcon,
  BanIcon,
  FileQuestionIcon,
  FileTextIcon,
  KeyRoundIcon,
  ListChecksIcon,
  PencilIcon,
  PlayIcon,
  RefreshCwIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { type ReactNode, useState } from 'react';
import type { ContractDetail, HistoryEntry } from '../../contracts';
import { AssetStatusBadge, CategoryIcon, ContractStatusBadge } from '../badges';
import { ConfirmDialog } from '../confirm-dialog';
import { ContractFormDialog, ItemsDialog, RenewDialog } from '../contract-dialogs';
import { CustomFieldsCard } from '../custom-fields';
import { assetHref, INVALIDATE, licenseHref, useDay, useMoney } from '../lib';
import { RenewalTimeline } from '../meters';
import { LinksAndFiles } from '../record-panels';
import { RenewsIn } from '../renews-in';

type Tab = 'overview' | 'items' | 'history' | 'links';
type DialogKind = 'edit' | 'renew' | 'cancel' | 'items' | null;

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] gap-3 py-2 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 wrap-anywhere">
        {children ?? <span className="text-muted-foreground">—</span>}
      </dd>
    </div>
  );
}

export default function ContractPage({ params }: WebPageProps) {
  const t = useTranslations('itam');
  const money = useMoney();
  const day = useDay();
  const {
    data: c,
    isLoading,
    error,
  } = useApiQuery<ContractDetail>(`/itam/contracts/${encodeURIComponent(params.ref ?? '')}`);
  const [tab, setTab] = useState<Tab>('overview');
  const [dialog, setDialog] = useState<DialogKind>(null);
  const close = (open: boolean) => !open && setDialog(null);
  const cancel = useApiMutation(
    (api) => api.post<ContractDetail>(`/itam/contracts/${c!.id}/cancel`, { note: null }),
    {
      invalidate: INVALIDATE,
      success: (r) => t('contract.cancelled', { reference: r.reference }),
      onSuccess: () => setDialog(null),
    },
  );
  const activate = useApiMutation(
    (api) => api.patch<ContractDetail>(`/itam/contracts/${c!.id}`, { activate: true }),
    { invalidate: INVALIDATE, success: (r) => t('contract.activated', { reference: r.reference }) },
  );

  if (isLoading)
    return (
      <div className="space-y-5">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-10 w-96" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  if (error || !c) return <EmptyState icon={<FileQuestionIcon />} title={t('contract.notFound')} />;

  const manage = c.viewer.canManage;
  const assets = c.items.filter((i) => i.asset);
  const licenses = c.items.filter((i) => i.license);

  return (
    <div className="space-y-5">
      <Button variant="ghost" size="sm" asChild className="-ml-2 text-muted-foreground">
        <Link href="/itam/contracts">
          <ArrowLeftIcon /> {t('contracts.title')}
        </Link>
      </Button>

      <FadeIn y={4} className="flex flex-col gap-4 lg:flex-row lg:items-start">
        <div className="flex min-w-0 flex-1 items-start gap-4">
          <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
            <FileTextIcon className="size-6" aria-hidden />
          </span>
          <div className="min-w-0 flex-1 space-y-1.5">
            <p className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
              <span className="font-mono">{c.reference}</span>
              <span aria-hidden>·</span>
              <span>{t(`contractKind.${c.kind}`)}</span>
              {c.vendor && (
                <>
                  <span aria-hidden>·</span>
                  <span>{c.vendor.name}</span>
                </>
              )}
            </p>
            <h1 className="text-xl font-semibold tracking-tight wrap-anywhere">{c.title}</h1>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <ContractStatusBadge status={c.status} />
              {c.autoRenew && (
                <Badge variant="info">
                  <RefreshCwIcon aria-hidden />
                  {t('fields.autoRenew')}
                </Badge>
              )}
              <RenewsIn c={c} />
            </div>
          </div>
        </div>
        {manage && (
          <div className="flex shrink-0 flex-wrap gap-2">
            {c.status === 'draft' ? (
              <Button loading={activate.isPending} onClick={() => activate.mutate(undefined)}>
                <PlayIcon /> {t('contract.activate')}
              </Button>
            ) : (
              c.status !== 'cancelled' && (
                <Button onClick={() => setDialog('renew')}>
                  <RefreshCwIcon /> {t('contract.renew')}
                </Button>
              )
            )}
            <Button variant="outline" onClick={() => setDialog('edit')}>
              <PencilIcon /> {t('actions.edit')}
            </Button>
            {c.status !== 'cancelled' && (
              <Button variant="outline" onClick={() => setDialog('cancel')}>
                <BanIcon /> {t('contract.cancel')}
              </Button>
            )}
          </div>
        )}
      </FadeIn>

      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
        <TabsList className="max-w-full justify-start overflow-x-auto">
          <TabsTrigger value="overview">{t('contract.tabs.overview')}</TabsTrigger>
          <TabsTrigger value="items">
            {t('contract.tabs.items')}
            <Badge variant="muted" className="px-1.5 tabular-nums">
              {c.items.length}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="history">{t('contract.tabs.history')}</TabsTrigger>
          <TabsTrigger value="links">{t('contract.tabs.links')}</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="grid min-w-0 grid-cols-1 items-start gap-4 lg:grid-cols-3">
          <div className="min-w-0 space-y-5 lg:col-span-2">
            <Card>
              <CardHeader>
                <CardTitle>{t('contract.terms')}</CardTitle>
                <CardDescription>{t('contract.termsHint', { days: c.noticeDays })}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                <RenewalTimeline
                  startDate={c.startDate}
                  noticeDate={c.noticeDate}
                  endDate={c.endDate}
                  today={c.today}
                  autoRenew={c.autoRenew}
                />
                <dl className="grid gap-x-8 sm:grid-cols-2 [&>div]:border-b [&>div:nth-last-child(-n+1)]:border-0 sm:[&>div:nth-last-child(-n+2)]:border-0">
                  <Row label={t('fields.startDate')}>{c.startDate && day(c.startDate)}</Row>
                  <Row label={t('fields.endDate')}>{c.endDate && day(c.endDate)}</Row>
                  <Row label={t('fields.noticeDays')}>{t('contract.noticeDays', { days: c.noticeDays })}</Row>
                  <Row label={t('fields.autoRenew')}>
                    {c.autoRenew ? t('contract.yes') : t('contract.no')}
                  </Row>
                  <Row label={t('fields.cost')}>
                    {c.cost !== null && `${money(c.cost, c.currency)} · ${t(`billing.${c.billing}`)}`}
                  </Row>
                  <Row label={t('fields.annualCost')}>
                    {c.annualCost !== null && money(c.annualCost, c.currency)}
                  </Row>
                  <Row label={t('fields.owner')}>
                    {c.owner && (
                      <span className="inline-flex min-w-0 items-center gap-2">
                        <UserAvatar
                          name={c.owner.displayName}
                          src={c.owner.avatarUrl}
                          className="size-5 text-[9px]"
                        />
                        <span className="truncate">{c.owner.displayName}</span>
                      </span>
                    )}
                  </Row>
                  <Row label={t('fields.vendor')}>{c.vendor?.name}</Row>
                </dl>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>{t('fields.notes')}</CardTitle>
              </CardHeader>
              <CardContent>
                {c.notes ? (
                  <Markdown className="text-sm">{c.notes}</Markdown>
                ) : (
                  <p className="text-sm text-muted-foreground">{t('contract.noNotes')}</p>
                )}
              </CardContent>
            </Card>
            <CustomFieldsCard entityType="itam.contract" attributes={c.attributes} />
          </div>
          <div className="min-w-0 space-y-5">
            <Card>
              <CardHeader>
                <CardTitle>{t('contract.coverage')}</CardTitle>
                <CardDescription>
                  {t('contract.coverageSummary', { assets: assets.length, licenses: licenses.length })}
                </CardDescription>
                <CardAction>
                  <Button variant="ghost" size="sm" onClick={() => setTab('items')}>
                    {t('contract.viewItems')}
                  </Button>
                </CardAction>
              </CardHeader>
              {c.licenses.length > 0 && (
                <CardContent>
                  <h3 className="mb-1 text-xs font-medium text-muted-foreground">
                    {t('contract.linkedLicenses')}
                  </h3>
                  <ul className="grid gap-1 text-sm">
                    {c.licenses.map((l) => (
                      <li key={l.id} className="min-w-0 truncate">
                        <Link href={licenseHref(l)} className="hover:underline focus-visible:underline">
                          {l.product}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              )}
            </Card>
            {c.lastReminderFor && (
              <p className="text-sm text-muted-foreground">
                {t('contract.reminded', { date: day(c.lastReminderFor) })}
              </p>
            )}
          </div>
        </TabsContent>

        <TabsContent value="items" className="min-w-0">
          <Card>
            <CardHeader>
              <CardTitle>{t('contract.tabs.items')}</CardTitle>
              <CardDescription>{t('contract.itemsHint')}</CardDescription>
              {manage && (
                <CardAction>
                  <Button variant="outline" size="sm" onClick={() => setDialog('items')}>
                    <ListChecksIcon /> {t('contract.editItems')}
                  </Button>
                </CardAction>
              )}
            </CardHeader>
            <CardContent>
              {c.items.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('contract.noItems')}</p>
              ) : (
                <ul className="divide-y">
                  {c.items.map((i) =>
                    i.asset ? (
                      <li
                        key={i.id}
                        className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm"
                      >
                        <CategoryIcon category={i.asset.category} className="text-muted-foreground" label />
                        <span className="font-mono text-xs text-muted-foreground">{i.asset.tag}</span>
                        <Link
                          href={assetHref(i.asset)}
                          className="min-w-0 flex-1 truncate font-medium hover:underline focus-visible:underline"
                        >
                          {i.asset.name}
                        </Link>
                        <span className="hidden truncate text-muted-foreground sm:inline">
                          {i.asset.model}
                        </span>
                        <AssetStatusBadge status={i.asset.status} />
                      </li>
                    ) : i.license ? (
                      <li key={i.id} className="flex min-w-0 items-center gap-3 py-2 text-sm">
                        <KeyRoundIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                        <span className="font-mono text-xs text-muted-foreground">{i.license.reference}</span>
                        <Link
                          href={licenseHref(i.license)}
                          className="min-w-0 flex-1 truncate font-medium hover:underline focus-visible:underline"
                        >
                          {i.license.product}
                        </Link>
                        <span className="hidden text-muted-foreground sm:inline">
                          {t(`licenseType.${i.license.licenseType}`)}
                        </span>
                      </li>
                    ) : null,
                  )}
                </ul>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="history" className="min-w-0">
          {tab === 'history' && <HistoryCard contract={c} />}
        </TabsContent>
        <TabsContent value="links" className="min-w-0">
          {tab === 'links' && <LinksAndFiles type="itam.contract" id={c.id} />}
        </TabsContent>
      </Tabs>

      {manage && (
        <>
          <ContractFormDialog open={dialog === 'edit'} onOpenChange={close} contract={c} />
          {dialog === 'renew' && <RenewDialog contract={c} open onOpenChange={close} />}
          {dialog === 'items' && <ItemsDialog contract={c} open onOpenChange={close} />}
          <ConfirmDialog
            open={dialog === 'cancel'}
            onOpenChange={close}
            title={t('contract.cancelTitle', { reference: c.reference })}
            description={t('contract.cancelBody')}
            confirmLabel={t('contract.cancel')}
            destructive
            loading={cancel.isPending}
            onConfirm={() => cancel.mutate(undefined)}
          />
        </>
      )}
    </div>
  );
}

function HistoryCard({ contract }: { contract: ContractDetail }) {
  const t = useTranslations('itam');
  const day = useDay();
  const money = useMoney();
  const { data, isLoading } = useApiQuery<{ items: HistoryEntry[] }>(
    `/itam/contracts/${contract.id}/history`,
  );
  if (isLoading || !data) return <Skeleton className="h-40 w-full rounded-xl" />;
  const actionKey = (a: string) => a.replace(/^itam\.contract\./, '');
  const detail = (e: HistoryEntry): string | null => {
    const ch = e.changes as Record<string, [unknown, unknown]> | null;
    if (e.action === 'itam.contract.renewed' && ch?.endDate)
      return t('contract.history.renewedTo', {
        from: day(String(ch.endDate[0] ?? '')),
        to: day(String(ch.endDate[1] ?? '')),
      });
    if (e.action === 'itam.contract.reminder_sent' && e.metadata)
      return t('contract.history.reminder', { stage: String(e.metadata.stage ?? '') });
    if (ch?.cost)
      return `${money(Number(ch.cost[0] ?? 0), contract.currency)} → ${money(Number(ch.cost[1] ?? 0), contract.currency)}`;
    if (ch)
      return Object.keys(ch)
        .map((k) => (t.has(`fields.${k}`) ? t(`fields.${k}` as 'fields.title') : k))
        .join(', ');
    return null;
  };
  return (
    <Card>
      <CardContent className="pt-6">
        {data.items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('contract.history.empty')}</p>
        ) : (
          <ol className="grid gap-4 border-l pl-5">
            {data.items.map((e) => {
              const key = actionKey(e.action);
              const note = e.metadata && typeof e.metadata.note === 'string' ? e.metadata.note : null;
              return (
                <li key={e.id} className="min-w-0">
                  <p className="text-sm font-medium">
                    {t.has(`contract.history.${key}`)
                      ? t(`contract.history.${key}` as 'contract.history.created')
                      : key}
                  </p>
                  {detail(e) && <p className="text-sm text-muted-foreground wrap-anywhere">{detail(e)}</p>}
                  {note && <p className="text-sm whitespace-pre-wrap text-muted-foreground">“{note}”</p>}
                  <p className="text-xs text-muted-foreground">
                    {e.actor ?? t('history.system')} · <RelativeTime date={e.occurredAt} />
                  </p>
                </li>
              );
            })}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
