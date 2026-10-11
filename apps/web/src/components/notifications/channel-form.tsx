'use client';

import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import { FormLayout } from '@astryxdesign/core/FormLayout';
import { HStack, Layout, LayoutContent, LayoutFooter } from '@astryxdesign/core/Layout';
import { RadioList, RadioListItem } from '@astryxdesign/core/RadioList';
import { Selector } from '@astryxdesign/core/Selector';
import { Switch } from '@astryxdesign/core/Switch';
import { TextInput } from '@astryxdesign/core/TextInput';
import { zodResolver } from '@hookform/resolvers/zod';
import type { NotificationChannel } from '@isbp/contracts';
import { ApiError } from '@isbp/sdk/web';
import { Form, FormField, fieldStatus } from '@isbp/ui/form';
import { countFilled, OptionalFields, useFieldList } from '@isbp/ui/optional-fields';
import { LockIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useMemo, useRef } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import { useApiMutation, useErrorText } from '@/lib/api';
import {
  CHANNEL_TYPES,
  CHANNELS_PATH,
  type ChannelType,
  localeLabel,
  MESSAGE_LOCALES,
  useChannelLabel,
} from './notification-meta';
import { TypePatternsField } from './type-patterns-field';

type Created = NotificationChannel & { signingSecret: string | null };

const PLACEHOLDER: Record<ChannelType, string> = {
  teams: 'https://prod-00.westeurope.logic.azure.com/workflows/…',
  slack: 'https://hooks.slack.com/services/T000/B000/XXXX',
  webhook: 'https://example.com/hooks/isbp',
};

const isHttpUrl = (value: string) => {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
};

/** Add (no `channel`) or edit a Teams / Slack / webhook channel. The URL is write-only. */
export function ChannelFormDialog({
  open,
  onOpenChange,
  channel,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  channel?: NotificationChannel;
  onCreated: (c: Created) => void;
}) {
  const t = useTranslations('notifications.admin.channels.form');
  const tc = useTranslations('common');
  const channelLabel = useChannelLabel();
  const errorText = useErrorText();
  const editing = Boolean(channel);
  const formId = useId();
  const list = useFieldList();

  const schema = useMemo(
    () =>
      z
        .object({
          name: z.string().trim().min(1, t('validation.name')).max(200, t('validation.nameLength')),
          type: z.enum(CHANNEL_TYPES),
          url: z.string().trim().max(2000, t('validation.url')),
          locale: z.enum(MESSAGE_LOCALES),
          types: z.array(z.string()).min(1, t('validation.types')).max(50, t('validation.typesMax')),
          enabled: z.boolean(),
        })
        .superRefine((v, ctx) => {
          if (!v.url && !editing)
            ctx.addIssue({ code: 'custom', path: ['url'], message: t('validation.urlRequired') });
          else if (v.url && !isHttpUrl(v.url))
            ctx.addIssue({ code: 'custom', path: ['url'], message: t('validation.url') });
        }),
    [t, editing],
  );
  type Values = z.input<typeof schema>;
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', type: 'teams', url: '', locale: 'en', types: [], enabled: true },
  });

  // Reset only when the dialog opens, so background refetches never clobber what's being typed.
  const wasOpen = useRef(false);
  useEffect(() => {
    const opening = open && !wasOpen.current;
    wasOpen.current = open;
    if (!opening) return;
    form.reset(
      channel
        ? {
            name: channel.name,
            type: channel.type,
            url: '',
            locale: (MESSAGE_LOCALES as readonly string[]).includes(channel.locale)
              ? (channel.locale as Values['locale'])
              : 'en',
            types: [...channel.types],
            enabled: channel.enabled,
          }
        : { name: '', type: 'teams', url: '', locale: 'en', types: [], enabled: true },
    );
  }, [open, channel, form]);

  const type = useWatch({ control: form.control, name: 'type' });
  const [locale, enabled] = useWatch({ control: form.control, name: ['locale', 'enabled'] });

  const create = useApiMutation((api, v: Values) => api.post<Created>(CHANNELS_PATH, v), {
    invalidate: [CHANNELS_PATH],
    success: (c) => t('created', { name: c.name }),
    onSuccess: (c) => {
      onOpenChange(false);
      onCreated(c);
    },
    silent: true,
  });
  const update = useApiMutation(
    (api, v: Partial<Values>) => api.patch<NotificationChannel>(`${CHANNELS_PATH}/${channel!.id}`, v),
    {
      invalidate: [CHANNELS_PATH],
      success: (c) => t('saved', { name: c.name }),
      onSuccess: () => onOpenChange(false),
      silent: true,
    },
  );
  const pending = create.isPending || update.isPending;

  const onSubmit = form.handleSubmit(async (v) => {
    const name = v.name.trim();
    const url = v.url.trim();
    try {
      if (editing) {
        await update.mutateAsync({
          name,
          locale: v.locale,
          types: v.types,
          enabled: v.enabled,
          ...(url ? { url } : {}),
        });
      } else {
        await create.mutateAsync({ ...v, name, url });
      }
    } catch (err) {
      if (err instanceof ApiError && err.code === 'WEBHOOK_TARGET_INVALID') {
        form.setError('url', { message: t('validation.target') }, { shouldFocus: true });
        return;
      }
      if (err instanceof ApiError && err.code === 'VALIDATION_FAILED') {
        const issues = (err.details as { issues?: { path: string }[] } | undefined)?.issues ?? [];
        const fields = ['name', 'url', 'types', 'locale'] as const;
        let mapped = false;
        for (const issue of issues) {
          const field = fields.find((f) => issue.path === f || issue.path.startsWith(`${f}.`));
          if (field) {
            form.setError(field, {
              message: field === 'url' ? t('validation.url') : t('validation.invalid'),
            });
            mapped = true;
          }
        }
        if (mapped) return;
      }
      form.setError('root', { message: errorText(err) });
    }
  });

  return (
    <Dialog isOpen={open} onOpenChange={onOpenChange} width={576} purpose="form">
      <Form {...form}>
        <Layout
          header={
            <DialogHeader
              title={editing ? t('editTitle', { name: channel!.name }) : t('createTitle')}
              subtitle={editing ? t('editDescription') : t('createDescription')}
              onOpenChange={onOpenChange}
            />
          }
          content={
            <LayoutContent padding={4}>
              <form id={formId} onSubmit={onSubmit} noValidate>
                <FormLayout defaultOptionality="required">
                  {editing ? (
                    <TextInput
                      label={t('type')}
                      isReadOnly
                      startIcon={LockIcon}
                      description={t('typeLocked')}
                      value={channelLabel(channel!.type)}
                      onChange={() => {}}
                    />
                  ) : (
                    <FormField
                      control={form.control}
                      name="type"
                      render={({ field }) => (
                        <RadioList label={t('type')} value={field.value} onChange={field.onChange}>
                          {CHANNEL_TYPES.map((ct) => (
                            <RadioListItem key={ct} value={ct} label={channelLabel(ct)} />
                          ))}
                        </RadioList>
                      )}
                    />
                  )}
                  <Banner status="info" title={t(`guide.${type}`)} collapsible={false} />
                  <FormField
                    control={form.control}
                    name="name"
                    render={({ field, fieldState }) => (
                      <TextInput
                        label={t('name')}
                        autoComplete="off"
                        placeholder={t('namePlaceholder')}
                        value={field.value}
                        onChange={field.onChange}
                        onBlur={field.onBlur}
                        ref={field.ref}
                        status={fieldStatus(fieldState)}
                      />
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="url"
                    render={({ field, fieldState }) => (
                      <TextInput
                        label={t('url')}
                        autoComplete="off"
                        isOptional={editing}
                        placeholder={editing ? t('urlKeepPlaceholder') : PLACEHOLDER[type]}
                        description={editing ? t('urlKeep', { host: channel!.host }) : t('urlHint')}
                        value={field.value}
                        onChange={field.onChange}
                        onBlur={field.onBlur}
                        ref={field.ref}
                        status={fieldStatus(fieldState)}
                      />
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="types"
                    render={({ field, fieldState }) => (
                      <TypePatternsField
                        value={field.value}
                        onChange={field.onChange}
                        status={fieldStatus(fieldState)}
                      />
                    )}
                  />
                  <OptionalFields
                    hint={list([t('locale'), t('enabled')])}
                    filled={countFilled(locale === 'en' ? '' : locale, !enabled)}
                  >
                    <FormLayout defaultOptionality="required">
                      <FormField
                        control={form.control}
                        name="locale"
                        render={({ field, fieldState }) => (
                          <Selector
                            label={t('locale')}
                            description={t('localeHint')}
                            options={MESSAGE_LOCALES.map((l) => ({ value: l, label: localeLabel(l) }))}
                            value={field.value}
                            onChange={(v) => field.onChange(v ?? 'en')}
                            status={fieldStatus(fieldState)}
                          />
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="enabled"
                        render={({ field }) => (
                          <Switch
                            label={t('enabled')}
                            description={t('enabledHint')}
                            value={field.value}
                            onChange={field.onChange}
                          />
                        )}
                      />
                    </FormLayout>
                  </OptionalFields>
                  {form.formState.errors.root && (
                    <Banner
                      status="error"
                      title={form.formState.errors.root.message ?? ''}
                      collapsible={false}
                    />
                  )}
                </FormLayout>
              </form>
            </LayoutContent>
          }
          footer={
            <LayoutFooter hasDivider padding={3}>
              <HStack gap={2} hAlign="end">
                <Button label={tc('cancel')} variant="ghost" onClick={() => onOpenChange(false)} />
                <Button
                  label={editing ? tc('saveChanges') : t('submit')}
                  variant="primary"
                  type="submit"
                  form={formId}
                  isLoading={pending}
                />
              </HStack>
            </LayoutFooter>
          }
        />
      </Form>
    </Dialog>
  );
}
