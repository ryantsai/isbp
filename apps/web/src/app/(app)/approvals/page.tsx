import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';
import { ApprovalsView } from '@/components/approvals/approvals-view';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('approvals'))('title') };
}

export default function ApprovalsPage() {
  return (
    <Suspense>
      <ApprovalsView />
    </Suspense>
  );
}
