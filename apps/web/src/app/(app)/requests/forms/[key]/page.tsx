import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { FormFillView } from '@/components/requests/form-fill-view';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('requests'))('form.title') };
}

export default async function FormPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  return <FormFillView formKey={key} />;
}
