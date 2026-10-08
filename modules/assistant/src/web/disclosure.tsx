'use client';

import { cn } from '@isbp/ui';
import { ChevronDownIcon } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Component, type ReactNode, useId, useState } from 'react';

/** Accessible disclosure: a heading with a button (`aria-expanded`) that controls a labelled region. */
export function Disclosure({
  title,
  icon,
  meta,
  defaultOpen = false,
  level = 4,
  children,
}: {
  title: ReactNode;
  icon?: ReactNode;
  meta?: ReactNode;
  defaultOpen?: boolean;
  level?: 3 | 4;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  const reduce = useReducedMotion();
  const Heading = level === 3 ? 'h3' : 'h4';
  return (
    <section className="border-t">
      <Heading className="m-0">
        <button
          type="button"
          id={`${id}-trigger`}
          aria-expanded={open}
          aria-controls={`${id}-panel`}
          onClick={() => setOpen((o) => !o)}
          className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm font-medium outline-none transition-colors hover:bg-accent/50 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-inset motion-reduce:transition-none"
        >
          {icon && <span className="text-muted-foreground [&_svg]:size-4">{icon}</span>}
          <span className="min-w-0 flex-1 truncate">{title}</span>
          {meta}
          <ChevronDownIcon
            className={cn(
              'size-4 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none',
              open && 'rotate-180',
            )}
            aria-hidden
          />
        </button>
      </Heading>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            id={`${id}-panel`}
            role="region"
            aria-labelledby={`${id}-trigger`}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: reduce ? 0 : 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <div className="min-w-0 px-4 pb-4">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

/** Keeps a module's preview from taking the whole change set page down when it can't render a value. */
export class PreviewBoundary extends Component<
  { fallback: ReactNode; children: ReactNode },
  { failed: boolean }
> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
