'use client';

import { defaultFieldValues, type FieldDef, type FormElement } from '@isbp/sdk';
import { Button } from '@isbp/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@isbp/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@isbp/ui/dialog';
import { Form } from '@isbp/ui/form';
import { FormAnswers, FormFields, useFieldsResolver } from '@isbp/ui/form-renderer';
import { usePeople } from '@isbp/ui/person-picker';
import { useApiMutation } from '@isbp/ui/query';
import { PencilIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';
import { type FieldValues, useForm } from 'react-hook-form';
import { INVALIDATE, useCustomFields } from '../lib';

function EditDialog({
  path,
  subtitle,
  attributes,
  fields,
  elements,
  open,
  onOpenChange,
}: {
  path: string;
  subtitle: string;
  attributes: Record<string, unknown>;
  fields: readonly FieldDef[];
  elements: readonly FormElement[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('projects.customFields');
  const tc = useTranslations('common');
  const resolver = useFieldsResolver(fields);
  const form = useForm<FieldValues>({ resolver, defaultValues: defaultFieldValues(fields, attributes) });
  useEffect(() => {
    if (open) form.reset(defaultFieldValues(fields, attributes));
  }, [open, fields, attributes, form]);
  const save = useApiMutation((api, body: { attributes: Record<string, unknown> }) => api.patch(path, body), {
    invalidate: INVALIDATE,
    success: tc('saved'),
    onSuccess: () => onOpenChange(false),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl" closeLabel={tc('close')}>
        <DialogHeader>
          <DialogTitle>{t('editTitle')}</DialogTitle>
          <DialogDescription>{subtitle}</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            noValidate
            className="grid gap-2"
            onSubmit={form.handleSubmit((values) =>
              save.mutate({ attributes: { ...attributes, ...values } }),
            )}
          >
            <FormFields elements={elements} form={form} />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {tc('cancel')}
              </Button>
              <Button type="submit" loading={save.isPending}>
                {tc('saveChanges')}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

/** A task's or project's custom fields (hidden when admins defined none); editable in a dialog. */
export function CustomFieldsCard({
  entity,
  path,
  subtitle,
  attributes,
  canEdit,
}: {
  entity: 'task' | 'project';
  /** PATCH endpoint of the record. */
  path: string;
  subtitle: string;
  attributes: Record<string, unknown>;
  canEdit: boolean;
}) {
  const t = useTranslations('fields.entity');
  const tc = useTranslations('common');
  const { fields, elements } = useCustomFields(entity);
  const [editing, setEditing] = useState(false);
  const personIds = useMemo(
    () => fields.filter((f) => f.type === 'user').map((f) => attributes[f.key] as string | undefined),
    [fields, attributes],
  );
  const peopleMap = usePeople(personIds);
  const people = useMemo(
    () => Object.fromEntries([...peopleMap.values()].map((p) => [p.id, p.displayName])),
    [peopleMap],
  );
  if (!elements.length) return null;
  return (
    <Card className="min-w-0 gap-4">
      <CardHeader>
        <CardTitle>{t('cardTitle')}</CardTitle>
        <CardDescription>{t('cardDescription')}</CardDescription>
        {canEdit && (
          <CardAction>
            <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
              <PencilIcon />
              {tc('edit')}
            </Button>
          </CardAction>
        )}
      </CardHeader>
      <CardContent>
        <FormAnswers elements={elements} data={attributes} people={people} emptyText={t('notSet')} />
      </CardContent>
      {canEdit && (
        <EditDialog
          path={path}
          subtitle={subtitle}
          attributes={attributes}
          fields={fields}
          elements={elements}
          open={editing}
          onOpenChange={setEditing}
        />
      )}
    </Card>
  );
}
