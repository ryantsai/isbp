import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';
import { NotificationsAdminView } from '@/components/notifications/admin-view';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('notifications'))('admin.title') };
}

export default function NotificationsAdminPage() {
  return (
    <Suspense>
      <NotificationsAdminView />
    </Suspense>
  );
}
