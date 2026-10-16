'use client';

import { Badge } from '@astryxdesign/core/Badge';
import { Button } from '@astryxdesign/core/Button';
import { Heading } from '@astryxdesign/core/Heading';
import { Icon } from '@astryxdesign/core/Icon';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { Text } from '@astryxdesign/core/Text';
import { guideHref } from '@isbp/guide/meta';
import { ArrowRightIcon, CheckIcon, MapPinIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { TourArea, TourContent } from './content';
import { Reveal } from './motion';
import { TileIcon } from './parts';
import { Rich, plain } from './rich';
import { ShotImage, ShotStage, scrollToMiddle } from './shot';

/**
 * One functional area, told as a story: its steps scroll past on one side while the real screen of the active step
 * stays in view on the other (a sticky window). Below `lg` there is no sticky window: each step carries its own
 * picture. The active step is the one crossing the middle of the screen.
 */
export function AreaChapter({
  area,
  index,
  total,
  content,
  locale,
  canHelp,
}: {
  area: TourArea;
  index: number;
  total: number;
  content: TourContent;
  locale: string;
  canHelp: boolean;
}) {
  const { chrome } = content;
  const [active, setActive] = useState(0);
  const stepRefs = useRef<(HTMLLIElement | null)[]>([]);

  useEffect(() => {
    const items = stepRefs.current.filter((el): el is HTMLLIElement => el !== null);
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const i = items.indexOf(entry.target as HTMLLIElement);
          if (i >= 0) setActive(i);
        }
      },
      { rootMargin: '-42% 0px -42% 0px' },
    );
    items.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  const frames = area.steps.map((s) => ({
    key: s.id,
    shot: s.shot,
    marks: s.marks,
    caption: s.where,
  }));

  return (
    <section
      id={area.id}
      className="tour-area"
      data-flip={index % 2 === 1}
      aria-labelledby={`${area.id}-title`}
    >
      <div className="tour-wrap tour-story">
        <div className="tour-story-main">
          <Reveal className="tour-area-head">
            <TileIcon name={area.icon} size="lg" />
            <VStack gap={2}>
              <Text type="supporting" color="secondary" hasTabularNumbers>
                {String(index + 1).padStart(2, '0')} {chrome.of} {total}
              </Text>
              <Heading level={3} type="display-3" id={`${area.id}-title`} textWrap="balance">
                {area.title}
              </Heading>
              <Text type="large" color="secondary" as="p" textWrap="pretty">
                {area.pitch}
              </Text>
              <HStack gap={1} vAlign="center">
                <Icon icon={MapPinIcon} size="sm" color="secondary" />
                <Text type="supporting" color="secondary">
                  {area.where}
                </Text>
              </HStack>
              <HStack gap={2} wrap="wrap" vAlign="center">
                <Text type="supporting" color="secondary">
                  {chrome.who}
                </Text>
                {area.who.map((w) => (
                  <Badge key={w} variant="blue" label={w} />
                ))}
              </HStack>
              {canHelp && (
                <div>
                  <Button
                    variant="secondary"
                    size="sm"
                    label={`${chrome.guideCta}：${area.guide.label}`}
                    href={guideHref(area.guide.slug)}
                    endContent={<Icon icon={ArrowRightIcon} />}
                  />
                </div>
              )}
            </VStack>
          </Reveal>
          <ol className="tour-steps" aria-label={area.title}>
            {area.steps.map((step, i) => (
              <li
                key={step.id}
                ref={(el) => {
                  stepRefs.current[i] = el;
                }}
                className="tour-step"
                data-active={i === active}
              >
                <div className="tour-step-card">
                  <VStack gap={3}>
                    <HStack gap={2} vAlign="center">
                      <Badge variant="blue" label={`${chrome.step} ${i + 1}`} />
                      <Text type="supporting" color="secondary" maxLines={1}>
                        {step.where}
                      </Text>
                    </HStack>
                    <Heading level={4} textWrap="balance">
                      {step.title}
                    </Heading>
                    <Text as="p" textWrap="pretty">
                      <Rich text={step.body} />
                    </Text>
                    <ul className="tour-points">
                      {step.points.map((p) => (
                        <li key={p}>
                          <Icon icon={CheckIcon} size="sm" color="success" />
                          <Text type="supporting" color="secondary" as="span">
                            <Rich text={p} />
                          </Text>
                        </li>
                      ))}
                    </ul>
                  </VStack>
                  <div className="tour-step-shot">
                    <ShotImage
                      shot={step.shot}
                      locale={locale}
                      marks={step.marks}
                      className="tour-shot-frame"
                    />
                    <Text type="supporting" color="secondary" as="p">
                      {plain(step.shot.alt)}
                    </Text>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </div>
        <div className="tour-stage">
          <ShotStage
            frames={frames}
            active={active}
            locale={locale}
            chrome={chrome}
            label={area.title}
            onGo={(i) => scrollToMiddle(stepRefs.current[i])}
          />
          <Text type="supporting" color="secondary" as="p" justify="center">
            {chrome.demoNote}
          </Text>
        </div>
      </div>
    </section>
  );
}
