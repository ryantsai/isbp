'use client';

import { Button } from '@astryxdesign/core/Button';
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import { Icon } from '@astryxdesign/core/Icon';
import { HStack, Layout, LayoutContent, LayoutFooter } from '@astryxdesign/core/Layout';
import { defaultFieldValues, type FieldDef, type FormElement } from '@isbp/sdk';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@isbp/ui/card';
import { Form } from '@isbp/ui/form';
import { FormAnswers, FormFields, useFieldsResolver } from '@isbp/ui/form-renderer';
import { usePeople } from '@isbp/ui/person-picker';
import { useApiMutation } from '@isbp/ui/query';
import { PencilIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useMemo, useState } from 'react';
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
  const formId = useId();
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
    <Dialog isOpen={open} onOpenChange={onOpenChange} width={576} purpose="form">
      <Layout
        header={<DialogHeader title={t('editTitle')} subtitle={subtitle} onOpenChange={onOpenChange} />}
        content={
          <LayoutContent padding={4}>
            <Form {...form}>
              <form
                id={formId}
                noValidate
                onSubmit={form.handleSubmit((values) =>
                  save.mutate({ attributes: { ...attributes, ...values } }),
                )}
              >
                <FormFields elements={elements} form={form} />
              </form>
            </Form>
          </LayoutContent>
        }
        footer={
          <LayoutFooter hasDivider padding={3}>
            <HStack gap={2} hAlign="end">
              <Button label={tc('cancel')} variant="ghost" onClick={() => onOpenChange(false)} />
              <Button
                label={tc('saveChanges')}
                variant="primary"
                isLoading={save.isPending}
                type="submit"
                form={formId}
              />
            </HStack>
          </LayoutFooter>
        }
      />
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
            <Button
              label={tc('edit')}
              variant="ghost"
              size="sm"
              icon={<Icon icon={PencilIcon} />}
              onClick={() => setEditing(true)}
            />
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
