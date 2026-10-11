'use client';

import { Badge } from '@astryxdesign/core/Badge';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Divider } from '@astryxdesign/core/Divider';
import { Icon } from '@astryxdesign/core/Icon';
import { HStack, StackItem, VStack } from '@astryxdesign/core/Layout';
import { Link } from '@astryxdesign/core/Link';
import { List, ListItem } from '@astryxdesign/core/List';
import { MetadataList, MetadataListItem } from '@astryxdesign/core/MetadataList';
import { Tab, TabList } from '@astryxdesign/core/TabList';
import { Text } from '@astryxdesign/core/Text';
import type { Page } from '@isbp/sdk';
import { localize } from '@isbp/sdk';
import type { WebPageProps } from '@isbp/sdk/web';
import { UserAvatar } from '@isbp/ui/avatar';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@isbp/ui/card';
import { useListState } from '@isbp/ui/data-table';
import { EmptyState, ErrorState } from '@isbp/ui/empty-state';
import { IconTile } from '@isbp/ui/icon-tile';
import { safeUrl } from '@isbp/ui/markdown';
import { type DetailAction, DetailHeader } from '@isbp/ui/page-header';
import { useApiQuery } from '@isbp/ui/query';
import { DateTime, RelativeTime } from '@isbp/ui/relative-time';
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
  ArchiveRestoreIcon,
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
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { useId, useState } from 'react';
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
import { Fact, Facts } from './facts';

const TABS = ['overview', 'software', 'contracts', 'history', 'links'] as const;
type Tab = (typeof TABS)[number];

export default function AssetPage({ params }: WebPageProps) {
  const t = useTranslations('itam');
  const {
    data: asset,
    isLoading,
    error,
  } = useApiQuery<AssetDetail>(`/itam/assets/${encodeURIComponent(params.ref ?? '')}`);
  const [state, set] = useListState();
  const tab: Tab = TABS.includes(state.tab as Tab) ? (state.tab as Tab) : 'overview';
  const [action, setAction] = useState<AssetAction | null>(null);
  const [editing, setEditing] = useState(false);
  const panelId = useId();

  if (isLoading)
    return (
      <VStack gap={5}>
        <Skeleton className="h-5 w-40" />
        <HStack gap={4} vAlign="center">
          <Skeleton className="size-12 rounded-xl" />
          <VStack gap={2}>
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-7 w-64" />
          </VStack>
        </HStack>
        <Skeleton className="h-72 w-full rounded-xl" />
      </VStack>
    );
  if (error) return <ErrorState kind="page" error={error} />;
  if (!asset) return <EmptyState icon={<FileQuestionIcon />} title={t('asset.notFound')} />;

  const v = asset.viewer;
  // One next step, from the asset's state; everything else is in "More".
  const wipePending =
    asset.wipeState === 'due' || asset.wipeState === 'overdue' || asset.wipeState === 'scheduled';
  const candidates: { action: AssetAction; label: string; icon: LucideIcon; when: boolean }[] = [
    { action: 'wipe', label: t('wipe.action'), icon: EraserIcon, when: v.canRecordWipe && wipePending },
    { action: 'return', label: t('actions.return'), icon: Undo2Icon, when: v.canReturn },
    {
      action: 'assign',
      label: t('actions.assign'),
      icon: UserPlusIcon,
      when: v.canAssign && !asset.assignee,
    },
    {
      action: 'dispose',
      label: t('actions.requestDisposal'),
      icon: RecycleIcon,
      when: v.canDispose && asset.status === 'retired',
    },
  ];
  const primary = v.canManage ? candidates.find((c) => c.when) : undefined;
  const more: DetailAction[] = v.canManage
    ? [
        ...(v.canAssign && asset.assignee
          ? [
              {
                id: 'reassign',
                label: t('actions.reassign'),
                icon: <Icon icon={ArrowRightLeftIcon} />,
                onSelect: () => setAction('assign'),
              },
            ]
          : []),
        ...(v.canReturn && primary?.action !== 'return'
          ? [
              {
                id: 'return',
                label: t('actions.return'),
                icon: <Icon icon={Undo2Icon} />,
                onSelect: () => setAction('return'),
              },
            ]
          : []),
        ...(v.transitions.some((s) => s !== 'deployed')
          ? [
              {
                id: 'status',
                label: t('actions.changeStatus'),
                icon: <Icon icon={ArchiveRestoreIcon} />,
                onSelect: () => setAction('status'),
              },
            ]
          : []),
        ...(v.canRecordWipe && primary?.action !== 'wipe'
          ? [
              {
                id: 'wipe',
                label: t('wipe.action'),
                icon: <Icon icon={EraserIcon} />,
                onSelect: () => setAction('wipe'),
              },
            ]
          : []),
        ...(v.canDispose && primary?.action !== 'dispose'
          ? [
              {
                id: 'dispose',
                label: t('actions.requestDisposalMore'),
                icon: <Icon icon={RecycleIcon} />,
                onSelect: () => setAction('dispose'),
              },
            ]
          : []),
      ]
    : [];

  return (
    <VStack gap={5}>
      <DetailHeader
        back={{ href: '/itam/hardware', label: t('hardware.title'), highlight: asset.id }}
        icon={<CategoryIcon category={asset.category} />}
        reference={[asset.tag, t(`category.${asset.category}`), asset.model ? modelLabel(asset.model) : null]
          .filter(Boolean)
          .join(' · ')}
        title={asset.name}
        status={<AssetStatusBadge status={asset.status} animate />}
        badges={
          <>
            {asset.warrantyState === 'expiring' || asset.warrantyState === 'expired' ? (
              <Badge
                variant={asset.warrantyState === 'expired' ? 'error' : 'warning'}
                icon={<Icon icon={ShieldAlertIcon} size="xsm" />}
                label={t(`warranty.badge.${asset.warrantyState}`)}
              />
            ) : null}
            <WipeBadge state={asset.wipeState} date={asset.wipeDue} />
          </>
        }
        meta={asset.assignee ? t('asset.assignedTo', { name: asset.assignee.displayName }) : undefined}
        primaryAction={
          primary ? (
            <Button
              label={primary.label}
              variant="primary"
              icon={<Icon icon={primary.icon} />}
              onClick={() => setAction(primary.action)}
            />
          ) : undefined
        }
        actions={
          v.canManage
            ? [
                {
                  id: 'edit',
                  label: t('actions.edit'),
                  icon: <Icon icon={PencilIcon} />,
                  onSelect: () => setEditing(true),
                },
              ]
            : []
        }
        menu={more}
      />

      <Banners asset={asset} />

      <VStack gap={3}>
        <TabList
          role="tablist"
          value={tab}
          onChange={(x) => set({ tab: x === 'overview' ? undefined : x })}
          hasDivider
        >
          {TABS.map((x) => (
            <Tab key={x} value={x} label={t(`asset.tabs.${x}`)} panelId={panelId} />
          ))}
        </TabList>

        <div
          role="tabpanel"
          id={panelId}
          aria-label={t(`asset.tabs.${tab}`)}
          className={
            tab === 'overview' ? 'grid min-w-0 grid-cols-1 items-start gap-4 lg:grid-cols-3' : 'min-w-0'
          }
        >
          {tab === 'overview' && <OverviewTab asset={asset} />}
          {tab === 'software' && <SoftwareTab asset={asset} />}
          {tab === 'contracts' &&
            (v.canReadContracts ? (
              <ContractsTab asset={asset} />
            ) : (
              <EmptyState icon={<FileTextIcon />} title={t('asset.contractsHidden')} />
            ))}
          {tab === 'history' && <HistoryTab asset={asset} />}
          {tab === 'links' && <LinksAndFiles type="itam.asset" id={asset.id} />}
        </div>
      </VStack>

      <AssetActionDialog asset={asset} action={action} onClose={() => setAction(null)} onNext={setAction} />
      {v.canManage && <AssetFormDialog open={editing} onOpenChange={setEditing} asset={asset} />}
    </VStack>
  );
}

/** The overview: facts and finance on the left (two thirds), who has it and where it sits in the CMDB on the right. */
function OverviewTab({ asset }: { asset: AssetDetail }) {
  const t = useTranslations('itam');
  const money = useMoney();
  const day = useDay();
  const dep = asset.depreciation;
  return (
    <>
      <div className="min-w-0 lg:col-span-2">
        <VStack gap={5}>
          <Card>
            <CardHeader>
              <CardTitle>{t('asset.details')}</CardTitle>
            </CardHeader>
            <CardContent>
              <Facts>
                <Fact label={t('fields.tag')}>
                  <Text type="code">{asset.tag}</Text>
                </Fact>
                <Fact label={t('fields.serialNumber')}>
                  {asset.serialNumber && <Text type="code">{asset.serialNumber}</Text>}
                </Fact>
                <Fact label={t('fields.category')}>
                  <CategoryLabel category={asset.category} />
                </Fact>
                <Fact label={t('fields.model')}>{asset.model && modelLabel(asset.model)}</Fact>
                <Fact label={t('fields.department')}>{asset.department?.name}</Fact>
                <Fact label={t('fields.location')}>{asset.location}</Fact>
                <Fact label={t('fields.retireOn')}>{asset.retireOn && day(asset.retireOn)}</Fact>
                <Fact label={t('fields.created')}>
                  <DateTime date={asset.createdAt} />
                </Fact>
                <Fact label={t('fields.updated')}>
                  <RelativeTime date={asset.updatedAt} />
                </Fact>
              </Facts>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>{t('asset.finance')}</CardTitle>
              <CardDescription>{t('asset.financeHint')}</CardDescription>
            </CardHeader>
            <CardContent>
              <VStack gap={4}>
                <Facts>
                  <Fact label={t('fields.vendor')}>{asset.vendor?.name}</Fact>
                  <Fact label={t('fields.invoiceNumber')}>{asset.invoiceNumber}</Fact>
                  <Fact label={t('fields.purchaseDate')}>
                    {asset.purchaseDate && day(asset.purchaseDate)}
                  </Fact>
                  <Fact label={t('fields.purchaseCost')}>
                    {asset.purchaseCost !== null && money(asset.purchaseCost, asset.currency)}
                  </Fact>
                  <Fact label={t('fields.warrantyEnd')}>
                    <WarrantyEnd date={asset.warrantyEnd} state={asset.warrantyState} />
                  </Fact>
                  <Fact label={t('fields.bookValue')}>
                    {dep && <Text weight="medium">{money(dep.bookValue, asset.currency)}</Text>}
                  </Fact>
                </Facts>
                {dep && asset.purchaseCost !== null && (
                  <VStack gap={1.5}>
                    <Divider />
                    <HStack gap={2} wrap="wrap" hAlign="between" vAlign="center">
                      <Text weight="medium">{t('finance.depreciation')}</Text>
                      <Text type="supporting">
                        {t('finance.lifespan', { months: dep.lifespanMonths, age: dep.ageMonths })}
                      </Text>
                    </HStack>
                    <DepreciationBar
                      cost={asset.purchaseCost}
                      bookValue={dep.bookValue}
                      depreciatedPercent={dep.depreciatedPercent}
                      currency={asset.currency}
                    />
                    <Text type="supporting" as="p">
                      {t('finance.fullyDepreciated', { date: day(dep.fullyDepreciatedOn) })}
                    </Text>
                  </VStack>
                )}
              </VStack>
            </CardContent>
          </Card>
          {asset.notes && (
            <Card>
              <CardHeader>
                <CardTitle>{t('fields.notes')}</CardTitle>
              </CardHeader>
              <CardContent>
                <Text as="p" className="whitespace-pre-wrap">
                  {asset.notes}
                </Text>
              </CardContent>
            </Card>
          )}
          <CustomFieldsCard entityType="itam.asset" attributes={asset.attributes} />
        </VStack>
      </div>
      <div className="min-w-0">
        <VStack gap={5}>
          <AssignmentCard asset={asset} />
          {asset.dataBearing && <WipeCard asset={asset} />}
          <CiCard asset={asset} />
        </VStack>
      </div>
    </>
  );
}

function Banners({ asset }: { asset: AssetDetail }) {
  const t = useTranslations('itam.asset');
  const format = useFormatter();
  if (asset.disposalInstanceId)
    return (
      <Banner
        status="warning"
        collapsible={false}
        icon={<Icon icon={GavelIcon} />}
        title={t('disposalPending')}
        description={asset.disposalNote ? `“${asset.disposalNote}”` : undefined}
      />
    );
  if (asset.status === 'disposed')
    return (
      <Banner
        status="info"
        collapsible={false}
        icon={<Icon icon={RecycleIcon} />}
        title={t('disposedBanner', {
          date: asset.disposedAt ? format.dateTime(new Date(asset.disposedAt), { dateStyle: 'medium' }) : '—',
        })}
        description={asset.disposalNote ? `“${asset.disposalNote}”` : undefined}
      />
    );
  if (asset.status === 'lost')
    return (
      <Banner
        status="error"
        collapsible={false}
        icon={<Icon icon={CircleAlertIcon} />}
        title={t('lostBanner')}
      />
    );
  return null;
}

function AssignmentCard({ asset }: { asset: AssetDetail }) {
  const t = useTranslations('itam.asset');
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('assignment')}</CardTitle>
      </CardHeader>
      <CardContent>
        <VStack gap={3}>
          {asset.assignee ? (
            <>
              <HStack gap={3} vAlign="center">
                <UserAvatar
                  name={asset.assignee.displayName}
                  src={asset.assignee.avatarUrl}
                  className="size-9"
                />
                <StackItem size="fill">
                  <VStack>
                    <Text weight="medium" maxLines={1}>
                      {asset.assignee.displayName}
                    </Text>
                    {asset.assignee.email && (
                      <Text type="supporting" maxLines={1}>
                        {asset.assignee.email}
                      </Text>
                    )}
                  </VStack>
                </StackItem>
              </HStack>
              {asset.assignedAt && (
                <Text type="supporting">
                  {t('since')} <RelativeTime date={asset.assignedAt} />
                </Text>
              )}
            </>
          ) : (
            <HStack gap={3} vAlign="center">
              <Icon icon={UserRoundXIcon} color="secondary" />
              <Text color="secondary">{t('unassigned')}</Text>
            </HStack>
          )}
        </VStack>
      </CardContent>
    </Card>
  );
}

/** Data retention and wipes of a device that stores data: the pending wipe and the last recorded one. */
function WipeCard({ asset }: { asset: AssetDetail }) {
  const t = useTranslations('itam.wipe');
  const tm = useTranslations('itam.wipeMethod');
  const day = useDay();
  const format = useFormatter();
  const w = asset.lastWipe;
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <HStack gap={2} vAlign="center">
            <Icon icon={EraserIcon} color="accent" />
            {t('cardTitle')}
          </HStack>
        </CardTitle>
        <CardDescription>{t('cardHint')}</CardDescription>
      </CardHeader>
      <CardContent>
        <VStack gap={3}>
          {asset.wipeDue ? (
            <MetadataList>
              {asset.dataRetainUntil && (
                <MetadataListItem label={t('retainUntil')}>{day(asset.dataRetainUntil)}</MetadataListItem>
              )}
              <MetadataListItem label={t('due')}>
                <WipeBadge state={asset.wipeState} date={asset.wipeDue} />
              </MetadataListItem>
            </MetadataList>
          ) : (
            <Text color="secondary">{t('nonePending')}</Text>
          )}
          {w ? (
            <HStack gap={2} vAlign="start">
              <Icon icon={CircleCheckIcon} color="success" />
              <Text color="secondary">
                {t('last', {
                  date: format.dateTime(new Date(w.at), { dateStyle: 'medium', timeStyle: 'short' }),
                  method: w.method ? tm(w.method) : '—',
                  name: w.by?.displayName ?? '—',
                })}
              </Text>
            </HStack>
          ) : null}
        </VStack>
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
        <CardTitle>
          <HStack gap={2} vAlign="center">
            <Icon icon={NetworkIcon} color="accent" />
            {t('ci')}
          </HStack>
        </CardTitle>
        <CardDescription>{t('ciHint')}</CardDescription>
      </CardHeader>
      <CardContent>
        {ci ? (
          <VStack>
            <Link href={`/cmdb/${ci.reference}`} color="primary" weight="medium" maxLines={1}>
              {ci.name}
            </Link>
            <Text type="supporting" maxLines={1}>
              {ci.reference}
              {ci.className ? ` · ${localize(ci.className, locale)}` : ''} · {t(`ciStatus.${ci.status}`)}
            </Text>
          </VStack>
        ) : (
          <Text color="secondary">{t('noCi')}</Text>
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
    <div className="grid min-w-0 grid-cols-1 items-start gap-4 lg:grid-cols-3">
      <Card className="min-w-0 lg:col-span-2">
        <CardHeader>
          <CardTitle>{t('installed')}</CardTitle>
          <CardDescription>
            {unlicensed ? t('unlicensedCount', { count: unlicensed }) : t('installedHint')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {data.installations.length === 0 ? (
            <Text color="secondary">{t('noInstalls')}</Text>
          ) : (
            <List hasDividers density="compact">
              {data.installations.map((i) => (
                <ListItem
                  key={i.id}
                  label={i.product}
                  description={i.reportedAs ? t('reportedAs', { title: i.reportedAs }) : undefined}
                  endContent={
                    <HStack gap={2} vAlign="center" wrap="wrap" hAlign="end">
                      {i.version && (
                        <Text type="supporting" hasTabularNumbers>
                          {i.version}
                        </Text>
                      )}
                      {i.approval !== 'allowed' && <ApprovalBadge approval={i.approval} />}
                      {i.managed ? (
                        i.licensed ? (
                          <Badge
                            variant="success"
                            label={t('licensed')}
                            icon={<Icon icon={CircleCheckIcon} size="xsm" />}
                          />
                        ) : (
                          <Badge
                            variant="error"
                            label={t('unlicensed')}
                            icon={<Icon icon={CircleAlertIcon} size="xsm" />}
                          />
                        )
                      ) : (
                        <Badge variant="neutral" label={t('notManaged')} />
                      )}
                    </HStack>
                  }
                />
              ))}
            </List>
          )}
        </CardContent>
      </Card>
      <Card className="min-w-0">
        <CardHeader>
          <CardTitle>{t('seats')}</CardTitle>
          <CardDescription>{t('seatsHint')}</CardDescription>
        </CardHeader>
        <CardContent>
          <VStack gap={4}>
            {[
              { title: t('deviceSeats'), items: data.licenses.map((l) => l.license) },
              {
                title: t('userSeats', { name: asset.assignee?.displayName ?? '—' }),
                items: data.userLicenses,
              },
            ].map((group) => (
              <VStack key={group.title} gap={1}>
                <Text type="label" color="secondary">
                  {group.title}
                </Text>
                {group.items.length === 0 ? (
                  <Text color="secondary">—</Text>
                ) : (
                  <List density="compact">
                    {group.items.map((l) => (
                      <ListItem
                        key={l.id}
                        label={l.product}
                        href={licenseHref(l)}
                        description={`${l.reference} · ${tt(l.licenseType)}`}
                      />
                    ))}
                  </List>
                )}
              </VStack>
            ))}
          </VStack>
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
      <CardContent>
        <List hasDividers>
          {data.items.map((c) => (
            <ListItem
              key={c.id}
              label={c.title}
              href={contractHref(c)}
              description={[c.reference, c.vendor?.name, t(`contractKind.${c.kind}`)]
                .filter(Boolean)
                .join(' · ')}
              endContent={
                <HStack gap={3} vAlign="center" wrap="wrap" hAlign="end">
                  <Text hasTabularNumbers>{day(c.endDate)}</Text>
                  <ContractStatusBadge status={c.status} />
                </HStack>
              }
            />
          ))}
        </List>
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
    <Link href={url} target="_blank" type="inherit" color="inherit" hasUnderline>
      {text}
    </Link>
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
        <CardTitle>
          <HStack gap={2} vAlign="center">
            <Icon icon={HistoryIcon} color="accent" />
            {t('asset.tabs.history')}
          </HStack>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <VStack gap={4}>
          <Timeline>
            {data.items.map((e) => {
              const EventIcon = EVENT_ICON[e.kind] ?? StickyNoteIcon;
              return (
                <TimelineItem key={e.id} className="min-w-0">
                  <TimelineHeader>
                    <TimelineSeparator />
                    <TimelineIndicator asChild>
                      <IconTile size="xs" className="text-muted-foreground">
                        <EventIcon />
                      </IconTile>
                    </TimelineIndicator>
                    <TimelineTitle className="wrap-anywhere">{sentence(e)}</TimelineTitle>
                  </TimelineHeader>
                  <TimelineContent>
                    {e.kind === 'updated' && e.note && <p>{t('history.fields', { fields: e.note })}</p>}
                    {e.kind !== 'updated' && e.note && <p className="whitespace-pre-wrap">{e.note}</p>}
                    <Text type="supporting">
                      {e.actor ? `${e.actor.displayName} · ` : `${t('history.system')} · `}
                      {e.via && (
                        <>
                          <Via via={e.via} />
                          {' · '}
                        </>
                      )}
                      {e.request && (
                        <>
                          <Link href={e.request.href} type="inherit" color="inherit" hasUnderline>
                            {t('history.viaRequest', { reference: e.request.reference })}
                          </Link>
                          {' · '}
                        </>
                      )}
                      <RelativeTime date={e.createdAt} />
                    </Text>
                  </TimelineContent>
                </TimelineItem>
              );
            })}
          </Timeline>
          {data.total > data.items.length && (
            <HStack>
              <Button
                label={t('history.more')}
                variant="secondary"
                size="sm"
                isLoading={isFetching}
                onClick={() => setPageSize((n) => n + 30)}
              />
            </HStack>
          )}
        </VStack>
      </CardContent>
    </Card>
  );
}
