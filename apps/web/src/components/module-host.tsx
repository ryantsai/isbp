'use client';

import { matchRoute, usePlatform, type WebPageProps } from '@isbp/sdk/web';
import { EmptyState } from '@isbp/ui/empty-state';
import { Skeleton } from '@isbp/ui/skeleton';
import { LockIcon } from 'lucide-react';
import { notFound } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type ComponentType, lazy, type LazyExoticComponent, Suspense } from 'react';
import { webModules } from '@/generated/modules';

/** One lazy component per module route, created once at import time (never during render). */
const pages = new Map<string, LazyExoticComponent<ComponentType<WebPageProps>>>(
  Object.entries(webModules).flatMap(([id, mod]) =>
    mod.routes.map((r) => [`${id}:${r.path}`, lazy(r.load)] as const),
  ),
);

function resolve(moduleId: string, path: string) {
  const mod = webModules[moduleId];
  for (const route of mod?.routes ?? []) {
    const params = matchRoute(route.path, path);
    if (params) return { route, params, Page: pages.get(`${moduleId}:${route.path}`)! };
  }
  return null;
}

function PageSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-4 w-96 max-w-full" />
      <Skeleton className="h-64 w-full rounded-xl" />
    </div>
  );
}

/** Resolves `/path` against the module's web routes and lazy-loads the matching page. */
export function ModuleHost({ moduleId, path }: { moduleId: string; path: string }) {
  const t = useTranslations('shell');
  const { permissions } = usePlatform();
  const match = resolve(moduleId, path);
  if (!match) notFound();
  const { route, params, Page } = match;

  if (route.permission && !permissions.hasAny(route.permission)) {
    return <EmptyState icon={<LockIcon />} title={t('forbidden')} />;
  }

  return (
    <Suspense fallback={<PageSkeleton />}>
      <Page params={params} />
    </Suspense>
  );
}
