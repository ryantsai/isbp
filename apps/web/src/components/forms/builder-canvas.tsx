'use client';

import { useDroppable } from '@dnd-kit/core';
import { SortableContext, useSortable } from '@dnd-kit/sortable';
import { type Condition, type FieldDef, type FormElement, isField, localize } from '@isbp/sdk';
import { cn } from '@isbp/ui';
import { Badge } from '@isbp/ui/badge';
import { Button } from '@isbp/ui/button';
import { duration, ease, useReducedMotion } from '@isbp/ui/motion';
import { Switch } from '@isbp/ui/switch';
import { Hint } from '@isbp/ui/tooltip';
import {
  ArrowDownIcon,
  ArrowUpIcon,
  BoxesIcon,
  CalendarDaysIcon,
  ChevronDownIcon,
  CopyPlusIcon,
  GitBranchIcon,
  GripVerticalIcon,
  LockIcon,
  MousePointerClickIcon,
  Trash2Icon,
  TriangleAlertIcon,
  UserRoundIcon,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useLocale, useTranslations } from 'next-intl';
import { type ReactNode, useId, useState } from 'react';
import { useShowFieldKeys } from '@/components/fields/field-keys';
import { ElementTypeIcon } from '@/components/fields/field-types';
import type { FieldIssue } from '@/components/fields/field-utils';

export const CANVAS_END = 'canvas:end';

/** Where a dragged element would land: before `elements[index]` (or at the end). */
export interface DropTarget {
  index: number;
  /** Draw the marker on the left edge (between two half-width fields) instead of the top. */
  vertical: boolean;
}

/** No transforms while dragging: the list stays put, a marker shows the drop position. */
export const noSortingTransforms = () => null;

function Box({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'flex h-9 w-full items-center gap-2 rounded-md border border-input bg-background/60 px-3 text-sm text-muted-foreground dark:bg-input/20',
        className,
      )}
    >
      {children}
    </div>
  );
}

/** A non-interactive picture of the field's control, like the real form shows it. */
function ControlMock({ field }: { field: FieldDef }) {
  const locale = useLocale();
  const tu = useTranslations('ui');
  const placeholder = localize(field.placeholder, locale);
  const dv = field.defaultValue;
  const optionLabel = (v: string) => localize(field.options?.find((o) => o.value === v)?.label, locale) || v;
  const shown = (text: string | undefined) =>
    text ? (
      <span className="truncate text-foreground">{text}</span>
    ) : (
      <span className="truncate">{placeholder}</span>
    );
  switch (field.type) {
    case 'textarea':
      return <Box className="h-16 items-start py-2">{shown(typeof dv === 'string' ? dv : undefined)}</Box>;
    case 'boolean':
      return (
        <div className="flex h-9 items-center">
          <span
            className={cn(
              'grid size-4 place-items-center rounded-[4px] border border-input',
              dv === true && 'border-primary bg-primary',
            )}
          />
        </div>
      );
    case 'select':
      return (
        <Box className="justify-between">
          {typeof dv === 'string' && dv ? (
            <span className="truncate text-foreground">{optionLabel(dv)}</span>
          ) : (
            <span className="truncate">{placeholder || tu('select.placeholder')}</span>
          )}
          <ChevronDownIcon className="size-4 shrink-0 opacity-50" aria-hidden />
        </Box>
      );
    case 'multiselect': {
      const options = field.options ?? [];
      const chosen = Array.isArray(dv) ? dv : [];
      return (
        <div className="flex flex-wrap gap-1.5">
          {options.slice(0, 5).map((o) => (
            <span
              key={o.value}
              className={cn(
                'flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs',
                chosen.includes(o.value) && 'border-primary/50 bg-primary/5',
              )}
            >
              <span
                className={cn(
                  'size-3 rounded-[3px] border',
                  chosen.includes(o.value) && 'border-primary bg-primary',
                )}
              />
              {localize(o.label, locale) || o.value}
            </span>
          ))}
          {options.length > 5 && (
            <span className="self-center text-xs text-muted-foreground">+{options.length - 5}</span>
          )}
        </div>
      );
    }
    case 'date':
      return (
        <Box className="justify-between">
          {shown(typeof dv === 'string' ? dv : undefined)}
          <CalendarDaysIcon className="size-4 shrink-0 opacity-60" aria-hidden />
        </Box>
      );
    case 'user':
      return (
        <Box>
          <UserRoundIcon className="size-4 shrink-0 opacity-60" aria-hidden />
          <span className="truncate">{tu('person.placeholder')}</span>
        </Box>
      );
    case 'record':
      return (
        <Box>
          <BoxesIcon className="size-4 shrink-0 opacity-60" aria-hidden />
          <span className="truncate">
            {placeholder || tu(field.record?.multiple ? 'record.placeholderMany' : 'record.placeholder')}
          </span>
        </Box>
      );
    case 'rows': {
      // The table's column headers over two empty rows.
      const columns = field.rows?.fields ?? [];
      return (
        <div className="grid gap-1 overflow-hidden rounded-md border p-2">
          <div className="flex gap-2 text-xs font-medium text-muted-foreground">
            {columns.slice(0, 4).map((c) => (
              <span key={c.key} className="min-w-0 flex-1 truncate">
                {localize(c.label, locale) || c.key}
              </span>
            ))}
            {columns.length > 4 && <span className="shrink-0">+{columns.length - 4}</span>}
          </div>
          {[0, 1].map((n) => (
            <div key={n} className="flex gap-2">
              {columns.slice(0, 4).map((c) => (
                <span key={c.key} className="h-6 min-w-0 flex-1 rounded border border-input bg-background" />
              ))}
            </div>
          ))}
        </div>
      );
    }
    default:
      return <Box>{shown(dv !== undefined && dv !== null && dv !== '' ? String(dv) : undefined)}</Box>;
  }
}

function ElementBody({ el, locale }: { el: FormElement; locale: string }) {
  const t = useTranslations('forms.builder');
  if (isField(el)) {
    const label = localize(el.label, locale);
    const help = localize(el.help, locale);
    return (
      <div className="grid gap-2">
        <span className="flex items-center gap-1 text-sm leading-none font-medium">
          {label || <span className="text-muted-foreground italic">{t('untitled')}</span>}
          {el.required && (
            <span aria-hidden className="text-destructive">
              *
            </span>
          )}
        </span>
        <ControlMock field={el} />
        {help && <span className="text-xs text-muted-foreground">{help}</span>}
      </div>
    );
  }
  if (el.type === 'heading')
    return (
      <span className="block pt-1 text-base font-semibold">
        {localize(el.text, locale) || (
          <span className="text-muted-foreground italic">{t('emptyHeading')}</span>
        )}
      </span>
    );
  if (el.type === 'paragraph')
    return (
      <span className="block text-sm leading-relaxed whitespace-pre-line text-muted-foreground">
        {localize(el.text, locale) || <span className="italic">{t('emptyParagraph')}</span>}
      </span>
    );
  return <span className="my-2 block h-px w-full bg-border" />;
}

function DropLine({ vertical }: { vertical: boolean }) {
  return (
    <motion.span
      aria-hidden
      layoutId="builder-drop-line"
      transition={{ type: 'spring', stiffness: 700, damping: 45 }}
      className={cn(
        'pointer-events-none absolute z-20 rounded-full bg-primary shadow-[0_0_0_3px] shadow-primary/20',
        vertical ? '-top-0.5 -bottom-0.5 -left-[9px] w-1' : '-top-[9px] right-0 left-0 h-1',
      )}
    />
  );
}

export interface CanvasItemProps {
  el: FormElement;
  index: number;
  count: number;
  selected: boolean;
  issues: readonly FieldIssue[];
  conditionText: (c: Condition) => string;
  locked: boolean;
  /** Show the field's key under it ("Show field keys"). */
  showKey: boolean;
  /** Just added (or brought back by undo): a one-shot ring shows where it landed. */
  fresh: boolean;
  drop: DropTarget | null;
  dimmed: boolean;
  onSelect: () => void;
  onMove: (by: -1 | 1) => void;
  onDuplicate: () => void;
  onRemove: () => void;
}

function CanvasItem({
  el,
  index,
  count,
  selected,
  issues,
  conditionText,
  locked,
  showKey,
  fresh,
  drop,
  dimmed,
  onSelect,
  onMove,
  onDuplicate,
  onRemove,
}: CanvasItemProps) {
  const t = useTranslations('forms.builder');
  const tf = useTranslations('fields');
  const locale = useLocale();
  const reduce = useReducedMotion();
  const field = isField(el);
  const typeName = field ? tf(`types.${el.type}.name`) : tf(`display.${el.type}.name`);
  const name = (field ? localize(el.label, locale) : localize(el.text, locale)) || typeName;
  const half = field && el.width === 'half';
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, isDragging } = useSortable({
    id: el.id,
    attributes: { roleDescription: tf('dnd.roleDescription') },
  });
  const issueId = `issues-${el.id}`;
  return (
    <motion.div
      ref={setNodeRef}
      layout
      initial={{ opacity: 0, scale: 0.97, y: -6 }}
      animate={{ opacity: dimmed || isDragging ? 0.4 : 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.15 } }}
      transition={{ type: 'spring', stiffness: 500, damping: 40, mass: 0.8 }}
      className={cn('relative', half ? 'sm:col-span-1' : 'sm:col-span-2')}
      data-element={el.id}
    >
      {drop && drop.index === index && <DropLine vertical={drop.vertical} />}
      <div
        onClick={onSelect}
        className={cn(
          'group relative flex gap-1.5 rounded-xl border bg-card p-3 pl-1.5 transition-[border-color,box-shadow,background-color]',
          selected
            ? 'border-primary/60 bg-primary/[0.03] shadow-sm ring-2 ring-primary/30'
            : 'hover:border-foreground/20 hover:shadow-sm',
          issues.length > 0 && !selected && 'border-destructive/50',
        )}
      >
        {fresh && !reduce && (
          <motion.span
            aria-hidden
            className="pointer-events-none absolute -inset-px z-10 rounded-xl ring-[3px] ring-primary/70"
            initial={{ opacity: 1 }}
            animate={{ opacity: 0 }}
            transition={{ duration: duration.base, delay: 0.25, ease: ease.exit }}
          />
        )}
        <button
          type="button"
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          aria-label={t('dragHandle', { name })}
          className="grid h-7 w-5 shrink-0 cursor-grab touch-none place-items-center rounded text-muted-foreground/70 outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 active:cursor-grabbing"
        >
          <GripVerticalIcon className="size-4" aria-hidden />
        </button>
        <button
          type="button"
          data-select={el.id}
          onClick={(e) => {
            e.stopPropagation();
            onSelect();
          }}
          aria-label={t('editElement', { name, type: typeName })}
          aria-current={selected ? 'true' : undefined}
          aria-describedby={issues.length ? issueId : undefined}
          className="min-w-0 flex-1 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-card"
        >
          <ElementBody el={el} locale={locale} />
          <span className="mt-2.5 flex flex-wrap items-center gap-1.5">
            <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
              <ElementTypeIcon type={el.type} size="sm" className="size-4 rounded [&_svg]:size-3" />
              {field && showKey ? <code className="font-mono">{el.key}</code> : typeName}
              {locked && showKey && <LockIcon className="size-3" aria-label={t('lockedKey')} />}
            </span>
            {el.visibleWhen && (
              <Badge variant="info" className="max-w-full font-normal">
                <GitBranchIcon aria-hidden />
                <span
                  className="truncate"
                  title={t('shownWhen', { condition: conditionText(el.visibleWhen) })}
                >
                  {t('shownWhen', { condition: conditionText(el.visibleWhen) })}
                </span>
              </Badge>
            )}
            {issues.length > 0 && (
              <Badge id={issueId} variant="destructive" className="max-w-full">
                <TriangleAlertIcon aria-hidden />
                <span className="truncate">
                  {issues.length === 1
                    ? tf(`issues.${issues[0]!.code}`, issues[0]!.params ?? {})
                    : t('issueCount', { count: issues.length })}
                </span>
              </Badge>
            )}
          </span>
        </button>
        <div
          className={cn(
            'absolute -top-3.5 right-2 z-10 flex items-center gap-0.5 rounded-lg border bg-popover p-0.5 shadow-sm transition-opacity',
            selected ? 'opacity-100' : 'opacity-0 group-focus-within:opacity-100 group-hover:opacity-100',
          )}
          onClick={(e) => e.stopPropagation()}
        >
          <Hint label={t('moveUp')}>
            <Button
              type="button"
              variant="ghost"
              className="size-7"
              aria-label={t('moveUpNamed', { name })}
              disabled={index === 0}
              onClick={() => onMove(-1)}
            >
              <ArrowUpIcon />
            </Button>
          </Hint>
          <Hint label={t('moveDown')}>
            <Button
              type="button"
              variant="ghost"
              className="size-7"
              aria-label={t('moveDownNamed', { name })}
              disabled={index === count - 1}
              onClick={() => onMove(1)}
            >
              <ArrowDownIcon />
            </Button>
          </Hint>
          <Hint label={t('duplicate')}>
            <Button
              type="button"
              variant="ghost"
              className="size-7"
              aria-label={t('duplicateNamed', { name })}
              onClick={onDuplicate}
            >
              <CopyPlusIcon />
            </Button>
          </Hint>
          <Hint label={t('remove')}>
            <Button
              type="button"
              variant="ghost"
              className="size-7 hover:text-destructive"
              aria-label={t('removeNamed', { name })}
              onClick={onRemove}
            >
              <Trash2Icon />
            </Button>
          </Hint>
        </div>
      </div>
    </motion.div>
  );
}

/** The ghost under the pointer while an existing element is dragged. */
export function CanvasGhost({ el }: { el: FormElement }) {
  const locale = useLocale();
  const tf = useTranslations('fields');
  const label = isField(el) ? localize(el.label, locale) : localize(el.text, locale);
  const typeName = isField(el) ? tf(`types.${el.type}.name`) : tf(`display.${el.type}.name`);
  return (
    <div className="flex w-64 items-center gap-2.5 rounded-xl border border-primary/50 bg-card p-2.5 shadow-xl ring-4 ring-primary/10">
      <GripVerticalIcon className="size-4 text-muted-foreground" aria-hidden />
      <ElementTypeIcon type={el.type} size="sm" />
      <span className="truncate text-sm font-medium">{label || typeName}</span>
    </div>
  );
}

function EndZone({ empty, active, onAddHint }: { empty: boolean; active: boolean; onAddHint: ReactNode }) {
  const t = useTranslations('forms.builder');
  const { setNodeRef, isOver } = useDroppable({ id: CANVAS_END });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        'relative grid place-items-center rounded-xl border-2 border-dashed text-center text-sm text-muted-foreground transition-colors sm:col-span-2',
        empty ? 'min-h-56 gap-3 p-8' : 'min-h-16 p-4',
        (isOver || active) && 'border-primary/60 bg-primary/5 text-primary',
      )}
    >
      {empty ? (
        <div className="grid justify-items-center gap-3">
          <span className="grid size-11 place-items-center rounded-full bg-muted text-muted-foreground">
            <MousePointerClickIcon className="size-5" aria-hidden />
          </span>
          <span className="max-w-xs">
            <span className="block font-medium text-foreground">{t('emptyTitle')}</span>
            <span className="block">{t('emptyDescription')}</span>
          </span>
          {onAddHint}
        </div>
      ) : (
        <span>{t('dropHere')}</span>
      )}
    </div>
  );
}

/**
 * Elements that appeared since the previous render (added, duplicated or restored by undo); none on the first render.
 * Moving elements doesn't make them fresh.
 */
function useFreshIds(elements: readonly FormElement[]): ReadonlySet<string> {
  const ids = elements.map((e) => e.id).join('|');
  const [seen, setSeen] = useState({ ids, fresh: new Set<string>() as ReadonlySet<string> });
  if (seen.ids !== ids) {
    const before = new Set(seen.ids.split('|'));
    setSeen({ ids, fresh: new Set(elements.map((e) => e.id).filter((id) => !before.has(id))) });
  }
  return seen.fresh;
}

/** The form being built, laid out like the real form (half-width fields side by side). */
export function BuilderCanvas({
  elements,
  selectedId,
  issues,
  conditionText,
  lockedIds,
  drop,
  draggingId,
  header,
  onSelect,
  onMove,
  onDuplicate,
  onRemove,
  emptyAction,
}: {
  elements: readonly FormElement[];
  selectedId: string | null;
  issues: ReadonlyMap<string, FieldIssue[]>;
  conditionText: (c: Condition) => string;
  lockedIds: ReadonlySet<string>;
  drop: DropTarget | null;
  draggingId: string | null;
  header: ReactNode;
  onSelect: (id: string) => void;
  onMove: (id: string, by: -1 | 1) => void;
  onDuplicate: (id: string) => void;
  onRemove: (id: string) => void;
  emptyAction: ReactNode;
}) {
  const t = useTranslations('forms.builder');
  const tf = useTranslations('fields');
  const uid = useId();
  const [showKeys, setShowKeys] = useShowFieldKeys();
  const fresh = useFreshIds(elements);
  return (
    <section
      aria-label={t('canvas')}
      className="rounded-2xl border bg-muted/30 p-3 sm:p-5"
      onClick={(e) => {
        if (e.target === e.currentTarget) onSelect('');
      }}
    >
      <div className="mx-auto mb-2 flex max-w-3xl justify-end">
        <label
          htmlFor={`${uid}-keys`}
          className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground"
        >
          <Switch id={`${uid}-keys`} checked={showKeys} onCheckedChange={setShowKeys} />
          {tf('showKeys')}
        </label>
      </div>
      <div className="mx-auto grid max-w-3xl gap-5 rounded-xl border bg-background p-4 sm:p-5">
        {header}
        <SortableContext items={elements.map((e) => e.id)} strategy={noSortingTransforms}>
          <div className="grid gap-x-4 gap-y-5 sm:grid-cols-2">
            <AnimatePresence initial={false} mode="popLayout">
              {elements.map((el, i) => (
                <CanvasItem
                  key={el.id}
                  el={el}
                  index={i}
                  count={elements.length}
                  selected={selectedId === el.id}
                  issues={issues.get(el.id) ?? []}
                  conditionText={conditionText}
                  locked={lockedIds.has(el.id)}
                  showKey={showKeys}
                  fresh={fresh.has(el.id)}
                  drop={drop}
                  dimmed={draggingId === el.id}
                  onSelect={() => onSelect(el.id)}
                  onMove={(by) => onMove(el.id, by)}
                  onDuplicate={() => onDuplicate(el.id)}
                  onRemove={() => onRemove(el.id)}
                />
              ))}
            </AnimatePresence>
            <div className="relative sm:col-span-2">
              {drop && drop.index === elements.length && elements.length > 0 && <DropLine vertical={false} />}
              <EndZone
                empty={elements.length === 0}
                active={Boolean(drop && drop.index === elements.length)}
                onAddHint={emptyAction}
              />
            </div>
          </div>
        </SortableContext>
      </div>
    </section>
  );
}
