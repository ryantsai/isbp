'use client';

import { Badge } from '@astryxdesign/core/Badge';
import { Card } from '@astryxdesign/core/Card';
import { Icon } from '@astryxdesign/core/Icon';
import { IconButton } from '@astryxdesign/core/IconButton';
import { HStack, StackItem, VStack } from '@astryxdesign/core/Layout';
import { Switch } from '@astryxdesign/core/Switch';
import { Text } from '@astryxdesign/core/Text';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, useSortable } from '@dnd-kit/sortable';
import { type Condition, type FieldDef, type FormElement, isField, localize } from '@isbp/sdk';
import { cn } from '@isbp/ui';
import { EmptyState } from '@isbp/ui/empty-state';
import { duration, ease, useReducedMotion } from '@isbp/ui/motion';
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
  PencilIcon,
  Trash2Icon,
  TriangleAlertIcon,
  UserRoundIcon,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useLocale, useTranslations } from 'next-intl';
import { type ReactNode, useState } from 'react';
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
          <Icon icon={ChevronDownIcon} size="sm" color="secondary" />
        </Box>
      );
    case 'multiselect': {
      const options = field.options ?? [];
      const chosen = Array.isArray(dv) ? dv : [];
      return (
        <HStack gap={1.5} wrap="wrap" vAlign="center">
          {options.slice(0, 5).map((o) => (
            <Badge
              key={o.value}
              variant={chosen.includes(o.value) ? 'info' : 'neutral'}
              label={localize(o.label, locale) || o.value}
            />
          ))}
          {options.length > 5 && <Text type="supporting">+{options.length - 5}</Text>}
        </HStack>
      );
    }
    case 'date':
      return (
        <Box className="justify-between">
          {shown(typeof dv === 'string' ? dv : undefined)}
          <Icon icon={CalendarDaysIcon} size="sm" color="secondary" />
        </Box>
      );
    case 'user':
      return (
        <Box>
          <Icon icon={UserRoundIcon} size="sm" color="secondary" />
          <span className="truncate">{tu('person.placeholder')}</span>
        </Box>
      );
    case 'record':
      return (
        <Box>
          <Icon icon={BoxesIcon} size="sm" color="secondary" />
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
          <HStack gap={2}>
            {columns.slice(0, 4).map((c) => (
              <StackItem size="fill" key={c.key}>
                <Text type="supporting" weight="medium" maxLines={1}>
                  {localize(c.label, locale) || c.key}
                </Text>
              </StackItem>
            ))}
            {columns.length > 4 && <Text type="supporting">+{columns.length - 4}</Text>}
          </HStack>
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
      <VStack gap={2}>
        <Text weight="medium">
          {label || <i>{t('untitled')}</i>}
          {el.required && <span aria-hidden> *</span>}
        </Text>
        <ControlMock field={el} />
        {help && <Text type="supporting">{help}</Text>}
      </VStack>
    );
  }
  if (el.type === 'heading')
    return (
      <Text type="large" weight="semibold" as="div">
        {localize(el.text, locale) || <i>{t('emptyHeading')}</i>}
      </Text>
    );
  if (el.type === 'paragraph')
    return (
      <Text as="div" color="secondary">
        <span className="whitespace-pre-line">
          {localize(el.text, locale) || <i>{t('emptyParagraph')}</i>}
        </span>
      </Text>
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
      className={cn('relative min-w-0', half ? 'sm:col-span-1' : 'sm:col-span-2')}
      data-element={el.id}
    >
      {drop && drop.index === index && <DropLine vertical={drop.vertical} />}
      <Card
        padding={3}
        variant={selected ? 'blue' : issues.length > 0 ? 'red' : 'default'}
        elevation={selected ? 'low' : 'none'}
        aria-current={selected ? 'true' : undefined}
        onClick={onSelect}
        className="group relative"
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
        <HStack gap={1.5} vAlign="start">
          <IconButton
            ref={setActivatorNodeRef}
            {...attributes}
            {...listeners}
            label={t('dragHandle', { name })}
            variant="ghost"
            size="sm"
            icon={<Icon icon={GripVerticalIcon} />}
            className="cursor-grab touch-none active:cursor-grabbing"
          />
          <StackItem size="fill">
            <VStack gap={3}>
              <ElementBody el={el} locale={locale} />
              <HStack gap={1.5} wrap="wrap" vAlign="center">
                <HStack gap={1} vAlign="center">
                  <ElementTypeIcon type={el.type} size="sm" className="size-4 rounded [&_svg]:size-3" />
                  <Text type="supporting" size="xsm">
                    {field && showKey ? <code>{el.key}</code> : typeName}
                  </Text>
                  {locked && showKey && (
                    <Icon icon={LockIcon} size="xsm" color="secondary" label={t('lockedKey')} />
                  )}
                </HStack>
                {el.visibleWhen && (
                  <Badge
                    variant="info"
                    label={t('shownWhen', { condition: conditionText(el.visibleWhen) })}
                    icon={<Icon icon={GitBranchIcon} size="xsm" />}
                  />
                )}
                {issues.length > 0 && (
                  <Badge
                    id={issueId}
                    variant="error"
                    label={
                      issues.length === 1
                        ? tf(`issues.${issues[0]!.code}`, issues[0]!.params ?? {})
                        : t('issueCount', { count: issues.length })
                    }
                    icon={<Icon icon={TriangleAlertIcon} size="xsm" />}
                  />
                )}
              </HStack>
            </VStack>
          </StackItem>
        </HStack>
        <div
          className={cn(
            'absolute -top-3.5 right-2 z-10 transition-opacity',
            selected ? 'opacity-100' : 'opacity-0 group-focus-within:opacity-100 group-hover:opacity-100',
          )}
          onClick={(e) => e.stopPropagation()}
        >
          <Card padding={0.5} elevation="low">
            <HStack gap={0.5} vAlign="center">
              <IconButton
                label={t('editElement', { name, type: typeName })}
                variant="ghost"
                size="sm"
                icon={<Icon icon={PencilIcon} />}
                data-select={el.id}
                aria-describedby={issues.length ? issueId : undefined}
                onClick={onSelect}
              />
              <IconButton
                label={t('moveUpNamed', { name })}
                variant="ghost"
                size="sm"
                icon={<Icon icon={ArrowUpIcon} />}
                isDisabled={index === 0}
                onClick={() => onMove(-1)}
              />
              <IconButton
                label={t('moveDownNamed', { name })}
                variant="ghost"
                size="sm"
                icon={<Icon icon={ArrowDownIcon} />}
                isDisabled={index === count - 1}
                onClick={() => onMove(1)}
              />
              <IconButton
                label={t('duplicateNamed', { name })}
                variant="ghost"
                size="sm"
                icon={<Icon icon={CopyPlusIcon} />}
                onClick={onDuplicate}
              />
              <IconButton
                label={t('removeNamed', { name })}
                variant="ghost"
                size="sm"
                icon={<Icon icon={Trash2Icon} />}
                onClick={onRemove}
              />
            </HStack>
          </Card>
        </div>
      </Card>
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
    <Card padding={3} elevation="high" width={256}>
      <HStack gap={3} vAlign="center">
        <Icon icon={GripVerticalIcon} color="secondary" />
        <ElementTypeIcon type={el.type} size="sm" />
        <StackItem size="fill">
          <Text weight="medium" maxLines={1}>
            {label || typeName}
          </Text>
        </StackItem>
      </HStack>
    </Card>
  );
}

function EndZone({ empty, active, onAddHint }: { empty: boolean; active: boolean; onAddHint: ReactNode }) {
  const t = useTranslations('forms.builder');
  const { setNodeRef, isOver } = useDroppable({ id: CANVAS_END });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        'relative grid place-items-center rounded-xl border-2 border-dashed text-center transition-colors sm:col-span-2',
        empty ? 'min-h-56 p-4' : 'min-h-16 p-4',
        (isOver || active) && 'border-primary/60 bg-primary/5',
      )}
    >
      {empty ? (
        <EmptyState
          icon={<MousePointerClickIcon />}
          title={t('emptyTitle')}
          description={t('emptyDescription')}
          action={onAddHint}
        />
      ) : (
        <Text color="secondary">{t('dropHere')}</Text>
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
  const [showKeys, setShowKeys] = useShowFieldKeys();
  const fresh = useFreshIds(elements);
  return (
    <Card
      variant="muted"
      padding={4}
      role="region"
      aria-label={t('canvas')}
      onClick={(e) => {
        if (e.target === e.currentTarget) onSelect('');
      }}
    >
      <VStack gap={2}>
        <HStack hAlign="end">
          <Switch label={tf('showKeys')} value={showKeys} onChange={setShowKeys} size="sm" />
        </HStack>
        <Card padding={5} maxWidth={768} className="mx-auto w-full">
          <VStack gap={5}>
            {header}
            <SortableContext items={elements.map((e) => e.id)} strategy={noSortingTransforms}>
              <div className="grid grid-cols-1 gap-x-4 gap-y-5 sm:grid-cols-2">
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
                  {drop && drop.index === elements.length && elements.length > 0 && (
                    <DropLine vertical={false} />
                  )}
                  <EndZone
                    empty={elements.length === 0}
                    active={Boolean(drop && drop.index === elements.length)}
                    onAddHint={emptyAction}
                  />
                </div>
              </div>
            </SortableContext>
          </VStack>
        </Card>
      </VStack>
    </Card>
  );
}
