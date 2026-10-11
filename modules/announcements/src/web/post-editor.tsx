'use client';

import { Button } from '@astryxdesign/core/Button';
import { DateTimeInput, type ISODateTimeString } from '@astryxdesign/core/DateTimeInput';
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import { FormLayout } from '@astryxdesign/core/FormLayout';
import { Grid } from '@astryxdesign/core/Grid';
import { HStack, Layout, LayoutContent, LayoutFooter } from '@astryxdesign/core/Layout';
import { RadioList, RadioListItem } from '@astryxdesign/core/RadioList';
import { Switch } from '@astryxdesign/core/Switch';
import { Text } from '@astryxdesign/core/Text';
import { TextArea } from '@astryxdesign/core/TextArea';
import { TextInput } from '@astryxdesign/core/TextInput';
import { zodResolver } from '@hookform/resolvers/zod';
import { Form, FormField, fieldStatus } from '@isbp/ui/form';
import { countFilled, OptionalFields, useFieldList } from '@isbp/ui/optional-fields';
import { useApiMutation } from '@isbp/ui/query';
import { useTranslations } from 'next-intl';
import { useEffect, useId } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import type { Post, Severity } from '../contracts';
import { SeverityBadge } from './severity';

const SEVERITIES: Severity[] = ['info', 'maintenance', 'incident'];

/** `<input type="datetime-local">` value ↔ ISO string (in the browser's time zone). */
const toLocalInput = (iso: string | null | undefined) => {
  if (!iso) return '';
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};
const fromLocalInput = (value: string) => (value ? new Date(value).toISOString() : null);
/** The form keeps the local "YYYY-MM-DDTHH:mm" text, which is also the shape Astryx's `DateTimeInput` takes. */
const asDateTime = (value: string) => (value ? (value as ISODateTimeString) : undefined);

const formSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    body: z.string().trim().max(10_000),
    severity: z.enum(['info', 'maintenance', 'incident']),
    pinned: z.boolean(),
    startsAt: z.string(),
    endsAt: z.string(),
  })
  .refine((v) => !v.startsAt || !v.endsAt || v.endsAt > v.startsAt, {
    path: ['endsAt'],
    message: 'Must be after the start',
  });
type Values = z.infer<typeof formSchema>;

export function PostEditor({
  open,
  onOpenChange,
  post,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  post?: Post;
  onSaved?: (p: Post) => void;
}) {
  const t = useTranslations('announcements');
  const tc = useTranslations('common');
  const list = useFieldList();
  const formId = useId();
  const form = useForm<Values>({
    resolver: zodResolver(formSchema),
    defaultValues: { title: '', body: '', severity: 'info', pinned: false, startsAt: '', endsAt: '' },
  });
  useEffect(() => {
    if (!open) return;
    form.reset({
      title: post?.title ?? '',
      body: post?.body ?? '',
      severity: post?.severity ?? 'info',
      pinned: post?.pinned ?? false,
      startsAt: toLocalInput(post?.startsAt),
      endsAt: toLocalInput(post?.endsAt),
    });
  }, [open, post, form]);

  const [startsAt, endsAt, pinned] = useWatch({
    control: form.control,
    name: ['startsAt', 'endsAt', 'pinned'],
  });

  const save = useApiMutation(
    (api, { values, publish }: { values: Values; publish: boolean }) => {
      const body = {
        ...values,
        startsAt: fromLocalInput(values.startsAt),
        endsAt: fromLocalInput(values.endsAt),
      };
      return post
        ? api.patch<Post>(`/announcements/posts/${post.id}`, body)
        : api.post<Post>('/announcements/posts', { ...body, publish });
    },
    {
      invalidate: ['/announcements/'],
      success: (p) =>
        post
          ? t('saved')
          : p.status === 'published'
            ? t('publishedToast')
            : p.status === 'pending'
              ? t('submittedToast')
              : t('draftSaved'),
      onSuccess: (p) => {
        onOpenChange(false);
        onSaved?.(p);
      },
    },
  );
  const submit = (publish: boolean) => form.handleSubmit((values) => save.mutate({ values, publish }));

  return (
    <Dialog isOpen={open} onOpenChange={onOpenChange} width={576} purpose="form">
      <Layout
        header={
          <DialogHeader
            title={post ? t('editor.editTitle') : t('editor.createTitle')}
            subtitle={t('editor.hint')}
            onOpenChange={onOpenChange}
          />
        }
        content={
          <LayoutContent padding={4}>
            <Form {...form}>
              <form id={formId} onSubmit={submit(false)} noValidate>
                <FormLayout defaultOptionality="optional">
                  <FormField
                    control={form.control}
                    name="severity"
                    render={({ field }) => (
                      <RadioList label={t('editor.severity')} value={field.value} onChange={field.onChange}>
                        {SEVERITIES.map((s) => (
                          <RadioListItem
                            key={s}
                            value={s}
                            label={<SeverityBadge severity={s} />}
                            description={t(`severityHint.${s}`)}
                          />
                        ))}
                      </RadioList>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="title"
                    render={({ field, fieldState }) => (
                      <TextInput
                        label={t('editor.title')}
                        isRequired
                        hasAutoFocus
                        value={field.value}
                        onChange={field.onChange}
                        onBlur={field.onBlur}
                        status={fieldStatus(fieldState)}
                      />
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="body"
                    render={({ field, fieldState }) => (
                      <TextArea
                        label={t('editor.body')}
                        rows={6}
                        value={field.value}
                        onChange={field.onChange}
                        onBlur={field.onBlur}
                        status={fieldStatus(fieldState)}
                      />
                    )}
                  />
                  <OptionalFields
                    hint={list([t('editor.startsAt'), t('editor.endsAt'), t('editor.pinned')])}
                    filled={countFilled(startsAt, endsAt, pinned)}
                  >
                    <Grid columns={{ minWidth: 220 }} gap={3}>
                      <FormField
                        control={form.control}
                        name="startsAt"
                        render={({ field }) => (
                          <DateTimeInput
                            label={t('editor.startsAt')}
                            hourFormat="24h"
                            hasClear
                            value={asDateTime(field.value)}
                            onChange={(v) => field.onChange(v ?? '')}
                          />
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="endsAt"
                        render={({ field, fieldState }) => (
                          <DateTimeInput
                            label={t('editor.endsAt')}
                            hourFormat="24h"
                            hasClear
                            value={asDateTime(field.value)}
                            onChange={(v) => field.onChange(v ?? '')}
                            status={fieldStatus(fieldState)}
                          />
                        )}
                      />
                    </Grid>
                    <Text as="p" display="block" type="supporting" color="secondary">
                      {t('editor.windowHint')}
                    </Text>
                    <FormField
                      control={form.control}
                      name="pinned"
                      render={({ field }) => (
                        <Switch
                          label={t('editor.pinned')}
                          description={t('editor.pinnedHint')}
                          value={field.value}
                          onChange={field.onChange}
                        />
                      )}
                    />
                  </OptionalFields>
                </FormLayout>
              </form>
            </Form>
          </LayoutContent>
        }
        footer={
          <LayoutFooter hasDivider padding={3}>
            <HStack gap={2} hAlign="end" wrap="wrap">
              <Button
                label={tc('cancel')}
                variant="ghost"
                type="button"
                onClick={() => onOpenChange(false)}
              />
              {post ? (
                <Button
                  label={tc('saveChanges')}
                  variant="primary"
                  isLoading={save.isPending}
                  type="submit"
                  form={formId}
                />
              ) : (
                <>
                  <Button
                    label={t('editor.saveDraft')}
                    variant="secondary"
                    isLoading={save.isPending && !save.variables?.publish}
                    type="submit"
                    form={formId}
                  />
                  <Button
                    label={t('editor.publish')}
                    variant="primary"
                    isLoading={save.isPending && save.variables?.publish}
                    type="button"
                    onClick={submit(true)}
                  />
                </>
              )}
            </HStack>
          </LayoutFooter>
        }
      />
    </Dialog>
  );
}
