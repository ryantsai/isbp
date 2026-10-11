'use client';

import { Badge } from '@astryxdesign/core/Badge';
import { ClickableCard } from '@astryxdesign/core/ClickableCard';
import { Divider } from '@astryxdesign/core/Divider';
import { Heading } from '@astryxdesign/core/Heading';
import { Icon } from '@astryxdesign/core/Icon';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { Text } from '@astryxdesign/core/Text';
import type { ModuleInfo } from '@isbp/contracts';
import { cn } from '@isbp/ui';
import { IconTile, type IconTileSize } from '@isbp/ui/icon-tile';
import { LockIcon, SlidersHorizontalIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { NavIcon } from '@/components/nav-icon';
import { ModuleSwitch } from './module-switch';
import { useManifestText } from './use-manifest-text';

export function ModuleIconTile({
  module: m,
  size = 'default',
}: {
  module: Pick<ModuleInfo, 'icon' | 'enabled'>;
  size?: IconTileSize;
}) {
  return (
    <IconTile aria-hidden size={size} className={cn(!m.enabled && 'text-muted-foreground')}>
      <NavIcon name={m.icon ?? undefined} />
    </IconTile>
  );
}

/** A module in the grid. The whole card opens details; the switch inside it handles its own clicks. */
export function ModuleCard({
  module: m,
  all,
  onOpen,
}: {
  module: ModuleInfo;
  all: ModuleInfo[];
  onOpen: () => void;
}) {
  const t = useTranslations('modules');
  const tc = useTranslations('common');
  const text = useManifestText();
  const name = text(m.name);
  return (
    <ClickableCard
      label={t('openDetails', { name })}
      onClick={onOpen}
      padding={4}
      variant={m.enabled ? 'default' : 'muted'}
      height="100%"
    >
      <VStack gap={3} className="h-full">
        <HStack gap={3} vAlign="start">
          <ModuleIconTile module={m} />
          <div className="min-w-0 flex-1">
            <VStack gap={1}>
              <Heading level={2} weight="medium" maxLines={1}>
                {name}
              </Heading>
              {(m.system || !m.enabled) && (
                <HStack gap={1.5} wrap="wrap">
                  {m.system && (
                    <Badge
                      variant="neutral"
                      label={tc('system')}
                      icon={<Icon icon={LockIcon} size="xsm" />}
                    />
                  )}
                  {!m.enabled && <Badge variant="neutral" label={tc('disabled')} />}
                </HStack>
              )}
            </VStack>
          </div>
          <ModuleSwitch module={m} all={all} />
        </HStack>
        <Text color="secondary" maxLines={2}>
          {m.description ? text(m.description) : t('noDescription')}
        </Text>
        {m.enabled && m.settings.length > 0 && (
          <div className="mt-auto">
            <VStack gap={3}>
              <Divider />
              <HStack gap={1.5} vAlign="center">
                <Icon icon={SlidersHorizontalIcon} size="sm" color="secondary" />
                <Text type="supporting">{t('hasSettings', { count: m.settings.length })}</Text>
              </HStack>
            </VStack>
          </div>
        )}
      </VStack>
    </ClickableCard>
  );
}
