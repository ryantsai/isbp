import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { AdminHub } from '@/components/admin-hub/admin-hub';
import type { Dashboard } from '@isbp/contracts';
import { getNavigation, serverApi } from '@/lib/server-api';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('admin'))('title') };
}

/** Administration: the hub of every configuration page the person may open (the sidebar has one row for it). */
export default async function AdministrationPage() {
  const nav = await getNavigation();
  // The platform figures render with the page (no jump when they arrive); they refresh in the browser.
  const stats = nav.admin.length ? await serverApi<Dashboard>('/platform/dashboard').catch(() => null) : null;
  return <AdminHub entries={nav.admin} initialStats={stats} />;
}
