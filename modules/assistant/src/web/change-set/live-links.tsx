'use client';

import { cn } from '@isbp/ui';
import { ArrowUpRightIcon } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import type { ObjectSnapshot } from '../../contracts';
import { type AppliedLink, appliedLinks, linkText } from '../../lib/links';

type LinkedItem = { id: string; label: string; after: ObjectSnapshot | null };

/** The links of what an applied change set made (a form's own page), or none while it isn't applied. */
export function liveLinksOf(status: string, items: readonly LinkedItem[] | undefined): AppliedLink[] {
  return status === 'applied' && items ? appliedLinks(items) : [];
}

/**
 * "Open the form" links for people who use what a change set made, each named with its object ("Open the form:
 * Laptop request") so several forms read as different links. The name is an `aria-label` that starts with the visible
 * text: a visually hidden suffix would be a separate box, and accessible names put a space before its colon.
 */
export function LiveLinks({
  links,
  showObject = true,
  className,
}: {
  links: readonly AppliedLink[];
  /** Show the object's name beside each link (a list of several), not only to screen readers. */
  showObject?: boolean;
  className?: string;
}) {
  const locale = useLocale();
  const t = useTranslations('assistant.detail.live');
  if (!links.length) return null;
  return (
    <ul className={cn('flex min-w-0 flex-wrap gap-x-4 gap-y-1', className)}>
      {links.map((l) => (
        <li key={l.href} className="min-w-0 break-words">
          <Link
            href={l.href}
            aria-label={t('link', { label: linkText(l.label, locale), object: l.object })}
            className="inline-flex items-center gap-0.5 rounded-sm font-medium text-primary outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            {linkText(l.label, locale)}
            <ArrowUpRightIcon className="size-3.5 shrink-0" aria-hidden />
          </Link>
          {showObject && (
            <span aria-hidden className="text-muted-foreground">
              {' '}
              · {l.object}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
