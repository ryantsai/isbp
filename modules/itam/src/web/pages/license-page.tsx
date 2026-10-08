'use client';

import type { Page } from '@isbp/sdk';
import type { WebPageProps } from '@isbp/sdk/web';
import { UserAvatar } from '@isbp/ui/avatar';
import { Badge } from '@isbp/ui/badge';
import { Button } from '@isbp/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@isbp/ui/card';
import { DataTable, type DataTableColumn } from '@isbp/ui/data-table';
import { EmptyState } from '@isbp/ui/empty-state';
import { Label } from '@isbp/ui/label';
import { FadeIn } from '@isbp/ui/motion';
import { type PersonOption, PersonPicker } from '@isbp/ui/person-picker';
import { useApiMutation, useApiQuery } from '@isbp/ui/query';
import { RelativeTime } from '@isbp/ui/relative-time';
import { SearchInput } from '@isbp/ui/search-input';
import { Skeleton } from '@isbp/ui/skeleton';
import { Switch } from '@isbp/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@isbp/ui/tabs';
import {
  ArrowLeftIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  CopyIcon,
  EyeIcon,
  EyeOffIcon,
  FileQuestionIcon,
  KeyRoundIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
} from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { type ReactNode, useId, useMemo, useState } from 'react';
import type { Installation, LicenseAssignment, LicenseDetail } from '../../contracts';
import { CategoryIcon, ComplianceBadge } from '../badges';
import { LicenseFormDialog } from '../license-form-dialog';
import { assetHref, contractHref, INVALIDATE, useDay, useItamSettings, useMoney } from '../lib';
import { UsageMeter } from '../meters';
import { AssetPicker, type PickedAsset } from '../pickers';
import { LinksAndFiles } from '../record-panels';

type Tab = 'seats' | 'installations' | 'links';

function Stat({ label, value, tone }: { label: string; value: ReactNode; tone?: 'destructive' }) {
  return (
    <div className="min-w-0 rounded-lg border px-3 py-2">
      <dt className="truncate text-xs text-muted-foreground">{label}</dt>
      <dd
        className={
          tone === 'destructive' ? 'text-lg font-semibold text-destructive' : 'text-lg font-semibold'
        }
      >
        {value}
      </dd>
    </div>
  );
}

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
  const [tab, setTab] = useState<Tab>('seats');
  const [editing, setEditing] = useState(false);

  if (isLoading)
    return (
      <div className="space-y-6">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-10 w-80" />
        <Skeleton className="h-48 w-full rounded-xl" />
      </div>
    );
  if (error || !lic) return <EmptyState icon={<FileQuestionIcon />} title={t('license.notFound')} />;

  const available = lic.quantity === null ? null : Math.max(0, lic.quantity - lic.used);

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" asChild className="-ml-2 text-muted-foreground">
        <Link href="/itam/software">
          <ArrowLeftIcon /> {t('software.title')}
        </Link>
      </Button>

      <FadeIn y={4} className="flex flex-col gap-4 lg:flex-row lg:items-start">
        <div className="flex min-w-0 flex-1 items-start gap-4">
          <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
            <KeyRoundIcon className="size-6" aria-hidden />
          </span>
          <div className="min-w-0 flex-1 space-y-1.5">
            <p className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
              <span className="font-mono">{lic.reference}</span>
              <span aria-hidden>·</span>
              <span>{t(`licenseType.${lic.licenseType}`)}</span>
              {lic.publisher && (
                <>
                  <span aria-hidden>·</span>
                  <span>{lic.publisher}</span>
                </>
              )}
            </p>
            <h1 className="text-2xl font-semibold tracking-tight wrap-anywhere">{lic.product}</h1>
            <ComplianceBadge state={lic.complianceState} />
          </div>
        </div>
        {lic.viewer.canManage && (
          <Button variant="outline" onClick={() => setEditing(true)}>
            <PencilIcon /> {t('actions.edit')}
          </Button>
        )}
      </FadeIn>

      <div className="grid min-w-0 grid-cols-1 items-start gap-6 lg:grid-cols-3">
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
            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label={t('license.entitled')} value={lic.quantity ?? t('license.unlimited')} />
              <Stat label={t('license.assigned')} value={lic.assigned} />
              <Stat
                label={t('license.unlicensed')}
                value={lic.unlicensed}
                tone={lic.unlicensed > 0 ? 'destructive' : undefined}
              />
              <Stat label={t('license.available')} value={available ?? '∞'} />
            </dl>
            {lic.licenseType === 'per_device' && lic.unlicensed > 0 && (
              <p className="flex items-start gap-2 text-sm text-muted-foreground">
                <CircleAlertIcon className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
                {t('license.unlicensedCounted')}
              </p>
            )}
          </CardContent>
        </Card>
        <div className="min-w-0 space-y-6">
          <KeyCard lic={lic} />
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
                  [t('fields.annualCost'), money(lic.annualCost, lic.currency)],
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
        </div>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
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
          {tab === 'seats' && <SeatsTab lic={lic} />}
        </TabsContent>
        <TabsContent value="installations" className="min-w-0">
          {tab === 'installations' && <InstallationsTab lic={lic} />}
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

function SeatsTab({ lic }: { lic: LicenseDetail }) {
  const t = useTranslations('itam.license');
  const tc = useTranslations('common');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [person, setPerson] = useState<PersonOption | null>(null);
  const [device, setDevice] = useState<PickedAsset | null>(null);
  const ids = { person: useId(), device: useId() };
  const { data, isLoading, isFetching } = useApiQuery<Page<LicenseAssignment>>(
    `/itam/licenses/${lic.id}/assignments`,
    { q: q || undefined, page, pageSize },
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
    (api, id: string) => api.delete(`/itam/licenses/${lic.id}/assignments/${id}`),
    { invalidate: INVALIDATE, success: t('seatRemoved') },
  );
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
              size: 48,
              cell: ({ row }: { row: { original: LicenseAssignment } }) => (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t('removeSeat', {
                    name: row.original.user?.displayName ?? row.original.asset?.tag ?? '',
                  })}
                  disabled={unassign.isPending}
                  onClick={(e) => {
                    e.stopPropagation();
                    unassign.mutate(row.original.id);
                  }}
                >
                  <Trash2Icon />
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
        getRowId={(a) => a.id}
        onPageChange={setPage}
        onPageSizeChange={(s) => {
          setPageSize(s);
          setPage(1);
        }}
        toolbar={
          <SearchInput
            value={q}
            onChange={(v) => {
              setQ(v);
              setPage(1);
            }}
            placeholder={t('searchSeats')}
            className="sm:w-72"
          />
        }
        empty={<EmptyState icon={<KeyRoundIcon />} title={t('noSeats')} />}
      />
    </div>
  );
}

function InstallationsTab({ lic }: { lic: LicenseDetail }) {
  const t = useTranslations('itam.license');
  const switchId = useId();
  const [unlicensed, setUnlicensed] = useState(lic.unlicensed > 0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const { data, isLoading, isFetching } = useApiQuery<Page<Installation>>(
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
    [t, lic.viewer.canManage, assign, perDevice],
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
