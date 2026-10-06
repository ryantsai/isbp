import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ModuleHost } from '@/components/module-host';
import { getSession } from '@/lib/server-api';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ module: string }>;
}): Promise<Metadata> {
  const { module } = await params;
  const t = await getTranslations();
  const key = `${module}.meta.name`;
  return { title: t.has(key) ? t(key) : module };
}

/**
 * Every module page is served through this one route: `/<moduleId>/<path…>`. Static core routes
 * (`/admin/*`, `/settings`) take precedence. Disabled or unknown modules 404 here; the client host
 * then resolves the path against the module's declared web routes.
 */
export default async function ModulePage({
  params,
}: {
  params: Promise<{ module: string; slug?: string[] }>;
}) {
  const { module, slug } = await params;
  const session = await getSession();
  if (!session?.enabledModules.includes(module) || module === 'core') notFound();
  return <ModuleHost moduleId={module} path={`/${(slug ?? []).map(encodeURIComponent).join('/')}`} />;
}
