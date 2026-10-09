import type { MyWork } from '@isbp/contracts';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { DashboardView } from '@/components/dashboard/dashboard-view';
import { serverApi } from '@/lib/server-api';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('dashboard'))('title') };
}

/** Home: what waits for the person is fetched on the server, so the greeting's summary is right on first paint. */
export default async function HomePage() {
  const work = await serverApi<MyWork>('/me/work?limit=5').catch(() => null);
  return <DashboardView initialWork={work} />;
}
