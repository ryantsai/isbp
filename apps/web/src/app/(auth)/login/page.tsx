import type { AuthProviderPublic } from '@isbp/contracts';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { getSession, serverApi } from '@/lib/server-api';
import { LoginView } from './login-view';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth');
  return { title: t('title') };
}

function safeNext(next: string | undefined) {
  return next && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/api/') ? next : '/';
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const next = safeNext(params.next);
  if (await getSession()) redirect(next);
  const info = await serverApi<{
    providers: AuthProviderPublic[];
    productName: string;
    loginBanner: string | null;
  }>('/auth/providers');
  return (
    <LoginView
      providers={info.providers}
      productName={info.productName}
      banner={info.loginBanner}
      next={next}
      error={params.error ?? null}
      signedOut={params.signedOut === '1'}
    />
  );
}
