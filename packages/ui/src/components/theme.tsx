'use client';

import {
  createContext,
  type ReactNode,
  use,
  useCallback,
  useEffect,
  useMemo,
  useSyncExternalStore,
} from 'react';

export type Theme = 'light' | 'dark' | 'system';
const STORAGE_KEY = 'theme';
const EVENT = 'isbp-theme-change';

/**
 * Inline script for <head> (rendered by a Server Component with the CSP nonce) that applies the stored/system theme
 * before first paint: no flash, no client-rendered <script>. It sets the three things the page reads: Astryx's
 * `data-theme` (drives `light-dark()` tokens and native controls), the `.dark` class (Tailwind's `dark:` variant)
 * and `color-scheme`.
 */
export const themeInitScript = `(function(){try{var t=localStorage.getItem('${STORAGE_KEY}')||'system';var d=t==='dark'||(t==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);var e=document.documentElement;e.classList.toggle('dark',d);e.classList.toggle('light',!d);e.style.colorScheme=d?'dark':'light';e.setAttribute('data-theme',d?'dark':'light')}catch(_){}})()`;

interface ThemeContextValue {
  /** What the person chose (`system` follows the OS). Pass it to Astryx `<Theme mode>`. */
  theme: Theme;
  resolvedTheme: 'light' | 'dark';
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

const mq = () => window.matchMedia('(prefers-color-scheme: dark)');

function subscribe(onChange: () => void) {
  const query = mq();
  window.addEventListener('storage', onChange);
  window.addEventListener(EVENT, onChange);
  query.addEventListener('change', onChange);
  return () => {
    window.removeEventListener('storage', onChange);
    window.removeEventListener(EVENT, onChange);
    query.removeEventListener('change', onChange);
  };
}

function readStored(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === 'light' || stored === 'dark' ? stored : 'system';
  } catch {
    return 'system'; // storage unavailable
  }
}

function apply(resolved: 'light' | 'dark') {
  const root = document.documentElement;
  // Suppress transitions for one frame so colours don't animate on theme change.
  const style = document.createElement('style');
  style.textContent = '*,*::before,*::after{transition:none!important}';
  document.head.appendChild(style);
  root.classList.toggle('dark', resolved === 'dark');
  root.classList.toggle('light', resolved === 'light');
  root.style.colorScheme = resolved;
  root.setAttribute('data-theme', resolved);
  requestAnimationFrame(() => requestAnimationFrame(() => style.remove()));
  // A background tab draws no frames: without this, every transition would stay off until the tab is shown.
  setTimeout(() => style.remove(), 100);
}

/**
 * Light / dark / system, remembered per device. The stored choice and the OS preference are read with
 * `useSyncExternalStore`, so the first client render matches the server (`system`) and React re-renders with the real
 * values before paint: the Astryx `<Theme mode>` never flashes the wrong mode.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const theme = useSyncExternalStore(subscribe, readStored, (): Theme => 'system');
  const systemDark = useSyncExternalStore(
    subscribe,
    () => mq().matches,
    () => false,
  );
  const resolvedTheme: 'light' | 'dark' = theme === 'system' ? (systemDark ? 'dark' : 'light') : theme;

  useEffect(() => {
    apply(resolvedTheme);
  }, [resolvedTheme]);

  const setTheme = useCallback((next: Theme) => {
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* storage unavailable */
    }
    window.dispatchEvent(new Event(EVENT));
  }, []);

  const value = useMemo(() => ({ theme, resolvedTheme, setTheme }), [theme, resolvedTheme, setTheme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = use(ThemeContext);
  if (!ctx) throw new Error('useTheme() must be used inside <ThemeProvider>');
  return ctx;
}
