'use client';

import { Heading } from '@astryxdesign/core/Heading';
import { Icon } from '@astryxdesign/core/Icon';
import { VStack } from '@astryxdesign/core/Layout';
import { Text } from '@astryxdesign/core/Text';
import { IconTile, type IconTileSize, type IconTileVariant } from '@isbp/ui/icon-tile';
import type { ReactNode } from 'react';
import type { TourIcon } from './content';
import { tourIcons } from './icons';
import { Reveal } from './motion';
import { Rich } from './rich';

/** A tinted square with one of the tour's icons (decorative: the text next to it says what it means). */
export function TileIcon({
  name,
  size = 'default',
  variant,
  className,
}: {
  name: TourIcon;
  size?: IconTileSize;
  variant?: IconTileVariant;
  className?: string;
}) {
  const Glyph = tourIcons[name];
  return (
    <IconTile size={size} variant={variant} className={className} aria-hidden>
      <Glyph />
    </IconTile>
  );
}

/** A bare icon from the tour's set. */
export function NamedIcon({
  name,
  size,
  color,
}: {
  name: TourIcon;
  size?: 'xsm' | 'sm' | 'md' | 'lg';
  color?: 'primary' | 'secondary' | 'accent' | 'success' | 'inherit';
}) {
  return <Icon icon={tourIcons[name]} size={size} color={color} />;
}

/** The opening of a section: heading, one lead paragraph, and an optional extra row. */
export function SectionHead({
  id,
  title,
  lead,
  children,
}: {
  id?: string;
  title: string;
  lead?: string;
  children?: ReactNode;
}) {
  return (
    <Reveal className="tour-head">
      <VStack gap={3}>
        <Heading level={2} type="display-2" id={id} textWrap="balance">
          {title}
        </Heading>
        {lead && (
          <Text type="large" color="secondary" as="p" textWrap="pretty">
            <Rich text={lead} />
          </Text>
        )}
        {children}
      </VStack>
    </Reveal>
  );
}

/** The heading of a block inside a section. */
export function BlockHead({ title, lead }: { title: string; lead?: string }) {
  return (
    <Reveal className="tour-block-head">
      <VStack gap={2}>
        <Heading level={3} type="display-3" textWrap="balance">
          {title}
        </Heading>
        {lead && (
          <Text color="secondary" as="p" textWrap="pretty">
            <Rich text={lead} />
          </Text>
        )}
      </VStack>
    </Reveal>
  );
}
