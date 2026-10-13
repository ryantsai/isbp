/**
 * Text the server writes for people (builtin status drafts, builtin report narratives, the Markdown export) comes
 * from the module's own catalogs, so it ships in en, zh-TW and ja-JP like every UI string. Arguments are `{name}`
 * and the ICU plural form `{name, plural, =0 {…} one {# …} other {# …}}` (no select, no nesting beyond that).
 */
import type { LocalizedText } from '@isbp/sdk';
import en from '../../messages/en.json';
import ja from '../../messages/ja-JP.json';
import zh from '../../messages/zh-TW.json';

export type TextLocale = 'en' | 'zh-TW' | 'ja-JP';

type Tree = { [key: string]: string | Tree };
const catalogs: Record<TextLocale, Tree> = { en: en as Tree, 'zh-TW': zh as Tree, 'ja-JP': ja as Tree };

export const TEXT_LOCALES: readonly TextLocale[] = ['en', 'zh-TW', 'ja-JP'];

export function textLocale(locale: string | null | undefined): TextLocale {
  return TEXT_LOCALES.includes(locale as TextLocale) ? (locale as TextLocale) : 'en';
}

function lookup(tree: Tree, path: string): string | undefined {
  let cur: string | Tree | undefined = tree;
  for (const seg of path.split('.')) {
    if (!cur || typeof cur === 'string') return undefined;
    cur = cur[seg];
  }
  return typeof cur === 'string' ? cur : undefined;
}

/** `{n, plural, =0 {…} one {# …} other {# …}}`: picks the case for `n` (exact, then the locale's category, then other). */
function plural(body: string, n: number, locale: TextLocale): string {
  const cases = new Map<string, string>();
  const re = /\s*(=\d+|zero|one|two|few|many|other)\s*\{([^{}]*)\}/g;
  for (let m = re.exec(body); m; m = re.exec(body)) cases.set(m[1]!, m[2]!);
  const pick =
    cases.get(`=${n}`) ?? cases.get(new Intl.PluralRules(locale).select(n)) ?? cases.get('other') ?? '';
  return pick.replace(/#/g, String(n));
}

/** Fills `{name}` and `{name, plural, …}` arguments of a catalog text. */
export function format(
  template: string,
  params: Record<string, string | number>,
  locale: TextLocale,
): string {
  return template
    .replace(/\{(\w+),\s*plural,((?:[^{}]|\{[^{}]*\})*)\}/g, (m, name: string, body: string) =>
      name in params ? plural(body, Number(params[name]), locale) : m,
    )
    .replace(/\{(\w+)\}/g, (m, name: string) => (name in params ? String(params[name]) : m));
}

/** The catalog text at `path` (inside the module's namespace) in `locale`, else English, with its arguments filled in. */
export function text(locale: TextLocale, path: string, params: Record<string, string | number> = {}): string {
  const template = lookup(catalogs[locale], path) ?? lookup(catalogs.en, path) ?? path;
  return format(template, params, locale);
}

/** Locale-bound shorthand: `const t = texts('ja-JP'); t('server.report.summary', { total: 3 })`. */
export function texts(locale: TextLocale) {
  return (path: string, params?: Record<string, string | number>) => text(locale, path, params);
}

/** A catalog text in all three languages (default names of built-in templates). */
export function localized(path: string): LocalizedText {
  return { en: text('en', path), 'zh-TW': text('zh-TW', path), 'ja-JP': text('ja-JP', path) };
}

/** A list joined the way each language does it ("A, B and C" / 「A、B、C」). */
export function joinList(locale: TextLocale, items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  if (locale === 'en')
    return items.length === 2
      ? `${items[0]} and ${items[1]}`
      : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
  return items.join('、');
}

/** Joins sentences: a space in English, nothing between CJK sentences (they end in 。). */
export function sentences(locale: TextLocale, ...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(locale === 'en' ? ' ' : '');
}

/** The language a model should write in. */
export const LANGUAGE_NAMES: Record<TextLocale, string> = {
  en: 'English',
  'zh-TW': 'Traditional Chinese as used in Taiwan',
  'ja-JP': 'Japanese',
};
