import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { WorkflowBuilder } from '@/components/workflows/workflow-builder';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('workflows'))('builder.title') };
}

export default async function WorkflowPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <WorkflowBuilder id={id} />;
}
