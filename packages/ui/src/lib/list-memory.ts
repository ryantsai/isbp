/**
 * Remembers each list's last URL state (filters, page, sort) and the row a person opened, per browser tab
 * (`sessionStorage`), so a detail page's back link returns to the list as it was and highlights that row.
 * Storage can be unavailable (private mode, blocked site data): every call is best-effort.
 */

const LIST = 'isbp:list:';
const OPENED = 'isbp:opened:';

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

/** The path part of an href (`/itsm?view=mine` → `/itsm`). */
export function pathOf(href: string): string {
  const i = href.search(/[?#]/);
  return i === -1 ? href : href.slice(0, i);
}

/** Stores a list's current query string (without `?`); an empty one forgets it. */
export function rememberListQuery(path: string, query: string): void {
  try {
    const s = storage();
    if (!s) return;
    if (query) s.setItem(LIST + path, query);
    else s.removeItem(LIST + path);
  } catch {
    // best effort
  }
}

/**
 * The href to go back to a list: the list path with its remembered query string, or `href` unchanged when nothing
 * is remembered (or `href` already carries its own query).
 */
export function recallListHref(href: string): string {
  if (href.includes('?')) return href;
  try {
    const q = storage()?.getItem(LIST + pathOf(href));
    return q ? `${href}?${q}` : href;
  } catch {
    return href;
  }
}

/** Remembers which row of a list was opened (by row id), so the list can highlight it on return. */
export function rememberOpenedRow(listPath: string, rowId: string): void {
  try {
    storage()?.setItem(OPENED + pathOf(listPath), rowId);
  } catch {
    // best effort
  }
}

/** Returns and forgets the row opened from a list. */
export function takeOpenedRow(listPath: string): string | null {
  try {
    const s = storage();
    const key = OPENED + pathOf(listPath);
    const id = s?.getItem(key) ?? null;
    if (id) s?.removeItem(key);
    return id;
  } catch {
    return null;
  }
}
