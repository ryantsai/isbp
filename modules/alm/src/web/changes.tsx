'use client';

import { Icon } from '@astryxdesign/core/Icon';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { Link } from '@astryxdesign/core/Link';
import { Text } from '@astryxdesign/core/Text';
import { CalendarClockIcon } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import type { ChangeInfo } from '../contracts';
import { ChangeStatusChip } from './badges';

/** "Oct 12, 19:00 – 21:00" — a change's planned window. */
export function useWindowText() {
  const format = useFormatter();
  return (c: Pick<ChangeInfo, 'plannedStart' | 'plannedEnd'>) =>
    c.plannedStart && c.plannedEnd
      ? format.dateTimeRange(new Date(c.plannedStart), new Date(c.plannedEnd), {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        })
      : null;
}

/** One ITSM change: reference (linked to ITSM), title, status chip and planned window. */
export function ChangeLine({ change }: { change: ChangeInfo }) {
  const t = useTranslations('alm.changes');
  const windowText = useWindowText();
  const w = windowText(change);
  return (
    <VStack gap={1}>
      <HStack gap={2} wrap="wrap" vAlign="center">
        <Link href={change.href} weight="medium">
          <Text type="code">{change.reference}</Text>
        </Link>
        <ChangeStatusChip status={change.status} />
      </HStack>
      <Text maxLines={1}>{change.title}</Text>
      <HStack gap={1} vAlign="center">
        <Icon icon={CalendarClockIcon} size="xsm" color="secondary" />
        <Text type="supporting">
          {w ? (
            <>
              {w}
              {change.authorized && (
                <Text weight="medium">{` · ${change.inWindow ? t('inWindow') : t('outsideWindow')}`}</Text>
              )}
            </>
          ) : (
            t('noWindow')
          )}
        </Text>
      </HStack>
    </VStack>
  );
}
