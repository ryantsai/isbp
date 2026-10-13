import { users } from '@isbp/db/schema';
import { type Db, ErrorCodes, HttpError } from '@isbp/sdk/server';
import { inArray } from 'drizzle-orm';
import en from '../../messages/en.json';
import ja from '../../messages/ja-JP.json';
import zh from '../../messages/zh-TW.json';

export const MEETING_ENTITY = 'meetings.meeting';
export const ITEM_ENTITY = 'meetings.action-item';

export const meetingHref = (reference: string) => `/meetings/${reference}`;
export const itemHref = (reference: string, itemId: string) => `/meetings/${reference}?item=${itemId}`;

export function notFound(what: 'meeting' | 'item' = 'meeting'): HttpError {
  return new HttpError(
    404,
    ErrorCodes.NOT_FOUND,
    what === 'meeting' ? 'Meeting not found' : 'Action item not found',
  );
}

export function forbidden(message: string): HttpError {
  return new HttpError(403, ErrorCodes.FORBIDDEN, message);
}

export function invalid(path: string, message: string, details: Record<string, unknown> = {}): HttpError {
  return new HttpError(400, ErrorCodes.VALIDATION_FAILED, message, {
    issues: [{ path, message }],
    ...details,
  });
}

export function invalidState(
  message: string,
  reason: string,
  details: Record<string, unknown> = {},
): HttpError {
  return new HttpError(409, ErrorCodes.INVALID_STATE, message, { reason, ...details });
}

export interface PersonInfo {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  email: string;
  username: string;
  status: string;
  timezone: string;
  locale: string;
}

export const personRef = (p: PersonInfo | null | undefined) =>
  p ? { id: p.id, displayName: p.displayName, avatarUrl: p.avatarUrl } : null;

/** People by id in one query (ids may repeat or be null). */
export async function peopleByIds(
  db: Db,
  ids: readonly (string | null | undefined)[],
): Promise<Map<string, PersonInfo>> {
  const wanted = [...new Set(ids.filter((x): x is string => Boolean(x)))];
  if (!wanted.length) return new Map();
  const rows = await db
    .select({
      id: users.id,
      displayName: users.displayName,
      avatarUrl: users.avatarUrl,
      email: users.email,
      username: users.username,
      status: users.status,
      timezone: users.timezone,
      locale: users.locale,
    })
    .from(users)
    .where(inArray(users.id, wanted));
  return new Map(rows.map((r) => [r.id, r]));
}

/** Postgres error code of a (possibly wrapped) driver error. */
export function pgCode(err: unknown): string | null {
  let e: unknown = err;
  for (let i = 0; i < 3 && e; i++) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) return code;
    e = (e as { cause?: unknown }).cause;
  }
  return null;
}

/* ── server texts (the catalogs' `server.*`, simple `{name}` arguments) ── */

export type TextLocale = 'en' | 'zh-TW' | 'ja-JP';
type Tree = { [key: string]: string | Tree };
const catalogs: Record<TextLocale, Tree> = { en: en as Tree, 'zh-TW': zh as Tree, 'ja-JP': ja as Tree };

export const textLocale = (l: string | null | undefined): TextLocale =>
  l === 'zh-TW' || l === 'ja-JP' ? l : 'en';

export function text(locale: TextLocale, path: string, params: Record<string, string | number> = {}): string {
  const find = (tree: Tree) => {
    let cur: string | Tree | undefined = tree;
    for (const seg of path.split('.')) cur = cur && typeof cur === 'object' ? cur[seg] : undefined;
    return typeof cur === 'string' ? cur : undefined;
  };
  const template = find(catalogs[locale]) ?? find(catalogs.en) ?? path;
  return template.replace(/\{(\w+)\}/g, (m, name: string) => (name in params ? String(params[name]) : m));
}

export const LANGUAGE_NAMES: Record<TextLocale, string> = {
  en: 'English',
  'zh-TW': 'Traditional Chinese as used in Taiwan',
  'ja-JP': 'Japanese',
};
