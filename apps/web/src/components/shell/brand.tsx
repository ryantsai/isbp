'use client';

import { AnimatePresence, motion } from 'motion/react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';

export function BrandMark({ className = 'size-8' }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={`relative grid shrink-0 place-items-center overflow-hidden rounded-lg bg-gradient-to-br from-indigo-500 via-indigo-600 to-violet-600 text-[13px] font-bold tracking-tight text-white shadow-sm shadow-indigo-500/30 ${className}`}
    >
      <span className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,0.35),transparent_55%)]" />
      <span className="relative">IS</span>
    </span>
  );
}

export function Brand({ collapsed = false }: { collapsed?: boolean }) {
  const t = useTranslations('common');
  return (
    <Link
      href="/"
      className="flex h-14 items-center gap-2.5 px-4 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      <BrandMark />
      <AnimatePresence initial={false}>
        {!collapsed && (
          <motion.span
            key="name"
            initial={{ opacity: 0, x: -6 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -6, transition: { duration: 0.1 } }}
            className="truncate text-[15px] font-semibold tracking-tight"
          >
            {t('appName')}
          </motion.span>
        )}
      </AnimatePresence>
    </Link>
  );
}
