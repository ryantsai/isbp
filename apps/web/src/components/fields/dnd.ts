'use client';

import type { Announcements, ScreenReaderInstructions } from '@dnd-kit/core';
import { useTranslations } from 'next-intl';
import { useMemo } from 'react';

/**
 * Translated screen-reader announcements for dnd-kit lists. `describe` names an item; `position`
 * returns its 1-based position and the list length.
 */
export function useDndAccessibility(
  describe: (id: string) => string,
  position: (id: string) => { position: number; total: number } | null,
): { announcements: Announcements; screenReaderInstructions: ScreenReaderInstructions } {
  const t = useTranslations('fields.dnd');
  return useMemo(() => {
    const where = (id: string | number | undefined) => (id === undefined ? null : position(String(id)));
    return {
      screenReaderInstructions: { draggable: t('instructions') },
      announcements: {
        onDragStart: ({ active }) => t('picked', { item: describe(String(active.id)) }),
        onDragOver: ({ active, over }) => {
          const p = where(over?.id);
          return p
            ? t('over', { item: describe(String(active.id)), ...p })
            : t('outside', { item: describe(String(active.id)) });
        },
        onDragEnd: ({ active, over }) => {
          const p = where(over?.id);
          return p
            ? t('dropped', { item: describe(String(active.id)), ...p })
            : t('cancelled', { item: describe(String(active.id)) });
        },
        onDragCancel: ({ active }) => t('cancelled', { item: describe(String(active.id)) }),
      },
    };
  }, [t, describe, position]);
}

/** Keeps a dragged row on the vertical axis. */
export const verticalOnly = ({
  transform,
}: {
  transform: { x: number; y: number; scaleX: number; scaleY: number };
}) => ({
  ...transform,
  x: 0,
});
