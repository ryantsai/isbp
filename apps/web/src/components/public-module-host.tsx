'use client';

import { matchRoute, type WebPageProps } from '@isbp/sdk/web';
import { notFound } from 'next/navigation';
import { type ComponentType, lazy, type LazyExoticComponent, Suspense, useEffect } from 'react';
import { webModules } from '@/generated/modules';

/** One lazy component per public route, created once at import time (never during render). */
const pages = new Map<string, LazyExoticComponent<ComponentType<WebPageProps>>>(
  Object.entries(webModules).flatMap(([id, mod]) =>
    mod.publicRoutes.map((r) => [`${id}:${r.path}`, lazy(r.load)] as const),
  ),
);

/** Sets `<html data-module-page="ready">` once the page has mounted, like `ModuleHost`, for end-to-end tests. */
function PageReady() {
  useEffect(() => {
    document.documentElement.dataset.modulePage = 'ready';
  }, []);
  return null;
}

/**
 * A module's public page (`/p/<module>/<path>`): no sign-in and no platform context. The page talks to its
 * module's public API routes itself.
 */
export function PublicModuleHost({ moduleId, path }: { moduleId: string; path: string }) {
  const match = resolve(moduleId, path);
  if (!match) notFound();
  const { params, Page } = match;
  return (
    <Suspense fallback={null}>
      <Page params={params} />
      <PageReady />
    </Suspense>
  );
}

function resolve(moduleId: string, path: string) {
  for (const route of webModules[moduleId]?.publicRoutes ?? []) {
    const params = matchRoute(route.path, path);
    if (params) return { params, Page: pages.get(`${moduleId}:${route.path}`)! };
  }
  return null;
}
