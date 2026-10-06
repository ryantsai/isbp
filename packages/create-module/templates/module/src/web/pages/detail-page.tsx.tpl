'use client';

import { useCan, type WebPageProps } from '@isbp/sdk/web';
import { Badge } from '@isbp/ui/badge';
import { Button } from '@isbp/ui/button';
import { Card, CardContent } from '@isbp/ui/card';
import { EmptyState } from '@isbp/ui/empty-state';
import { FadeIn } from '@isbp/ui/motion';
import { useApiMutation, useApiQuery } from '@isbp/ui/query';
import { DateTime } from '@isbp/ui/relative-time';
import { Skeleton } from '@isbp/ui/skeleton';
import { ArrowLeftIcon, FileQuestionIcon, PencilIcon, Trash2Icon } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import type { Item } from '../../contracts';
import { ItemFormDialog } from '../item-form';

export default function DetailPage({ params }: WebPageProps) {
  const t = useTranslations('__ID__');
  const tc = useTranslations('common');
  const router = useRouter();
  const canManage = useCan('__ID__.items.manage');
  const [editing, setEditing] = useState(false);
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
      <Button variant="ghost" size="sm" asChild className="-ml-2 text-muted-foreground">
        <Link href="/__ID__">
          <ArrowLeftIcon /> {t('meta.name')}
        </Link>
      </Button>
      <FadeIn y={4} className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">{item.title}</h1>
          <Badge variant="secondary">{t(`status.${item.status}`)}</Badge>
        </div>
        {canManage && (
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setEditing(true)}>
              <PencilIcon /> {tc('edit')}
            </Button>
            <Button variant="outline" onClick={() => remove.mutate(undefined)} loading={remove.isPending}>
              <Trash2Icon /> {tc('delete')}
            </Button>
          </div>
        )}
      </FadeIn>
      <Card>
        <CardContent className="space-y-4">
          <p className="whitespace-pre-wrap">{item.description || '—'}</p>
          <dl className="grid gap-2 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-muted-foreground">{t('fields.owner')}</dt>
              <dd>{item.owner?.displayName ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{tc('created_at')}</dt>
              <dd>
                <DateTime date={item.createdAt} />
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t('fields.updated')}</dt>
              <dd>
                <DateTime date={item.updatedAt} />
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>
      <ItemFormDialog open={editing} onOpenChange={setEditing} item={item} />
    </div>
  );
}
