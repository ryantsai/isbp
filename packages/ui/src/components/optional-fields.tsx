'use client';

import { ChevronRightIcon } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import * as React from 'react';
import { cn } from '../lib/utils';
import { Collapse } from './motion';

/**
 * The fields most people leave empty, behind one "More details" row, so a form opens on its essentials. Put the
 * required fields and the one or two everyone fills above it, everything else inside.
 *
 * - The fields stay mounted while closed (react-hook-form keeps them registered, `inert` keeps them out of the tab
 *   order), and the section opens by itself as soon as one of them is invalid, so an error is never hidden.
 * - `hint` names what is inside ("Purchase, warranty, notes") and `filled` counts the fields that hold a value; both
 *   show while it is closed, so an edit form never hides that data exists.
 */
export function OptionalFields({
  children,
  label,
  hint,
  filled = 0,
  defaultOpen = false,
  open: openProp,
  onOpenChange,
  className,
  contentClassName = 'grid gap-4 pt-3',
}: {
  children: React.ReactNode;
  /** Defaults to "More details". */
  label?: React.ReactNode;
  hint?: React.ReactNode;
  filled?: number;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
  contentClassName?: string;
}) {
  const t = useTranslations('ui.optionalFields');
  const [inner, setInner] = React.useState(defaultOpen);
  const open = openProp ?? inner;
  const id = React.useId();
  const region = React.useRef<HTMLDivElement>(null);
  const setOpen = (next: boolean) => {
    setInner(next);
    onOpenChange?.(next);
  };
  const reveal = React.useEffectEvent(() => {
    if (!open) setOpen(true);
  });

  // An invalid field inside opens the section: on submit (aria-invalid set by FormControl) or a native `invalid`.
  React.useEffect(() => {
    const el = region.current;
    if (!el) return;
    const check = () => {
      if (el.querySelector('[aria-invalid="true"]')) reveal();
    };
    check();
    const observer = new MutationObserver(check);
    observer.observe(el, { subtree: true, attributes: true, attributeFilter: ['aria-invalid'] });
    return () => observer.disconnect();
  }, []);

  return (
    <div
      data-slot="optional-fields"
      className={cn('min-w-0 border-t border-dashed pt-1.5', className)}
      onInvalidCapture={() => !open && setOpen(true)}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
        className="group flex w-full min-w-0 items-center gap-1.5 rounded-sm py-1 text-left text-[13px] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <ChevronRightIcon
          aria-hidden
          className={cn(
            'size-4 shrink-0 text-muted-foreground transition-transform duration-(--motion-base) ease-move motion-reduce:transition-none',
            open && 'rotate-90',
          )}
        />
        <span className="shrink-0 font-medium text-primary group-hover:underline group-hover:underline-offset-4">
          {label ?? t('label')}
        </span>
        {/* Zero intrinsic width: a long hint truncates instead of widening the form on a phone. */}
        <span className="w-0 flex-1 truncate text-muted-foreground">{hint && !open ? hint : null}</span>
        {filled > 0 && !open && (
          <span className="shrink-0 rounded-[3px] bg-primary/10 px-1.5 text-xs font-medium text-primary tabular-nums">
            {t('filled', { count: filled })}
          </span>
        )}
      </button>
      <div ref={region}>
        <Collapse id={id} open={open} contentClassName={contentClassName}>
          {children}
        </Collapse>
      </div>
    </div>
  );
}

/** How many of `values` hold something (for `filled`): non-empty strings, numbers, true, non-empty lists. */
export function countFilled(...values: unknown[]): number {
  return values.filter((v) =>
    Array.isArray(v) ? v.length > 0 : typeof v === 'string' ? v.trim() !== '' : v != null && v !== false,
  ).length;
}

/**
 * Joins field labels for `hint` the way the UI language lists them ("Vendor, Invoice number" / "廠商、發票號碼"), so a
 * hint needs no catalog string of its own: `hint={list([t('fields.vendor'), t('fields.invoice')])}`.
 */
export function useFieldList(): (labels: readonly string[]) => string {
  const locale = useLocale();
  const separator = locale.startsWith('zh') || locale.startsWith('ja') ? '、' : ', ';
  return (labels) => labels.join(separator);
}
