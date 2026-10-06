/** Supported UI locales. Order matters: it is the order shown in language pickers. */
export const locales = ['en', 'zh-TW', 'ja-JP'] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = 'en';

/** Locale names in their own language (never translated). */
export const localeLabels: Record<Locale, string> = {
  en: 'English',
  'zh-TW': '繁體中文（台灣）',
  'ja-JP': '日本語',
};

/** BCP 47 tag for `<html lang>` and Intl APIs. */
export const htmlLang: Record<Locale, string> = {
  en: 'en',
  'zh-TW': 'zh-Hant-TW',
  'ja-JP': 'ja',
};

export const LOCALE_COOKIE = 'isbp_locale';

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (locales as readonly string[]).includes(value);
}

/** Maps loose tags (zh-Hant, zh-HK, ja, en-GB …) onto a supported locale. */
export function normalizeLocale(tag: string | null | undefined): Locale | null {
  if (!tag) return null;
  const t = tag.trim().toLowerCase();
  if (!t) return null;
  if (t.startsWith('zh')) {
    // Simplified-only tags fall back to English rather than mislabelling Traditional text.
    if (t.includes('hans') || t === 'zh-cn' || t === 'zh-sg') return null;
    return 'zh-TW';
  }
  if (t.startsWith('ja')) return 'ja-JP';
  if (t.startsWith('en')) return 'en';
  return null;
}

/** Picks the best locale from an Accept-Language header, honouring q-values. */
export function negotiateLocale(acceptLanguage: string | null | undefined): Locale {
  if (!acceptLanguage) return defaultLocale;
  const ranked = acceptLanguage
    .split(',')
    .map((part, index) => {
      const [tag = '', ...params] = part.trim().split(';');
      const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
      return { tag, q: q ? Number(q.slice(2)) || 0 : 1, index };
    })
    .filter((x) => x.q > 0)
    .sort((a, b) => b.q - a.q || a.index - b.index);
  for (const { tag } of ranked) {
    const locale = normalizeLocale(tag);
    if (locale) return locale;
  }
  return defaultLocale;
}

export type Messages = { [key: string]: string | Messages };

/** Flattens a nested catalog into dotted keys (used by the catalog parity test). */
export function flattenMessages(messages: Messages, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(messages)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') out[path] = value;
    else Object.assign(out, flattenMessages(value, path));
  }
  return out;
}
