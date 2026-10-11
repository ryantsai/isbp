'use client';

import { Badge } from '@astryxdesign/core/Badge';
import { Tab, TabList } from '@astryxdesign/core/TabList';
import { usePathname, useSearchParams } from 'next/navigation';
import type * as React from 'react';
import { cn } from '../lib/utils';

export interface SectionTab {
  /** Where the tab goes: a path (`/scheduler/jobs`) or a path with a query (`/itam/software?tab=approved`). */
  href: string;
  label: string;
  icon?: React.ReactNode;
  /** A count shown after the label (e.g. open conflicts). */
  count?: number;
  /**
   * `prefix` (default): the tab stays active on pages below its path (`/scheduler/jobs/JOB-1` → Jobs); the longest
   * matching path wins. `exact`: only on its own path.
   */
  match?: 'exact' | 'prefix';
}

function parse(href: string) {
  const [path = '', query = ''] = href.split('?');
  return { path, params: new URLSearchParams(query) };
}

/** The href of the active tab: the longest matching path, then the most matching query parameters. */
export function activeSectionTab(
  items: readonly SectionTab[],
  pathname: string,
  search: URLSearchParams,
): string | undefined {
  let best: { href: string; score: number } | undefined;
  for (const item of items) {
    const { path, params } = parse(item.href);
    const pathOk =
      pathname === path ||
      (item.match !== 'exact' && pathname.startsWith(path.endsWith('/') ? path : `${path}/`));
    if (!pathOk) continue;
    let queryOk = true;
    params.forEach((v, k) => {
      if (search.get(k) !== v) queryOk = false;
    });
    if (!queryOk) continue;
    const score = path.length * 100 + [...params.keys()].length;
    if (!best || score > best.score) best = { href: item.href, score };
  }
  return best?.href;
}

/**
 * Link tabs for the sections of one area (Overview | Jobs | Runs), placed right under the `PageHeader`. Each tab is
 * its own URL, so deep links and list state keep working. Use instead of header buttons or sidebar entries that lead
 * to sibling pages. For in-page panels use `TabList` + `Tab`.
 */
export function SectionTabs({
  items,
  label,
  value,
  className,
}: {
  items: readonly SectionTab[];
  /** Accessible name of the navigation (e.g. "Scheduled jobs sections"). */
  label: string;
  /** The active tab's href, when it can't be derived from the URL. */
  value?: string;
  className?: string;
}) {
  const pathname = usePathname();
  const search = useSearchParams();
  const active = value ?? activeSectionTab(items, pathname, new URLSearchParams(search.toString()));
  return (
    <TabList
      aria-label={label}
      value={active ?? ''}
      onChange={() => {}}
      hasDivider
      className={cn('-mt-1 mb-4', className)}
    >
      {items.map((item) => (
        <Tab
          key={item.href}
          value={item.href}
          href={item.href}
          label={item.label}
          icon={item.icon}
          endContent={item.count != null ? <Badge label={item.count} /> : undefined}
        />
      ))}
    </TabList>
  );
}
