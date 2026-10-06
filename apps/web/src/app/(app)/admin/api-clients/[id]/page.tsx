import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { ApiClientDetailView } from '@/components/api-clients/api-client-detail-view';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('applications.clients'))('title') };
}

export default async function ApiClientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ApiClientDetailView id={id} />;
}
