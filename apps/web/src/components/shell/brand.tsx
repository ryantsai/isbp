'use client';

import { cn } from '@isbp/ui';
import { AnimatePresence, motion } from 'motion/react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';

/** "IS" on TEL blue, closed by the green square of the TEL logo. */
export function BrandMark({ className = 'size-8' }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'relative grid shrink-0 place-items-center rounded-[5px] bg-primary text-[13px] font-bold tracking-tight text-primary-foreground',
        className,
      )}
    >
      <span className="-translate-x-[3px]">IS</span>
      <span className="absolute right-[14%] bottom-[29%] size-[15%] bg-brand-green" />
    </span>
  );
}

export function Brand({ collapsed = false }: { collapsed?: boolean }) {
  const t = useTranslations('common');
  return (
    <Link
      href="/"
      className={cn(
        'flex h-12 shrink-0 items-center gap-2.5 px-3.5 text-sidebar-accent-foreground outline-none focus-visible:ring-2 focus-visible:ring-sidebar-primary focus-visible:ring-inset',
        collapsed && 'justify-center px-0',
      )}
    >
      <BrandMark className="size-7" />
      <AnimatePresence initial={false}>
        {!collapsed && (
          <motion.span
            key="name"
            initial={{ opacity: 0, x: -6 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -6, transition: { duration: 0.1 } }}
            className="truncate text-sm font-semibold tracking-tight"
          >
            {t('appName')}
          </motion.span>
        )}
      </AnimatePresence>
    </Link>
  );
}
