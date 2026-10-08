/**
 * "Require a new password at next sign-in" (set by an administrator): people are sent to the Password card of
 * Profile & preferences with `?password=required`, and back to where they were going (`next`) once it's changed.
 */
export const PASSWORD_REQUIRED_PARAM = 'password';

/** Same-origin app paths only (no open redirects, no API routes). */
export function safeNextPath(next: string | null | undefined): string | null {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return null;
  if (next.startsWith('/api/') || next.startsWith('/login')) return null;
  return next.slice(0, 1000);
}

export function passwordChangeHref(next?: string | null): string {
  const target = safeNextPath(next);
  const params = new URLSearchParams({ [PASSWORD_REQUIRED_PARAM]: 'required' });
  if (target && target !== '/' && !target.startsWith('/settings')) params.set('next', target);
  return `/settings?${params.toString()}`;
}
