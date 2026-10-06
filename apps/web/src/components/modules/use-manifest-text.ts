'use client';

import { useTranslations } from 'next-intl';
import { useCallback } from 'react';

/**
 * Manifest strings (module names, descriptions, setting labels, permission descriptions) are i18n
 * keys such as `core.meta.name`; anything that is not a key (or not yet translated) renders as-is.
 */
export function useManifestText() {
  const t = useTranslations();
  return useCallback(
    (key: string | null | undefined): string => {
      if (!key) return '';
      return t.has(key) && typeof t.raw(key) === 'string' ? t(key) : key;
    },
    [t],
  );
}
