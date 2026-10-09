'use client';

import { useCallback, useSyncExternalStore } from 'react';

/*
 * "Show field keys": a per-viewer preference (this browser only) of the form builder and the custom fields page.
 * Keys are where answers are stored; people building a form work with labels, so keys stay hidden until asked for.
 * Storage can be unavailable (private windows, blocked site data): the choice then lasts until the page reloads.
 */

const STORAGE_KEY = 'isbp.fields.showKeys';
const listeners = new Set<() => void>();
let memory = false;

function read(): boolean {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored === null ? memory : stored === '1';
  } catch {
    return memory;
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

/** Whether to show field keys, and a setter shared by every component using it. Off on the server. */
export function useShowFieldKeys(): [boolean, (show: boolean) => void] {
  const show = useSyncExternalStore(subscribe, read, () => false);
  const set = useCallback((next: boolean) => {
    memory = next;
    try {
      window.localStorage.setItem(STORAGE_KEY, next ? '1' : '0');
    } catch {
      try {
        window.localStorage.removeItem(STORAGE_KEY);
      } catch {
        // No storage at all: `memory` holds the choice.
      }
    }
    for (const l of listeners) l();
  }, []);
  return [show, set];
}
