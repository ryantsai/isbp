import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { GroupDetailView } from '@/components/groups/group-detail-view';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('groups'))('title') };
}

export default async function GroupDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <GroupDetailView id={id} />;
}
