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
  // Catalogs are independent: don't serialize every module's chunk load on a cold page request.
  const [core, modules] = await Promise.all([
    loadCoreMessages(locale),
    Promise.all(
      Object.entries(moduleMessages).map(async ([moduleId, loaders]) => {
        const [en, translated] = await Promise.all([
          loaders.en(),
          locale === 'en' ? undefined : loaders[locale](),
        ]);
        return [moduleId, translated ? deepMerge(en.default, translated.default) : en.default] as const;
      }),
    ),
  ]);
  const messages: Messages = { ...core, ...Object.fromEntries(modules) };
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
