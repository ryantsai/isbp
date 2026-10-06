import { isLocale, LOCALE_COOKIE, type Locale, type Messages, negotiateLocale } from '@isbp/i18n';
import { deepMerge, loadCoreMessages } from '@isbp/i18n/messages';
import { cookies, headers } from 'next/headers';
import { getRequestConfig } from 'next-intl/server';
import { moduleMessages } from '@/generated/module-messages';

/** Locale: explicit cookie (set from the user's profile) → Accept-Language → English. No URL prefix. */
export async function resolveLocale(): Promise<Locale> {
  const cookieLocale = (await cookies()).get(LOCALE_COOKIE)?.value;
  if (isLocale(cookieLocale)) return cookieLocale;
  return negotiateLocale((await headers()).get('accept-language'));
}

export default getRequestConfig(async () => {
  const locale = await resolveLocale();
  const messages: Messages = { ...(await loadCoreMessages(locale)) };
  for (const [moduleId, loaders] of Object.entries(moduleMessages)) {
    const en = (await loaders.en()).default;
    messages[moduleId] = locale === 'en' ? en : deepMerge(en, (await loaders[locale]()).default);
  }
  return {
    locale,
    messages,
    // Shared "now" so relative times render identically on the server and during hydration.
    now: new Date(),
    onError: (err) => {
      if (process.env.NODE_ENV !== 'production') console.warn(err.message);
    },
    getMessageFallback: ({ key }) => key.split('.').pop() ?? key,
  };
});
