import en from '../../messages/en.json';
import ja from '../../messages/ja-JP.json';
import zh from '../../messages/zh-TW.json';
import type { ChatLocale } from '../contracts';

/**
 * Server-side texts (builtin replies, chat answers, KB draft headings, triage rationales) come from the
 * module's own catalogs under `server.*`, so they ship in en, zh-TW and ja-JP like every UI string.
 * They use simple `{name}` arguments only.
 */
type Catalog = typeof en;
type ServerTexts = Catalog['server'];
type Section = keyof ServerTexts;

const catalogs: Record<ChatLocale, Catalog> = { en, 'zh-TW': zh as Catalog, 'ja-JP': ja as Catalog };

export function text<S extends Section>(
  locale: ChatLocale,
  section: S,
  key: keyof ServerTexts[S] & string,
  params: Record<string, string | number> = {},
): string {
  const table = (catalogs[locale]?.server ?? en.server)[section] as Record<string, string>;
  const template = table[key] ?? (en.server[section] as Record<string, string>)[key] ?? key;
  return template.replace(/\{(\w+)\}/g, (m, name: string) => (name in params ? String(params[name]) : m));
}

/** Locale-bound shorthand: `const t = texts('ja-JP'); t('chat', 'found')`. */
export function texts(locale: ChatLocale) {
  return <S extends Section>(
    section: S,
    key: keyof ServerTexts[S] & string,
    params?: Record<string, string | number>,
  ) => text(locale, section, key, params);
}

/** A list joined the way each language does it ("A, B and C" / 「A、B 和 C」 / 「A、B、C」). */
export function joinList(locale: ChatLocale, items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  if (locale === 'en')
    return items.length === 2
      ? `${items[0]} and ${items[1]}`
      : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
  return items.join('、');
}

/** Joins sentences: a space in English, nothing between CJK sentences (they end in 。). */
export function sentences(locale: ChatLocale, ...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(locale === 'en' ? ' ' : '');
}
