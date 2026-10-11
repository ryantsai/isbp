'use client';

import type { CustomField } from '@isbp/contracts';
import { defaultFieldValues, type FieldDef, type FormElement } from '@isbp/sdk';
import { Button } from '@astryxdesign/core/Button';
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import { Icon } from '@astryxdesign/core/Icon';
import { HStack, Layout, LayoutContent, LayoutFooter } from '@astryxdesign/core/Layout';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@isbp/ui/card';
import { Form } from '@isbp/ui/form';
import { FormAnswers, FormFields, useFieldsResolver } from '@isbp/ui/form-renderer';
import { usePeople } from '@isbp/ui/person-picker';
import { useApiMutation, useApiQuery } from '@isbp/ui/query';
import { Skeleton } from '@isbp/ui/skeleton';
import { PencilIcon, PlusIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useMemo, useState } from 'react';
import { type FieldValues, useForm } from 'react-hook-form';
import type { TicketDetail, UpdateTicketInput } from '../../contracts';
import { INVALIDATE, ticketApi } from '../lib';
import { isDone } from '../statuses';

const EMPTY: readonly FieldDef[] = [];

/** Active custom fields of tickets (`itsm.ticket`), defined by admins in Administration → Custom fields. */
export function useTicketFields() {
  const q = useApiQuery<{ items: CustomField[] }>('/custom-fields', { entityType: 'itsm.ticket' });
  const fields = useMemo(
    () => (q.data ? q.data.items.filter((f) => !f.archived).map((f) => f.field as FieldDef) : EMPTY),
    [q.data],
  );
  const elements = useMemo<FormElement[]>(() => fields.map((f) => ({ ...f, id: f.key })), [fields]);
  return { fields, elements, isLoading: q.isLoading };
}

function EditFieldsDialog({
  ticket,
  fields,
  elements,
  open,
  onOpenChange,
}: {
  ticket: TicketDetail;
  fields: readonly FieldDef[];
  elements: readonly FormElement[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('itsm.customFields');
  const tc = useTranslations('common');
  const formId = useId();
  const resolver = useFieldsResolver(fields);
  const form = useForm<FieldValues>({
    resolver,
    defaultValues: defaultFieldValues(fields, ticket.attributes),
  });
  useEffect(() => {
    if (open) form.reset(defaultFieldValues(fields, ticket.attributes));
  }, [open, fields, ticket.attributes, form]);
  const save = useApiMutation(
    (api, body: UpdateTicketInput) => api.patch<TicketDetail>(ticketApi(ticket.reference), body),
    { invalidate: INVALIDATE, success: tc('saved'), onSuccess: () => onOpenChange(false) },
  );
  return (
    <Dialog isOpen={open} onOpenChange={onOpenChange} width={576} purpose="form">
      <Form {...form}>
        <Layout
          header={
            <DialogHeader title={t('editTitle')} subtitle={ticket.reference} onOpenChange={onOpenChange} />
          }
          content={
            <LayoutContent padding={4}>
              <form
                id={formId}
                noValidate
                onSubmit={form.handleSubmit((values) =>
                  save.mutate({ attributes: { ...ticket.attributes, ...values } }),
                )}
              >
                <FormFields elements={elements} form={form} />
              </form>
            </LayoutContent>
          }
          footer={
            <LayoutFooter hasDivider padding={3}>
              <HStack gap={2} hAlign="end">
                <Button label={tc('cancel')} variant="ghost" onClick={() => onOpenChange(false)} />
                <Button
                  label={tc('saveChanges')}
                  variant="primary"
                  type="submit"
                  form={formId}
                  isLoading={save.isPending}
                />
              </HStack>
            </LayoutFooter>
          }
        />
      </Form>
    </Dialog>
  );
}

/** The ticket's custom fields (hidden when none are defined). */
export function CustomFieldsCard({ ticket }: { ticket: TicketDetail }) {
  const t = useTranslations('itsm.customFields');
  const tc = useTranslations('common');
  const { fields, elements, isLoading } = useTicketFields();
  const [editing, setEditing] = useState(false);
  const personIds = useMemo(
    () => fields.filter((f) => f.type === 'user').map((f) => ticket.attributes[f.key] as string | undefined),
    [fields, ticket.attributes],
  );
  const peopleMap = usePeople(personIds);
  const people = useMemo(
    () => Object.fromEntries([...peopleMap.values()].map((p) => [p.id, p.displayName])),
    [peopleMap],
  );
  const editable = ticket.viewer.canEdit && !isDone(ticket.status);
  if (isLoading) return <Skeleton className="h-28 w-full rounded-xl" />;
  if (!elements.length) return null;
  const filled = fields.some((f) => {
    const v = ticket.attributes[f.key];
    return v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0);
  });
  // Nothing filled in: one line to add details (agents), or nothing at all.
  if (!filled && !editable) return null;
  return (
    <Card className="gap-3 py-4">
      <CardHeader className="px-4">
        <CardTitle>{t('title')}</CardTitle>
        {editable && filled && (
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
      <CardContent className="px-4">
        {filled ? (
          <FormAnswers
            elements={elements}
            data={ticket.attributes}
            people={people}
            emptyText={t('notSet')}
            className="sm:grid-cols-1"
          />
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
            {t('empty')}
            <Button
              label={t('add')}
              variant="secondary"
              size="sm"
              icon={<Icon icon={PlusIcon} />}
              onClick={() => setEditing(true)}
            />
          </div>
        )}
      </CardContent>
      {editable && (
        <EditFieldsDialog
          ticket={ticket}
          fields={fields}
          elements={elements}
          open={editing}
          onOpenChange={setEditing}
        />
      )}
    </Card>
  );
}
