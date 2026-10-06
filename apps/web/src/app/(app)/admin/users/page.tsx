import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';
import { UsersView } from '@/components/users/users-view';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('users'))('title') };
}

export default function UsersPage() {
  return (
    <Suspense>
      <UsersView />
    </Suspense>
  );
}
