import type { Dashboard } from '@isbp/contracts';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { DashboardView } from '@/components/dashboard/dashboard-view';
import { serverApi } from '@/lib/server-api';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('dashboard'))('title') };
}

export default async function DashboardPage() {
  const data = await serverApi<Dashboard>('/platform/dashboard');
  return <DashboardView initial={data} />;
}
