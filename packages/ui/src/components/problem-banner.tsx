'use client';

import { Banner } from '@astryxdesign/core/Banner';
import { Collapsible } from '@astryxdesign/core/Collapsible';
import { HStack } from '@astryxdesign/core/Layout';
import { Text } from '@astryxdesign/core/Text';
import { useTranslations } from 'next-intl';
import type * as React from 'react';

/** Our tones on Astryx `Banner` statuses. */
const bannerStatus = { destructive: 'error', warning: 'warning', info: 'info' } as const;

/**
 * A failure explained in plain words with one next step: a headline in the reader's language ("The connection to
 * HR database was refused"), what to do (`action`: open the connection, test, retry), and the raw error text
 * behind "Technical details". `live` announces it (for failures that happen while the person watches).
 */
export function ProblemBanner({
  title,
  description,
  action,
  details,
  tone = 'destructive',
  live,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  /** Raw technical text (driver error, stack…), shown collapsed and monospaced. */
  details?: string | null;
  tone?: keyof typeof bannerStatus;
  live?: boolean;
  className?: string;
}) {
  const t = useTranslations('ui.problem');
  return (
    <Banner
      status={bannerStatus[tone]}
      title={title}
      description={description}
      endContent={
        action ? (
          <HStack gap={2} wrap="wrap" vAlign="center">
            {action}
          </HStack>
        ) : undefined
      }
      collapsible={false}
      // Astryx announces error and warning banners on its own; here only a failure that happens while the person watches does.
      role={live ? 'alert' : undefined}
      className={className}
    >
      {details ? (
        <Collapsible trigger={<Text type="supporting">{t('technicalDetails')}</Text>} defaultIsOpen={false}>
          <Text as="div" type="code" className="max-h-60 overflow-auto p-2 break-all whitespace-pre-wrap">
            {details}
          </Text>
        </Collapsible>
      ) : undefined}
    </Banner>
  );
}
