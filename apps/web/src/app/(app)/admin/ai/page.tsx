import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';
import { AiAdminView } from '@/components/ai/ai-admin-view';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('ai'))('title') };
}

export default function AiAdminPage() {
  return (
    <Suspense>
      <AiAdminView />
    </Suspense>
  );
}
