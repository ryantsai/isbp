'use client';

import { Icon } from '@astryxdesign/core/Icon';
import { IconButton } from '@astryxdesign/core/IconButton';
import { Lightbox } from '@astryxdesign/core/Lightbox';
import { HStack } from '@astryxdesign/core/Layout';
import { Text } from '@astryxdesign/core/Text';
import { ChevronLeftIcon, ChevronRightIcon, Maximize2Icon, MousePointerClickIcon } from 'lucide-react';
import { type CSSProperties, useEffect, useState } from 'react';
import { type TourContent, type TourMark, type TourShot, shotSrc } from './content';
import { prefersReducedMotion } from './motion';

type Chrome = TourContent['chrome'];

/** How long each call-out is the one being explained. */
const MARK_MS = 2800;

/**
 * Call-outs on a screenshot: every point is marked, and they take turns saying what is there (one label at a time,
 * so they never cover each other). Hovering a point holds the turn on it. With reduced motion the first one is
 * shown and the rest wait for the pointer. Decorative: the step's text says the same.
 */
function Marks({ marks, shot }: { marks: TourMark[]; shot: TourShot }) {
  const [focus, setFocus] = useState(0);
  const [hold, setHold] = useState(false);
  useEffect(() => {
    if (marks.length < 2 || hold || prefersReducedMotion()) return;
    const timer = window.setInterval(() => setFocus((f) => (f + 1) % marks.length), MARK_MS);
    return () => window.clearInterval(timer);
  }, [marks.length, hold]);
  return (
    <span className="tour-marks" aria-hidden>
      {marks.map((m, i) => {
        const side = m.side ?? (m.x > shot.w / 2 ? 'left' : 'right');
        // A label above or below its point is centred on it, unless the point is near an edge.
        const h = m.x < shot.w * 0.28 ? 'start' : m.x > shot.w * 0.72 ? 'end' : 'center';
        return (
          <span
            key={`${m.x}-${m.y}`}
            className="tour-mark"
            data-side={side}
            data-h={h}
            data-on={i === focus}
            style={{ '--mx': (m.x / shot.w) * 100, '--my': (m.y / shot.h) * 100 } as CSSProperties}
          >
            <span
              className="tour-mark-dot"
              onMouseEnter={() => {
                setFocus(i);
                setHold(true);
              }}
              onMouseLeave={() => setHold(false)}
            />
            <span className="tour-mark-label">
              <Text type="supporting" weight="medium">
                {m.label}
              </Text>
            </span>
          </span>
        );
      })}
    </span>
  );
}

/**
 * A real screenshot of the product (1280 × 800 capture, or a panel) at its own proportions, with its call-outs
 * positioned in the screenshot's pixels. Pictures below the first screen load lazily.
 */
export function ShotImage({
  shot,
  locale,
  marks,
  eager = false,
  decorative = false,
  className,
}: {
  shot: TourShot;
  locale: string;
  marks?: TourMark[];
  eager?: boolean;
  /** A picture that only decorates (the hero): no text alternative. */
  decorative?: boolean;
  className?: string;
}) {
  return (
    <span
      className={['tour-shot-inner', className].filter(Boolean).join(' ')}
      style={{ '--shot-ar': `${shot.w} / ${shot.h}` } as CSSProperties}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- a captured screen, served from public/help */}
      <img
        src={shotSrc(shot, locale)}
        alt={decorative ? '' : shot.alt}
        width={shot.w}
        height={shot.h}
        loading={eager ? 'eager' : 'lazy'}
        decoding="async"
      />
      {marks?.length ? <Marks key={shot.name} marks={marks} shot={shot} /> : null}
    </span>
  );
}

export interface StageFrame {
  key: string;
  shot: TourShot;
  marks?: TourMark[];
  /** Shown in the window's title strip (where in the product this is, or who acts). */
  caption: string;
}

/**
 * The window that shows one screenshot at a time and fades between them as the story moves on. Every picture is in
 * the page (so the next one is already loaded), only the active one is exposed to assistive technology, and its
 * call-outs replay each time it comes back. "Previous / next" move the story, "enlarge" opens the capture at full
 * size in a gallery.
 */
export function ShotStage({
  frames,
  active,
  locale,
  chrome,
  onGo,
  label,
  eagerFirst = false,
}: {
  frames: StageFrame[];
  active: number;
  locale: string;
  chrome: Chrome;
  onGo: (index: number) => void;
  /** Accessible name of the figure. */
  label: string;
  eagerFirst?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const current = frames[active] ?? frames[0]!;
  return (
    <figure className="tour-window" aria-label={label}>
      <figcaption className="tour-window-bar">
        <HStack gap={2} vAlign="center" align="center">
          <Icon icon={MousePointerClickIcon} size="sm" color="secondary" />
          <Text type="supporting" weight="medium" maxLines={1}>
            {current.caption}
          </Text>
        </HStack>
        <HStack gap={1} vAlign="center" align="center">
          <Text type="supporting" color="secondary" hasTabularNumbers>
            {active + 1} {chrome.of} {frames.length}
          </Text>
          <IconButton
            label={chrome.previous}
            tooltip={chrome.previous}
            variant="ghost"
            size="sm"
            icon={<Icon icon={ChevronLeftIcon} />}
            isDisabled={active === 0}
            onClick={() => onGo(active - 1)}
          />
          <IconButton
            label={chrome.next}
            tooltip={chrome.next}
            variant="ghost"
            size="sm"
            icon={<Icon icon={ChevronRightIcon} />}
            isDisabled={active === frames.length - 1}
            onClick={() => onGo(active + 1)}
          />
          <IconButton
            label={chrome.openLarge}
            tooltip={chrome.openLarge}
            variant="ghost"
            size="sm"
            icon={<Icon icon={Maximize2Icon} />}
            onClick={() => setOpen(true)}
          />
        </HStack>
      </figcaption>
      <div className="tour-window-body">
        {frames.map((f, i) => (
          <div key={f.key} className="tour-frame" data-active={i === active} aria-hidden={i !== active}>
            <ShotImage
              shot={f.shot}
              locale={locale}
              marks={i === active ? f.marks : undefined}
              eager={eagerFirst && i === 0}
            />
          </div>
        ))}
      </div>
      <Lightbox
        isOpen={open}
        onOpenChange={setOpen}
        index={active}
        onIndexChange={onGo}
        hasZoom
        media={frames.map((f) => ({
          src: shotSrc(f.shot, locale),
          alt: f.shot.alt,
          caption: f.caption,
        }))}
      />
    </figure>
  );
}

/** Scrolls an element to the middle of the screen (smoothly unless the person asked for reduced motion). */
export function scrollToMiddle(el: Element | null | undefined) {
  el?.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'center' });
}
