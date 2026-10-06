import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { IdpView } from '@/components/idp/idp-view';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('idp'))('title') };
}

export default function IdentityProvidersPage() {
  return <IdpView />;
}
