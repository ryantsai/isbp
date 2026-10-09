import { LoaderCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '../lib/utils';

export function Spinner({ className, label }: { className?: string; label?: string }) {
  const t = useTranslations('ui');
  return (
    <LoaderCircle
      role="status"
      aria-label={label ?? t('loading')}
      className={cn('size-4 animate-spin motion-reduce:animate-[spin_2s_linear_infinite]', className)}
    />
  );
}
