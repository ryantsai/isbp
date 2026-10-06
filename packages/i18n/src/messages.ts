import type { Locale, Messages } from './index';

/** Core catalog namespaces — one JSON file per namespace per locale under `messages/<locale>/`. */
export const namespaces = [
  'common',
  'ui',
  'core',
  'auth',
  'shell',
  'errors',
  'dashboard',
  'users',
  'groups',
  'departments',
  'roles',
  'audit',
  'modules',
  'idp',
  'settings',
] as const;

const loaders: Record<Locale, () => Promise<{ default: Messages }>> = {
  en: () => import('../messages/en/index'),
  'zh-TW': () => import('../messages/zh-TW/index'),
  'ja-JP': () => import('../messages/ja-JP/index'),
};

export function deepMerge(base: Messages, override: Messages): Messages {
  const out: Messages = { ...base };
  for (const [k, v] of Object.entries(override)) {
    const b = out[k];
    out[k] = typeof v === 'object' && v && typeof b === 'object' && b ? deepMerge(b, v) : v;
  }
  return out;
}

/** Core messages for a locale, with English filling any gaps so the UI never shows raw keys. */
export async function loadCoreMessages(locale: Locale): Promise<Messages> {
  const en = (await loaders.en()).default;
  if (locale === 'en') return en;
  return deepMerge(en, (await loaders[locale]()).default);
}
