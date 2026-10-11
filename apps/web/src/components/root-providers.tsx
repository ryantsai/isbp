'use client';

import { UiProvider } from '@isbp/ui/provider';
import { ThemeProvider } from '@isbp/ui/theme';
import { useZodErrorMap } from '@isbp/ui/validation';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MotionConfig, useReducedMotion } from 'motion/react';
import { useLocale } from 'next-intl';
import { z } from 'zod';
import { type ReactNode, useEffect, useState } from 'react';
import { ApiError } from '@isbp/sdk/web';

const ZOD_LOCALES = { en: z.locales.en, 'zh-TW': z.locales.zhTW, 'ja-JP': z.locales.ja } as const;
/**
 * Validation messages follow the UI language: plain ones from `@isbp/ui/validation` ("Required", "Enter at least 2
 * characters"), Zod's own locale for anything else.
 */
function useZodLocale() {
  const locale = useLocale() as keyof typeof ZOD_LOCALES;
  const errorMap = useZodErrorMap();
  useEffect(() => {
    z.config({ ...(ZOD_LOCALES[locale] ?? z.locales.en)(), customError: errorMap });
  }, [locale, errorMap]);
}

/**
 * Marks `<html data-hydrated="1">` once the tree has hydrated (effects run children-first), so end-to-end
 * tests interact with a live page instead of server-rendered markup.
 */
function useHydratedMark() {
  useEffect(() => {
    document.documentElement.dataset.hydrated = '1';
  }, []);
}

/** App-wide client providers. Every animation honours the OS "reduce motion" setting (see `MotionConfig`). */
export function RootProviders({ children }: { children: ReactNode }) {
  useZodLocale();
  useHydratedMark();
  const reduceMotion = useReducedMotion() === true;
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            refetchOnWindowFocus: false,
            retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 2,
          },
        },
      }),
  );
  return (
    <ThemeProvider>
      {/* Reduced motion: transforms and layout off (`reducedMotion`), and every other animation (fades, loops) jumps
          to its end state (`skipAnimations`). */}
      <MotionConfig reducedMotion="user" skipAnimations={reduceMotion}>
        <QueryClientProvider client={client}>
          <UiProvider>{children}</UiProvider>
        </QueryClientProvider>
      </MotionConfig>
    </ThemeProvider>
  );
}
