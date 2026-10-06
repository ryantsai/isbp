import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';
import { NotificationsView } from '@/components/notifications/notifications-view';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('notifications'))('title') };
}

export default function NotificationsPage() {
  return (
    <Suspense>
      <NotificationsView />
    </Suspense>
  );
}
