import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { RequestPrintView } from '@/components/requests/request-print-view';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ reference: string }>;
}): Promise<Metadata> {
  const t = await getTranslations('requests.print');
  return { title: t('pageTitle', { reference: (await params).reference }) };
}

/** A request laid out for printing (or saving as PDF): answers, decisions, actions and attachments. */
export default async function RequestPrintPage({ params }: { params: Promise<{ reference: string }> }) {
  const { reference } = await params;
  return <RequestPrintView reference={reference} />;
}
