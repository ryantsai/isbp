import type { Metadata } from 'next';
import { getLocale } from 'next-intl/server';
import { getTourContent } from '@/components/tour/content';
import { TourPage } from '@/components/tour/tour-page';

export async function generateMetadata(): Promise<Metadata> {
  const { meta } = getTourContent(await getLocale());
  return { title: meta.title, description: meta.description, robots: { index: false } };
}

export default function Page() {
  return <TourPage />;
}
