'use client';

/**
 * The motion system (docs/ai/ui-guidelines.md "Motion"). Tokens: fast 120 ms, base 180 ms, slow 240 ms; nothing
 * over 250 ms except continuous indicators. Every component here renders its end state, with no fade, when the
 * person prefers reduced motion, and never animates content that was rendered on the server (hydration).
 */

import { CheckIcon, ChevronDownIcon } from 'lucide-react';
import {
  AnimatePresence,
  animate,
  type HTMLMotionProps,
  motion,
  type Transition,
  useReducedMotionConfig,
} from 'motion/react';
import { useLocale, useTranslations } from 'next-intl';
import * as React from 'react';
import { cn } from '../lib/utils';
import { Skeleton } from './skeleton';

/* ───────────────────────── tokens ───────────────────────── */

/** Durations in seconds (motion's unit). The same values are CSS variables `--motion-fast/base/slow`. */
export const duration = { fast: 0.12, base: 0.18, slow: 0.24 } as const;

/** Cubic-bezier easings. CSS: `ease-enter`, `ease-exit`, `ease-move` utilities. */
export const ease = {
  /** Things appearing: quick out, gentle settle. */
  enter: [0.22, 1, 0.36, 1],
  /** Things leaving. */
  exit: [0.4, 0, 1, 1],
  /** Things moving or resizing in place. */
  move: [0.4, 0, 0.2, 1],
} as const;

/** @deprecated use `ease.enter`. */
export const easeOut = ease.enter;

/** Springs. `indicator` settles in about 200 ms (tab underlines, active pills). */
export const spring = {
  indicator: { type: 'spring', stiffness: 500, damping: 40 },
} as const satisfies Record<string, Transition>;

/** Travel distances in px: content shifts 4, overlays 8. */
export const distance = { content: 4, overlay: 8 } as const;

export const motionTokens = { duration, ease, spring, distance } as const;

/* ───────────────────────── hooks ───────────────────────── */

const noopSubscribe = () => () => {};

/** False while rendering on the server and during hydration, true afterwards. */
export function useHydrated() {
  return React.useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}

/** True when the person asked for reduced motion (honours `MotionConfig reducedMotion`). */
export function useReducedMotion() {
  return useReducedMotionConfig() === true;
}

/**
 * Whether something mounting now may play an entrance animation: never for server-rendered content (it is
 * already on screen) and never with reduced motion.
 */
export function useEntranceMotion() {
  const hydrated = useHydrated();
  const reduce = useReducedMotion();
  return hydrated && !reduce;
}

/* ───────────────────────── entrance ───────────────────────── */

/**
 * Fades a block in (opacity + 4 px rise, 180 ms). For a section that appears after an interaction or a load,
 * not for every block of a page. `delay` is capped at 60 ms.
 */
export function FadeIn({
  delay = 0,
  y = distance.content,
  className,
  children,
  transition,
  ...props
}: HTMLMotionProps<'div'> & { delay?: number; y?: number }) {
  const play = useEntranceMotion();
  return (
    <motion.div
      initial={play ? { opacity: 0, y } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: duration.base, ease: ease.enter, delay: Math.min(delay, 0.06), ...transition }}
      className={className}
      {...props}
    >
      {children}
    </motion.div>
  );
}

/** Children of a `Stagger` past this count appear together, without a stagger. */
const STAGGER_FIRST = 6;
/** A `Stagger` with more children than this doesn't animate at all. */
const STAGGER_LIMIT = 24;
const STAGGER_STEP = 0.03;

const StaggerContext = React.createContext<{ play: boolean; index: number }>({ play: false, index: 0 });

/**
 * Cards or tiles that appear one after the other: 30 ms apart for the first 6, the rest with the 6th. Lists of more
 * than 24 children, server-rendered content and reduced motion show at once. Put `StaggerItem`s directly inside.
 */
export function Stagger({ className, children, ...props }: HTMLMotionProps<'div'>) {
  const play = useEntranceMotion();
  const items = React.Children.toArray(children as React.ReactNode);
  const animateItems = play && items.length <= STAGGER_LIMIT;
  return (
    <motion.div className={className} {...props}>
      {items.map((child, i) => (
        <StaggerContext.Provider
          key={React.isValidElement(child) && child.key != null ? child.key : i}
          value={{ play: animateItems, index: i }}
        >
          {child}
        </StaggerContext.Provider>
      ))}
    </motion.div>
  );
}

export function StaggerItem({ className, children, transition, ...props }: HTMLMotionProps<'div'>) {
  const { play, index } = React.use(StaggerContext);
  return (
    <motion.div
      initial={play ? { opacity: 0, y: distance.content } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: duration.base,
        ease: ease.enter,
        delay: Math.min(index, STAGGER_FIRST - 1) * STAGGER_STEP,
        ...transition,
      }}
      className={className}
      {...props}
    >
      {children}
    </motion.div>
  );
}

/**
 * Skeleton → content. While `loading`, shows `skeleton` (shape it like the final layout); then the content fades in
 * over 150 ms. Content that was already there (cached) shows without a fade.
 */
export function Reveal({
  loading,
  skeleton,
  children,
  className,
}: {
  loading: boolean;
  skeleton?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}) {
  const [startedLoading] = React.useState(loading);
  const play = useEntranceMotion() && startedLoading;
  if (loading)
    return (
      <div className={className} aria-busy="true">
        {skeleton ?? <Skeleton className="h-24 w-full" />}
      </div>
    );
  return (
    <motion.div
      className={className}
      initial={play ? { opacity: 0 } : false}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.15, ease: ease.enter }}
    >
      {children}
    </motion.div>
  );
}

/* ───────────────────────── lists ───────────────────────── */

type ListTag = 'ul' | 'ol' | 'div';

/**
 * A list whose items animate when added, removed or reordered. Items already there on first render don't
 * animate. Children must be `AnimatedItem`s with stable `key`s. Space items with padding or `divide-y`, not `gap`
 * (a gap jumps when an item collapses).
 */
export function AnimatedList({
  as = 'ul',
  className,
  children,
  ...props
}: { as?: ListTag; children?: React.ReactNode } & React.HTMLAttributes<HTMLElement>) {
  const Tag = as;
  return (
    <Tag className={cn('relative', className)} {...props}>
      <AnimatePresence initial={false}>{children}</AnimatePresence>
    </Tag>
  );
}

/**
 * An item of an `AnimatedList`: grows in (height + opacity, 180 ms), fades then collapses out (≈ 200 ms), and moves
 * to its new place when the order changes. `highlight` flashes the background once (for live arrivals).
 */
export function AnimatedItem({
  as = 'li',
  highlight,
  className,
  children,
  onAnimationComplete,
  ...props
}: Omit<HTMLMotionProps<'li'>, 'initial' | 'animate' | 'exit' | 'layout' | 'variants' | 'ref'> & {
  as?: 'li' | 'div';
  highlight?: boolean;
}) {
  const reduce = useReducedMotion();
  const Item = as === 'div' ? motion.div : motion.li;
  const ref = React.useRef<HTMLLIElement & HTMLDivElement>(null);
  return (
    <Item
      layout={reduce ? false : 'position'}
      variants={{
        enter: { opacity: 0, height: 0, overflow: 'hidden' },
        shown: { opacity: 1, height: 'auto' },
        gone: {
          opacity: 0,
          height: 0,
          overflow: 'hidden',
          transition: reduce
            ? { duration: 0 }
            : {
                opacity: { duration: duration.fast, ease: ease.exit },
                height: { duration: duration.fast, delay: 0.08, ease: ease.exit },
              },
        },
      }}
      initial="enter"
      animate="shown"
      exit="gone"
      transition={
        reduce
          ? { duration: 0 }
          : { duration: duration.base, ease: ease.enter, layout: { duration: 0.2, ease: ease.move } }
      }
      // Clipping is only needed while the height animates; afterwards focus rings and popovers may overflow.
      // (`transitionEnd` doesn't survive motion's own `height: auto` handling, so it is set here.)
      onAnimationComplete={(definition) => {
        if (definition === 'shown' && ref.current) ref.current.style.overflow = 'visible';
        onAnimationComplete?.(definition);
      }}
      ref={ref}
      className={cn(highlight && 'highlight-flash', className)}
      {...(props as HTMLMotionProps<'li'> & HTMLMotionProps<'div'>)}
    >
      {children}
    </Item>
  );
}

/* ───────────────────────── expand / collapse ───────────────────────── */

/**
 * A region that expands and collapses (height + opacity, 180 ms). It stays mounted when closed (form state is kept)
 * but is `inert` and hidden from assistive technology. Give it an `id` and point the trigger's `aria-controls` at it.
 *
 * The height animates in CSS (grid rows `0fr` ↔ `1fr`), not by measuring `height: auto` in script: a measured
 * animation puts the scroll position back where it started, so a field scrolled into view while the region opened
 * jumped away again. `className` places the region (e.g. a grid span); `contentClassName` lays out its children.
 */
export function Collapse({
  open,
  className,
  contentClassName,
  onOpened,
  children,
  ...props
}: Omit<React.ComponentProps<'div'>, 'onTransitionEnd'> & {
  open: boolean;
  contentClassName?: string;
  /** Runs once the region has finished opening (straight away with reduced motion). */
  onOpened?: () => void;
}) {
  const reduce = useReducedMotion();
  const content = React.useRef<HTMLDivElement>(null);
  const opened = React.useEffectEvent(() => onOpened?.());
  const first = React.useRef(true);
  React.useLayoutEffect(() => {
    const el = content.current;
    const initial = first.current;
    first.current = false;
    if (!el) return;
    // Clipped while closed, closing or opening; once open, focus rings and popovers may overflow.
    if (!open) {
      el.removeAttribute('data-settled');
      return;
    }
    const settle = () => {
      el.setAttribute('data-settled', '');
      if (!initial) opened();
    };
    if (initial || reduce) return settle();
    // `transitionend` doesn't fire when nothing transitions (hidden ancestors, zero duration): settle anyway.
    const timer = setTimeout(settle, 260);
    const onEnd = (e: TransitionEvent) => {
      if (e.target !== el.parentElement || e.propertyName !== 'grid-template-rows') return;
      clearTimeout(timer);
      settle();
    };
    el.parentElement?.addEventListener('transitionend', onEnd);
    return () => {
      clearTimeout(timer);
      el.parentElement?.removeEventListener('transitionend', onEnd);
    };
  }, [open, reduce]);
  return (
    <div
      data-state={open ? 'open' : 'closed'}
      inert={!open}
      aria-hidden={!open || undefined}
      className={cn(
        'grid transition-[grid-template-rows,opacity] duration-(--motion-base) ease-move motion-reduce:transition-none',
        open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0',
        className,
      )}
      {...props}
    >
      <div
        ref={content}
        className={cn('min-h-0 overflow-hidden data-settled:overflow-visible', contentClassName)}
      >
        {children}
      </div>
    </div>
  );
}

/** A chevron that points down when closed and up when open (rotates 180°). */
export function CollapseChevron({ open, className }: { open: boolean; className?: string }) {
  return (
    <ChevronDownIcon
      aria-hidden
      className={cn(
        'size-4 shrink-0 text-muted-foreground transition-transform duration-(--motion-base) ease-move motion-reduce:transition-none',
        open && 'rotate-180',
        className,
      )}
    />
  );
}

/**
 * A button that shows and hides a section (`Collapse` + chevron, `aria-expanded`/`aria-controls`). Controlled with
 * `open`/`onOpenChange`, or uncontrolled with `defaultOpen`.
 */
export function Disclosure({
  summary,
  children,
  defaultOpen = false,
  open: openProp,
  onOpenChange,
  className,
  triggerClassName,
  contentClassName,
}: {
  summary: React.ReactNode;
  children?: React.ReactNode;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
  triggerClassName?: string;
  contentClassName?: string;
}) {
  const [inner, setInner] = React.useState(defaultOpen);
  const open = openProp ?? inner;
  const id = React.useId();
  return (
    <div className={className}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => {
          setInner(!open);
          onOpenChange?.(!open);
        }}
        className={cn(
          'flex w-full items-center justify-between gap-2 rounded-md py-2 text-left text-sm font-medium outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50',
          triggerClassName,
        )}
      >
        <span className="min-w-0">{summary}</span>
        <CollapseChevron open={open} />
      </button>
      <Collapse id={id} open={open} contentClassName={contentClassName}>
        {children}
      </Collapse>
    </div>
  );
}

/* ───────────────────────── numbers ───────────────────────── */

/**
 * A number that renders its real value straight away (on the server too), formatted for the UI language, and
 * animates from the old to the new value (250 ms) only when it changes later (live counts).
 */
export function AnimatedNumber({
  value,
  format,
  className,
}: {
  value: number;
  format?: (n: number) => string;
  className?: string;
}) {
  const locale = useLocale();
  const formatter = React.useMemo(
    () => new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }),
    [locale],
  );
  const fmt = format ?? ((n: number) => formatter.format(Math.round(n)));
  const text = React.useEffectEvent((n: number) => fmt(n));
  const reduce = useReducedMotion();
  const ref = React.useRef<HTMLSpanElement>(null);
  const shown = React.useRef(value);
  React.useLayoutEffect(() => {
    const from = shown.current;
    shown.current = value;
    const node = ref.current?.firstChild;
    if (!node || from === value || reduce) return;
    node.nodeValue = text(from);
    const controls = animate(from, value, {
      duration: 0.25,
      ease: ease.enter,
      onUpdate: (v) => {
        node.nodeValue = text(v);
      },
    });
    return () => {
      controls.stop();
      node.nodeValue = text(value);
    };
  }, [value, reduce]);
  return (
    <span ref={ref} className={cn('tabular-nums', className)}>
      {fmt(value)}
    </span>
  );
}

/* ───────────────────────── feedback ───────────────────────── */

/** A check mark that draws itself (240 ms) — for "done" and wizard confirmation steps. Static with reduced motion. */
export function SuccessMark({ className, label }: { className?: string; label?: string }) {
  const play = useEntranceMotion();
  return (
    <motion.svg
      viewBox="0 0 24 24"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cn('size-10 shrink-0 text-success', className)}
      initial={play ? { scale: 0.9, opacity: 0 } : false}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ duration: duration.slow, ease: ease.enter }}
    >
      <circle cx="12" cy="12" r="11" className="fill-success/12" />
      <motion.path
        d="M7 12.5l3.2 3.2L17 9"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={play ? { pathLength: 0 } : false}
        animate={{ pathLength: 1 }}
        transition={{ duration: duration.slow, ease: ease.enter, delay: 0.06 }}
      />
    </motion.svg>
  );
}

/**
 * "✓ Saved" next to a control that saves on change. Pass a new `at` (e.g. `Date.now()` from the mutation's
 * success) each time something is saved; the chip shows for 2 s. The live region is always rendered so screen
 * readers announce it.
 */
export function SavedIndicator({
  at,
  label,
  className,
}: {
  at?: number | string | null;
  label?: string;
  className?: string;
}) {
  const t = useTranslations('ui');
  const reduce = useReducedMotion();
  const [hiddenFor, setHiddenFor] = React.useState<number | string | null>(null);
  React.useEffect(() => {
    if (at == null) return;
    const timer = setTimeout(() => setHiddenFor(at), 2000);
    return () => clearTimeout(timer);
  }, [at]);
  const visible = at != null && hiddenFor !== at;
  return (
    <span role="status" className={cn('inline-flex min-h-5 items-center', className)}>
      <AnimatePresence>
        {visible && (
          <motion.span
            key={String(at)}
            initial={reduce ? false : { opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, transition: { duration: reduce ? 0 : duration.base } }}
            transition={{ duration: duration.base, ease: ease.enter }}
            className="inline-flex items-center gap-1 text-xs font-medium text-success"
          >
            <CheckIcon className="size-3.5" aria-hidden />
            {label ?? t('saved')}
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
}

/* ───────────────────────── wizards ───────────────────────── */

/**
 * Swaps wizard steps with a direction-aware slide (forward → from the right, back → from the left; 12 px + fade,
 * 180 ms). After a change, focus moves to the new step's first heading (or the step itself) so keyboard and
 * screen reader users land on it. Use with `Stepper` (`@isbp/ui/stepper`).
 */
export function StepTransition({
  step,
  children,
  className,
  focusOnChange = true,
}: {
  /** The current step's index. */
  step: number;
  children?: React.ReactNode;
  className?: string;
  focusOnChange?: boolean;
}) {
  const [prev, setPrev] = React.useState(step);
  const [direction, setDirection] = React.useState(1);
  const [changes, setChanges] = React.useState(0);
  if (step !== prev) {
    setPrev(step);
    setDirection(step > prev ? 1 : -1);
    setChanges((c) => c + 1);
  }
  const reduce = useReducedMotion();
  const offset = reduce ? 0 : 12;
  return (
    <div className={cn('relative', className)}>
      <AnimatePresence mode="wait" initial={false} custom={direction}>
        <motion.div
          key={step}
          custom={direction}
          variants={{
            enter: (d: number) => ({ opacity: 0, x: offset * d }),
            center: { opacity: 1, x: 0 },
            // The old step leaves quickly so the whole change stays under 300 ms.
            exit: (d: number) => ({
              opacity: 0,
              x: -offset * d,
              transition: { duration: reduce ? 0 : 0.09, ease: ease.exit },
            }),
          }}
          initial="enter"
          animate="center"
          exit="exit"
          transition={reduce ? { duration: 0 } : { duration: duration.base, ease: ease.enter }}
        >
          <StepPane focus={focusOnChange && changes > 0}>{children}</StepPane>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

function StepPane({ focus, children }: { focus: boolean; children?: React.ReactNode }) {
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (!focus || !ref.current) return;
    const target =
      ref.current.querySelector<HTMLElement>('[data-step-focus], h1, h2, h3, legend') ?? ref.current;
    if (!target.hasAttribute('tabindex') && target !== ref.current) target.setAttribute('tabindex', '-1');
    target.focus({ preventScroll: false });
    // Focus once, when this step mounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div ref={ref} tabIndex={-1} className="outline-none">
      {children}
    </div>
  );
}

/* ───────────────────────── navigation progress ───────────────────────── */

/**
 * A 2 px bar for "something is loading" at the top of its positioned container (or the viewport with
 * `fixed`). Appears only after 120 ms, loops while `active`, fades out in 150 ms. Static with reduced motion.
 * Decorative: announce state elsewhere (`aria-busy`).
 */
export function NavProgress({
  active,
  fixed,
  className,
}: {
  active: boolean;
  fixed?: boolean;
  className?: string;
}) {
  return (
    <AnimatePresence>
      {active && (
        <motion.div
          key="progress"
          aria-hidden
          initial={{ opacity: 0 }}
          animate={{ opacity: 1, transition: { delay: duration.fast, duration: 0.1 } }}
          exit={{ opacity: 0, transition: { duration: 0.15 } }}
          className={cn(
            'pointer-events-none inset-x-0 top-0 z-50 h-0.5 overflow-hidden',
            fixed ? 'fixed' : 'absolute',
            className,
          )}
        >
          <div className="indeterminate-bar h-full w-1/3 rounded-full bg-primary" />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
