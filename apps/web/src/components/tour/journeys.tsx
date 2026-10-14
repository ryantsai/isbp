'use client';

import { Badge } from '@astryxdesign/core/Badge';
import { Button } from '@astryxdesign/core/Button';
import { Heading } from '@astryxdesign/core/Heading';
import { Icon } from '@astryxdesign/core/Icon';
import { IconButton } from '@astryxdesign/core/IconButton';
import { Item } from '@astryxdesign/core/Item';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { Text } from '@astryxdesign/core/Text';
import { guideHref } from '@isbp/guide/meta';
import { Segmented } from '@isbp/ui/segmented';
import {
  ArrowRightIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  PauseIcon,
  PlayIcon,
  RotateCcwIcon,
} from 'lucide-react';
import { type CSSProperties, useEffect, useState } from 'react';
import type { TourContent } from './content';
import { NamedIcon, SectionHead } from './parts';
import { Rich } from './rich';
import { ShotStage } from './shot';

const STEP_MS = 4600;

/**
 * Four to five screens in a row tell one task from start to end: who does what, on which real screen. Pick a story,
 * then step through it, or press play (it never starts on its own, and stops at the last step).
 */
export function JourneysSection({
  content,
  locale,
  canHelp,
}: {
  content: TourContent;
  locale: string;
  canHelp: boolean;
}) {
  const { journeys, chrome } = content;
  const [id, setId] = useState(journeys.items[0]!.id);
  const [active, setActive] = useState(0);
  const [playing, setPlaying] = useState(false);
  const journey = journeys.items.find((j) => j.id === id) ?? journeys.items[0]!;
  const last = journey.steps.length - 1;

  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => {
      setActive((a) => {
        if (a >= last) {
          setPlaying(false);
          return a;
        }
        return a + 1;
      });
    }, STEP_MS);
    return () => window.clearInterval(timer);
  }, [playing, last]);

  const go = (i: number) => {
    setPlaying(false);
    setActive(Math.max(0, Math.min(last, i)));
  };
  const frames = journey.steps.map((s, i) => ({
    key: `${journey.id}-${i}`,
    shot: s.shot,
    caption: s.who,
  }));

  return (
    <section id="journeys" className="tour-section" aria-labelledby="journeys-title">
      <div className="tour-wrap tour-stack">
        <SectionHead id="journeys-title" title={journeys.title} lead={journeys.lead} />
        <Segmented
          label={journeys.title}
          value={id}
          onChange={(next) => {
            setId(next);
            setActive(0);
            setPlaying(false);
          }}
          options={journeys.items.map((j) => ({
            value: j.id,
            label: j.nav,
            icon: <NamedIcon name={j.icon} size="sm" />,
          }))}
        />
        <div className="tour-journey" key={journey.id}>
          <VStack gap={4} className="tour-journey-side">
            <VStack gap={2}>
              <Heading level={3} textWrap="balance">
                {journey.title}
              </Heading>
              <Text color="secondary" as="p" textWrap="pretty">
                {journey.intro}
              </Text>
            </VStack>
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
            </HStack>
            <ol
              className="tour-timeline"
              style={{ '--progress': last ? active / last : 1 } as CSSProperties}
              aria-label={journey.title}
            >
              {journey.steps.map((s, i) => (
                <li key={s.title} data-state={i < active ? 'done' : i === active ? 'active' : 'todo'}>
                  <Item
                    density="compact"
                    marker={`${i + 1}.`}
                    label={s.title}
                    isSelected={i === active}
                    aria-current={i === active ? 'step' : undefined}
                    onClick={() => go(i)}
                  />
                  {i === active && (
                    <div className="tour-timeline-body" aria-live="polite">
                      <Badge variant="blue" label={s.who} />
                      <Text as="p" textWrap="pretty">
                        <Rich text={s.body} />
                      </Text>
                    </div>
                  )}
                </li>
              ))}
            </ol>
            {canHelp && (
              <div>
                <Button
                  variant="ghost"
                  size="sm"
                  label={`${journeys.guideCta}：${journey.guide.label}`}
                  href={guideHref(journey.guide.slug, journey.guide.anchor)}
                  endContent={<Icon icon={ArrowRightIcon} />}
                />
              </div>
            )}
          </VStack>
          <div className="tour-journey-stage">
            <ShotStage
              frames={frames}
              active={active}
              locale={locale}
              chrome={chrome}
              label={journey.title}
              onGo={go}
            />
            <Text type="supporting" color="secondary" as="p" justify="center">
              {chrome.demoNote}
            </Text>
          </div>
        </div>
      </div>
    </section>
  );
}
