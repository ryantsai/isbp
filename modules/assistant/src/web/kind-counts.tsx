'use client';

import { useTranslations } from 'next-intl';

/**
 * "21 processes · 5 groups · 3 ticket categories · 8 scheduled jobs": what a change set or a package adds up to.
 * Kinds with their own plural in the catalog (`assistant.counts.kinds.<module>_<kind>`) read naturally; others as
 * "Notification channel: 2".
 */
export function KindCounts({
  processes,
  kinds,
  kindLabel,
  overrides = {},
  className,
}: {
  processes: number;
  kinds: readonly { kind: string; count: number }[];
  kindLabel: (kind: string) => string;
  /** Another wording for a kind's count ("5 groups you fill in after installing"). */
  overrides?: Record<string, (count: number) => string>;
  className?: string;
}) {
  const t = useTranslations('assistant.counts');
  const parts = [
    ...(processes > 0 ? [t('processes', { count: processes })] : []),
    ...kinds.map(({ kind, count }) => {
      const custom = overrides[kind];
      if (custom) return custom(count);
      const key = `kinds.${kind.replace('.', '_')}`;
      return t.has(key) ? t(key, { count }) : t('other', { kind: kindLabel(kind), count });
    }),
  ];
  if (!parts.length) return null;
  return <p className={className}>{parts.join(' · ')}</p>;
}
