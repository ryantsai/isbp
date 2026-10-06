import type { Metadata } from 'next';
import { RequestDetailView } from '@/components/requests/request-detail-view';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ reference: string }>;
}): Promise<Metadata> {
  return { title: (await params).reference };
}

export default async function RequestPage({ params }: { params: Promise<{ reference: string }> }) {
  const { reference } = await params;
  return <RequestDetailView reference={reference} />;
}
