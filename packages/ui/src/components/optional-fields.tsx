'use client';

import { Badge } from '@astryxdesign/core/Badge';
import { Collapsible } from '@astryxdesign/core/Collapsible';
import { Divider } from '@astryxdesign/core/Divider';
import { Text } from '@astryxdesign/core/Text';
import { useLocale, useTranslations } from 'next-intl';
import * as React from 'react';
import { cn } from '../lib/utils';

/**
 * The fields most people leave empty, behind one "More details" row, so a form opens on its essentials. Put the
 * required fields and the one or two everyone fills above it, everything else inside.
 *
 * - The fields stay mounted while closed (react-hook-form keeps them registered), and the section opens by itself as
 *   soon as one of them is invalid, so an error is never hidden.
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
  const region = React.useRef<HTMLDivElement>(null);
  const setOpen = (next: boolean) => {
    setInner(next);
    onOpenChange?.(next);
  };
  const reveal = React.useEffectEvent(() => {
    if (!open) setOpen(true);
  });

  // An invalid field inside opens the section: on submit (`aria-invalid` set by the Astryx input) or a native `invalid`.
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
      ref={region}
      data-slot="optional-fields"
      className={cn('min-w-0', className)}
      onInvalidCapture={() => !open && setOpen(true)}
    >
      <Divider />
      <Collapsible
        chevronPosition="start"
        isOpen={open}
        onOpenChange={setOpen}
        trigger={
          <span className="flex min-w-0 items-center gap-1.5">
            <Text weight="medium" color="accent" className="shrink-0">
              {label ?? t('label')}
            </Text>
            {/* Zero intrinsic width: a long hint truncates instead of widening the form on a phone. */}
            <span className="w-0 flex-1 truncate">
              {hint && !open ? <Text color="secondary">{hint}</Text> : null}
            </span>
            {filled > 0 && !open && <Badge variant="blue" label={t('filled', { count: filled })} />}
          </span>
        }
      >
        <div className={contentClassName}>{children}</div>
      </Collapsible>
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
