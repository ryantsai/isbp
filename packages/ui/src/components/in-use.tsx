'use client';

import { localize } from '@isbp/sdk';
import { ApiError } from '@isbp/sdk/web';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { cn } from '../lib/utils';

export type InUseKind = 'request' | 'approval' | 'todo' | 'work' | 'setting';

export interface InUseReference {
  kind: InUseKind;
  label: string | Record<string, string>;
  href?: string | null;
}

/** What still uses the thing an `IN_USE` refusal was about (`details.references`), or null when it doesn't say. */
export function inUseReferences(err: unknown): { items: InUseReference[]; more: boolean } | null {
  if (!(err instanceof ApiError) || err.code !== 'IN_USE') return null;
  const details = err.details as { references?: InUseReference[]; more?: boolean } | undefined;
  return details?.references?.length ? { items: details.references, more: !!details.more } : null;
}

/**
 * "Still used by" with a link to each item, for a dialog whose delete was refused because open requests, approvals,
 * to-dos or settings still use the thing. Renders nothing for other errors.
 */
export function InUseList({ error, className }: { error: unknown; className?: string }) {
  const t = useTranslations('ui.inUse');
  const locale = useLocale();
  const found = inUseReferences(error);
  if (!found) return null;
  return (
    <div role="alert" className={cn('grid gap-2 rounded-lg border bg-muted/40 p-3 text-sm', className)}>
      <p className="font-medium">{t('title')}</p>
      <ul className="grid gap-1.5">
        {found.items.map((r, i) => {
          const label = localize(r.label, locale);
          return (
            <li key={`${r.href ?? ''}${i}`} className="flex min-w-0 items-baseline gap-2">
              <span className="shrink-0 text-xs text-muted-foreground">{t(`kind.${r.kind}`)}</span>
              {r.href ? (
                <Link
                  href={r.href}
                  className="min-w-0 truncate rounded-sm font-medium underline-offset-4 outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                  {label}
                </Link>
              ) : (
                <span className="min-w-0 truncate">{label}</span>
              )}
            </li>
          );
        })}
      </ul>
      {found.more && <p className="text-xs text-muted-foreground">{t('more')}</p>}
    </div>
  );
}
