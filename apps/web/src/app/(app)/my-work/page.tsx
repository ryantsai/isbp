import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { MyWorkView } from '@/components/my-work/my-work-view';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('work'))('title') };
}

export default function MyWorkPage() {
  return <MyWorkView />;
}
