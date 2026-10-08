import en from '../../messages/en.json';
import ja from '../../messages/ja-JP.json';
import zh from '../../messages/zh-TW.json';

/** Server-side replies come from the module's catalogs (`server.*`), in en, zh-TW and ja-JP like every UI string. */
type ServerTexts = (typeof en)['server'];

const catalogs: Record<string, ServerTexts> = {
  en: en.server,
  'zh-TW': (zh as typeof en).server,
  'ja-JP': (ja as typeof en).server,
};

/** A server text with simple `{name}` arguments. */
export function text(
  locale: string,
  key: keyof ServerTexts,
  params: Record<string, string | number> = {},
): string {
  const template = catalogs[locale]?.[key] ?? en.server[key];
  return template.replace(/\{(\w+)\}/g, (m, name: string) => (name in params ? String(params[name]) : m));
}
