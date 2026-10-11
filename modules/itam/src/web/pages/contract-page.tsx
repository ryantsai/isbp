'use client';

import { Badge } from '@astryxdesign/core/Badge';
import { Button } from '@astryxdesign/core/Button';
import { Icon } from '@astryxdesign/core/Icon';
import { HStack, StackItem, VStack } from '@astryxdesign/core/Layout';
import { List, ListItem } from '@astryxdesign/core/List';
import { Tab, TabList } from '@astryxdesign/core/TabList';
import { Text } from '@astryxdesign/core/Text';
import type { WebPageProps } from '@isbp/sdk/web';
import { UserAvatar } from '@isbp/ui/avatar';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@isbp/ui/card';
import { EmptyState } from '@isbp/ui/empty-state';
import { Markdown } from '@isbp/ui/markdown';
import { type DetailAction, DetailHeader } from '@isbp/ui/page-header';
import { useApiMutation, useApiQuery } from '@isbp/ui/query';
import { RelativeTime } from '@isbp/ui/relative-time';
import { Skeleton } from '@isbp/ui/skeleton';
import {
  Timeline,
  TimelineContent,
  TimelineHeader,
  TimelineIndicator,
  TimelineItem,
  TimelineSeparator,
  TimelineTitle,
} from '@isbp/ui/timeline';
import {
  BanIcon,
  FileQuestionIcon,
  FileTextIcon,
  KeyRoundIcon,
  ListChecksIcon,
  PencilIcon,
  PlayIcon,
  RefreshCwIcon,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import type { ContractDetail, HistoryEntry } from '../../contracts';
import { AssetStatusBadge, CategoryIcon, ContractStatusBadge } from '../badges';
import { ConfirmDialog } from '../confirm-dialog';
import { ContractFormDialog, ItemsDialog, RenewDialog } from '../contract-dialogs';
import { CustomFieldsCard } from '../custom-fields';
import { assetHref, INVALIDATE, licenseHref, useDay, useMoney } from '../lib';
import { RenewalTimeline } from '../meters';
import { LinksAndFiles } from '../record-panels';
import { RenewsIn } from '../renews-in';
import { Fact, Facts } from './facts';

type Tab = 'overview' | 'items' | 'history' | 'links';
type DialogKind = 'edit' | 'renew' | 'cancel' | 'items' | null;

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
  const panelId = useId();
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
      <VStack gap={5}>
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-10 w-96" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </VStack>
    );
  if (error || !c) return <EmptyState icon={<FileQuestionIcon />} title={t('contract.notFound')} />;

  const manage = c.viewer.canManage;
  const assets = c.items.filter((i) => i.asset);
  const licenses = c.items.filter((i) => i.license);
  // The next step in the contract's life; editing and cancelling are secondary.
  const primary =
    c.status === 'draft' ? (
      <Button
        label={t('contract.activate')}
        variant="primary"
        icon={<Icon icon={PlayIcon} />}
        isLoading={activate.isPending}
        onClick={() => activate.mutate(undefined)}
      />
    ) : c.status !== 'cancelled' ? (
      <Button
        label={t('contract.renew')}
        variant="primary"
        icon={<Icon icon={RefreshCwIcon} />}
        onClick={() => setDialog('renew')}
      />
    ) : undefined;
  const actions: DetailAction[] = manage
    ? [
        {
          id: 'edit',
          label: t('actions.edit'),
          icon: <Icon icon={PencilIcon} />,
          onSelect: () => setDialog('edit'),
        },
      ]
    : [];
  const menu: DetailAction[] =
    manage && c.status !== 'cancelled'
      ? [
          {
            id: 'cancel',
            label: t('contract.cancel'),
            icon: <Icon icon={BanIcon} />,
            destructive: true,
            onSelect: () => setDialog('cancel'),
          },
        ]
      : [];

  return (
    <VStack gap={5}>
      <DetailHeader
        back={{ href: '/itam/contracts', label: t('contracts.title'), highlight: c.id }}
        icon={<Icon icon={FileTextIcon} />}
        reference={[c.reference, t(`contractKind.${c.kind}`), c.vendor?.name].filter(Boolean).join(' · ')}
        title={c.title}
        status={<ContractStatusBadge status={c.status} />}
        badges={
          <>
            {c.autoRenew && (
              <Badge
                variant="info"
                label={t('fields.autoRenew')}
                icon={<Icon icon={RefreshCwIcon} size="xsm" />}
              />
            )}
            <RenewsIn c={c} />
          </>
        }
        primaryAction={manage ? primary : undefined}
        actions={actions}
        menu={menu}
      />

      <VStack gap={3}>
        <TabList role="tablist" value={tab} onChange={(v) => setTab(v as Tab)} hasDivider>
          <Tab value="overview" label={t('contract.tabs.overview')} panelId={panelId} />
          <Tab
            value="items"
            label={t('contract.tabs.items')}
            panelId={panelId}
            endContent={<Badge variant="neutral" label={String(c.items.length)} />}
          />
          <Tab value="history" label={t('contract.tabs.history')} panelId={panelId} />
          <Tab value="links" label={t('contract.tabs.links')} panelId={panelId} />
        </TabList>

        <div
          role="tabpanel"
          id={panelId}
          aria-label={t(`contract.tabs.${tab}`)}
          className={
            tab === 'overview' ? 'grid min-w-0 grid-cols-1 items-start gap-4 lg:grid-cols-3' : 'min-w-0'
          }
        >
          {tab === 'overview' && (
            <>
              <div className="min-w-0 lg:col-span-2">
                <VStack gap={5}>
                  <Card>
                    <CardHeader>
                      <CardTitle>{t('contract.terms')}</CardTitle>
                      <CardDescription>{t('contract.termsHint', { days: c.noticeDays })}</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <VStack gap={5}>
                        <RenewalTimeline
                          startDate={c.startDate}
                          noticeDate={c.noticeDate}
                          endDate={c.endDate}
                          today={c.today}
                          autoRenew={c.autoRenew}
                        />
                        <Facts>
                          <Fact label={t('fields.startDate')}>{c.startDate && day(c.startDate)}</Fact>
                          <Fact label={t('fields.endDate')}>{c.endDate && day(c.endDate)}</Fact>
                          <Fact label={t('fields.noticeDays')}>
                            {t('contract.noticeDays', { days: c.noticeDays })}
                          </Fact>
                          <Fact label={t('fields.autoRenew')}>
                            {c.autoRenew ? t('contract.yes') : t('contract.no')}
                          </Fact>
                          <Fact label={t('fields.cost')}>
                            {c.cost !== null && `${money(c.cost, c.currency)} · ${t(`billing.${c.billing}`)}`}
                          </Fact>
                          <Fact label={t('fields.annualCost')}>
                            {c.annualCost !== null && money(c.annualCost, c.currency)}
                          </Fact>
                          <Fact label={t('fields.owner')}>
                            {c.owner && (
                              <HStack gap={2} vAlign="center">
                                <UserAvatar
                                  name={c.owner.displayName}
                                  src={c.owner.avatarUrl}
                                  className="size-5 text-[9px]"
                                />
                                <StackItem size="fill">
                                  <Text maxLines={1}>{c.owner.displayName}</Text>
                                </StackItem>
                              </HStack>
                            )}
                          </Fact>
                          <Fact label={t('fields.vendor')}>{c.vendor?.name}</Fact>
                        </Facts>
                      </VStack>
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
                        <Text color="secondary">{t('contract.noNotes')}</Text>
                      )}
                    </CardContent>
                  </Card>
                  <CustomFieldsCard entityType="itam.contract" attributes={c.attributes} />
                </VStack>
              </div>
              <div className="min-w-0">
                <VStack gap={5}>
                  <Card>
                    <CardHeader>
                      <CardTitle>{t('contract.coverage')}</CardTitle>
                      <CardDescription>
                        {t('contract.coverageSummary', { assets: assets.length, licenses: licenses.length })}
                      </CardDescription>
                      <CardAction>
                        <Button
                          label={t('contract.viewItems')}
                          variant="ghost"
                          size="sm"
                          onClick={() => setTab('items')}
                        />
                      </CardAction>
                    </CardHeader>
                    {c.licenses.length > 0 && (
                      <CardContent>
                        <VStack gap={1}>
                          <Text type="label" color="secondary">
                            {t('contract.linkedLicenses')}
                          </Text>
                          <List density="compact">
                            {c.licenses.map((l) => (
                              <ListItem key={l.id} label={l.product} href={licenseHref(l)} />
                            ))}
                          </List>
                        </VStack>
                      </CardContent>
                    )}
                  </Card>
                  {c.lastReminderFor && (
                    <Text as="p" color="secondary">
                      {t('contract.reminded', { date: day(c.lastReminderFor) })}
                    </Text>
                  )}
                </VStack>
              </div>
            </>
          )}

          {tab === 'items' && (
            <Card>
              <CardHeader>
                <CardTitle>{t('contract.tabs.items')}</CardTitle>
                <CardDescription>{t('contract.itemsHint')}</CardDescription>
                {manage && (
                  <CardAction>
                    <Button
                      label={t('contract.editItems')}
                      variant="secondary"
                      size="sm"
                      icon={<Icon icon={ListChecksIcon} />}
                      onClick={() => setDialog('items')}
                    />
                  </CardAction>
                )}
              </CardHeader>
              <CardContent>
                {c.items.length === 0 ? (
                  <Text color="secondary">{t('contract.noItems')}</Text>
                ) : (
                  <List hasDividers density="compact">
                    {c.items.map((i) =>
                      i.asset ? (
                        <ListItem
                          key={i.id}
                          label={i.asset.name}
                          href={assetHref(i.asset)}
                          startContent={<CategoryIcon category={i.asset.category} color="secondary" label />}
                          description={[i.asset.tag, i.asset.model].filter(Boolean).join(' · ')}
                          endContent={<AssetStatusBadge status={i.asset.status} />}
                        />
                      ) : i.license ? (
                        <ListItem
                          key={i.id}
                          label={i.license.product}
                          href={licenseHref(i.license)}
                          startContent={<Icon icon={KeyRoundIcon} color="secondary" />}
                          description={`${i.license.reference} · ${t(`licenseType.${i.license.licenseType}`)}`}
                        />
                      ) : null,
                    )}
                  </List>
                )}
              </CardContent>
            </Card>
          )}

          {tab === 'history' && <HistoryCard contract={c} />}
          {tab === 'links' && <LinksAndFiles type="itam.contract" id={c.id} />}
        </div>
      </VStack>

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
    </VStack>
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
      <CardContent>
        {data.items.length === 0 ? (
          <Text color="secondary">{t('contract.history.empty')}</Text>
        ) : (
          <Timeline>
            {data.items.map((e) => {
              const key = actionKey(e.action);
              const note = e.metadata && typeof e.metadata.note === 'string' ? e.metadata.note : null;
              const text = detail(e);
              return (
                <TimelineItem key={e.id} className="min-w-0">
                  <TimelineHeader>
                    <TimelineSeparator />
                    <TimelineIndicator />
                    <TimelineTitle>
                      {t.has(`contract.history.${key}`)
                        ? t(`contract.history.${key}` as 'contract.history.created')
                        : key}
                    </TimelineTitle>
                  </TimelineHeader>
                  <TimelineContent>
                    {text && <p className="wrap-anywhere">{text}</p>}
                    {note && <p className="whitespace-pre-wrap">“{note}”</p>}
                    <Text type="supporting">
                      {e.actor ?? t('history.system')} · <RelativeTime date={e.occurredAt} />
                    </Text>
                  </TimelineContent>
                </TimelineItem>
              );
            })}
          </Timeline>
        )}
      </CardContent>
    </Card>
  );
}
