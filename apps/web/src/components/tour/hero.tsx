'use client';

import { Badge } from '@astryxdesign/core/Badge';
import { Button } from '@astryxdesign/core/Button';
import { Heading } from '@astryxdesign/core/Heading';
import { Icon } from '@astryxdesign/core/Icon';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { Text } from '@astryxdesign/core/Text';
import { Theme } from '@astryxdesign/core/theme';
import { guideHref } from '@isbp/guide/meta';
import { telTheme } from '@isbp/ui/theme/tel';
import { ArrowDownIcon, BookOpenIcon, HouseIcon } from 'lucide-react';
import { BrandMark } from '@/components/shell/brand';
import type { TourContent } from './content';
import { ShotImage } from './shot';

/**
 * The first screen: the promise, three real screens layered and drifting, and the two ways on. Navy like the product's
 * navigation rail, so it takes the dark theme's text and focus colours whatever the viewer's theme is.
 */
export function Hero({
  content,
  locale,
  canHelp,
}: {
  content: TourContent;
  locale: string;
  canHelp: boolean;
}) {
  const { hero } = content;
  return (
    <section id="top" className="tour-hero" aria-labelledby="tour-title">
      <div className="tour-hero-bg" aria-hidden />
      <Theme theme={telTheme} mode="dark">
        <div className="tour-wrap tour-hero-inner">
          <VStack gap={5} className="tour-hero-copy">
            <HStack gap={3} vAlign="center">
              <BrandMark className="size-9" />
              <Badge variant="info" label={hero.kicker} />
            </HStack>
            <Heading level={1} type="display-1" id="tour-title" textWrap="balance">
              {hero.title}
            </Heading>
            <Text type="large" as="p" textWrap="pretty">
              {hero.lead}
            </Text>
            <HStack gap={3} wrap="wrap">
              <Button
                variant="primary"
                size="lg"
                label={hero.start}
                href="#overview"
                endContent={<Icon icon={ArrowDownIcon} />}
              />
              <Button
                variant="secondary"
                size="lg"
                label={hero.openProduct}
                href="/"
                icon={<Icon icon={HouseIcon} />}
              />
              {canHelp && (
                <Button
                  variant="ghost"
                  size="lg"
                  label={hero.openGuide}
                  href={guideHref('start-here')}
                  icon={<Icon icon={BookOpenIcon} />}
                />
              )}
            </HStack>
            <HStack gap={2} wrap="wrap">
              {hero.chips.map((c) => (
                <Badge key={c} variant="neutral" label={c} />
              ))}
            </HStack>
            <Text type="supporting" color="secondary" as="p">
              {hero.note}
            </Text>
          </VStack>
          <div className="tour-hero-visual" aria-hidden>
            {hero.shots.map((s, i) => (
              <div key={s.name} className="tour-hero-card" data-i={i}>
                <ShotImage shot={s} locale={locale} decorative eager={i === 0} />
              </div>
            ))}
          </div>
        </div>
      </Theme>
    </section>
  );
}
