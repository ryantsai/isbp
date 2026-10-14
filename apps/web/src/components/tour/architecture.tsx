'use client';

import { Badge } from '@astryxdesign/core/Badge';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { Grid } from '@astryxdesign/core/Grid';
import { Icon } from '@astryxdesign/core/Icon';
import { IconButton } from '@astryxdesign/core/IconButton';
import { Item } from '@astryxdesign/core/Item';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { Text } from '@astryxdesign/core/Text';
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  RotateCcwIcon,
  WaypointsIcon,
} from 'lucide-react';
import { Fragment, type CSSProperties, useEffect, useRef, useState } from 'react';
import type { TourContent } from './content';
import { Reveal, prefersReducedMotion } from './motion';
import { BlockHead, SectionHead, TileIcon } from './parts';
import { Rich } from './rich';
import { ShotImage } from './shot';

type Architecture = TourContent['architecture'];

/** Each layer of the system, top to bottom, with a flow running between them. */
function Stack({ architecture }: { architecture: Architecture }) {
  const { stack } = architecture;
  return (
    <div className="tour-stack-sm">
      <BlockHead title={stack.title} lead={stack.lead} />
      <div className="tour-layers">
        {stack.layers.map((layer, i) => (
          <Fragment key={layer.id}>
            {i > 0 && <div className="tour-flow" aria-hidden />}
            <Reveal delay={i * 60}>
              <Card padding={4}>
                <div className="tour-layer">
                  <HStack gap={3} vAlign="center" className="tour-layer-name">
                    <TileIcon name={layer.icon} />
                    <VStack gap={0}>
                      <Text weight="semibold">{layer.name}</Text>
                      <Text type="supporting" color="secondary">
                        {layer.tech}
                      </Text>
                    </VStack>
                  </HStack>
                  <div className="tour-layer-items">
                    {layer.items.map((item) => (
                      <div key={item.label} className="tour-layer-item">
                        <Text weight="medium">{item.label}</Text>
                        <Text type="supporting" color="secondary" as="p" textWrap="pretty">
                          {item.note}
                        </Text>
                      </div>
                    ))}
                  </div>
                </div>
              </Card>
            </Reveal>
          </Fragment>
        ))}
      </div>
      <HStack gap={2} vAlign="center" align="center">
        <Icon icon={WaypointsIcon} color="secondary" />
        <Text type="supporting" color="secondary" as="p" textWrap="pretty">
          {stack.scale}
        </Text>
      </HStack>
    </div>
  );
}

/**
 * A sequence diagram that plays itself once it is on screen: one message at a time travels between the parts of the
 * system, with the matching explanation beside it. Anyone can pause, step or replay it; a phone gets the list
 * without the drawing.
 */
function RequestPath({ content }: { content: TourContent }) {
  const { request } = content.architecture;
  const { chrome } = content;
  const steps = request.steps;
  const [active, setActive] = useState(0);
  const [playing, setPlaying] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const last = steps.length - 1;

  // Starts by itself when the diagram first comes into view (never with reduced motion).
  useEffect(() => {
    const el = root.current;
    if (!el || prefersReducedMotion()) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        io.disconnect();
        setPlaying(true);
      },
      { threshold: 0.45 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => {
      setActive((a) => {
        if (a >= last) {
          setPlaying(false);
          return a;
        }
        return a + 1;
      });
    }, 3400);
    return () => window.clearInterval(id);
  }, [playing, last]);

  const go = (i: number) => {
    setPlaying(false);
    setActive(Math.max(0, Math.min(last, i)));
  };
  const laneIndex = (id: string) => request.lanes.findIndex((l) => l.id === id);
  const step = steps[active]!;

  return (
    <div className="tour-stack-sm" ref={root}>
      <BlockHead title={request.title} lead={request.lead} />
      <div className="tour-seq-layout">
        <VStack gap={3}>
          <HStack gap={1} vAlign="center" wrap="wrap">
            <Button
              variant="secondary"
              size="sm"
              label={playing ? chrome.pause : active >= last ? chrome.replay : chrome.play}
              icon={<Icon icon={playing ? PauseIcon : active >= last ? RotateCcwIcon : PlayIcon} />}
              onClick={() => {
                if (playing) return setPlaying(false);
                if (active >= last) setActive(0);
                setPlaying(true);
              }}
            />
            <IconButton
              label={chrome.previous}
              tooltip={chrome.previous}
              variant="ghost"
              icon={<Icon icon={ChevronLeftIcon} />}
              isDisabled={active === 0}
              onClick={() => go(active - 1)}
            />
            <IconButton
              label={chrome.next}
              tooltip={chrome.next}
              variant="ghost"
              icon={<Icon icon={ChevronRightIcon} />}
              isDisabled={active === last}
              onClick={() => go(active + 1)}
            />
            <Text type="supporting" color="secondary" hasTabularNumbers>
              {active + 1} {chrome.of} {steps.length}
            </Text>
          </HStack>
          <ol className="tour-seq-steps">
            {steps.map((s, i) => (
              <Item
                key={`${s.from}-${s.to}-${s.title}`}
                as="li"
                density="compact"
                marker={`${i + 1}.`}
                label={s.title}
                isSelected={i === active}
                aria-current={i === active ? 'step' : undefined}
                onClick={() => go(i)}
              />
            ))}
          </ol>
        </VStack>
        <VStack gap={3} className="tour-seq-main">
          <div className="tour-seq" aria-hidden>
            <div className="tour-seq-lanes">
              {request.lanes.map((l) => (
                <div key={l.id} className="tour-seq-lane">
                  <Text weight="semibold" maxLines={1}>
                    {l.label}
                  </Text>
                  <Text type="supporting" color="secondary" maxLines={1}>
                    {l.note}
                  </Text>
                </div>
              ))}
            </div>
            <div className="tour-seq-body">
              {request.lanes.map((l, i) => (
                <span key={l.id} className="tour-seq-line" style={{ '--lane': i } as CSSProperties} />
              ))}
              {steps.map((s, i) => {
                const a = laneIndex(s.from);
                const b = laneIndex(s.to);
                const dir = a < b ? 'right' : a > b ? 'left' : 'self';
                const column =
                  a === b ? `${2 * a + 2} / span 3` : `${2 * Math.min(a, b) + 2} / ${2 * Math.max(a, b) + 2}`;
                return (
                  <div
                    key={`${s.from}-${s.to}-${s.title}`}
                    className="tour-seq-row"
                    data-state={i < active ? 'done' : i === active ? 'active' : 'todo'}
                  >
                    <span
                      key={i === active ? `on-${active}` : 'off'}
                      className="tour-seq-arrow"
                      data-dir={dir}
                      data-edge={a === request.lanes.length - 1 ? 'end' : undefined}
                      style={{ gridColumn: column }}
                    >
                      <span className="tour-seq-label">
                        <Text type="supporting" weight={i === active ? 'semibold' : 'normal'}>
                          {i + 1}. {s.title}
                        </Text>
                      </span>
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
          <Card padding={4} variant="muted">
            <VStack gap={2} aria-live="polite" key={active}>
              <HStack gap={2} vAlign="center">
                <Badge variant="blue" label={`${chrome.step} ${active + 1}`} />
                <Text weight="semibold">{step.title}</Text>
              </HStack>
              <Text as="p" textWrap="pretty">
                {step.body}
              </Text>
            </VStack>
          </Card>
        </VStack>
      </div>
    </div>
  );
}

/** The 18 modules in their groups, with who depends on whom, and how a module is switched on. */
function Modules({ architecture, locale }: { architecture: Architecture; locale: string }) {
  const { modules } = architecture;
  const nameOf = (id: string) => modules.items.find((m) => m.id === id)?.name ?? id;
  return (
    <div className="tour-stack-sm">
      <BlockHead title={modules.title} lead={modules.lead} />
      <div className="tour-masonry">
        {modules.groups.map((g, gi) => (
          <Reveal key={g.id} delay={(gi % 3) * 60}>
            <Card padding={4}>
              <VStack gap={3}>
                <Text weight="semibold" color="accent">
                  {g.label}
                </Text>
                <ul className="tour-modules">
                  {modules.items
                    .filter((m) => m.group === g.id)
                    .map((m) => (
                      <li key={m.id}>
                        <Text weight="medium">{m.name}</Text>
                        <Text type="supporting" color="secondary" as="p" textWrap="pretty">
                          {m.note}
                        </Text>
                        {m.dependsOn && (
                          <HStack gap={1} wrap="wrap" vAlign="center">
                            <Text type="supporting" color="secondary">
                              {modules.dependsOn}
                            </Text>
                            {m.dependsOn.map((d) => (
                              <Badge key={d} variant="neutral" label={nameOf(d)} />
                            ))}
                          </HStack>
                        )}
                      </li>
                    ))}
                </ul>
              </VStack>
            </Card>
          </Reveal>
        ))}
      </div>
      <Banner status="info" title={<Rich text={modules.rule} />} />
      <div className="tour-split">
        <Reveal>
          <VStack gap={3}>
            <Text type="large" weight="semibold" as="p">
              {modules.toggleTitle}
            </Text>
            <Text as="p" textWrap="pretty">
              <Rich text={modules.toggleBody} />
            </Text>
          </VStack>
        </Reveal>
        <Reveal delay={80}>
          <ShotImage
            shot={modules.toggleShot}
            locale={locale}
            marks={modules.toggleMarks}
            className="tour-shot-frame"
          />
        </Reveal>
      </div>
    </div>
  );
}

/** Configuration (what an organisation builds) next to code (what the platform can do), and the rule between them. */
function ConfigVsCode({ architecture, locale }: { architecture: Architecture; locale: string }) {
  const { config } = architecture;
  return (
    <div className="tour-stack-sm">
      <BlockHead title={config.title} lead={config.lead} />
      <div className="tour-vs">
        <Reveal>
          <Card padding={5} variant="blue" height="100%">
            <VStack gap={4}>
              <Text type="large" weight="semibold">
                {config.configTitle}
              </Text>
              {config.configItems.map((it) => (
                <VStack key={it.title} gap={1}>
                  <Text weight="semibold">{it.title}</Text>
                  <Text type="supporting" as="p" textWrap="pretty">
                    {it.body}
                  </Text>
                </VStack>
              ))}
            </VStack>
          </Card>
        </Reveal>
        <div className="tour-vs-join" aria-hidden>
          <Icon icon={PlusIcon} size="lg" color="secondary" />
        </div>
        <Reveal delay={90}>
          <Card padding={5} variant="muted" height="100%">
            <VStack gap={4}>
              <Text type="large" weight="semibold">
                {config.codeTitle}
              </Text>
              {config.codeItems.map((it) => (
                <VStack key={it.title} gap={1}>
                  <Text weight="semibold">{it.title}</Text>
                  <Text type="supporting" as="p" textWrap="pretty">
                    {it.body}
                  </Text>
                </VStack>
              ))}
            </VStack>
          </Card>
        </Reveal>
      </div>
      <Banner status="success" title={<Rich text={config.rule} />} />
      <Reveal>
        <ShotImage shot={config.shot} locale={locale} className="tour-shot-frame tour-shot-wide" />
      </Reveal>
    </div>
  );
}

function Deploy({ architecture }: { architecture: Architecture }) {
  const { deploy } = architecture;
  return (
    <div className="tour-stack-sm">
      <BlockHead title={deploy.title} lead={deploy.lead} />
      <Grid columns={{ minWidth: 230 }} gap={3}>
        {deploy.items.map((it, i) => (
          <Reveal key={it.title} delay={(i % 3) * 60}>
            <Card padding={4} height="100%">
              <VStack gap={3}>
                <TileIcon name={it.icon} size="sm" />
                <Text weight="semibold">{it.title}</Text>
                <Text type="supporting" color="secondary" as="p" textWrap="pretty">
                  {it.body}
                </Text>
              </VStack>
            </Card>
          </Reveal>
        ))}
      </Grid>
    </div>
  );
}

export function ArchitectureSection({ content, locale }: { content: TourContent; locale: string }) {
  const { architecture } = content;
  return (
    <section
      id="architecture"
      className="tour-section"
      data-tone="surface"
      aria-labelledby="architecture-title"
    >
      <div className="tour-wrap tour-stack">
        <SectionHead id="architecture-title" title={architecture.title} lead={architecture.lead} />
        <Stack architecture={architecture} />
        <RequestPath content={content} />
        <Modules architecture={architecture} locale={locale} />
        <ConfigVsCode architecture={architecture} locale={locale} />
        <Deploy architecture={architecture} />
      </div>
    </section>
  );
}
