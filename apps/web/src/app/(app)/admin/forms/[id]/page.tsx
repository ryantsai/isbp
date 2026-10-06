import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';
import { FormBuilderView } from '@/components/forms/form-builder';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('forms'))('builder.title') };
}

export default async function FormBuilderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense>
      <FormBuilderView id={id} />
    </Suspense>
  );
}
