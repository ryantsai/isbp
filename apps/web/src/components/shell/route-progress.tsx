'use client';

import { NavProgress } from '@isbp/ui/motion';
import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useSyncExternalStore } from 'react';

/* A tiny store: "a navigation started". Links start it (a capture-phase click listener), code that calls
   `router.push` starts it with `markNavigating()`, and the next URL change ends it. */
let pending = false;
let timer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function set(next: boolean) {
  clearTimeout(timer);
  // A navigation that never lands (an error page, a cancelled click) stops showing progress after 10 s.
  if (next) timer = setTimeout(() => set(false), 10_000);
  if (pending !== next) {
    pending = next;
    emit();
  }
}

/** Call before `router.push` so the top bar shows while the next page loads. */
export function markNavigating() {
  set(true);
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** Whether a click on this anchor is an in-app navigation to another page. */
function isPageLink(e: MouseEvent): boolean {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return false;
  const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
  if (!a || (a.target && a.target !== '_self') || a.hasAttribute('download')) return false;
  const url = new URL(a.href, window.location.href);
  if (url.origin !== window.location.origin || url.pathname.startsWith('/api/')) return false;
  return url.pathname !== window.location.pathname || url.search !== window.location.search;
}

/**
 * The 2 px bar at the top of the window while a page loads after a click (shown only after 120 ms, so fast
 * navigations show nothing).
 */
export function RouteProgress() {
  const pathname = usePathname();
  const search = useSearchParams();
  const active = useSyncExternalStore(
    subscribe,
    () => pending,
    () => false,
  );
  useEffect(() => {
    set(false);
  }, [pathname, search]);
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (isPageLink(e)) set(true);
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, []);
  return <NavProgress active={active} fixed />;
}
