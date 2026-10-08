import { isLocale, type Locale, locales, type Messages } from '@isbp/i18n';
import { loadCoreMessages } from '@isbp/i18n/messages';
import type { AuthContext, LocalizedText } from '@isbp/sdk/server';
import { renderText } from '../../kernel/notifications/render';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Object ids of uuid-keyed kinds: anything else is simply not found (and never reaches Postgres). */
export const isUuid = (id: string) => UUID_RE.test(id);

/** The caller's locale (labels in lists), English for API clients. */
export const localeOf = (auth: AuthContext): Locale =>
  auth.user && isLocale(auth.user.locale) ? auth.user.locale : 'en';

/** A catalog key (`<module>.<path>`, as manifests use them) in one locale; the key itself when missing. */
export async function catalogText(key: string, locale: Locale = 'en'): Promise<string> {
  const [moduleId = '', ...rest] = key.split('.');
  if (!rest.length) return key;
  return (await renderText(moduleId, rest.join('.'), {}, { locale })) ?? key;
}

/** A catalog key in every locale — template questions and the step names templates build. */
export async function catalogLocalized(key: string): Promise<LocalizedText> {
  const texts = await Promise.all(locales.map((l) => catalogText(key, l)));
  return Object.fromEntries(locales.map((l, i) => [l, texts[i]]));
}

const coreCatalogs = new Map<Locale, Promise<Messages>>();

/** Text from a core namespace other than `core` (`fields.types.text.name`) in every locale. */
export async function coreLocalized(key: string): Promise<LocalizedText> {
  const texts = await Promise.all(
    locales.map(async (l) => {
      let catalog = coreCatalogs.get(l);
      if (!catalog) coreCatalogs.set(l, (catalog = loadCoreMessages(l)));
      let cur: Messages | string | undefined = await catalog;
      for (const seg of key.split('.')) cur = typeof cur === 'object' ? cur[seg] : undefined;
      return typeof cur === 'string' ? cur : key;
    }),
  );
  return Object.fromEntries(locales.map((l, i) => [l, texts[i]]));
}

/** Template labels resolved once per request: `t('approvalChain.trigger')`. */
export async function templateTexts(prefix: string, keys: readonly string[]) {
  const entries = await Promise.all(
    keys.map(async (k) => [k, await catalogLocalized(`core.customizations.${prefix}.${k}`)] as const),
  );
  const map = new Map(entries);
  return (key: string): LocalizedText => map.get(key) ?? { en: key };
}

/** Case-insensitive "contains" over the given texts (list filters). */
export function matchesQuery(q: string | undefined, ...texts: (string | null | undefined)[]): boolean {
  if (!q) return true;
  const needle = q.toLowerCase();
  return texts.some((t) => t?.toLowerCase().includes(needle));
}

/** Text a person typed into a template, stored in their own locale (translations can be added later). */
export const typedText = (text: string, auth: AuthContext): LocalizedText =>
  ({ [localeOf(auth)]: text }) as LocalizedText;

/** `Laptop request` → `laptop-request` (ASCII only; empty when nothing is left). */
export const slugOf = (s: string, max = 50) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max);

/** `Cost centre` → `costCentre` (a valid field key, or empty when the text has no ASCII letters). */
export function fieldKeyOf(s: string): string {
  const words = slugOf(s, 60).split('-').filter(Boolean);
  const key = words.map((w, i) => (i ? w[0]!.toUpperCase() + w.slice(1) : w)).join('');
  return /^[a-z]/.test(key) ? key.slice(0, 64) : '';
}

/** One option per non-empty line (`value` from the text, numbered when it has no ASCII letters). */
export function optionsOf(lines: string, auth: AuthContext) {
  const seen = new Set<string>();
  return lines
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 200)
    .map((label, i) => {
      let value = slugOf(label, 90) || `option-${i + 1}`;
      while (seen.has(value)) value = `${value}-${i + 1}`;
      seen.add(value);
      return { value, label: typedText(label, auth) };
    });
}
