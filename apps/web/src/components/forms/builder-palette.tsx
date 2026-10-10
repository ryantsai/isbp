'use client';

import { useDraggable } from '@dnd-kit/core';
import type { DisplayType, FieldType } from '@isbp/sdk';
import { cn } from '@isbp/ui';
import { PlusIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import {
  DISPLAY_TYPE_ORDER,
  type ElementType,
  ElementTypeIcon,
  FIELD_TYPE_ORDER,
} from '@/components/fields/field-types';

export const PALETTE_PREFIX = 'palette:';

export interface PaletteData {
  from: 'palette';
  type: ElementType;
}

function useTypeText() {
  const t = useTranslations('fields');
  return (type: ElementType) => {
    const base = (DISPLAY_TYPE_ORDER as readonly string[]).includes(type)
      ? `display.${type}`
      : `types.${type}`;
    return { name: t(`${base}.name`), description: t(`${base}.description`) };
  };
}

function PaletteItem({
  type,
  compact,
  onAdd,
}: {
  type: ElementType;
  compact?: boolean;
  onAdd: (type: ElementType) => void;
}) {
  const t = useTranslations('forms.builder');
  const text = useTypeText()(type);
  const { setNodeRef, listeners, isDragging } = useDraggable({
    id: `${PALETTE_PREFIX}${type}`,
    data: { from: 'palette', type } satisfies PaletteData,
  });
  // Pointer drag only: Enter/Space on the button adds the element (the keyboard alternative to dragging).
  const { onKeyDown: _keyboardDrag, ...pointer } = listeners ?? {};
  return (
    <button
      ref={setNodeRef}
      type="button"
      {...pointer}
      onClick={() => onAdd(type)}
      aria-label={t('addElement', { type: text.name })}
      title={compact ? text.description : undefined}
      className={cn(
        'group flex touch-none items-center gap-2.5 rounded-lg border bg-card text-left outline-none transition-[background-color,border-color,box-shadow,transform,opacity] select-none hover:border-primary/40 hover:bg-primary/5 hover:shadow-sm focus-visible:ring-[3px] focus-visible:ring-ring/50 active:scale-[0.98]',
        compact ? 'shrink-0 px-2.5 py-1.5' : 'w-full p-2',
        isDragging && 'opacity-50',
      )}
    >
      <ElementTypeIcon type={type} size={compact ? 'sm' : 'md'} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{text.name}</span>
        {!compact && <span className="line-clamp-2 text-xs text-muted-foreground">{text.description}</span>}
      </span>
      {!compact && (
        <PlusIcon
          aria-hidden
          className="size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
        />
      )}
    </button>
  );
}

/** Field types and layout elements: drag onto the canvas, or click (Enter) to add. */
export function BuilderPalette({
  onAdd,
  compact,
  className,
}: {
  onAdd: (type: FieldType | DisplayType) => void;
  compact?: boolean;
  className?: string;
}) {
  const t = useTranslations('forms.builder');
  if (compact) {
    return (
      <nav
        aria-label={t('palette')}
        className={cn('-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1', className)}
      >
        {[...FIELD_TYPE_ORDER, ...DISPLAY_TYPE_ORDER].map((type) => (
          <PaletteItem key={type} type={type} compact onAdd={onAdd} />
        ))}
      </nav>
    );
  }
  return (
    <nav aria-label={t('palette')} className={cn('grid grid-cols-1 gap-5', className)}>
      <p className="text-xs text-muted-foreground">{t('paletteHint')}</p>
      <section className="grid grid-cols-1 gap-1.5" aria-labelledby="palette-fields">
        <h2 id="palette-fields" className="text-xs font-semibold text-muted-foreground">
          {t('paletteFields')}
        </h2>
        {FIELD_TYPE_ORDER.map((type) => (
          <PaletteItem key={type} type={type} onAdd={onAdd} />
        ))}
      </section>
      <section className="grid grid-cols-1 gap-1.5" aria-labelledby="palette-layout">
        <h2 id="palette-layout" className="text-xs font-semibold text-muted-foreground">
          {t('paletteLayout')}
        </h2>
        {DISPLAY_TYPE_ORDER.map((type) => (
          <PaletteItem key={type} type={type} onAdd={onAdd} />
        ))}
      </section>
    </nav>
  );
}

/** What follows the pointer while a palette item is dragged. */
export function PaletteGhost({ type }: { type: ElementType }) {
  const text = useTypeText()(type);
  return (
    <div className="flex w-56 items-center gap-2.5 rounded-lg border border-primary/50 bg-card p-2 shadow-xl ring-4 ring-primary/10">
      <ElementTypeIcon type={type} />
      <span className="truncate text-sm font-medium">{text.name}</span>
    </div>
  );
}
