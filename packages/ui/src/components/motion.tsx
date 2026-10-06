'use client';

import { animate, motion, type HTMLMotionProps, useInView, useReducedMotion } from 'motion/react';
import * as React from 'react';

/** Shared easing: quick out, gentle settle. */
export const easeOut = [0.22, 1, 0.36, 1] as const;

export function FadeIn({
  delay = 0,
  y = 8,
  className,
  children,
  ...props
}: HTMLMotionProps<'div'> & { delay?: number; y?: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: easeOut, delay }}
      className={className}
      {...props}
    >
      {children}
    </motion.div>
  );
}

const staggerParent = { hidden: {}, show: { transition: { staggerChildren: 0.05 } } };
const staggerChild = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { duration: 0.35, ease: easeOut } },
};

export function Stagger({ className, children, ...props }: HTMLMotionProps<'div'>) {
  return (
    <motion.div variants={staggerParent} initial="hidden" animate="show" className={className} {...props}>
      {children}
    </motion.div>
  );
}

export function StaggerItem({ className, children, ...props }: HTMLMotionProps<'div'>) {
  return (
    <motion.div variants={staggerChild} className={className} {...props}>
      {children}
    </motion.div>
  );
}

/** Counts up to `value` once visible; renders the final value immediately with reduced motion. */
export function AnimatedNumber({
  value,
  format = (n) => Math.round(n).toLocaleString(),
}: {
  value: number;
  format?: (n: number) => string;
}) {
  const ref = React.useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  const reduce = useReducedMotion();
  const from = React.useRef(0);
  React.useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (reduce || !inView) {
      node.textContent = format(value);
      return;
    }
    const controls = animate(from.current, value, {
      duration: 0.9,
      ease: easeOut,
      onUpdate: (v) => {
        node.textContent = format(v);
      },
    });
    from.current = value;
    return () => controls.stop();
  }, [value, inView, reduce, format]);
  // Server and client render the same initial text (no hydration mismatch); the effect sets the real value.
  return (
    <span ref={ref} className="tabular-nums">
      {format(0)}
    </span>
  );
}
