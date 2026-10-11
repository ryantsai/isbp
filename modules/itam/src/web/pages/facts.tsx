'use client';

import { MetadataList, MetadataListItem } from '@astryxdesign/core/MetadataList';
import { Children, type ReactNode } from 'react';

/** One label/value pair of a record's facts; an empty value reads as "—". */
export function Fact({ label, children }: { label: string; children: ReactNode }) {
  return <MetadataListItem label={label}>{children ?? '—'}</MetadataListItem>;
}

/**
 * A record's facts as label/value rows in two columns (one on a phone). Two `MetadataList`s side by side rather than
 * one multi-column list: Astryx stacks the labels on top in a multi-column list, and a record page wants them
 * beside their value.
 */
export function Facts({ children }: { children: ReactNode }) {
  const items = Children.toArray(children);
  const half = Math.ceil(items.length / 2);
  return (
    <div className="grid gap-x-8 gap-y-2 sm:grid-cols-2">
      <MetadataList>{items.slice(0, half)}</MetadataList>
      <MetadataList>{items.slice(half)}</MetadataList>
    </div>
  );
}
