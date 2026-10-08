'use client';

import type { DisplayType, FieldType } from '@isbp/sdk';
import { cn } from '@isbp/ui';
import {
  AtSignIcon,
  BoxesIcon,
  CalendarDaysIcon,
  HashIcon,
  HeadingIcon,
  Link2Icon,
  ListChecksIcon,
  type LucideIcon,
  PilcrowIcon,
  SeparatorHorizontalIcon,
  SquareCheckIcon,
  SquareChevronDownIcon,
  Table2Icon,
  TextAlignStartIcon,
  TypeIcon,
  UserRoundIcon,
} from 'lucide-react';

export type ElementType = FieldType | DisplayType;

export const ELEMENT_ICONS: Record<ElementType, LucideIcon> = {
  text: TypeIcon,
  textarea: TextAlignStartIcon,
  number: HashIcon,
  boolean: SquareCheckIcon,
  date: CalendarDaysIcon,
  select: SquareChevronDownIcon,
  multiselect: ListChecksIcon,
  email: AtSignIcon,
  url: Link2Icon,
  user: UserRoundIcon,
  record: BoxesIcon,
  rows: Table2Icon,
  heading: HeadingIcon,
  paragraph: PilcrowIcon,
  divider: SeparatorHorizontalIcon,
};

/** Order in palettes and type pickers (most used first). */
export const FIELD_TYPE_ORDER: readonly FieldType[] = [
  'text',
  'textarea',
  'select',
  'multiselect',
  'number',
  'date',
  'boolean',
  'user',
  'record',
  'rows',
  'email',
  'url',
];
export const DISPLAY_TYPE_ORDER: readonly DisplayType[] = ['heading', 'paragraph', 'divider'];

/** The type's icon in a tinted tile (display elements use a neutral tint). */
export function ElementTypeIcon({
  type,
  className,
  size = 'md',
}: {
  type: ElementType;
  className?: string;
  size?: 'sm' | 'md';
}) {
  const Icon = ELEMENT_ICONS[type] ?? TypeIcon;
  const display = type === 'heading' || type === 'paragraph' || type === 'divider';
  return (
    <span
      aria-hidden
      className={cn(
        'grid shrink-0 place-items-center rounded-md',
        size === 'sm' ? 'size-6 [&_svg]:size-3.5' : 'size-8 [&_svg]:size-4',
        display ? 'bg-muted text-muted-foreground' : 'bg-primary/10 text-primary',
        className,
      )}
    >
      <Icon />
    </span>
  );
}
