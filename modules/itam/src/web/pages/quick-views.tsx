'use client';

import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { Selector } from '@astryxdesign/core/Selector';

/**
 * The quick views of a list ("All · Deployed · In stock…"): they only filter the list, so they are a segmented control
 * (not tabs: there is no panel to switch), and on a phone, where they would not fit in one row, a selector.
 */
export function QuickViews({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly { value: string; label: string }[];
}) {
  return (
    <>
      <div className="hidden sm:block">
        <SegmentedControl label={label} value={value} onChange={onChange}>
          {options.map((o) => (
            <SegmentedControlItem key={o.value} value={o.value} label={o.label} />
          ))}
        </SegmentedControl>
      </div>
      <div className="sm:hidden">
        <Selector label={label} isLabelHidden value={value} onChange={onChange} options={[...options]} />
      </div>
    </>
  );
}
