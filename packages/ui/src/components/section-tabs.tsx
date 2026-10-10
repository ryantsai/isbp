'use client';

import { motion } from 'motion/react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import type * as React from 'react';
import { cn } from '../lib/utils';
import { spring } from './motion';

export interface SectionTab {
  /** Where the tab goes: a path (`/scheduler/jobs`) or a path with a query (`/itam/software?tab=approved`). */
  href: string;
  label: React.ReactNode;
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
 * its own URL, so deep links and list state keep working; the indicator slides between tabs. Use instead of header
 * buttons or sidebar entries that lead to sibling pages. For in-page panels use `Tabs`.
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
    <nav aria-label={label} className={cn('-mt-1 mb-4 border-b', className)}>
      <ul className="-mb-px flex max-w-full gap-1 overflow-x-auto">
        {items.map((item) => {
          const current = item.href === active;
          return (
            <li key={item.href} className="shrink-0">
              <Link
                href={item.href}
                aria-current={current ? 'page' : undefined}
                className={cn(
                  "relative inline-flex h-9 items-center gap-1.5 px-2.5 text-sm font-medium whitespace-nowrap text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
                  current && 'text-foreground',
                )}
              >
                {item.icon}
                {item.label}
                {item.count != null && (
                  <span className="rounded-full bg-muted px-1.5 text-xs text-muted-foreground tabular-nums">
                    {item.count}
                  </span>
                )}
                {current && (
                  <motion.span
                    layoutId={`section-tabs:${label}`}
                    className="absolute inset-x-1 bottom-0 h-0.5 rounded-full bg-primary"
                    transition={spring.indicator}
                  />
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
