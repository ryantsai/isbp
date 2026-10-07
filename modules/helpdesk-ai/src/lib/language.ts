import { CHAT_LOCALES, type ChatLocale } from '../contracts';

const KANA = /[぀-ヿㇰ-ㇿｦ-ﾟ]/g;
const HAN = /[㐀-䶿一-鿿豈-﫿]/g;
const LATIN = /[a-z]/gi;
/** Characters only used in Japanese (kokuji and shinjitai forms that differ from traditional Chinese). */
const JA_ONLY = /[々〆込働畑峠辻枠匂栃]/;

/** Maps any locale-ish value (`zh-Hant-TW`, `ja`, `en-GB`) to a supported locale. */
export function normalizeLocale(value: string | null | undefined, fallback: ChatLocale = 'en'): ChatLocale {
  if (!value) return fallback;
  if ((CHAT_LOCALES as readonly string[]).includes(value)) return value as ChatLocale;
  const v = value.toLowerCase();
  if (v.startsWith('zh')) return 'zh-TW';
  if (v.startsWith('ja')) return 'ja-JP';
  if (v.startsWith('en')) return 'en';
  return fallback;
}

/**
 * The language a message is written in: kana → Japanese, Han without kana → Chinese, Latin → English.
 * Mixed text (e.g. "VPN 連不上") goes by script share; empty or unknown text uses `fallback`.
 */
export function detectLanguage(text: string, fallback: ChatLocale = 'en'): ChatLocale {
  const kana = text.match(KANA)?.length ?? 0;
  const han = text.match(HAN)?.length ?? 0;
  const latin = text.match(LATIN)?.length ?? 0;
  // Chinese never uses kana; Japanese almost always does.
  if (kana > 0 || (han > 0 && JA_ONLY.test(text))) return 'ja-JP';
  // One Han character is worth several Latin letters ("VPN 連不上" is Chinese).
  if (han > 0 && han * 3 >= latin) return 'zh-TW';
  if (latin >= 2) return 'en';
  return fallback;
}

export const LANGUAGE_NAMES: Record<ChatLocale, string> = {
  en: 'English',
  'zh-TW': 'Traditional Chinese (Taiwan)',
  'ja-JP': 'Japanese',
};
