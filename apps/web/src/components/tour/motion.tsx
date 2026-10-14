'use client';

import { animate } from 'motion/react';
import { type CSSProperties, type ReactNode, useEffect, useRef } from 'react';

/**
 * The tour's motion. It is a presentation page, so it may tell a story with longer moves than the product's
 * screens do (`@isbp/ui/motion` caps those at 250 ms), but the same promises hold: nothing animates on the
 * server (the HTML is complete and visible without JavaScript), and with "reduce motion" every block simply
 * shows, every counter shows its final number and every loop stands still.
 */

/** Whether the person asked for reduced motion (read when an effect runs, never during render). */
export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * A block that rises into place the first time it scrolls into view. The server renders it visible; once the page
 * is live, only blocks that are still below the fold are hidden (by a data attribute, not state, so nothing
 * re-renders), and the first screen never flashes.
 */
export function Reveal({
  children,
  delay = 0,
  className,
  as: Tag = 'div',
}: {
  children: ReactNode;
  /** Milliseconds, for blocks that arrive one after the other. */
  delay?: number;
  className?: string;
  as?: 'div' | 'li' | 'section' | 'article';
}) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (prefersReducedMotion() || el.getBoundingClientRect().top < window.innerHeight * 0.9) {
      el.dataset.reveal = 'shown';
      return;
    }
    el.dataset.reveal = 'hidden';
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        el.dataset.reveal = 'shown';
        io.disconnect();
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.05 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const style = { '--reveal-delay': `${delay}ms` } as CSSProperties;
  // The element type is a prop of this component: a ref for a div, li, section or article is the same HTMLElement.
  return (
    <Tag ref={ref as never} className={['tour-reveal', className].filter(Boolean).join(' ')} style={style}>
      {children}
    </Tag>
  );
}

/**
 * A number that counts up when it first scrolls into view. The final value is in the markup (and read by screen
 * readers); the count is decoration.
 */
export function CountUp({ value, duration = 1.4 }: { value: number; duration?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || prefersReducedMotion()) return;
    let controls: { stop: () => void } | undefined;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        io.disconnect();
        controls = animate(0, value, {
          duration,
          ease: [0.22, 1, 0.36, 1],
          onUpdate: (v) => {
            el.textContent = String(Math.round(v));
          },
        });
      },
      { threshold: 0.6 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      controls?.stop();
    };
  }, [value, duration]);
  return (
    <>
      <span className="sr-only">{value}</span>
      <span ref={ref} aria-hidden>
        {value}
      </span>
    </>
  );
}

/**
 * A group whose children play a staggered sequence (in CSS, by `--i`) the first time it scrolls into view. The server
 * renders the finished state; below the fold the page starts it from the beginning (`data-seq="pending"` → `"run"`).
 */
export function Sequence({
  children,
  className,
  as: Tag = 'div',
  threshold = 0.3,
}: {
  children: ReactNode;
  className?: string;
  as?: 'div' | 'ol' | 'ul';
  threshold?: number;
}) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (prefersReducedMotion()) {
      el.dataset.seq = 'run';
      return;
    }
    el.dataset.seq = 'pending';
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        el.dataset.seq = 'run';
        io.disconnect();
      },
      { threshold },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [threshold]);
  return (
    <Tag ref={ref as never} className={className}>
      {children}
    </Tag>
  );
}
