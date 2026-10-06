import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';
import { ModulesView } from '@/components/modules/modules-view';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('modules'))('title') };
}

export default function ModulesPage() {
  return (
    <Suspense>
      <ModulesView />
    </Suspense>
  );
}
