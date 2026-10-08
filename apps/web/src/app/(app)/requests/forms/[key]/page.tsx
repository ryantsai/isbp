import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { FormFillView } from '@/components/requests/form-fill-view';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('requests'))('form.title') };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function FormPage({
  params,
  searchParams,
}: {
  params: Promise<{ key: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { key } = await params;
  // `?assignment=<id>`: the to-do this form is filled in for (sending it completes the to-do).
  const { assignment } = await searchParams;
  const assignmentId = typeof assignment === 'string' && UUID.test(assignment) ? assignment : undefined;
  return <FormFillView key={assignmentId ?? key} formKey={key} assignmentId={assignmentId} />;
}
