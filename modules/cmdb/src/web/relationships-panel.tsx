'use client';

import { localize } from '@isbp/sdk';
import { Button } from '@isbp/ui/button';
import { Card, CardContent } from '@isbp/ui/card';
import { EmptyState, ErrorState } from '@isbp/ui/empty-state';
import { AnimatedItem, AnimatedList } from '@isbp/ui/motion';
import { useApiMutation, useApiQuery } from '@isbp/ui/query';
import { Skeleton } from '@isbp/ui/skeleton';
import { CableIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo } from 'react';
import { type CiRelation, RELATIONSHIP_TYPES, type RelationDirection } from '../contracts';
import { CiStatusBadge } from './badges';
import { ClassIcon } from './class-icon';
import { ciHref, INVALIDATE } from './data';

const DIRECTIONS: RelationDirection[] = ['outgoing', 'incoming'];

function RelationRow({ rel, label, canManage }: { rel: CiRelation; label: string; canManage: boolean }) {
  const t = useTranslations('cmdb');
  const locale = useLocale();
  const remove = useApiMutation((api) => api.delete(`/cmdb/relationships/${rel.id}`), {
    invalidate: INVALIDATE,
    success: t('rel.removed'),
  });
  return (
    <AnimatedItem>
      <div className="flex items-center gap-3 py-2.5">
        <span className="grid size-8 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
          <ClassIcon name={rel.ci.class.icon} className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
            <Link href={ciHref(rel.ci)} className="truncate font-medium hover:underline">
              {rel.ci.name}
            </Link>
            <span className="font-mono text-xs text-muted-foreground">{rel.ci.reference}</span>
          </div>
          <p className="truncate text-xs text-muted-foreground">
            {localize(rel.ci.class.name, locale)}
            {rel.note && <> · {rel.note}</>}
          </p>
        </div>
        <CiStatusBadge status={rel.ci.status} className="hidden sm:inline-flex" />
        {canManage && (
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground hover:text-destructive"
            onClick={() => remove.mutate(undefined)}
            loading={remove.isPending}
            aria-label={t('rel.remove', { label, name: rel.ci.name })}
          >
            <Trash2Icon />
          </Button>
        )}
      </div>
    </AnimatedItem>
  );
}

/** Relationships grouped by type and direction, labelled from this CI's point of view. */
export function RelationshipsPanel({
  ciRef,
  canManage,
  onAdd,
}: {
  ciRef: string;
  canManage: boolean;
  onAdd: () => void;
}) {
  const t = useTranslations('cmdb');
  const { data, isLoading, error, refetch } = useApiQuery<{ items: CiRelation[] }>(
    `/cmdb/cis/${ciRef}/relationships`,
  );
  const groups = useMemo(() => {
    const items = data?.items ?? [];
    return RELATIONSHIP_TYPES.flatMap((type) =>
      DIRECTIONS.map((direction) => ({
        key: `${type}:${direction}`,
        label: t(`relationships.${type}.${direction === 'outgoing' ? 'forward' : 'reverse'}`),
        items: items
          .filter((r) => r.type === type && r.direction === direction)
          .sort((a, b) => a.ci.name.localeCompare(b.ci.name)),
      })),
    ).filter((g) => g.items.length);
  }, [data, t]);

  if (isLoading) return <Skeleton className="h-48 w-full rounded-xl" />;
  if (error && !data)
    return <ErrorState error={error} onRetry={() => refetch()} className="rounded-xl border" />;

  if (!groups.length)
    return (
      <EmptyState
        icon={<CableIcon />}
        title={t('rel.empty')}
        description={t('rel.emptyHint')}
        className="rounded-xl border border-dashed"
        action={
          canManage && (
            <Button variant="outline" onClick={onAdd}>
              <PlusIcon /> {t('detail.addRelationship')}
            </Button>
          )
        }
      />
    );

  return (
    <div className="space-y-4">
      {canManage && (
        <div className="flex justify-end">
          <Button variant="outline" size="sm" onClick={onAdd}>
            <PlusIcon /> {t('detail.addRelationship')}
          </Button>
        </div>
      )}
      <div className="grid items-start gap-4 lg:grid-cols-2">
        {groups.map((g) => (
          <Card key={g.key} className="min-w-0 gap-2 py-4">
            <CardContent>
              <h3 className="flex items-center gap-2 text-sm font-semibold">
                {g.label}
                <span className="font-normal text-muted-foreground tabular-nums">{g.items.length}</span>
              </h3>
              {/* Added and removed relationships grow in and collapse out; the rest stay still. */}
              <AnimatedList className="divide-y" aria-label={g.label}>
                {g.items.map((rel) => (
                  <RelationRow key={rel.id} rel={rel} label={g.label} canManage={canManage} />
                ))}
              </AnimatedList>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
