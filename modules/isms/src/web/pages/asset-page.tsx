'use client';

import { Button } from '@astryxdesign/core/Button';
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import { HStack, Layout, LayoutContent, LayoutFooter, VStack } from '@astryxdesign/core/Layout';
import { List, ListItem } from '@astryxdesign/core/List';
import { MetadataList, MetadataListItem } from '@astryxdesign/core/MetadataList';
import { Tab, TabList } from '@astryxdesign/core/TabList';
import { Text } from '@astryxdesign/core/Text';
import type { Page } from '@isbp/sdk';
import { useApi, type WebPageProps } from '@isbp/sdk/web';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@isbp/ui/card';
import { useListState } from '@isbp/ui/data-table';
import { EmptyState, ErrorState } from '@isbp/ui/empty-state';
import { DetailHeader } from '@isbp/ui/page-header';
import { useApiMutation, useApiQuery } from '@isbp/ui/query';
import { RecordValues } from '@isbp/ui/record-picker';
import { DateTime, RelativeTime } from '@isbp/ui/relative-time';
import { Skeleton } from '@isbp/ui/skeleton';
import { ArrowRightLeftIcon, FileQuestionIcon, PencilIcon, ShieldCheckIcon, Trash2Icon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type ReactNode, useId, useState } from 'react';
import type { Asset, AssetEvent } from '../../contracts';
import { AssetFormSheet, ChangeStatusDialog } from '../asset-form';
import { AssetStatusBadge, ValueBadge } from '../badges';
import { CustomFieldsCard } from '../custom-fields';
import { assetHref, INVALIDATE, useDay, useLocalized, useTaxonomy } from '../lib';
import { LinksAndFiles } from '../record-panels';

const TABS = ['overview', 'history', 'links'] as const;
type Tab = (typeof TABS)[number];

/** A value in a facts list; "—" when there is none. */
const show = (value: ReactNode) => (value === null || value === undefined || value === '' ? '—' : value);

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
  if (!data?.items.length)
    return (
      <Text as="p" color="secondary">
        {t('history.none')}
      </Text>
    );
  const shown = (v: unknown) =>
    v === null || v === undefined || v === '' ? '—' : Array.isArray(v) ? String(v.length) : String(v);
  return (
    <VStack gap={3}>
      <List hasDividers>
        {data.items.map((e) => (
          <ListItem
            key={e.id}
            label={t(`history.kinds.${e.kind as 'created'}`)}
            endContent={
              <Text type="supporting">
                {e.actor?.displayName ?? t('history.system')} · <RelativeTime date={e.createdAt} />
              </Text>
            }
            description={
              e.note || (e.changes && Object.keys(e.changes).length > 0) ? (
                <VStack gap={1}>
                  {e.note && <Text as="p">{e.note}</Text>}
                  {e.changes &&
                    Object.entries(e.changes).map(([field, [before, after]]) => (
                      <Text key={field} as="div" type="supporting">
                        {t.has(`fields.${FIELD_KEYS[field] ?? field}`)
                          ? t(`fields.${(FIELD_KEYS[field] ?? field) as 'name'}`)
                          : t('history.customFields')}
                        :{' '}
                        {FIELD_KEYS[field] || field === 'attributes'
                          ? t('history.changed')
                          : `${shown(before)} → ${shown(after)}`}
                      </Text>
                    ))}
                </VStack>
              ) : undefined
            }
          />
        ))}
      </List>
      {data.total > page * 20 && (
        <Button
          label={t('history.more')}
          variant="secondary"
          size="sm"
          onClick={() => setPage((p) => p + 1)}
        />
      )}
    </VStack>
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
  const panels = useId();
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
      <div className="space-y-5">
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
    <div className="space-y-5">
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
            {asset.classification && <Text color="secondary">{localized(asset.classification.name)}</Text>}
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

      <VStack gap={4}>
        <TabList
          role="tablist"
          value={tab}
          onChange={(v) => set({ tab: v === 'overview' ? undefined : v })}
          hasDivider
        >
          <Tab value="overview" label={tc('overview')} panelId={`${panels}-overview`} />
          <Tab value="history" label={t('history.title')} panelId={`${panels}-history`} />
          <Tab value="links" label={t('links.title')} panelId={`${panels}-links`} />
        </TabList>
        <div role="tabpanel" id={`${panels}-overview`} hidden={tab !== 'overview'} className="min-w-0">
          {tab === 'overview' && (
            <VStack gap={5}>
              <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-2">
                <Card className="min-w-0">
                  <CardHeader>
                    <CardTitle>{t('asset.about')}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <MetadataList>
                      <MetadataListItem label={t('fields.site')}>
                        {asset.site.code} · {asset.site.name}
                      </MetadataListItem>
                      <MetadataListItem label={t('fields.manager')}>
                        {show(asset.manager?.displayName)}
                      </MetadataListItem>
                      <MetadataListItem label={t('fields.managerGroup')}>
                        {show(asset.managerGroup?.name)}
                      </MetadataListItem>
                      <MetadataListItem label={t('fields.users')}>
                        {show(
                          asset.users.length || asset.usersText
                            ? [...asset.users.map((u) => u.displayName), asset.usersText]
                                .filter(Boolean)
                                .join(', ')
                            : null,
                        )}
                      </MetadataListItem>
                      <MetadataListItem label={t('fields.location')}>{show(asset.location)}</MetadataListItem>
                      <MetadataListItem label={t('fields.brand')}>{show(asset.brand)}</MetadataListItem>
                      <MetadataListItem label={t('fields.model')}>{show(asset.model)}</MetadataListItem>
                      <MetadataListItem label={t('fields.version')}>{show(asset.version)}</MetadataListItem>
                      <MetadataListItem label={t('fields.quantity')}>{show(asset.quantity)}</MetadataListItem>
                      <MetadataListItem label={t('fields.lastVerifiedOn')}>
                        {show(asset.lastVerifiedOn ? day(asset.lastVerifiedOn) : null)}
                      </MetadataListItem>
                      {asset.sourceRef && (
                        <MetadataListItem label={t('fields.source')}>
                          <RecordValues refs={[asset.sourceRef]} />
                        </MetadataListItem>
                      )}
                      <MetadataListItem label={tc('created_at')}>
                        <DateTime date={asset.createdAt} />
                      </MetadataListItem>
                    </MetadataList>
                  </CardContent>
                </Card>
                <Card className="min-w-0">
                  <CardHeader>
                    <CardTitle>{t('asset.cia')}</CardTitle>
                    <CardDescription>{t('asset.ciaDescription', { value: asset.value })}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <MetadataList>
                      {(
                        [
                          ['confidentiality', 'c'],
                          ['integrity', 'i'],
                          ['availability', 'a'],
                        ] as const
                      ).map(([k, d]) => (
                        <MetadataListItem key={k} label={t(`fields.${k}`)}>
                          <VStack gap={0.5}>
                            <Text weight="medium" hasTabularNumbers>
                              {asset[k]}
                            </Text>
                            {guidance(d, asset[k]) && <Text type="supporting">{guidance(d, asset[k])}</Text>}
                          </VStack>
                        </MetadataListItem>
                      ))}
                      <MetadataListItem label={t('fields.value')}>
                        <ValueBadge value={asset.value} />
                      </MetadataListItem>
                      <MetadataListItem label={t('fields.classification')}>
                        {show(asset.classification ? localized(asset.classification.name) : null)}
                      </MetadataListItem>
                    </MetadataList>
                  </CardContent>
                </Card>
              </div>
              {asset.notes && (
                <Card>
                  <CardHeader>
                    <CardTitle>{t('fields.notes')}</CardTitle>
                  </CardHeader>
                  <CardContent className="text-sm whitespace-pre-wrap wrap-anywhere">
                    {asset.notes}
                  </CardContent>
                </Card>
              )}
              <CustomFieldsCard entityType="isms.asset" attributes={asset.attributes} />
            </VStack>
          )}
        </div>
        <div role="tabpanel" id={`${panels}-history`} hidden={tab !== 'history'} className="min-w-0">
          {tab === 'history' && <History number={asset.number} />}
        </div>
        <div role="tabpanel" id={`${panels}-links`} hidden={tab !== 'links'} className="min-w-0">
          {tab === 'links' && <LinksAndFiles type="isms.asset" id={asset.id} />}
        </div>
      </VStack>

      {asset.viewer.canManage && changing && <ChangeStatusDialog asset={asset} onOpenChange={setChanging} />}
      {asset.viewer.canManage && (
        <AssetFormSheet
          open={editing}
          onOpenChange={setEditing}
          asset={asset}
          onSaved={(a) => a.number !== asset.number && router.replace(assetHref(a.number))}
        />
      )}
      {/* Three answers (keep, mark disposed instead, delete): more than an AlertDialog's cancel + action. */}
      <Dialog isOpen={deleting} onOpenChange={setDeleting} width={448}>
        <Layout
          header={
            <DialogHeader
              title={t('asset.deleteTitle', { number: asset.number })}
              onOpenChange={setDeleting}
            />
          }
          content={
            <LayoutContent padding={4}>
              <Text as="p">{t('asset.deleteDescription', { name: asset.name })}</Text>
            </LayoutContent>
          }
          footer={
            <LayoutFooter hasDivider padding={3}>
              <HStack gap={2} hAlign="end" wrap="wrap">
                <Button label={tc('cancel')} variant="ghost" onClick={() => setDeleting(false)} />
                {asset.status !== 'disposed' && (
                  <Button
                    label={t('asset.markDisposedInstead')}
                    variant="secondary"
                    onClick={() => {
                      setDeleting(false);
                      setChanging(true);
                    }}
                  />
                )}
                <Button
                  label={tc('delete')}
                  variant="destructive"
                  isLoading={remove.isPending}
                  onClick={() => remove.mutate(undefined)}
                />
              </HStack>
            </LayoutFooter>
          }
        />
      </Dialog>
    </div>
  );
}
