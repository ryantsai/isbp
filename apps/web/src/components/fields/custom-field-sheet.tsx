'use client';

import type { CustomField } from '@isbp/contracts';
import { type FieldDef, fieldDefSchema, localize } from '@isbp/sdk';
import { ApiError } from '@isbp/sdk/web';
import { Form } from '@isbp/ui/form';
import { FormFields } from '@isbp/ui/form-renderer';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@isbp/ui/sheet';
import { EyeIcon } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useApiMutation, useErrorText } from '@/lib/api';
import { FieldEditor } from './field-editor';
import {
  canonical,
  cleanField,
  type EditableElement,
  elementIssues,
  type FieldIssue,
  uniqueName,
} from './field-utils';
import { Badge } from '@astryxdesign/core/Badge';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';

function blankField(siblings: readonly FieldDef[] = []): FieldDef {
  return { key: uniqueName('text', new Set(siblings.map((f) => f.key))), type: 'text', label: {} };
}

/** A one-field form so admins see the control exactly as people will. */
function SinglePreview({ field }: { field: FieldDef }) {
  const elements = useMemo(() => [{ ...field, id: 'preview', visibleWhen: undefined }], [field]);
  const form = useForm();
  return (
    <Form {...form}>
      <FormFields elements={elements} form={form} />
    </Form>
  );
}

/** Add (no `field`) or edit a custom field of an entity type in a side sheet. */
export function CustomFieldSheet({
  open,
  onOpenChange,
  entityType,
  entityName,
  field,
  siblings,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entityType: string;
  entityName: string;
  field?: CustomField;
  /** The entity's other active fields (conditions, key uniqueness). */
  siblings: readonly FieldDef[];
}) {
  const t = useTranslations('fields.custom');
  const tc = useTranslations('common');
  const errorText = useErrorText();
  const editing = Boolean(field);
  const locale = useLocale();
  const [draft, setDraft] = useState<FieldDef>(() => blankField());
  const [attempted, setAttempted] = useState(false);
  const [serverIssue, setServerIssue] = useState<FieldIssue | null>(null);
  const [rootError, setRootError] = useState<string | null>(null);
  const [initial, setInitial] = useState('');

  // Start from the stored definition each time the sheet opens.
  const wasOpen = useRef(false);
  useEffect(() => {
    const opening = open && !wasOpen.current;
    wasOpen.current = open;
    if (!opening) return;
    const start = field ? (field.field as FieldDef) : blankField(siblings);
    setDraft(start);
    setInitial(canonical(start));
    setAttempted(false);
    setServerIssue(null);
    setRootError(null);
  }, [open, field, siblings]);

  const issues = useMemo(() => {
    const list = elementIssues(draft, siblings);
    return serverIssue ? [...list, serverIssue] : list;
  }, [draft, siblings, serverIssue]);
  const lockedValues = useMemo(
    () =>
      field && field.usage > 0
        ? new Set(((field.field as FieldDef).options ?? []).map((o) => o.value))
        : undefined,
    [field],
  );
  const dirty = canonical(draft) !== initial;

  const create = useApiMutation(
    (api, def: FieldDef) => api.post<CustomField>('/custom-fields', { entityType, field: def }),
    {
      invalidate: ['/custom-fields', '/audit-logs'],
      success: (f) => t('created', { label: localize((f.field as FieldDef).label, locale) || f.key }),
      onSuccess: () => onOpenChange(false),
      silent: true,
    },
  );
  const update = useApiMutation(
    (api, def: FieldDef) => api.patch<CustomField>(`/custom-fields/${field!.id}`, { field: def }),
    {
      invalidate: ['/custom-fields', '/audit-logs'],
      success: t('saved'),
      onSuccess: () => onOpenChange(false),
      silent: true,
    },
  );
  const mutation = editing ? update : create;

  const submit = async () => {
    setAttempted(true);
    setRootError(null);
    const def = cleanField(draft);
    if (issues.some((i) => i !== serverIssue) || !fieldDefSchema.safeParse(def).success) return;
    try {
      await mutation.mutateAsync(def);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'CONFLICT') {
        setServerIssue({ code: 'keyDuplicate', target: 'key', params: { key: def.key } });
        return;
      }
      setRootError(errorText(err));
    }
  };

  const shownIssues = attempted ? issues : issues.filter((i) => i.code === 'keyDuplicate');

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-xl" closeLabel={tc('close')}>
        <SheetHeader>
          <SheetTitle>
            {editing
              ? t('editTitle', { label: localize((field!.field as FieldDef).label, locale) || field!.key })
              : t('addTitle', { entity: entityName })}
          </SheetTitle>
          <SheetDescription>{editing ? t('editDescription') : t('addDescription')}</SheetDescription>
        </SheetHeader>
        <form
          noValidate
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <SheetBody className="space-y-5 pb-6">
            {editing && field!.usage > 0 && (
              <Banner status="info" title={t('usageNote', { count: field!.usage })} collapsible={false} />
            )}
            <FieldEditor
              value={draft}
              onChange={(next: EditableElement) => {
                setDraft(next as FieldDef);
                if (serverIssue) setServerIssue(null);
              }}
              siblings={siblings}
              issues={shownIssues}
              lockedKey={editing}
              lockedType={editing}
              lockedValues={lockedValues}
            />
            <section aria-labelledby="cf-preview" className="space-y-3 rounded-xl border bg-muted/30 p-4">
              <h3 id="cf-preview" className="flex items-center gap-2 text-sm font-medium">
                <EyeIcon className="size-4 text-muted-foreground" aria-hidden /> {t('preview')}
                <Badge variant="neutral" label={t('previewHint')} className="font-normal" />
              </h3>
              <SinglePreview key={`${draft.type}-${draft.key}`} field={draft} />
            </section>
            {rootError && <Banner status="error" title={rootError} collapsible={false} />}
          </SheetBody>
          <SheetFooter>
            <Button
              label={tc('cancel')}
              variant="secondary"
              type="button"
              onClick={() => onOpenChange(false)}
            />
            <Button
              label={editing ? tc('saveChanges') : t('add')}
              variant="primary"
              isLoading={mutation.isPending}
              isDisabled={editing && !dirty}
              type="submit"
            />
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
