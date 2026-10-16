'use client';

import { Badge } from '@astryxdesign/core/Badge';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { ClickableCard } from '@astryxdesign/core/ClickableCard';
import { Grid } from '@astryxdesign/core/Grid';
import { Heading } from '@astryxdesign/core/Heading';
import { Icon } from '@astryxdesign/core/Icon';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { Text } from '@astryxdesign/core/Text';
import { Theme } from '@astryxdesign/core/theme';
import { guideHref } from '@isbp/guide/meta';
import { telTheme } from '@isbp/ui/theme/tel';
import { ArrowRightIcon, BookOpenIcon, HouseIcon } from 'lucide-react';
import type { TourContent } from './content';
import { Reveal } from './motion';
import { BlockHead, SectionHead, TileIcon } from './parts';
import { Rich } from './rich';
import { ShotImage } from './shot';

/** Languages and themes (real captures of the same page), then the guide for each role. */
export function StartSection({
  content,
  locale,
  canHelp,
}: {
  content: TourContent;
  locale: string;
  canHelp: boolean;
}) {
  const { polish, roles } = content;
  return (
    <section id="start" className="tour-section" data-tone="surface" aria-labelledby="polish-title">
      <div className="tour-wrap tour-stack">
        <SectionHead id="polish-title" title={polish.title} lead={polish.lead} />
        <Grid columns={{ minWidth: 280, max: 3 }} gap={4}>
          {polish.langs.map((l, i) => (
            <Reveal key={l.locale} delay={i * 80}>
              <VStack gap={2}>
                <ShotImage shot={l.shot} locale={locale} className="tour-shot-frame" />
                <HStack gap={2} vAlign="center">
                  <Badge variant="blue" label={l.label} />
                </HStack>
              </VStack>
            </Reveal>
          ))}
        </Grid>
        <div className="tour-split" data-wide-first>
          <Reveal>
            <VStack gap={2}>
              <ShotImage shot={polish.dark.shot} locale={locale} className="tour-shot-frame" />
              <HStack gap={2} vAlign="center">
                <Badge variant="neutral" label={polish.dark.label} />
              </HStack>
            </VStack>
          </Reveal>
          <VStack gap={4}>
            {polish.points.map((p, i) => (
              <Reveal key={p.title} delay={i * 80}>
                <HStack gap={3} vAlign="start">
                  <TileIcon name={p.icon} size="sm" />
                  <VStack gap={1}>
                    <Text weight="semibold">{p.title}</Text>
                    <Text type="supporting" color="secondary" as="p" textWrap="pretty">
                      {p.body}
                    </Text>
                  </VStack>
                </HStack>
              </Reveal>
            ))}
          </VStack>
        </div>

        <div className="tour-stack-sm">
          <BlockHead title={roles.title} lead={roles.lead} />
          <Grid columns={{ minWidth: 290 }} gap={3}>
            {roles.items.map((r, i) => (
              <Reveal key={r.guide.slug} delay={(i % 3) * 50}>
                {canHelp ? (
                  <ClickableCard
                    label={r.guide.label}
                    href={guideHref(r.guide.slug)}
                    padding={4}
                    height="100%"
                  >
                    <VStack gap={2}>
                      <Text type="supporting" color="secondary" as="p" textWrap="pretty">
                        {r.who}
                      </Text>
                      <HStack gap={1} vAlign="center">
                        <Text weight="semibold">{r.guide.label}</Text>
                        <Icon icon={ArrowRightIcon} size="sm" color="accent" />
                      </HStack>
                    </VStack>
                  </ClickableCard>
                ) : (
                  <Card padding={4} height="100%">
                    <VStack gap={2}>
                      <Text type="supporting" color="secondary" as="p" textWrap="pretty">
                        {r.who}
                      </Text>
                      <Text weight="semibold">{r.guide.label}</Text>
                    </VStack>
                  </Card>
                )}
              </Reveal>
            ))}
          </Grid>
        </div>
      </div>
    </section>
  );
}

/** The last screen: navy again, with the three ways on. */
export function Closing({ content, canHelp }: { content: TourContent; canHelp: boolean }) {
  const { closing } = content;
  return (
    <section className="tour-hero tour-closing" aria-labelledby="closing-title">
      <div className="tour-hero-bg" aria-hidden />
      <Theme theme={telTheme} mode="dark">
        <div className="tour-wrap">
          <Reveal>
            <VStack gap={4} className="tour-closing-copy">
              <Heading level={2} type="display-2" id="closing-title" textWrap="balance">
                {closing.title}
              </Heading>
              <Text type="large" as="p" textWrap="pretty">
                <Rich text={closing.lead} />
              </Text>
              <HStack gap={3} wrap="wrap">
                {closing.actions
                  .filter((a) => a.kind === 'product' || canHelp)
                  .map((a, i) =>
                    a.kind === 'product' ? (
                      <Button
                        key={a.label}
                        variant="primary"
                        size="lg"
                        label={a.label}
                        href="/"
                        icon={<Icon icon={HouseIcon} />}
                      />
                    ) : (
                      <Button
                        key={a.label}
                        variant={i === 1 ? 'secondary' : 'ghost'}
                        size="lg"
                        label={a.label}
                        href={guideHref(a.slug ?? 'start-here')}
                        icon={<Icon icon={BookOpenIcon} />}
                      />
                    ),
                  )}
              </HStack>
              <Text type="supporting" color="secondary" as="p">
                {closing.footnote}
              </Text>
            </VStack>
          </Reveal>
        </div>
      </Theme>
    </section>
  );
}
