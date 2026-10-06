import { Button } from '@isbp/ui/button';
import { CompassIcon } from 'lucide-react';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

export default async function RootNotFound() {
  const t = await getTranslations('shell');
  return (
    <main className="grid min-h-dvh place-items-center p-6">
      <div className="flex max-w-sm flex-col items-center gap-3 text-center">
        <div className="grid size-12 place-items-center rounded-full bg-muted text-muted-foreground">
          <CompassIcon className="size-5" />
        </div>
        <h1 className="text-xl font-semibold">{t('notFoundTitle')}</h1>
        <p className="text-sm text-muted-foreground">{t('notFoundBody')}</p>
        <Button asChild variant="outline">
          <Link href="/">{t('goHome')}</Link>
        </Button>
      </div>
    </main>
  );
}
