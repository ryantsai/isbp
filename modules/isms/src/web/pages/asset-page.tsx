'use client';

import type { Page } from '@isbp/sdk';
import { useApi, type WebPageProps } from '@isbp/sdk/web';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@isbp/ui/alert-dialog';
import { Button } from '@isbp/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@isbp/ui/card';
import { EmptyState, ErrorState } from '@isbp/ui/empty-state';
import { useListState } from '@isbp/ui/data-table';
import { DetailHeader } from '@isbp/ui/page-header';
import { useApiMutation, useApiQuery } from '@isbp/ui/query';
import { RecordValues } from '@isbp/ui/record-picker';
import { DateTime, RelativeTime } from '@isbp/ui/relative-time';
import { Skeleton } from '@isbp/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@isbp/ui/tabs';
import { ArrowRightLeftIcon, FileQuestionIcon, PencilIcon, ShieldCheckIcon, Trash2Icon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type ReactNode, useState } from 'react';
import type { Asset, AssetEvent } from '../../contracts';
import { AssetFormSheet, ChangeStatusDialog } from '../asset-form';
import { AssetStatusBadge, ValueBadge } from '../badges';
import { CustomFieldsCard } from '../custom-fields';
import { assetHref, INVALIDATE, useDay, useLocalized, useTaxonomy } from '../lib';
import { LinksAndFiles } from '../record-panels';

const TABS = ['overview', 'history', 'links'] as const;
type Tab = (typeof TABS)[number];

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)] gap-3 border-b py-2 text-sm last:border-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 wrap-anywhere">
        {children ?? <span className="text-muted-foreground">—</span>}
      </dd>
    </div>
  );
}

const FIELD_KEYS: Record<string, string> = {
  classId: 'class',
  subclassId: 'subclass',
  siteId: 'site',
  managerId: 'manager',
  managerGroupId: 'managerGroup',
  userIds: 'users',
  labelId: 'classification',
};

function History({ number }: { number: string }) {
  const t = useTranslations('isms');
  const [page, setPage] = useState(1);
  const { data, isLoading } = useApiQuery<Page<AssetEvent>>(`/isms/assets/${number}/events`, {
    page,
    pageSize: 20,
  });
  if (isLoading) return <Skeleton className="h-40 w-full" />;
  if (!data?.items.length) return <p className="text-sm text-muted-foreground">{t('history.none')}</p>;
  const shown = (v: unknown) =>
    v === null || v === undefined || v === '' ? '—' : Array.isArray(v) ? String(v.length) : String(v);
  return (
    <div className="space-y-3">
      <ol className="space-y-3">
        {data.items.map((e) => (
          <li key={e.id} className="rounded-lg border p-3 text-sm">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="font-medium">{t(`history.kinds.${e.kind as 'created'}`)}</span>
              <span className="text-xs text-muted-foreground">
                {e.actor?.displayName ?? t('history.system')} · <RelativeTime date={e.createdAt} />
              </span>
            </div>
            {e.note && <p className="mt-1 text-muted-foreground">{e.note}</p>}
            {e.changes && Object.keys(e.changes).length > 0 && (
              <ul className="mt-2 space-y-0.5 text-xs">
                {Object.entries(e.changes).map(([field, [before, after]]) => (
                  <li key={field} className="wrap-anywhere">
                    <span className="text-muted-foreground">
                      {t.has(`fields.${FIELD_KEYS[field] ?? field}`)
                        ? t(`fields.${(FIELD_KEYS[field] ?? field) as 'name'}`)
                        : t('history.customFields')}
                      :
                    </span>{' '}
                    {FIELD_KEYS[field] || field === 'attributes'
                      ? t('history.changed')
                      : `${shown(before)} → ${shown(after)}`}
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ol>
      {data.total > page * 20 && (
        <Button variant="outline" size="sm" onClick={() => setPage((p) => p + 1)}>
          {t('history.more')}
        </Button>
      )}
    </div>
  );
}

/** One information asset: what it is, who looks after it, its C/I/A with the class's guidance, history and links. */
export default function AssetPage({ params }: WebPageProps) {
  const t = useTranslations('isms');
  const tc = useTranslations('common');
  const router = useRouter();
  const api = useApi();
  const localized = useLocalized();
  const day = useDay();
  const {
    data: asset,
    isLoading,
    error,
  } = useApiQuery<Asset>(`/isms/assets/${encodeURIComponent(params.ref ?? '')}`);
  const { data: taxonomy } = useTaxonomy();
  const [state, set] = useListState();
  const tab: Tab = TABS.includes(state.tab as Tab) ? (state.tab as Tab) : 'overview';
  const [editing, setEditing] = useState(false);
  const [changing, setChanging] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const remove = useApiMutation(() => api.delete(`/isms/assets/${asset!.id}`), {
    invalidate: INVALIDATE,
    success: t('asset.deleted'),
    onSuccess: () => router.push('/isms'),
  });

  if (isLoading)
    return (
      <div className="space-y-6">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-10 w-80" />
        <Skeleton className="h-72 w-full rounded-xl" />
      </div>
    );
  if (error) return <ErrorState kind="page" error={error} />;
  if (!asset) return <EmptyState icon={<FileQuestionIcon />} title={t('asset.notFound')} />;

  const klass = taxonomy?.classes.find((c) => c.id === asset.class.id);
  const guidance = (dim: 'c' | 'i' | 'a', level: number) =>
    klass ? localized(klass.guidance[dim][String(level) as '1']) : '';

  return (
    <div className="space-y-6">
      <DetailHeader
        back={{ href: '/isms', label: t('register.title'), highlight: asset.id }}
        icon={<ShieldCheckIcon />}
        reference={[
          asset.number,
          localized(asset.class.name),
          asset.subclass ? localized(asset.subclass.name) : null,
        ]
          .filter(Boolean)
          .join(' · ')}
        title={asset.name}
        status={<AssetStatusBadge status={asset.status} animate />}
        badges={
          <>
            <ValueBadge value={asset.value} />
            {asset.classification && (
              <span className="text-sm text-muted-foreground">{localized(asset.classification.name)}</span>
            )}
          </>
        }
        actions={
          asset.viewer.canManage
            ? [
                { id: 'edit', label: tc('edit'), icon: <PencilIcon />, onSelect: () => setEditing(true) },
                {
                  id: 'status',
                  label: t('asset.changeStatus'),
                  icon: <ArrowRightLeftIcon />,
                  onSelect: () => setChanging(true),
                },
              ]
            : []
        }
        menu={
          asset.viewer.canManage
            ? [
                {
                  id: 'delete',
                  label: tc('delete'),
                  icon: <Trash2Icon />,
                  destructive: true,
                  onSelect: () => setDeleting(true),
                },
              ]
            : []
        }
      />

      <Tabs
        value={tab}
        onValueChange={(v) => set({ tab: v === 'overview' ? undefined : v })}
        className="gap-4"
      >
        <TabsList className="max-w-full justify-start overflow-x-auto">
          <TabsTrigger value="overview">{tc('overview')}</TabsTrigger>
          <TabsTrigger value="history">{t('history.title')}</TabsTrigger>
          <TabsTrigger value="links">{t('links.title')}</TabsTrigger>
        </TabsList>
        <TabsContent value="overview" className="min-w-0 space-y-6">
          <div className="grid min-w-0 grid-cols-1 gap-6 lg:grid-cols-2">
            <Card className="min-w-0">
              <CardHeader>
                <CardTitle>{t('asset.about')}</CardTitle>
              </CardHeader>
              <CardContent>
                <dl>
                  <Field label={t('fields.site')}>
                    {asset.site.code} · {asset.site.name}
                  </Field>
                  <Field label={t('fields.manager')}>{asset.manager?.displayName}</Field>
                  <Field label={t('fields.managerGroup')}>{asset.managerGroup?.name}</Field>
                  <Field label={t('fields.users')}>
                    {asset.users.length || asset.usersText
                      ? [...asset.users.map((u) => u.displayName), asset.usersText].filter(Boolean).join(', ')
                      : null}
                  </Field>
                  <Field label={t('fields.location')}>{asset.location}</Field>
                  <Field label={t('fields.brand')}>{asset.brand}</Field>
                  <Field label={t('fields.model')}>{asset.model}</Field>
                  <Field label={t('fields.version')}>{asset.version}</Field>
                  <Field label={t('fields.quantity')}>{asset.quantity}</Field>
                  <Field label={t('fields.lastVerifiedOn')}>
                    {asset.lastVerifiedOn ? day(asset.lastVerifiedOn) : null}
                  </Field>
                  {asset.sourceRef && (
                    <Field label={t('fields.source')}>
                      <RecordValues refs={[asset.sourceRef]} />
                    </Field>
                  )}
                  <Field label={tc('created_at')}>
                    <DateTime date={asset.createdAt} />
                  </Field>
                </dl>
              </CardContent>
            </Card>
            <Card className="min-w-0">
              <CardHeader>
                <CardTitle>{t('asset.cia')}</CardTitle>
                <CardDescription>{t('asset.ciaDescription', { value: asset.value })}</CardDescription>
              </CardHeader>
              <CardContent>
                <dl>
                  {(
                    [
                      ['confidentiality', 'c'],
                      ['integrity', 'i'],
                      ['availability', 'a'],
                    ] as const
                  ).map(([k, d]) => (
                    <Field key={k} label={t(`fields.${k}`)}>
                      <span className="font-medium tabular-nums">{asset[k]}</span>
                      {guidance(d, asset[k]) && (
                        <span className="block text-xs text-muted-foreground">{guidance(d, asset[k])}</span>
                      )}
                    </Field>
                  ))}
                  <Field label={t('fields.value')}>
                    <ValueBadge value={asset.value} />
                  </Field>
                  <Field label={t('fields.classification')}>
                    {asset.classification ? localized(asset.classification.name) : null}
                  </Field>
                </dl>
              </CardContent>
            </Card>
          </div>
          {asset.notes && (
            <Card>
              <CardHeader>
                <CardTitle>{t('fields.notes')}</CardTitle>
              </CardHeader>
              <CardContent className="text-sm whitespace-pre-wrap wrap-anywhere">{asset.notes}</CardContent>
            </Card>
          )}
          <CustomFieldsCard entityType="isms.asset" attributes={asset.attributes} />
        </TabsContent>
        <TabsContent value="history" className="min-w-0">
          {tab === 'history' && <History number={asset.number} />}
        </TabsContent>
        <TabsContent value="links" className="min-w-0">
          {tab === 'links' && <LinksAndFiles type="isms.asset" id={asset.id} />}
        </TabsContent>
      </Tabs>

      {asset.viewer.canManage && changing && <ChangeStatusDialog asset={asset} onOpenChange={setChanging} />}
      {asset.viewer.canManage && (
        <AssetFormSheet
          open={editing}
          onOpenChange={setEditing}
          asset={asset}
          onSaved={(a) => a.number !== asset.number && router.replace(assetHref(a.number))}
        />
      )}
      <AlertDialog open={deleting} onOpenChange={setDeleting}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('asset.deleteTitle', { number: asset.number })}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('asset.deleteDescription', { name: asset.name })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tc('cancel')}</AlertDialogCancel>
            {asset.status !== 'disposed' && (
              <Button
                variant="outline"
                onClick={() => {
                  setDeleting(false);
                  setChanging(true);
                }}
              >
                {t('asset.markDisposedInstead')}
              </Button>
            )}
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={(e) => {
                e.preventDefault();
                remove.mutate(undefined);
              }}
            >
              {tc('delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
