import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';
import { DepartmentsView } from '@/components/departments/departments-view';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('departments'))('title') };
}

export default function DepartmentsPage() {
  return (
    <Suspense>
      <DepartmentsView />
    </Suspense>
  );
}
