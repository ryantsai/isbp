import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';
import { ApiClientsView } from '@/components/api-clients/api-clients-view';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('applications.clients'))('title') };
}

export default function ApiClientsPage() {
  return (
    <Suspense>
      <ApiClientsView />
    </Suspense>
  );
}
