'use client';

import { ThemeProvider } from '@isbp/ui/theme';
import { TooltipProvider } from '@isbp/ui/tooltip';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MotionConfig } from 'motion/react';
import { useLocale } from 'next-intl';
import { z } from 'zod';
import { type ReactNode, useEffect, useState } from 'react';
import { ApiError } from '@isbp/sdk/web';

const ZOD_LOCALES = { en: z.locales.en, 'zh-TW': z.locales.zhTW, 'ja-JP': z.locales.ja } as const;
/** Zod's built-in validation messages follow the UI language. */
function useZodLocale() {
  const locale = useLocale() as keyof typeof ZOD_LOCALES;
  useEffect(() => {
    z.config((ZOD_LOCALES[locale] ?? z.locales.en)());
  }, [locale]);
}

/** App-wide client providers. `reducedMotion="user"` makes every animation honour the OS setting. */
export function RootProviders({ children }: { children: ReactNode }) {
  useZodLocale();
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
      <MotionConfig reducedMotion="user">
        <QueryClientProvider client={client}>
          <TooltipProvider>{children}</TooltipProvider>
        </QueryClientProvider>
      </MotionConfig>
    </ThemeProvider>
  );
}
