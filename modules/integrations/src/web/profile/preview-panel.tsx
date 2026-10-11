'use client';

import { Badge } from '@astryxdesign/core/Badge';
import { Divider } from '@astryxdesign/core/Divider';
import { Icon } from '@astryxdesign/core/Icon';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { Text } from '@astryxdesign/core/Text';
import { ArrowRightIcon, CircleAlertIcon, EyeIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type Preview, type PreviewAction } from '../../contracts';
import { DIRECTION_ICON } from '../badges';
import { showValue } from '../lib';

const ACTION_VARIANT: Record<PreviewAction, 'info' | 'success' | 'warning' | 'neutral' | 'error'> = {
  create: 'success',
  link: 'info',
  update: 'info',
  push: 'info',
  remoteCreate: 'success',
  conflict: 'warning',
  skip: 'neutral',
  orphan: 'neutral',
};

/** The dry run: per record what would happen, and per field the value before → after. */
export function PreviewPanel({ preview, system }: { preview: Preview; system: string }) {
  const t = useTranslations('integrations.preview');
  const tn = useTranslations('integrations.preview.notes');
  if (!preview.items.length)
    return (
      <HStack gap={2} vAlign="center">
        <Icon icon={EyeIcon} color="secondary" />
        <Text color="secondary">
          {preview.source === 'remote' ? t('nothingRemote', { system }) : t('nothingLocal')}
        </Text>
      </HStack>
    );
  return (
    <VStack gap={3} className="min-w-0">
      <Text color="secondary" as="p" display="block">
        {preview.source === 'remote'
          ? t('fromRemote', { count: preview.items.length, system })
          : t('fromLocal', { count: preview.items.length })}
        {preview.hasMore && ` ${t('more')}`}
      </Text>
      <VStack as="ul" gap={3} className="min-w-0">
        {preview.items.map((item, i) => (
          <li key={item.remoteId ?? item.localId ?? i} className="min-w-0">
            <VStack gap={2} className="min-w-0">
              {i > 0 && <Divider />}
              <HStack gap={2} wrap="wrap" vAlign="center">
                {item.remoteRef && (
                  <Text type="code" color="secondary">
                    {item.remoteRef}
                  </Text>
                )}
                <Text weight="medium" maxLines={1}>
                  {item.title}
                </Text>
                {item.localTitle && (
                  <HStack gap={1} vAlign="center" className="min-w-0">
                    <Icon icon={ArrowRightIcon} color="secondary" />
                    <Text type="supporting" maxLines={1}>
                      {item.localTitle}
                    </Text>
                  </HStack>
                )}
                <HStack gap={1} wrap="wrap" className="sm:ml-auto">
                  {item.actions.map((a) => (
                    <Badge key={a} variant={ACTION_VARIANT[a]} label={t(`actions.${a}`, { system })} />
                  ))}
                </HStack>
              </HStack>
              {item.error && (
                <HStack gap={1.5} vAlign="start">
                  <Icon icon={CircleAlertIcon} color="error" />
                  <Text type="supporting">{item.error.message}</Text>
                </HStack>
              )}
              {item.notes.length > 0 && (
                <Text type="supporting">
                  {item.notes
                    .map((n) => {
                      const key = n.startsWith('unmappable:') ? 'unmappable' : n;
                      return tn.has(key) ? tn(key, { field: n.split(':')[1] ?? '' }) : n;
                    })
                    .join(' · ')}
                </Text>
              )}
              {item.changes.length > 0 && (
                <VStack as="dl" gap={1} className="min-w-0">
                  {item.changes.map((c) => (
                    <div
                      key={c.field}
                      className="grid min-w-0 grid-cols-[auto_minmax(0,8rem)_minmax(0,1fr)] items-start gap-2"
                    >
                      <Icon
                        icon={
                          DIRECTION_ICON[
                            c.direction === 'push' ? 'push' : c.direction === 'pull' ? 'pull' : 'both'
                          ]
                        }
                        color={c.direction === 'conflict' ? 'warning' : 'accent'}
                      />
                      <dt className="min-w-0">
                        <span className="sr-only">{t(`direction.${c.direction}`, { system })} </span>
                        <Text type="code" maxLines={1}>
                          {c.field}
                        </Text>
                      </dt>
                      <dd className="min-w-0 wrap-anywhere">
                        <Text type="supporting" hasStrikethrough>
                          {showValue(c.before) || t('empty')}
                        </Text>{' '}
                        <Icon icon={ArrowRightIcon} color="secondary" size="xsm" />
                        <span className="sr-only"> {t('becomes')} </span>{' '}
                        <Text type="supporting" color="primary">
                          {showValue(c.after) || t('empty')}
                        </Text>
                      </dd>
                    </div>
                  ))}
                </VStack>
              )}
            </VStack>
          </li>
        ))}
      </VStack>
    </VStack>
  );
}
