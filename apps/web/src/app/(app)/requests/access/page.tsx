import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';
import { RequestAccessView } from '@/components/requests/request-access-view';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('requests'))('access.title') };
}

export default function RequestAccessPage() {
  return (
    <Suspense>
      <RequestAccessView />
    </Suspense>
  );
}
