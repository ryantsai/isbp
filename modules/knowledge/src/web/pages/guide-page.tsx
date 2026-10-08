'use client';

import type { WebPageProps } from '@isbp/sdk/web';
import { Button } from '@isbp/ui/button';
import { EmptyState } from '@isbp/ui/empty-state';
import { useApiQuery } from '@isbp/ui/query';
import { Skeleton } from '@isbp/ui/skeleton';
import { LifeBuoyIcon } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect } from 'react';

/**
 * `/knowledge/guide/<slug>`: the in-app help links here (`guideHref` in `@isbp/guide`). Opens the guide's article in
 * the reader's language, keeping the `#section` of the link.
 */
export default function GuidePage({ params }: WebPageProps) {
  const t = useTranslations('knowledge');
  const locale = useLocale();
  const router = useRouter();
  const { data, error } = useApiQuery<{ reference: string; href: string }>(
    `/knowledge/guide/${encodeURIComponent(params.slug ?? '')}?locale=${encodeURIComponent(locale)}`,
  );

  useEffect(() => {
    if (data) router.replace(`${data.href}${window.location.hash}`);
  }, [data, router]);

  if (error)
    return (
      <EmptyState
        icon={<LifeBuoyIcon />}
        title={t('guide.notFound')}
        description={t('guide.notFoundHint')}
        action={
          <Button variant="outline" asChild>
            <Link href="/knowledge">{t('article.backHome')}</Link>
          </Button>
        }
      />
    );
  return (
    <div className="mx-auto grid max-w-6xl gap-4" aria-busy="true">
      <span className="sr-only" role="status">
        {t('guide.opening')}
      </span>
      <Skeleton className="h-6 w-32" />
      <Skeleton className="h-10 w-2/3" />
      <Skeleton className="h-96 rounded-xl" />
    </div>
  );
}
