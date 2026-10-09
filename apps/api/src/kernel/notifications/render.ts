import { isLocale, type Locale, type Messages } from '@isbp/i18n';
import { deepMerge, loadCoreMessages } from '@isbp/i18n/messages';
import { localize, type NotificationParam } from '@isbp/sdk/server';
import { IntlMessageFormat } from 'intl-messageformat';
import { moduleMessages } from '../../generated/module-messages';

const catalogs = new Map<string, Promise<Messages>>();

/** The module's own namespace (`core` lives inside the core catalogs; modules ship their own). */
async function loadCatalog(moduleId: string, locale: Locale): Promise<Messages> {
  if (moduleId === 'core') return ((await loadCoreMessages(locale)).core ?? {}) as Messages;
  const loaders = moduleMessages[moduleId];
  if (!loaders) return {};
  const en = (await loaders.en()).default;
  return locale === 'en' ? en : deepMerge(en, (await loaders[locale]()).default);
}

function catalog(moduleId: string, locale: Locale): Promise<Messages> {
  const key = `${moduleId}:${locale}`;
  let hit = catalogs.get(key);
  if (!hit) {
    hit = loadCatalog(moduleId, locale).catch(() => ({}));
    catalogs.set(key, hit);
  }
  return hit;
}

function lookup(messages: Messages, path: string): string | undefined {
  let cur: string | Messages | undefined = messages;
  for (const seg of path.split('.')) {
    if (!cur || typeof cur === 'string') return undefined;
    cur = cur[seg];
  }
  return typeof cur === 'string' ? cur : undefined;
}

/** `core.approval.assigned` → module `core`, catalog key `notifications.approval_assigned`. */
export function notificationKey(type: string): { moduleId: string; key: string } {
  const [moduleId = '', ...rest] = type.split('.');
  return { moduleId, key: `notifications.${rest.join('_').replaceAll('-', '_')}` };
}

export interface RenderOptions {
  locale: string;
  timezone?: string;
}

/**
 * Date formatters by locale and time zone: building one is far more costly than formatting with it, and every
 * catalog lookup formats its (usually empty) parameters. Bounded, since zones are few and entries are cheap to rebuild.
 */
const dateFormats = new Map<string, Intl.DateTimeFormat>();
function dateFormatOf(locale: string, timezone: string | undefined): Intl.DateTimeFormat {
  const zone = timezone || 'UTC';
  const key = `${locale}\u0000${zone}`;
  let fmt = dateFormats.get(key);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: zone });
    if (dateFormats.size >= 256) dateFormats.clear();
    dateFormats.set(key, fmt);
  }
  return fmt;
}

function formatParams(params: Record<string, NotificationParam>, opts: RenderOptions) {
  const out: Record<string, string | number> = {};
  const dateFmt = dateFormatOf(opts.locale, opts.timezone);
  for (const [k, v] of Object.entries(params)) {
    if (v instanceof Date) out[k] = dateFmt.format(v);
    else if (v === null || v === undefined) out[k] = '';
    else if (typeof v === 'object') out[k] = localize(v, opts.locale);
    else out[k] = v;
  }
  return out;
}

/**
 * Compiled message formatters by locale and message text: compiling one is the costly part of formatting, and a
 * compiled formatter depends on nothing else. Catalog messages are a fixed set, so the cache is bounded in practice.
 */
const messageFormats = new Map<string, IntlMessageFormat>();
function messageFormatOf(message: string, locale: string): IntlMessageFormat {
  const key = `${locale}\u0000${message}`;
  let compiled = messageFormats.get(key);
  if (!compiled) {
    compiled = new IntlMessageFormat(message, locale);
    if (messageFormats.size >= 5_000) messageFormats.clear();
    messageFormats.set(key, compiled);
  }
  return compiled;
}

function format(message: string, locale: string, values: Record<string, string | number>): string {
  try {
    return String(messageFormatOf(message, locale).format(values));
  } catch {
    return message;
  }
}

/** Renders a module catalog string (`<key>` inside the module namespace) for one locale. */
export async function renderText(
  moduleId: string,
  key: string,
  params: Record<string, NotificationParam>,
  opts: RenderOptions,
): Promise<string | null> {
  const locale: Locale = isLocale(opts.locale) ? opts.locale : 'en';
  const message = lookup(await catalog(moduleId, locale), key);
  return message === undefined ? null : format(message, locale, formatParams(params, opts));
}

/**
 * Title and body of a notification type in the recipient's locale (English fallback, then the type
 * name, so a missing translation never produces an empty notification).
 */
export async function renderNotification(
  type: string,
  params: Record<string, NotificationParam>,
  opts: RenderOptions,
): Promise<{ title: string; body: string | null }> {
  const { moduleId, key } = notificationKey(type);
  const title = (await renderText(moduleId, `${key}.title`, params, opts)) ?? type;
  const body = await renderText(moduleId, `${key}.body`, params, opts);
  return { title: title.slice(0, 300), body: body ? body.slice(0, 5_000) : null };
}
