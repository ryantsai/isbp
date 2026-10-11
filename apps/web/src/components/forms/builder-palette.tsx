'use client';

import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { Icon } from '@astryxdesign/core/Icon';
import { HStack, StackItem, VStack } from '@astryxdesign/core/Layout';
import { Text } from '@astryxdesign/core/Text';
import { useDraggable } from '@dnd-kit/core';
import type { DisplayType, FieldType } from '@isbp/sdk';
import { cn } from '@isbp/ui';
import { PlusIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import {
  DISPLAY_TYPE_ORDER,
  ELEMENT_ICONS,
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
  const drag = {
    ...pointer,
    className: cn('touch-none select-none', compact && 'shrink-0', isDragging && 'opacity-50'),
  };
  return (
    <Button
      ref={setNodeRef}
      {...drag}
      label={t('addElement', { type: text.name })}
      tooltip={text.description}
      variant={compact ? 'secondary' : 'ghost'}
      size={compact ? 'sm' : 'md'}
      width={compact ? undefined : '100%'}
      icon={compact ? <Icon icon={ELEMENT_ICONS[type]} /> : <ElementTypeIcon type={type} size="sm" />}
      endContent={compact ? undefined : <Icon icon={PlusIcon} color="secondary" />}
      onClick={() => onAdd(type)}
    >
      {text.name}
    </Button>
  );
}

/** Field types and layout elements: drag onto the canvas, or click (Enter) to add. */
export function BuilderPalette({
  onAdd,
  compact,
}: {
  onAdd: (type: FieldType | DisplayType) => void;
  compact?: boolean;
}) {
  const t = useTranslations('forms.builder');
  if (compact) {
    return (
      <nav aria-label={t('palette')} className="-mx-1 overflow-x-auto px-1 pb-1">
        <HStack gap={1.5} wrap="nowrap">
          {[...FIELD_TYPE_ORDER, ...DISPLAY_TYPE_ORDER].map((type) => (
            <PaletteItem key={type} type={type} compact onAdd={onAdd} />
          ))}
        </HStack>
      </nav>
    );
  }
  return (
    <nav aria-label={t('palette')}>
      <VStack gap={5}>
        <Text type="supporting">{t('paletteHint')}</Text>
        <VStack as="section" gap={1} aria-labelledby="palette-fields">
          <Text type="label" color="secondary" id="palette-fields">
            {t('paletteFields')}
          </Text>
          {FIELD_TYPE_ORDER.map((type) => (
            <PaletteItem key={type} type={type} onAdd={onAdd} />
          ))}
        </VStack>
        <VStack as="section" gap={1} aria-labelledby="palette-layout">
          <Text type="label" color="secondary" id="palette-layout">
            {t('paletteLayout')}
          </Text>
          {DISPLAY_TYPE_ORDER.map((type) => (
            <PaletteItem key={type} type={type} onAdd={onAdd} />
          ))}
        </VStack>
      </VStack>
    </nav>
  );
}

/** What follows the pointer while a palette item is dragged. */
export function PaletteGhost({ type }: { type: ElementType }) {
  const text = useTypeText()(type);
  return (
    <Card padding={2} elevation="high" width={224}>
      <HStack gap={3} vAlign="center">
        <ElementTypeIcon type={type} />
        <StackItem size="fill">
          <Text weight="medium" maxLines={1}>
            {text.name}
          </Text>
        </StackItem>
      </HStack>
    </Card>
  );
}
