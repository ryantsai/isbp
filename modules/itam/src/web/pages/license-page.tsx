'use client';

import { Badge } from '@astryxdesign/core/Badge';
import { Button } from '@astryxdesign/core/Button';
import { Field } from '@astryxdesign/core/Field';
import { Icon } from '@astryxdesign/core/Icon';
import { HStack, StackItem, VStack } from '@astryxdesign/core/Layout';
import { Link } from '@astryxdesign/core/Link';
import { MetadataList, MetadataListItem } from '@astryxdesign/core/MetadataList';
import { Switch } from '@astryxdesign/core/Switch';
import { Tab, TabList } from '@astryxdesign/core/TabList';
import { Text } from '@astryxdesign/core/Text';
import type { Page } from '@isbp/sdk';
import type { WebPageProps } from '@isbp/sdk/web';
import { UserAvatar } from '@isbp/ui/avatar';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@isbp/ui/card';
import { DataTable, type DataTableColumn, type DataTableSelection, useListState } from '@isbp/ui/data-table';
import { EmptyState, ErrorState } from '@isbp/ui/empty-state';
import { DetailHeader } from '@isbp/ui/page-header';
import { type PersonOption, PersonPicker } from '@isbp/ui/person-picker';
import { useApiMutation, useApiQuery } from '@isbp/ui/query';
import { RelativeTime } from '@isbp/ui/relative-time';
import { SearchInput } from '@isbp/ui/search-input';
import { Skeleton } from '@isbp/ui/skeleton';
import { StatTile } from '@isbp/ui/stat-tile';
import {
  CircleAlertIcon,
  CircleCheckIcon,
  CopyIcon,
  EyeIcon,
  EyeOffIcon,
  FileQuestionIcon,
  KeyRoundIcon,
  PencilIcon,
  PlusIcon,
  Undo2Icon,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useMemo, useState } from 'react';
import type { Installation, LicenseAssignment, LicenseDetail } from '../../contracts';
import { CategoryIcon, ComplianceBadge } from '../badges';
import { LicenseFormDialog } from '../license-form-dialog';
import { assetHref, contractHref, INVALIDATE, useDay, useItamSettings, useMoney } from '../lib';
import { UsageMeter } from '../meters';
import { AssetPicker, type PickedAsset } from '../pickers';
import { LinksAndFiles } from '../record-panels';

const TABS = ['seats', 'installations', 'links'] as const;
type Tab = (typeof TABS)[number];

export default function LicensePage({ params }: WebPageProps) {
  const t = useTranslations('itam');
  const money = useMoney();
  const day = useDay();
  const settings = useItamSettings();
  const {
    data: lic,
    isLoading,
    error,
  } = useApiQuery<LicenseDetail>(`/itam/licenses/${encodeURIComponent(params.ref ?? '')}`);
  const [state, set] = useListState();
  const tab: Tab = TABS.includes(state.tab as Tab) ? (state.tab as Tab) : 'seats';
  const [editing, setEditing] = useState(false);
  const panelId = useId();

  if (isLoading)
    return (
      <VStack gap={5}>
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-10 w-80" />
        <Skeleton className="h-48 w-full rounded-xl" />
      </VStack>
    );
  if (error) return <ErrorState kind="page" error={error} />;
  if (!lic) return <EmptyState icon={<FileQuestionIcon />} title={t('license.notFound')} />;

  const available = lic.quantity === null ? null : Math.max(0, lic.quantity - lic.used);

  return (
    <VStack gap={5}>
      <DetailHeader
        back={{ href: '/itam/software', label: t('nav.software'), highlight: lic.id }}
        icon={<Icon icon={KeyRoundIcon} />}
        reference={[lic.reference, t(`licenseType.${lic.licenseType}`), lic.publisher]
          .filter(Boolean)
          .join(' · ')}
        title={lic.product}
        status={<ComplianceBadge state={lic.complianceState} />}
        actions={
          lic.viewer.canManage
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
      />

      <div className="grid min-w-0 grid-cols-1 items-start gap-4 lg:grid-cols-3">
        <Card className="min-w-0 lg:col-span-2">
          <CardHeader>
            <CardTitle>{t('license.usageTitle')}</CardTitle>
            <CardDescription>{t(`license.state.${lic.complianceState}`)}</CardDescription>
          </CardHeader>
          <CardContent>
            <VStack gap={4}>
              <UsageMeter
                used={lic.used}
                quantity={lic.quantity}
                size="lg"
                underUsedPercent={settings.underUsedPercent}
              />
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <StatTile label={t('license.entitled')} value={lic.quantity ?? t('license.unlimited')} />
                <StatTile label={t('license.assigned')} value={lic.assigned} />
                <StatTile
                  label={t('license.unlicensed')}
                  value={lic.unlicensed}
                  tone={lic.unlicensed > 0 ? 'destructive' : 'default'}
                  icon={lic.unlicensed > 0 ? <CircleAlertIcon /> : undefined}
                  href={lic.unlicensed > 0 ? `?tab=installations` : undefined}
                />
                <StatTile label={t('license.available')} value={available ?? '∞'} />
              </div>
              {lic.complianceState === 'over_deployed' && (
                <Text as="p">
                  {t('license.overHint')}{' '}
                  <Link href="?tab=seats&reclaim=true" type="inherit" weight="medium">
                    {t('license.showReclaim')}
                  </Link>
                </Text>
              )}
              {lic.licenseType === 'per_device' && lic.unlicensed > 0 && (
                <HStack gap={2} vAlign="start">
                  <Icon icon={CircleAlertIcon} color="error" />
                  <Text color="secondary">{t('license.unlicensedCounted')}</Text>
                </HStack>
              )}
            </VStack>
          </CardContent>
        </Card>
        <div className="min-w-0">
          <VStack gap={5}>
            <Card>
              <CardHeader>
                <CardTitle>{t('license.terms')}</CardTitle>
              </CardHeader>
              <CardContent>
                <VStack gap={4}>
                  <MetadataList>
                    <MetadataListItem label={t('fields.vendor')}>{lic.vendor?.name ?? '—'}</MetadataListItem>
                    <MetadataListItem label={t('fields.billing')}>
                      {t(`billing.${lic.billing}`)}
                    </MetadataListItem>
                    <MetadataListItem label={t('fields.cost')}>
                      {money(lic.cost, lic.currency)}
                    </MetadataListItem>
                    {lic.billing !== 'annual' && (
                      <MetadataListItem label={t('fields.annualCost')}>
                        {money(lic.annualCost, lic.currency)}
                      </MetadataListItem>
                    )}
                    <MetadataListItem label={t('fields.startDate')}>{day(lic.startDate)}</MetadataListItem>
                    <MetadataListItem label={t('fields.endDate')}>
                      {lic.endDate ? day(lic.endDate) : t('software.perpetual')}
                    </MetadataListItem>
                    <MetadataListItem label={t('fields.contract')}>
                      {lic.contract ? (
                        lic.viewer.canReadContracts ? (
                          <Link href={contractHref(lic.contract)}>
                            <Text type="code">{lic.contract.reference}</Text> {lic.contract.title}
                          </Link>
                        ) : (
                          <Text>
                            <Text type="code">{lic.contract.reference}</Text> {lic.contract.title}
                          </Text>
                        )
                      ) : (
                        '—'
                      )}
                    </MetadataListItem>
                  </MetadataList>
                  {lic.notes && (
                    <Text as="p" color="secondary" className="whitespace-pre-wrap">
                      {lic.notes}
                    </Text>
                  )}
                </VStack>
              </CardContent>
            </Card>
            <KeyCard lic={lic} />
          </VStack>
        </div>
      </div>

      <VStack gap={3}>
        <TabList
          role="tablist"
          value={tab}
          onChange={(v) => set({ tab: v === 'seats' ? undefined : v, reclaim: undefined })}
          hasDivider
        >
          <Tab
            value="seats"
            label={t('license.tabs.seats')}
            panelId={panelId}
            endContent={<Badge variant="neutral" label={String(lic.assigned)} />}
          />
          <Tab
            value="installations"
            label={t('license.tabs.installations')}
            panelId={panelId}
            endContent={
              lic.unlicensed > 0 ? <Badge variant="error" label={String(lic.unlicensed)} /> : undefined
            }
          />
          <Tab value="links" label={t('license.tabs.links')} panelId={panelId} />
        </TabList>
        <div role="tabpanel" id={panelId} aria-label={t(`license.tabs.${tab}`)} className="min-w-0">
          {tab === 'seats' && (
            <SeatsTab
              lic={lic}
              reclaim={state.reclaim === 'true'}
              onReclaim={(on) => set({ reclaim: on ? 'true' : undefined })}
            />
          )}
          {tab === 'installations' && <InstallationsTab lic={lic} available={available} />}
          {tab === 'links' && <LinksAndFiles type="itam.license" id={lic.id} />}
        </div>
      </VStack>

      {lic.viewer.canManage && <LicenseFormDialog open={editing} onOpenChange={setEditing} license={lic} />}
    </VStack>
  );
}

function KeyCard({ lic }: { lic: LicenseDetail }) {
  const t = useTranslations('itam.license');
  const [key, setKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const reveal = useApiMutation((api) => api.post<{ key: string }>(`/itam/licenses/${lic.id}/reveal-key`), {
    onSuccess: (r) => setKey(r.key),
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('key')}</CardTitle>
        <CardDescription>{lic.hasKey ? t('keyAudited') : t('noKey')}</CardDescription>
      </CardHeader>
      {lic.hasKey && (
        <CardContent>
          <VStack gap={3}>
            <p aria-live="polite" className="break-all">
              <Text type="code">
                {key ?? (lic.keyHint ? `•••• •••• •••• ${lic.keyHint}` : '•••• •••• •••• ••••')}
              </Text>
            </p>
            <HStack gap={2} wrap="wrap">
              {key ? (
                <>
                  <Button
                    label={copied ? t('copied') : t('copy')}
                    variant="secondary"
                    size="sm"
                    icon={<Icon icon={CopyIcon} />}
                    onClick={async () => {
                      await navigator.clipboard?.writeText(key);
                      setCopied(true);
                    }}
                  />
                  <Button
                    label={t('hide')}
                    variant="ghost"
                    size="sm"
                    icon={<Icon icon={EyeOffIcon} />}
                    onClick={() => setKey(null)}
                  />
                </>
              ) : (
                lic.viewer.canReveal && (
                  <Button
                    label={t('reveal')}
                    variant="secondary"
                    size="sm"
                    icon={<Icon icon={EyeIcon} />}
                    isLoading={reveal.isPending}
                    onClick={() => reveal.mutate(undefined)}
                  />
                )
              )}
            </HStack>
          </VStack>
        </CardContent>
      )}
    </Card>
  );
}

const userTypes = ['per_user', 'concurrent', 'site', 'subscription'];
const deviceTypes = ['per_device', 'concurrent', 'site', 'subscription'];

function SeatsTab({
  lic,
  reclaim,
  onReclaim,
}: {
  lic: LicenseDetail;
  reclaim: boolean;
  onReclaim: (on: boolean) => void;
}) {
  const t = useTranslations('itam.license');
  const tc = useTranslations('common');
  const [selection, setSelection] = useState<DataTableSelection>({});
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [person, setPerson] = useState<PersonOption | null>(null);
  const [device, setDevice] = useState<PickedAsset | null>(null);
  const personId = useId();
  const { data, isLoading, isFetching, error, refetch } = useApiQuery<Page<LicenseAssignment>>(
    `/itam/licenses/${lic.id}/assignments`,
    { q: q || undefined, page, pageSize, reclaim: reclaim ? 'true' : undefined },
  );
  const assign = useApiMutation(
    (api, body: { userId?: string; assetId?: string }) =>
      api.post(`/itam/licenses/${lic.id}/assignments`, body),
    {
      invalidate: INVALIDATE,
      success: t('seatAssigned'),
      onSuccess: () => {
        setPerson(null);
        setDevice(null);
      },
    },
  );
  const unassign = useApiMutation(
    async (api, ids: string[]) => {
      for (const id of ids) await api.delete(`/itam/licenses/${lic.id}/assignments/${id}`);
      return ids.length;
    },
    {
      invalidate: INVALIDATE,
      success: (n) => t('seatsReclaimed', { count: n }),
      onSuccess: () => setSelection({}),
    },
  );
  const selected = Object.keys(selection).filter((k) => selection[k]);
  const columns = useMemo<DataTableColumn<LicenseAssignment>[]>(
    () => [
      {
        id: 'holder',
        header: t('holder'),
        meta: { className: 'max-w-72' },
        cell: ({ row }) => {
          const a = row.original;
          if (a.user)
            return (
              <HStack gap={2} vAlign="center">
                <UserAvatar name={a.user.displayName} src={a.user.avatarUrl} className="size-6 text-[10px]" />
                <StackItem size="fill">
                  <VStack>
                    <Text maxLines={1}>{a.user.displayName}</Text>
                    {a.user.email && (
                      <Text type="supporting" maxLines={1}>
                        {a.user.email}
                      </Text>
                    )}
                  </VStack>
                </StackItem>
              </HStack>
            );
          if (a.asset)
            return (
              <HStack gap={2} vAlign="center">
                <CategoryIcon category={a.asset.category} color="secondary" label />
                <Text type="code" size="xsm" color="secondary">
                  {a.asset.tag}
                </Text>
                <StackItem size="fill">
                  <Link href={assetHref(a.asset)} color="primary" maxLines={1}>
                    {a.asset.name}
                  </Link>
                </StackItem>
              </HStack>
            );
          return '—';
        },
      },
      {
        id: 'reclaim',
        header: t('reclaimWhy'),
        cell: ({ row }) =>
          row.original.reclaim ? (
            <Badge variant="warning" label={t(`reclaimReason.${row.original.reclaim}`)} />
          ) : null,
      },
      {
        id: 'assignedAt',
        header: t('since'),
        meta: {
          className: 'hidden whitespace-nowrap text-muted-foreground sm:table-cell',
          headerClassName: 'hidden sm:table-cell',
        },
        cell: ({ row }) => <RelativeTime date={row.original.assignedAt} />,
      },
      {
        id: 'by',
        header: t('assignedBy'),
        meta: {
          className: 'hidden max-w-40 truncate text-muted-foreground md:table-cell',
          headerClassName: 'hidden md:table-cell',
        },
        cell: ({ row }) => row.original.assignedBy?.displayName ?? '—',
      },
      ...(lic.viewer.canManage
        ? [
            {
              id: 'actions',
              header: () => <span className="sr-only">{tc('actions')}</span>,
              meta: { className: 'text-right' },
              cell: ({ row }: { row: { original: LicenseAssignment } }) => (
                <Button
                  label={t('reclaim')}
                  aria-label={t('removeSeat', {
                    name: row.original.user?.displayName ?? row.original.asset?.tag ?? '',
                  })}
                  variant="ghost"
                  size="sm"
                  icon={<Icon icon={Undo2Icon} />}
                  isDisabled={unassign.isPending}
                  onClick={(e) => {
                    e.stopPropagation();
                    unassign.mutate([row.original.id]);
                  }}
                />
              ),
            } satisfies DataTableColumn<LicenseAssignment>,
          ]
        : []),
    ],
    [t, tc, lic.viewer.canManage, unassign],
  );
  return (
    <VStack gap={4}>
      {lic.viewer.canManage && (
        <Card>
          <CardContent className="grid gap-4 md:grid-cols-2">
            {userTypes.includes(lic.licenseType) && (
              <HStack gap={2} vAlign="end">
                <StackItem size="fill">
                  <Field label={t('assignPerson')} inputID={personId}>
                    <PersonPicker
                      id={personId}
                      value={person}
                      onChange={setPerson}
                      placeholder={t('personPlaceholder')}
                    />
                  </Field>
                </StackItem>
                <Button
                  label={t('assign')}
                  variant="primary"
                  icon={<Icon icon={PlusIcon} />}
                  isLoading={assign.isPending && Boolean(person)}
                  isDisabled={!person}
                  onClick={() => person && assign.mutate({ userId: person.id })}
                />
              </HStack>
            )}
            {deviceTypes.includes(lic.licenseType) && (
              <HStack gap={2} vAlign="end">
                <StackItem size="fill">
                  <AssetPicker
                    label={t('assignDevice')}
                    value={device}
                    onChange={setDevice}
                    placeholder={t('devicePlaceholder')}
                  />
                </StackItem>
                <Button
                  label={t('assign')}
                  variant="primary"
                  icon={<Icon icon={PlusIcon} />}
                  isLoading={assign.isPending && Boolean(device)}
                  isDisabled={!device}
                  onClick={() => device && assign.mutate({ assetId: device.id })}
                />
              </HStack>
            )}
          </CardContent>
        </Card>
      )}
      <DataTable
        label={t('tabs.seats')}
        columns={columns}
        data={data?.items ?? []}
        total={data?.total ?? 0}
        page={page}
        pageSize={pageSize}
        loading={isLoading}
        fetching={isFetching}
        error={error}
        onRetry={() => refetch()}
        getRowId={(a) => a.id}
        selectable={lic.viewer.canManage}
        selection={selection}
        onSelectionChange={setSelection}
        onPageChange={setPage}
        onPageSizeChange={(s) => {
          setPageSize(s);
          setPage(1);
        }}
        toolbar={
          <>
            <SearchInput
              value={q}
              onChange={(v) => {
                setQ(v);
                setPage(1);
              }}
              placeholder={t('searchSeats')}
              className="sm:w-72"
            />
            <Switch
              label={t('onlyReclaim')}
              value={reclaim}
              onChange={(c) => {
                onReclaim(c);
                setPage(1);
              }}
            />
            {lic.viewer.canManage && selected.length > 0 && (
              <Button
                label={t('reclaimSelected', { count: selected.length })}
                variant="secondary"
                size="sm"
                icon={<Icon icon={Undo2Icon} />}
                isLoading={unassign.isPending}
                onClick={() => unassign.mutate(selected)}
              />
            )}
          </>
        }
        empty={
          reclaim ? (
            <EmptyState icon={<CircleCheckIcon />} title={t('noReclaim')} description={t('noReclaimHint')} />
          ) : (
            <EmptyState icon={<KeyRoundIcon />} title={t('noSeats')} />
          )
        }
      />
    </VStack>
  );
}

function InstallationsTab({ lic, available }: { lic: LicenseDetail; available: number | null }) {
  const t = useTranslations('itam.license');
  const [unlicensed, setUnlicensed] = useState(lic.unlicensed > 0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const { data, isLoading, isFetching, error, refetch } = useApiQuery<Page<Installation>>(
    `/itam/licenses/${lic.id}/installations`,
    {
      unlicensed: unlicensed ? 'true' : undefined,
      page,
      pageSize,
    },
  );
  const assign = useApiMutation(
    (api, body: { userId?: string; assetId?: string }) =>
      api.post(`/itam/licenses/${lic.id}/assignments`, body),
    { invalidate: INVALIDATE, success: t('seatAssigned') },
  );
  const perDevice = deviceTypes.includes(lic.licenseType) && !userTypes.includes(lic.licenseType);
  const columns = useMemo<DataTableColumn<Installation>[]>(
    () => [
      {
        id: 'device',
        header: t('device'),
        meta: { className: 'max-w-72' },
        cell: ({ row }) => (
          <HStack gap={2} vAlign="center">
            <CategoryIcon category={row.original.asset.category} color="secondary" label />
            <Text type="code" size="xsm" color="secondary">
              {row.original.asset.tag}
            </Text>
            <StackItem size="fill">
              <Link href={assetHref(row.original.asset)} color="primary" maxLines={1}>
                {row.original.asset.name}
              </Link>
            </StackItem>
          </HStack>
        ),
      },
      {
        id: 'user',
        header: t('usedBy'),
        meta: {
          className: 'hidden max-w-44 truncate md:table-cell',
          headerClassName: 'hidden md:table-cell',
        },
        cell: ({ row }) => row.original.asset.assignee?.displayName ?? '—',
      },
      {
        id: 'version',
        header: t('version'),
        meta: {
          className: 'hidden text-muted-foreground tabular-nums lg:table-cell',
          headerClassName: 'hidden lg:table-cell',
        },
        cell: ({ row }) => row.original.version ?? '—',
      },
      {
        id: 'lastSeen',
        header: t('lastSeen'),
        meta: {
          className: 'hidden whitespace-nowrap text-muted-foreground sm:table-cell',
          headerClassName: 'hidden sm:table-cell',
        },
        cell: ({ row }) => <RelativeTime date={row.original.lastSeenAt} />,
      },
      {
        id: 'state',
        header: t('coverage'),
        cell: ({ row }) =>
          row.original.licensed ? (
            <Badge
              variant="success"
              label={t('licensed')}
              icon={<Icon icon={CircleCheckIcon} size="xsm" />}
            />
          ) : (
            <Badge
              variant="error"
              label={t('unlicensedBadge')}
              icon={<Icon icon={CircleAlertIcon} size="xsm" />}
            />
          ),
      },
      ...(lic.viewer.canManage
        ? [
            {
              id: 'fix',
              header: () => <span className="sr-only">{t('assignLicense')}</span>,
              cell: ({ row }: { row: { original: Installation } }) => {
                const i = row.original;
                if (i.licensed) return null;
                const target = perDevice
                  ? { assetId: i.asset.id }
                  : i.asset.assignee
                    ? { userId: i.asset.assignee.id }
                    : null;
                if (!target) return <Text type="supporting">{t('noOwner')}</Text>;
                if (available !== null && available <= 0)
                  return <Text type="supporting">{t('noFreeSeats')}</Text>;
                return (
                  <Button
                    label={t('assignLicense')}
                    aria-label={t('assignLicenseTo', {
                      name: perDevice ? i.asset.tag : (i.asset.assignee?.displayName ?? ''),
                    })}
                    variant="secondary"
                    size="sm"
                    icon={<Icon icon={PlusIcon} />}
                    isDisabled={assign.isPending}
                    onClick={() => assign.mutate(target)}
                  />
                );
              },
            } satisfies DataTableColumn<Installation>,
          ]
        : []),
    ],
    [t, lic.viewer.canManage, assign, perDevice, available],
  );
  return (
    <DataTable
      label={t('tabs.installations')}
      columns={columns}
      data={data?.items ?? []}
      total={data?.total ?? 0}
      page={page}
      pageSize={pageSize}
      loading={isLoading}
      fetching={isFetching}
      error={error}
      onRetry={() => refetch()}
      getRowId={(i) => i.id}
      onPageChange={setPage}
      onPageSizeChange={(s) => {
        setPageSize(s);
        setPage(1);
      }}
      toolbar={
        <Switch
          label={t('onlyUnlicensed')}
          value={unlicensed}
          onChange={(c) => {
            setUnlicensed(c);
            setPage(1);
          }}
        />
      }
      empty={
        <EmptyState icon={<CircleCheckIcon />} title={unlicensed ? t('noUnlicensed') : t('noInstalls')} />
      }
    />
  );
}
