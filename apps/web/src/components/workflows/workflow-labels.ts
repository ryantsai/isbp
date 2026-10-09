'use client';

import { useTranslations } from 'next-intl';
import { useCallback } from 'react';

/** The trigger of approvals that forms name themselves (one workflow per form, no default). */
export const FORM_TRIGGER = 'core.form-submission';

/**
 * The area a built-in approval belongs to, in the people's words: core's own triggers are about access, a module's
 * trigger takes the module's name ("Service desk", "Assets").
 */
export function useAreaName() {
  const t = useTranslations();
  return useCallback(
    (moduleId: string) => {
      if (moduleId === 'core') return t('workflows.list.areas.access');
      const key = `${moduleId}.meta.name`;
      return t.has(key) ? t(key) : moduleId;
    },
    [t],
  );
}
