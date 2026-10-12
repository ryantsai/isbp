import { PublicModuleHost } from '@/components/public-module-host';

export const dynamic = 'force-dynamic';

/**
 * Modules' public pages: `/p/<moduleId>/<path…>`, without sign-in and without the app shell (a published chat
 * opened as a link or framed by an allowed website). The client host resolves the module's `publicRoutes` (404
 * otherwise); the module's API decides what the page may show, and a disabled module's API answers 404.
 */
export default async function PublicModulePage({
  params,
}: {
  params: Promise<{ module: string; slug?: string[] }>;
}) {
  const { module, slug } = await params;
  return (
    <div className="min-h-dvh bg-background text-foreground">
      <PublicModuleHost moduleId={module} path={`/${(slug ?? []).map(encodeURIComponent).join('/')}`} />
    </div>
  );
}
