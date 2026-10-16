'use client';

import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { ClickableCard } from '@astryxdesign/core/ClickableCard';
import { Grid } from '@astryxdesign/core/Grid';
import { Icon } from '@astryxdesign/core/Icon';
import { VStack } from '@astryxdesign/core/Layout';
import { Text } from '@astryxdesign/core/Text';
import { ArrowRightIcon } from 'lucide-react';
import { motion } from 'motion/react';
import { useState } from 'react';
import type { TourContent } from './content';
import { tourIcons } from './icons';
import { CountUp, Reveal } from './motion';
import { BlockHead, SectionHead, TileIcon } from './parts';

const W = 1000;
const H = 540;
const CX = W / 2;
const CY = H / 2 + 5;
const RX = 392;
const RY = 214;
const NODE_W = 160;
const NODE_H = 50;

/**
 * The twelve areas around the platform's core, as one picture. Each node is a link to its chapter; hovering or
 * focusing one says what the area is for. The spokes draw themselves when the map scrolls into view. On a phone the
 * same links are a grid of cards (the drawing would be too small to read).
 */
function AreaMap({ content }: { content: TourContent }) {
  const { overview, areas } = content;
  const [current, setCurrent] = useState<string | null>(null);
  const shown = areas.find((a) => a.id === current);
  const nodes = areas.map((a, i) => {
    const angle = (-90 + (360 / areas.length) * i) * (Math.PI / 180);
    // Rounded: Math.sin and cos differ in the last digits between the server and the browser (a hydration mismatch).
    return { area: a, x: Math.round(CX + RX * Math.cos(angle)), y: Math.round(CY + RY * Math.sin(angle)) };
  });
  return (
    <div className="tour-map">
      <svg
        className="tour-map-svg"
        viewBox={`0 0 ${W} ${H}`}
        role="group"
        aria-label={overview.mapTitle}
        focusable="false"
      >
        <g aria-hidden>
          {nodes.map(({ area, x, y }, i) => (
            <motion.path
              key={area.id}
              d={`M${CX} ${CY} L${x} ${y}`}
              className="tour-map-spoke"
              data-on={current === area.id}
              initial={{ pathLength: 0, opacity: 0 }}
              whileInView={{ pathLength: 1, opacity: 1 }}
              viewport={{ once: true, margin: '-10% 0px' }}
              transition={{ duration: 0.9, delay: 0.1 + i * 0.06, ease: [0.22, 1, 0.36, 1] }}
            />
          ))}
          <rect x={CX - 118} y={CY - 66} width={236} height={132} rx={14} className="tour-map-halo" />
          <rect x={CX - 98} y={CY - 46} width={196} height={92} rx={8} className="tour-map-core" />
        </g>
        <text x={CX} y={CY - 6} textAnchor="middle" className="tour-map-core-label">
          {overview.coreLabel}
        </text>
        <text x={CX} y={CY + 20} textAnchor="middle" className="tour-map-core-note">
          {overview.coreNote}
        </text>
        {nodes.map(({ area, x, y }, i) => {
          const Glyph = tourIcons[area.icon];
          return (
            <motion.a
              key={area.id}
              href={`#${area.id}`}
              className="tour-map-node"
              aria-label={`${area.nav}：${area.pitch}`}
              onMouseEnter={() => setCurrent(area.id)}
              onFocus={() => setCurrent(area.id)}
              initial={{ opacity: 0, scale: 0.86 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true, margin: '-10% 0px' }}
              transition={{ duration: 0.5, delay: 0.35 + i * 0.06, ease: [0.22, 1, 0.36, 1] }}
              style={{ transformOrigin: `${x}px ${y}px` }}
            >
              <rect x={x - NODE_W / 2} y={y - NODE_H / 2} width={NODE_W} height={NODE_H} rx={6} />
              <Glyph x={x - NODE_W / 2 + 14} y={y - 11} width={22} height={22} aria-hidden />
              <text x={x - NODE_W / 2 + 46} y={y + 5} className="tour-map-label">
                {area.nav}
              </text>
            </motion.a>
          );
        })}
      </svg>
      <div className="tour-map-panel" aria-live="polite">
        {shown ? (
          <VStack gap={2} key={shown.id}>
            <Text weight="semibold">{shown.title}</Text>
            <Text type="supporting" color="secondary" as="p">
              {shown.pitch}
            </Text>
            <div>
              <Button
                variant="ghost"
                size="sm"
                label={overview.open}
                href={`#${shown.id}`}
                endContent={<Icon icon={ArrowRightIcon} />}
              />
            </div>
          </VStack>
        ) : (
          <Text color="secondary" as="p" justify="center">
            {overview.mapHint}
          </Text>
        )}
      </div>
      <div className="tour-map-grid">
        <Grid columns={{ minWidth: 220 }} gap={3}>
          {areas.map((a) => (
            <ClickableCard key={a.id} label={a.nav} href={`#${a.id}`} padding={3}>
              <VStack gap={2}>
                <TileIcon name={a.icon} size="sm" />
                <Text weight="semibold">{a.nav}</Text>
                <Text type="supporting" color="secondary" as="p" maxLines={3}>
                  {a.pitch}
                </Text>
              </VStack>
            </ClickableCard>
          ))}
        </Grid>
      </div>
    </div>
  );
}

/** The numbers behind the platform, counted up when they come into view (the generated reference is their source). */
function Stats({ content }: { content: TourContent }) {
  return (
    <Grid columns={{ minWidth: 180, max: 6 }} gap={3}>
      {content.overview.stats.map((s, i) => (
        <Reveal key={s.key} delay={i * 60}>
          <Card padding={4} height="100%">
            <VStack gap={1}>
              <Text type="display-2" weight="semibold" color="accent" hasTabularNumbers>
                <CountUp value={s.value} />
              </Text>
              <Text weight="semibold">{s.label}</Text>
              <Text type="supporting" color="secondary" as="p" textWrap="pretty">
                {s.hint}
              </Text>
            </VStack>
          </Card>
        </Reveal>
      ))}
    </Grid>
  );
}

export function Overview({ content }: { content: TourContent }) {
  const { overview } = content;
  return (
    <section id="overview" className="tour-section" aria-labelledby="overview-title">
      <div className="tour-wrap tour-stack">
        <SectionHead id="overview-title" title={overview.title} lead={overview.lead} />
        <AreaMap content={content} />
        <Stats content={content} />
        <div className="tour-stack-sm">
          <BlockHead title={overview.shared.title} lead={overview.shared.lead} />
          <Grid columns={{ minWidth: 240 }} gap={3}>
            {overview.shared.items.map((item, i) => (
              <Reveal key={item.title} delay={(i % 4) * 60}>
                <Card padding={4} height="100%">
                  <VStack gap={3}>
                    <TileIcon name={item.icon} size="sm" />
                    <Text weight="semibold">{item.title}</Text>
                    <Text type="supporting" color="secondary" as="p" textWrap="pretty">
                      {item.body}
                    </Text>
                  </VStack>
                </Card>
              </Reveal>
            ))}
          </Grid>
        </div>
      </div>
    </section>
  );
}
