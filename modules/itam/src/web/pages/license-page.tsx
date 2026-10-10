'use client';

import type { Page } from '@isbp/sdk';
import type { WebPageProps } from '@isbp/sdk/web';
import { UserAvatar } from '@isbp/ui/avatar';
import { Badge } from '@isbp/ui/badge';
import { Button } from '@isbp/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@isbp/ui/card';
import { DataTable, type DataTableColumn, type DataTableSelection, useListState } from '@isbp/ui/data-table';
import { EmptyState, ErrorState } from '@isbp/ui/empty-state';
import { Label } from '@isbp/ui/label';
import { DetailHeader } from '@isbp/ui/page-header';
import { type PersonOption, PersonPicker } from '@isbp/ui/person-picker';
import { useApiMutation, useApiQuery } from '@isbp/ui/query';
import { RelativeTime } from '@isbp/ui/relative-time';
import { SearchInput } from '@isbp/ui/search-input';
import { Skeleton } from '@isbp/ui/skeleton';
import { StatTile } from '@isbp/ui/stat-tile';
import { Switch } from '@isbp/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@isbp/ui/tabs';
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
import Link from 'next/link';
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

  if (isLoading)
    return (
      <div className="space-y-5">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-10 w-80" />
        <Skeleton className="h-48 w-full rounded-xl" />
      </div>
    );
  if (error) return <ErrorState kind="page" error={error} />;
  if (!lic) return <EmptyState icon={<FileQuestionIcon />} title={t('license.notFound')} />;

  const available = lic.quantity === null ? null : Math.max(0, lic.quantity - lic.used);

  return (
    <div className="space-y-5">
      <DetailHeader
        back={{ href: '/itam/software', label: t('nav.software'), highlight: lic.id }}
        icon={<KeyRoundIcon />}
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
                  icon: <PencilIcon />,
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
          <CardContent className="space-y-4">
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
              <p className="text-sm">
                {t('license.overHint')}{' '}
                <Link href="?tab=seats&reclaim=true" className="font-medium text-primary hover:underline">
                  {t('license.showReclaim')}
                </Link>
              </p>
            )}
            {lic.licenseType === 'per_device' && lic.unlicensed > 0 && (
              <p className="flex items-start gap-2 text-sm text-muted-foreground">
                <CircleAlertIcon className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
                {t('license.unlicensedCounted')}
              </p>
            )}
          </CardContent>
        </Card>
        <div className="min-w-0 space-y-5">
          <Card>
            <CardHeader>
              <CardTitle>{t('license.terms')}</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-2 text-sm">
                {[
                  [t('fields.vendor'), lic.vendor?.name ?? '—'],
                  [t('fields.billing'), t(`billing.${lic.billing}`)],
                  [t('fields.cost'), money(lic.cost, lic.currency)],
                  ...(lic.billing === 'annual'
                    ? []
                    : [[t('fields.annualCost'), money(lic.annualCost, lic.currency)]]),
                  [t('fields.startDate'), day(lic.startDate)],
                  [t('fields.endDate'), lic.endDate ? day(lic.endDate) : t('software.perpetual')],
                ].map(([label, value]) => (
                  <div key={label} className="grid grid-cols-[minmax(0,8rem)_minmax(0,1fr)] gap-2">
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd className="min-w-0 wrap-anywhere">{value}</dd>
                  </div>
                ))}
                <div className="grid grid-cols-[minmax(0,8rem)_minmax(0,1fr)] gap-2">
                  <dt className="text-muted-foreground">{t('fields.contract')}</dt>
                  <dd className="min-w-0">
                    {lic.contract ? (
                      lic.viewer.canReadContracts ? (
                        <Link
                          href={contractHref(lic.contract)}
                          className="hover:underline focus-visible:underline"
                        >
                          <span className="font-mono text-xs">{lic.contract.reference}</span>{' '}
                          {lic.contract.title}
                        </Link>
                      ) : (
                        <span>
                          <span className="font-mono text-xs">{lic.contract.reference}</span>{' '}
                          {lic.contract.title}
                        </span>
                      )
                    ) : (
                      '—'
                    )}
                  </dd>
                </div>
              </dl>
              {lic.notes && (
                <p className="mt-4 text-sm whitespace-pre-wrap text-muted-foreground">{lic.notes}</p>
              )}
            </CardContent>
          </Card>
          <KeyCard lic={lic} />
        </div>
      </div>

      <Tabs
        value={tab}
        onValueChange={(v) => set({ tab: v === 'seats' ? undefined : v, reclaim: undefined })}
      >
        <TabsList className="max-w-full justify-start overflow-x-auto">
          <TabsTrigger value="seats">
            {t('license.tabs.seats')}
            <Badge variant="muted" className="px-1.5 tabular-nums">
              {lic.assigned}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="installations">
            {t('license.tabs.installations')}
            {lic.unlicensed > 0 && (
              <Badge variant="destructive" className="px-1.5 tabular-nums">
                {lic.unlicensed}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="links">{t('license.tabs.links')}</TabsTrigger>
        </TabsList>
        <TabsContent value="seats" className="min-w-0">
          {tab === 'seats' && (
            <SeatsTab
              lic={lic}
              reclaim={state.reclaim === 'true'}
              onReclaim={(on) => set({ reclaim: on ? 'true' : undefined })}
            />
          )}
        </TabsContent>
        <TabsContent value="installations" className="min-w-0">
          {tab === 'installations' && <InstallationsTab lic={lic} available={available} />}
        </TabsContent>
        <TabsContent value="links" className="min-w-0">
          {tab === 'links' && <LinksAndFiles type="itam.license" id={lic.id} />}
        </TabsContent>
      </Tabs>

      {lic.viewer.canManage && <LicenseFormDialog open={editing} onOpenChange={setEditing} license={lic} />}
    </div>
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
        <CardContent className="space-y-3">
          <p className="rounded-md bg-muted px-3 py-2 font-mono text-sm break-all" aria-live="polite">
            {key ?? (lic.keyHint ? `•••• •••• •••• ${lic.keyHint}` : '•••• •••• •••• ••••')}
          </p>
          <div className="flex flex-wrap gap-2">
            {key ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={async () => {
                    await navigator.clipboard?.writeText(key);
                    setCopied(true);
                  }}
                >
                  <CopyIcon /> {copied ? t('copied') : t('copy')}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setKey(null)}>
                  <EyeOffIcon /> {t('hide')}
                </Button>
              </>
            ) : (
              lic.viewer.canReveal && (
                <Button
                  variant="outline"
                  size="sm"
                  loading={reveal.isPending}
                  onClick={() => reveal.mutate(undefined)}
                >
                  <EyeIcon /> {t('reveal')}
                </Button>
              )
            )}
          </div>
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
  const reclaimId = useId();
  const [selection, setSelection] = useState<DataTableSelection>({});
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [person, setPerson] = useState<PersonOption | null>(null);
  const [device, setDevice] = useState<PickedAsset | null>(null);
  const ids = { person: useId(), device: useId() };
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
              <span className="flex min-w-0 items-center gap-2">
                <UserAvatar name={a.user.displayName} src={a.user.avatarUrl} className="size-6 text-[10px]" />
                <span className="min-w-0">
                  <span className="block truncate">{a.user.displayName}</span>
                  {a.user.email && (
                    <span className="block truncate text-xs text-muted-foreground">{a.user.email}</span>
                  )}
                </span>
              </span>
            );
          if (a.asset)
            return (
              <Link
                href={assetHref(a.asset)}
                className="flex min-w-0 items-center gap-2 hover:underline focus-visible:underline"
              >
                <CategoryIcon category={a.asset.category} className="text-muted-foreground" label />
                <span className="font-mono text-xs text-muted-foreground">{a.asset.tag}</span>
                <span className="truncate">{a.asset.name}</span>
              </Link>
            );
          return '—';
        },
      },
      {
        id: 'reclaim',
        header: t('reclaimWhy'),
        cell: ({ row }) =>
          row.original.reclaim ? (
            <Badge variant="warning">{t(`reclaimReason.${row.original.reclaim}`)}</Badge>
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
                  variant="ghost"
                  size="sm"
                  aria-label={t('removeSeat', {
                    name: row.original.user?.displayName ?? row.original.asset?.tag ?? '',
                  })}
                  disabled={unassign.isPending}
                  onClick={(e) => {
                    e.stopPropagation();
                    unassign.mutate([row.original.id]);
                  }}
                >
                  <Undo2Icon /> {t('reclaim')}
                </Button>
              ),
            } satisfies DataTableColumn<LicenseAssignment>,
          ]
        : []),
    ],
    [t, tc, lic.viewer.canManage, unassign],
  );
  return (
    <div className="grid min-w-0 gap-4">
      {lic.viewer.canManage && (
        <Card>
          <CardContent className="grid gap-4 pt-6 md:grid-cols-2">
            {userTypes.includes(lic.licenseType) && (
              <div className="grid min-w-0 gap-2">
                <Label htmlFor={ids.person}>{t('assignPerson')}</Label>
                <div className="flex min-w-0 gap-2">
                  <div className="min-w-0 flex-1">
                    <PersonPicker
                      id={ids.person}
                      value={person}
                      onChange={setPerson}
                      placeholder={t('personPlaceholder')}
                    />
                  </div>
                  <Button
                    disabled={!person}
                    loading={assign.isPending && Boolean(person)}
                    onClick={() => person && assign.mutate({ userId: person.id })}
                  >
                    <PlusIcon /> {t('assign')}
                  </Button>
                </div>
              </div>
            )}
            {deviceTypes.includes(lic.licenseType) && (
              <div className="grid min-w-0 gap-2">
                <Label htmlFor={ids.device}>{t('assignDevice')}</Label>
                <div className="flex min-w-0 gap-2">
                  <div className="min-w-0 flex-1">
                    <AssetPicker
                      id={ids.device}
                      value={device}
                      onChange={setDevice}
                      placeholder={t('devicePlaceholder')}
                    />
                  </div>
                  <Button
                    disabled={!device}
                    loading={assign.isPending && Boolean(device)}
                    onClick={() => device && assign.mutate({ assetId: device.id })}
                  >
                    <PlusIcon /> {t('assign')}
                  </Button>
                </div>
              </div>
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
            <div className="flex items-center gap-2 text-sm">
              <Switch
                id={reclaimId}
                checked={reclaim}
                onCheckedChange={(c) => {
                  onReclaim(c);
                  setPage(1);
                }}
              />
              <Label htmlFor={reclaimId} className="font-normal">
                {t('onlyReclaim')}
              </Label>
            </div>
            {lic.viewer.canManage && selected.length > 0 && (
              <Button
                size="sm"
                variant="outline"
                loading={unassign.isPending}
                onClick={() => unassign.mutate(selected)}
              >
                <Undo2Icon /> {t('reclaimSelected', { count: selected.length })}
              </Button>
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
    </div>
  );
}

function InstallationsTab({ lic, available }: { lic: LicenseDetail; available: number | null }) {
  const t = useTranslations('itam.license');
  const switchId = useId();
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
          <Link
            href={assetHref(row.original.asset)}
            className="flex min-w-0 items-center gap-2 hover:underline focus-visible:underline"
          >
            <CategoryIcon category={row.original.asset.category} className="text-muted-foreground" label />
            <span className="font-mono text-xs text-muted-foreground">{row.original.asset.tag}</span>
            <span className="truncate">{row.original.asset.name}</span>
          </Link>
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
            <Badge variant="success">
              <CircleCheckIcon aria-hidden /> {t('licensed')}
            </Badge>
          ) : (
            <Badge variant="destructive">
              <CircleAlertIcon aria-hidden /> {t('unlicensedBadge')}
            </Badge>
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
                if (!target) return <span className="text-xs text-muted-foreground">{t('noOwner')}</span>;
                if (available !== null && available <= 0)
                  return <span className="text-xs text-muted-foreground">{t('noFreeSeats')}</span>;
                return (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={assign.isPending}
                    aria-label={t('assignLicenseTo', {
                      name: perDevice ? i.asset.tag : (i.asset.assignee?.displayName ?? ''),
                    })}
                    onClick={() => assign.mutate(target)}
                  >
                    <PlusIcon /> {t('assignLicense')}
                  </Button>
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
        <div className="flex items-center gap-2 text-sm">
          <Switch
            id={switchId}
            checked={unlicensed}
            onCheckedChange={(c) => {
              setUnlicensed(c);
              setPage(1);
            }}
          />
          <Label htmlFor={switchId} className="font-normal">
            {t('onlyUnlicensed')}
          </Label>
        </div>
      }
      empty={
        <EmptyState icon={<CircleCheckIcon />} title={unlicensed ? t('noUnlicensed') : t('noInstalls')} />
      }
    />
  );
}
