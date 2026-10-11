'use client';

import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { Selector } from '@astryxdesign/core/Selector';
import type { ReactNode } from 'react';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  icon?: ReactNode;
}

/**
 * One choice out of a few, as Astryx `SegmentedControl` (a view switch, a range, a mode). Astryx truncates segment
 * labels when they don't fit ("Perm…", "7 …" at 375 px), so with more than three options the same choice is a
 * `Selector` below `sm`. Use this instead of `SegmentedControl` for any switch with four or more options; for up to
 * three options (or when the choice filters a list that also has tabs semantics) use `SegmentedControl` directly.
 * Radix-style `tab` semantics are not offered: this is a radio group. A real tab strip is `TabList`.
 */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  className,
  disabled,
}: {
  value: T;
  onChange: (value: T) => void;
  options: SegmentedOption<T>[];
  label: string;
  className?: string;
  disabled?: boolean;
}) {
  const wide = (
    <SegmentedControl
      label={label}
      value={value}
      onChange={(next) => onChange(next as T)}
      isDisabled={disabled}
      className={className}
    >
      {options.map((o) => (
        <SegmentedControlItem key={o.value} value={o.value} label={o.label} icon={o.icon} />
      ))}
    </SegmentedControl>
  );
  if (options.length <= 3) return wide;
  return (
    <>
      <div className="hidden sm:block">{wide}</div>
      <div className="sm:hidden">
        <Selector
          label={label}
          isLabelHidden
          value={value}
          onChange={(next) => onChange(next as T)}
          options={options.map((o) => ({ value: o.value, label: o.label }))}
          isDisabled={disabled}
        />
      </div>
    </>
  );
}
