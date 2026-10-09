'use client';

import type { ModuleInfo } from '@isbp/contracts';
import { Badge } from '@isbp/ui/badge';
import { Card, CardContent } from '@isbp/ui/card';
import { EmptyState } from '@isbp/ui/empty-state';
import { Stagger, StaggerItem } from '@isbp/ui/motion';
import { PageHeader } from '@isbp/ui/page-header';
import { Skeleton } from '@isbp/ui/skeleton';
import { BlocksIcon } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { useApiQuery } from '@/lib/api';
import { ModuleCard } from './module-card';
import { ModuleSheet } from './module-sheet';

function CardSkeleton() {
  return (
    <Card className="gap-0 py-4">
      <CardContent className="space-y-4 px-4">
        <div className="flex items-start gap-3">
          <Skeleton className="size-10 rounded-lg" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-16" />
          </div>
          <Skeleton className="h-[1.15rem] w-8 rounded-full" />
        </div>
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-9 w-full" />
      </CardContent>
    </Card>
  );
}

export function ModulesView() {
  const t = useTranslations('modules');
  const router = useRouter();
  const sp = useSearchParams();
  const { data, isLoading } = useApiQuery<{ items: ModuleInfo[] }>('/modules');
  const items = data?.items ?? [];
  const enabled = items.filter((m) => m.enabled).length;

  // `?module=<id>` deep-links the details sheet; keep the last module rendered while it slides out.
  const selectedId = sp.get('module');
  const selected = items.find((m) => m.id === selectedId) ?? null;
  const [shown, setShown] = useState<ModuleInfo | null>(null);
  useEffect(() => {
    if (selected) setShown(selected);
  }, [selected]);

  const select = (id: string | null) => {
    const next = new URLSearchParams(sp.toString());
    if (id) next.set('module', id);
    else next.delete('module');
    router.replace(`/admin/modules${next.size ? `?${next}` : ''}`, { scroll: false });
  };

  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={
          !isLoading &&
          items.length > 0 && (
            <Badge variant="secondary" className="px-2.5 py-1 text-sm font-normal">
              {t('summary', { enabled, total: items.length })}
            </Badge>
          )
        }
      />
      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-busy>
          {Array.from({ length: 3 }, (_, i) => (
            <CardSkeleton key={i} />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState icon={<BlocksIcon />} title={t('empty')} />
      ) : (
        <Stagger className="grid auto-rows-fr grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((m) => (
            <StaggerItem key={m.id} className="h-full min-w-0">
              <ModuleCard module={m} all={items} onOpen={() => select(m.id)} />
            </StaggerItem>
          ))}
        </Stagger>
      )}
      <ModuleSheet
        module={selected ?? shown}
        all={items}
        open={Boolean(selected)}
        onOpenChange={(o) => !o && select(null)}
        onNavigate={select}
      />
    </>
  );
}
