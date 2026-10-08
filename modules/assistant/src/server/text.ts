import en from '../../messages/en.json';
import ja from '../../messages/ja-JP.json';
import zh from '../../messages/zh-TW.json';
import { type AppliedLink, linkText } from '../lib/links';

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

/** Text inside a Markdown link or list item: brackets and parentheses can't end the link early. */
const inline = (s: string) => s.replace(/[[\]()\\*_`]/g, (c) => `\\${c}`).replace(/\s+/g, ' ');

/** "Ready to use:" and one Markdown line per link ("- Laptop request: [Open the form](/requests/forms/…)"). */
export function linkLines(links: readonly AppliedLink[], locale: string): string {
  const lines = links.map(
    (l) =>
      `- ${text(locale, 'link', {
        object: inline(l.object),
        label: inline(linkText(l.label, locale)),
        href: encodeURI(l.href).replace(/\(/g, '%28').replace(/\)/g, '%29'),
      })}`,
  );
  return [text(locale, 'linksIntro'), '', ...lines].join('\n');
}
