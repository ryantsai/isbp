'use client';

import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { CustomField, CustomFieldEntity } from '@isbp/contracts';
import { type FieldDef, type FormElement, defaultFieldValues, localize } from '@isbp/sdk';
import { useCan } from '@isbp/sdk/web';
import { cn } from '@isbp/ui';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@isbp/ui/card';
import { useConditionText } from '@isbp/ui/condition-builder';
import { EmptyState } from '@isbp/ui/empty-state';
import { Form } from '@isbp/ui/form';
import { FormFields } from '@isbp/ui/form-renderer';
import { PageHeader } from '@isbp/ui/page-header';
import { Skeleton } from '@isbp/ui/skeleton';
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  AsteriskIcon,
  EyeIcon,
  GitBranchIcon,
  GripVerticalIcon,
  LockIcon,
  PencilIcon,
  PlusIcon,
  TextCursorInputIcon,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useId, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { useApiMutation, useApiQuery } from '@/lib/api';
import { CustomFieldSheet } from './custom-field-sheet';
import { useDndAccessibility, verticalOnly } from './dnd';
import { useShowFieldKeys } from './field-keys';
import { ElementTypeIcon } from './field-types';
import { fieldFacts } from './field-utils';
import { Badge } from '@astryxdesign/core/Badge';
import { Button } from '@astryxdesign/core/Button';
import { Icon } from '@astryxdesign/core/Icon';
import { IconButton } from '@astryxdesign/core/IconButton';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { MoreMenu } from '@astryxdesign/core/MoreMenu';
import { Switch } from '@astryxdesign/core/Switch';
import { Tab, TabList } from '@astryxdesign/core/TabList';
import { Tooltip } from '@astryxdesign/core/Tooltip';

const def = (f: CustomField) => f.field as FieldDef;

export function CustomFieldsView() {
  const t = useTranslations('fields.custom');
  const tr = useTranslations();
  const panelId = useId();
  const router = useRouter();
  const sp = useSearchParams();
  const canManage = useCan('core.custom-fields.manage');
  const entities = useApiQuery<{ items: CustomFieldEntity[] }>(canManage ? '/custom-fields/entities' : null);
  const items = entities.data?.items ?? [];
  const current = items.find((e) => e.type === sp.get('entity')) ?? items[0];
  const entityName = (e: CustomFieldEntity) => (tr.has(e.name) ? tr(e.name) : e.type);
  // Tabs and list titles name the records in the plural ("Tickets"); the module's own name otherwise.
  const pluralName = (e: CustomFieldEntity) =>
    t.has(`plural.${e.type}`) ? t(`plural.${e.type}`) : entityName(e);

  const setEntity = (type: string) => {
    const next = new URLSearchParams(sp.toString());
    next.set('entity', type);
    router.replace(`/admin/custom-fields?${next}`, { scroll: false });
  };

  if (!canManage) {
    return (
      <>
        <PageHeader title={t('title')} />
        <EmptyState icon={<LockIcon />} title={t('noAccess')} />
      </>
    );
  }

  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />
      {entities.isLoading || !current ? (
        <div className="space-y-4">
          <Skeleton className="h-9 w-80" />
          <Skeleton className="h-72 w-full rounded-xl" />
        </div>
      ) : (
        <VStack gap={4}>
          <TabList
            role="tablist"
            aria-label={t('entities')}
            value={current.type}
            onChange={setEntity}
            hasDivider
          >
            {items.map((e) => (
              <Tab
                key={e.type}
                value={e.type}
                label={pluralName(e)}
                panelId={panelId}
                endContent={<Badge variant="neutral" label={String(e.fieldCount)} />}
              />
            ))}
          </TabList>
          <div role="tabpanel" id={panelId} aria-label={pluralName(current)}>
            <EntityFields key={current.type} entityType={current.type} entityName={pluralName(current)} />
          </div>
        </VStack>
      )}
    </>
  );
}

function EntityFields({ entityType, entityName }: { entityType: string; entityName: string }) {
  const t = useTranslations('fields.custom');
  const tf = useTranslations('fields');
  const locale = useLocale();
  const [showArchived, setShowArchived] = useState(false);
  const [showKeys, setShowKeys] = useShowFieldKeys();
  const [sheet, setSheet] = useState<{ open: boolean; field?: CustomField }>({ open: false });
  const [archiving, setArchiving] = useState<CustomField | null>(null);
  const { data, isLoading } = useApiQuery<{ items: CustomField[] }>('/custom-fields', {
    entityType,
    includeArchived: true,
  });
  const all = useMemo(() => data?.items ?? [], [data]);
  const serverActive = useMemo(() => all.filter((f) => !f.archived), [all]);
  const archived = all.filter((f) => f.archived);

  // Local order while a reorder is saving (optimistic); reset whenever the server list changes.
  const [pending, setPending] = useState<{ base: CustomField[]; ids: string[] } | null>(null);
  const active = useMemo(() => {
    if (!pending || pending.base !== serverActive) return serverActive;
    const byId = new Map(serverActive.map((f) => [f.id, f]));
    return pending.ids.map((id) => byId.get(id)).filter((f): f is CustomField => Boolean(f));
  }, [pending, serverActive]);

  const reorder = useApiMutation(
    (api, ids: string[]) => api.put('/custom-fields/order', { entityType, ids }),
    {
      invalidate: ['/custom-fields', '/audit-logs'],
      success: t('reordered'),
      onSuccess: () => setPending(null),
    },
  );
  const restore = useApiMutation((api, f: CustomField) => api.post(`/custom-fields/${f.id}/restore`), {
    invalidate: ['/custom-fields', '/audit-logs'],
    success: t('restored'),
  });

  const move = (from: number, to: number) => {
    if (to < 0 || to >= active.length || from === to) return;
    const ids = arrayMove(active, from, to).map((f) => f.id);
    setPending({ base: serverActive, ids });
    reorder.mutate(ids, { onError: () => setPending(null) });
  };

  const siblingsFor = (f?: CustomField) => serverActive.filter((x) => x.id !== f?.id).map(def);
  const facts = useMemo(() => fieldFacts(serverActive.map(def), locale), [serverActive, locale]);

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)] xl:grid-cols-[minmax(0,1fr)_minmax(0,28rem)]">
      <Card className="gap-0 overflow-hidden py-0">
        <CardHeader className="flex flex-col gap-3 border-b py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <CardTitle>{t('listTitle', { entity: entityName })}</CardTitle>
            <CardDescription>{t('listDescription')}</CardDescription>
          </div>
          <HStack gap={3} wrap="wrap" vAlign="center">
            <Switch label={tf('showKeys')} size="sm" value={showKeys} onChange={setShowKeys} />
            <Switch label={t('showArchived')} size="sm" value={showArchived} onChange={setShowArchived} />
            <Button
              label={t('add')}
              variant="primary"
              size="sm"
              icon={<Icon icon={PlusIcon} />}
              onClick={() => setSheet({ open: true })}
            />
          </HStack>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="space-y-2 p-4">
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
            </div>
          ) : active.length === 0 && (!showArchived || archived.length === 0) ? (
            <EmptyState
              icon={<TextCursorInputIcon />}
              title={t('emptyTitle', { entity: entityName })}
              description={t('emptyDescription')}
              action={
                <Button
                  label={t('add')}
                  variant="primary"
                  size="sm"
                  icon={<Icon icon={PlusIcon} />}
                  onClick={() => setSheet({ open: true })}
                />
              }
            />
          ) : (
            <>
              <SortableFieldList
                fields={active}
                facts={facts}
                onMove={move}
                onEdit={(f) => setSheet({ open: true, field: f })}
                onArchive={setArchiving}
              />
              <AnimatePresence initial={false}>
                {showArchived && archived.length > 0 && (
                  <motion.section
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="overflow-hidden border-t"
                    aria-labelledby="cf-archived"
                  >
                    <h3
                      id="cf-archived"
                      className="px-4 pt-4 pb-1 text-xs font-semibold text-muted-foreground"
                    >
                      {t('archivedTitle')}
                    </h3>
                    <ul className="divide-y">
                      {archived.map((f) => (
                        <li key={f.id} className="flex items-center gap-3 px-4 py-3 opacity-80">
                          <span className="w-6" aria-hidden />
                          <ElementTypeIcon type={def(f).type} className="grayscale" />
                          <FieldSummary field={f} facts={facts} />
                          <Button
                            label={t('restore')}
                            variant="secondary"
                            size="sm"
                            icon={<Icon icon={ArchiveRestoreIcon} />}
                            isLoading={restore.isPending && restore.variables?.id === f.id}
                            onClick={() => restore.mutate(f)}
                          />
                        </li>
                      ))}
                    </ul>
                  </motion.section>
                )}
              </AnimatePresence>
            </>
          )}
        </CardContent>
      </Card>

      <LivePreview fields={active} entityName={entityName} />

      <CustomFieldSheet
        open={sheet.open}
        onOpenChange={(open) => setSheet((s) => ({ ...s, open }))}
        entityType={entityType}
        entityName={entityName}
        field={sheet.field}
        siblings={siblingsFor(sheet.field)}
      />
      <ArchiveDialog field={archiving} onClose={() => setArchiving(null)} />
    </div>
  );
}

function FieldSummary({ field, facts }: { field: CustomField; facts: ReturnType<typeof fieldFacts> }) {
  const t = useTranslations('fields');
  const [showKeys] = useShowFieldKeys();
  const locale = useLocale();
  const conditionText = useConditionText(facts);
  const d = def(field);
  return (
    <div className="min-w-0 flex-1 space-y-1">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="truncate font-medium">{localize(d.label, locale) || field.key}</span>
        {showKeys && <code className="font-mono text-xs text-muted-foreground">{field.key}</code>}
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        <span>{t(`types.${d.type}.name`)}</span>
        <span aria-hidden>·</span>
        <span>{t('custom.usage', { count: field.usage })}</span>
        {d.required && (
          <Badge
            variant="neutral"
            label={t('badges.required')}
            icon={<Icon icon={AsteriskIcon} size="xsm" />}
          />
        )}
        {d.visibleWhen && (
          <Tooltip content={t('badges.conditionalWhen', { condition: conditionText(d.visibleWhen) })}>
            <Badge
              variant="info"
              tabIndex={0}
              className="max-w-full cursor-help"
              label={t('badges.conditionalWhen', { condition: conditionText(d.visibleWhen) })}
              icon={<Icon icon={GitBranchIcon} size="xsm" />}
            />
          </Tooltip>
        )}
        {field.archived && (
          <Badge
            variant="neutral"
            label={t('badges.archived')}
            icon={<Icon icon={ArchiveIcon} size="xsm" />}
          />
        )}
      </div>
    </div>
  );
}

function SortableFieldList({
  fields,
  facts,
  onMove,
  onEdit,
  onArchive,
}: {
  fields: CustomField[];
  facts: ReturnType<typeof fieldFacts>;
  onMove: (from: number, to: number) => void;
  onEdit: (f: CustomField) => void;
  onArchive: (f: CustomField) => void;
}) {
  const locale = useLocale();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const ids = fields.map((f) => f.id);
  const describe = useCallback(
    (id: string) => {
      const f = fields.find((x) => x.id === id);
      return f ? localize(def(f).label, locale) || f.key : id;
    },
    [fields, locale],
  );
  const position = useCallback(
    (id: string) => {
      const i = fields.findIndex((x) => x.id === id);
      return i < 0 ? null : { position: i + 1, total: fields.length };
    },
    [fields],
  );
  const accessibility = useDndAccessibility(describe, position);
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    onMove(ids.indexOf(String(active.id)), ids.indexOf(String(over.id)));
  };
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={onDragEnd}
      modifiers={[verticalOnly]}
      accessibility={accessibility}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <ul className="divide-y">
          {fields.map((f, i) => (
            <SortableRow
              key={f.id}
              field={f}
              facts={facts}
              first={i === 0}
              last={i === fields.length - 1}
              onUp={() => onMove(i, i - 1)}
              onDown={() => onMove(i, i + 1)}
              onEdit={() => onEdit(f)}
              onArchive={() => onArchive(f)}
            />
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
}

function SortableRow({
  field,
  facts,
  first,
  last,
  onUp,
  onDown,
  onEdit,
  onArchive,
}: {
  field: CustomField;
  facts: ReturnType<typeof fieldFacts>;
  first: boolean;
  last: boolean;
  onUp: () => void;
  onDown: () => void;
  onEdit: () => void;
  onArchive: () => void;
}) {
  const t = useTranslations('fields');
  const locale = useLocale();
  const label = localize(def(field).label, locale) || field.key;
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id: field.id, attributes: { roleDescription: t('dnd.roleDescription') } });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(
        'group relative flex items-center gap-3 bg-card px-4 py-3 transition-shadow',
        isDragging && 'z-10 rounded-lg shadow-lg ring-2 ring-primary/40',
      )}
    >
      <button
        type="button"
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        aria-label={t('dnd.handle', { item: label })}
        className="grid size-6 shrink-0 cursor-grab touch-none place-items-center rounded text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 active:cursor-grabbing"
      >
        <GripVerticalIcon className="size-4" aria-hidden />
      </button>
      <ElementTypeIcon type={def(field).type} className="max-sm:hidden" />
      <FieldSummary field={field} facts={facts} />
      <div className="flex shrink-0 items-center gap-0.5">
        <div className="hidden items-center gap-0.5 sm:flex">
          <IconButton
            label={t('custom.moveUp', { label })}
            variant="ghost"
            size="sm"
            icon={<Icon icon={ArrowUpIcon} />}
            isDisabled={first}
            onClick={onUp}
          />
          <IconButton
            label={t('custom.moveDown', { label })}
            variant="ghost"
            size="sm"
            icon={<Icon icon={ArrowDownIcon} />}
            isDisabled={last}
            onClick={onDown}
          />
        </div>
        <IconButton
          label={t('custom.edit', { label })}
          variant="ghost"
          size="sm"
          icon={<Icon icon={PencilIcon} />}
          onClick={onEdit}
        />
        <MoreMenu
          label={t('custom.more', { label })}
          size="sm"
          items={[
            { label: t('custom.editAction'), icon: PencilIcon, onClick: onEdit },
            { label: t('custom.moveUpAction'), icon: ArrowUpIcon, isDisabled: first, onClick: onUp },
            { label: t('custom.moveDownAction'), icon: ArrowDownIcon, isDisabled: last, onClick: onDown },
            { type: 'divider' as const },
            {
              label: t('custom.archive'),
              icon: ArchiveIcon,
              variant: 'destructive' as const,
              onClick: onArchive,
            },
          ]}
        />
      </div>
    </li>
  );
}

function ArchiveDialog({ field, onClose }: { field: CustomField | null; onClose: () => void }) {
  const t = useTranslations('fields.custom');
  const locale = useLocale();
  const archive = useApiMutation((api, f: CustomField) => api.post(`/custom-fields/${f.id}/archive`), {
    invalidate: ['/custom-fields', '/audit-logs'],
    success: t('archived'),
    onSuccess: onClose,
  });
  const label = field ? localize(def(field).label, locale) || field.key : '';
  return (
    <ConfirmDialog
      open={Boolean(field)}
      onOpenChange={(o) => !o && onClose()}
      title={t('archiveTitle', { label })}
      description={t('archiveBody', { count: field?.usage ?? 0 })}
      confirmLabel={t('archive')}
      destructive
      loading={archive.isPending}
      onConfirm={() => field && archive.mutate(field)}
    />
  );
}

/** The section as it appears on the entity's form; interactive so conditional logic can be tried. */
function LivePreview({ fields, entityName }: { fields: CustomField[]; entityName: string }) {
  const t = useTranslations('fields.custom');
  const elements = useMemo<FormElement[]>(() => fields.map((f) => ({ ...def(f), id: f.key })), [fields]);
  const signature = elements.map((e) => e.id).join('|');
  return (
    <Card className="lg:sticky lg:top-20">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <EyeIcon className="size-4 text-muted-foreground" aria-hidden /> {t('previewTitle')}
        </CardTitle>
        <CardDescription>{t('previewDescription', { entity: entityName })}</CardDescription>
      </CardHeader>
      <CardContent>
        {elements.length ? (
          <div className="rounded-lg border border-dashed bg-muted/20 p-4">
            <p className="mb-3 text-xs font-semibold text-muted-foreground">{t('previewSection')}</p>
            <PreviewForm key={signature} elements={elements} />
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{t('previewEmpty')}</p>
        )}
      </CardContent>
    </Card>
  );
}

function PreviewForm({ elements }: { elements: FormElement[] }) {
  const form = useForm({ defaultValues: defaultFieldValues(elements as FieldDef[]) });
  return (
    <Form {...form}>
      <FormFields elements={elements} form={form} />
    </Form>
  );
}
