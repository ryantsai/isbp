'use client';

import { AlertDialog } from '@astryxdesign/core/AlertDialog';
import { Badge } from '@astryxdesign/core/Badge';
import { MetadataList, MetadataListItem } from '@astryxdesign/core/MetadataList';
import { Text } from '@astryxdesign/core/Text';
import { useCan, type WebPageProps } from '@isbp/sdk/web';
import { Card, CardContent } from '@isbp/ui/card';
import { EmptyState } from '@isbp/ui/empty-state';
import { useApiMutation, useApiQuery } from '@isbp/ui/query';
import { DateTime } from '@isbp/ui/relative-time';
import { DetailHeader } from '@isbp/ui/page-header';
import { Skeleton } from '@isbp/ui/skeleton';
import { FileQuestionIcon, PencilIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import type { Item } from '../../contracts';
import { ItemFormDialog } from '../item-form';

const STATUS_VARIANT = { draft: 'neutral', active: 'success', archived: 'neutral' } as const;

/**
 * A detail page: back link, title and status, the actions (one primary, at most two secondary, the rest in "More"
 * with the destructive one last and confirmed), then the facts people act on.
 */
export default function DetailPage({ params }: WebPageProps) {
  const t = useTranslations('__ID__');
  const tc = useTranslations('common');
  const router = useRouter();
  const canManage = useCan('__ID__.items.manage');
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const { data: item, isLoading, error } = useApiQuery<Item>(`/__ID__/items/${params.id}`);
  const remove = useApiMutation((api) => api.delete(`/__ID__/items/${params.id}`), {
    invalidate: ['/__ID__/'],
    success: t('deleted'),
    onSuccess: () => router.push('/__ID__'),
  });

  if (isLoading) return <Skeleton className="h-48 w-full rounded-xl" />;
  if (error || !item) return <EmptyState icon={<FileQuestionIcon />} title={t('notFound')} />;

  return (
    <div className="space-y-6">
      <DetailHeader
        back={{ href: '/__ID__', label: t('meta.name'), highlight: item.id }}
        title={item.title}
        status={<Badge variant={STATUS_VARIANT[item.status]} label={t(`status.${item.status}`)} />}
        actions={canManage ? [{ label: tc('edit'), icon: <PencilIcon />, onSelect: () => setEditing(true) }] : []}
        menu={canManage ? [{ label: tc('delete'), destructive: true, onSelect: () => setConfirmingDelete(true) }] : []}
      />
      <Card>
        <CardContent className="space-y-4">
          <Text as="p">{item.description || '—'}</Text>
          <MetadataList columns="multi" label={{ position: 'top' }}>
            <MetadataListItem label={t('fields.owner')}>{item.owner?.displayName ?? '—'}</MetadataListItem>
            <MetadataListItem label={tc('created_at')}>
              <DateTime date={item.createdAt} />
            </MetadataListItem>
            <MetadataListItem label={t('fields.updated')}>
              <DateTime date={item.updatedAt} />
            </MetadataListItem>
          </MetadataList>
        </CardContent>
      </Card>
      <ItemFormDialog open={editing} onOpenChange={setEditing} item={item} />
      <AlertDialog
        isOpen={confirmingDelete}
        onOpenChange={setConfirmingDelete}
        title={t('deleteTitle')}
        description={t('deleteDescription')}
        actionLabel={tc('delete')}
        cancelLabel={tc('cancel')}
        isActionLoading={remove.isPending}
        onAction={() => remove.mutate(undefined)}
      />
    </div>
  );
}
