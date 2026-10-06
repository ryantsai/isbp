import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';
import { RequestsHome } from '@/components/requests/requests-home';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('requests'))('home.title') };
}

export default function RequestsPage() {
  return (
    <Suspense>
      <RequestsHome />
    </Suspense>
  );
}
