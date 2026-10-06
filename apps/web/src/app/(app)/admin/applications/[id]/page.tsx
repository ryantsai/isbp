import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';
import { ApplicationDetailView } from '@/components/applications/application-detail-view';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('applications'))('title') };
}

export default async function ApplicationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense>
      <ApplicationDetailView id={id} />
    </Suspense>
  );
}
