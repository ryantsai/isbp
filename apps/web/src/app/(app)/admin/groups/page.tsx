import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';
import { GroupsView } from '@/components/groups/groups-view';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('groups'))('title') };
}

export default function GroupsPage() {
  return (
    <Suspense>
      <GroupsView />
    </Suspense>
  );
}
