import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { RoleDetailView } from '@/components/roles/role-detail-view';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('roles'))('title') };
}

export default async function RoleDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <RoleDetailView id={id} />;
}
