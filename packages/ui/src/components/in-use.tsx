'use client';

import { Banner } from '@astryxdesign/core/Banner';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { Link } from '@astryxdesign/core/Link';
import { Text } from '@astryxdesign/core/Text';
import { localize } from '@isbp/sdk';
import { ApiError } from '@isbp/sdk/web';
import { useLocale, useTranslations } from 'next-intl';

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
    <Banner status="warning" title={t('title')} collapsible={false} className={className}>
      <VStack gap={1.5}>
        <VStack as="ul" gap={1.5}>
          {found.items.map((r, i) => {
            const label = localize(r.label, locale);
            return (
              <HStack as="li" key={`${r.href ?? ''}${i}`} gap={2} vAlign="center" className="min-w-0">
                <Text type="supporting" className="shrink-0">
                  {t(`kind.${r.kind}`)}
                </Text>
                {r.href ? (
                  <Link href={r.href} weight="medium" maxLines={1} className="min-w-0">
                    {label}
                  </Link>
                ) : (
                  <Text maxLines={1} className="min-w-0">
                    {label}
                  </Text>
                )}
              </HStack>
            );
          })}
        </VStack>
        {found.more && <Text type="supporting">{t('more')}</Text>}
      </VStack>
    </Banner>
  );
}
