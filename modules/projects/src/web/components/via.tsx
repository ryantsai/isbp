'use client';

import { safeUrl } from '@isbp/ui/markdown';
import { useTranslations } from 'next-intl';
import type { Via as ViaData } from '../../contracts';

/** "via Azure DevOps Bug 812": a change a sync with another system made, linking to its record there. */
export function Via({ via }: { via: ViaData }) {
  const t = useTranslations('projects.sync');
  const text = t('via', { system: via.connection, reference: via.ref });
  const url = via.url ? safeUrl(via.url) : '';
  return url ? (
    <a
      href={url}
      target="_blank"
      rel="noreferrer noopener"
      className="underline underline-offset-4 hover:text-foreground focus-visible:text-foreground focus-visible:outline-none"
    >
      {text}
    </a>
  ) : (
    <span>{text}</span>
  );
}
