'use client';

import { Badge } from '@astryxdesign/core/Badge';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import { Field } from '@astryxdesign/core/Field';
import { FormLayout } from '@astryxdesign/core/FormLayout';
import { Icon } from '@astryxdesign/core/Icon';
import { HStack, Layout, LayoutContent, LayoutFooter, StackItem, VStack } from '@astryxdesign/core/Layout';
import { Selector } from '@astryxdesign/core/Selector';
import { Switch } from '@astryxdesign/core/Switch';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import { zodResolver } from '@hookform/resolvers/zod';
import type { EmailSettings, UpdateEmailSettingsInput } from '@isbp/contracts';
import { ApiError, usePlatform } from '@isbp/sdk/web';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@isbp/ui/card';
import { Form, FormField, fieldStatus } from '@isbp/ui/form';
import { Skeleton } from '@isbp/ui/skeleton';
import {
  CircleCheckIcon,
  CircleMinusIcon,
  KeyRoundIcon,
  SendIcon,
  TriangleAlertIcon,
  Undo2Icon,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type FormEvent, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import { applyServerErrors, useApiMutation, useApiQuery, useErrorText } from '@/lib/api';
import { PREFS_PATH } from './notification-meta';

const PATH = '/notifications/email';
const SENDER_RE = /^(?:[^<>]*<\s*[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+\s*>|[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+)$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DEFAULT_PORT = { starttls: 587, tls: 465 } as const;
const SENDER_EXAMPLE = 'IS Big Platform <noreply@example.com>';

type PasswordMode = 'keep' | 'replace' | 'remove';

/** Ready (can send) / Not configured (on, but incomplete) / Off — icon + text. */
export function EmailStatusBadge({ settings }: { settings: Pick<EmailSettings, 'enabled' | 'available'> }) {
  const t = useTranslations('notifications.admin.email.status');
  if (settings.available)
    return <Badge variant="success" label={t('ready')} icon={<Icon icon={CircleCheckIcon} size="xsm" />} />;
  if (settings.enabled)
    return (
      <Badge variant="warning" label={t('incomplete')} icon={<Icon icon={TriangleAlertIcon} size="xsm" />} />
    );
  return <Badge variant="neutral" label={t('off')} icon={<Icon icon={CircleMinusIcon} size="xsm" />} />;
}

export function EmailPanel() {
  const { data, isLoading } = useApiQuery<EmailSettings>(PATH);
  if (isLoading || !data)
    return (
      <Card className="max-w-3xl">
        <CardContent className="space-y-4">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-2/3" />
        </CardContent>
      </Card>
    );
  return <EmailForm settings={data} />;
}

function EmailForm({ settings }: { settings: EmailSettings }) {
  const t = useTranslations('notifications.admin.email');
  const tc = useTranslations('common');
  const errorText = useErrorText();
  const [testOpen, setTestOpen] = useState(false);
  // A fresh dialog (empty result) each time it opens.
  const [testKey, setTestKey] = useState(0);
  const passwordId = useId();

  const schema = useMemo(
    () =>
      z
        .object({
          enabled: z.boolean(),
          host: z.string().trim().max(255, t('validation.tooLong')),
          port: z.string().trim(),
          tls: z.enum(['starttls', 'tls']),
          username: z.string().trim().max(320, t('validation.tooLong')),
          passwordMode: z.enum(['keep', 'replace', 'remove']),
          password: z.string().max(500, t('validation.tooLong')),
          from: z.string().trim().max(320, t('validation.tooLong')),
        })
        .superRefine((v, ctx) => {
          const port = Number(v.port);
          if (!/^\d+$/.test(v.port) || port < 1 || port > 65535)
            ctx.addIssue({ code: 'custom', path: ['port'], message: t('validation.port') });
          if (v.enabled && !v.host)
            ctx.addIssue({ code: 'custom', path: ['host'], message: t('validation.hostRequired') });
          if (v.enabled && !v.from)
            ctx.addIssue({ code: 'custom', path: ['from'], message: t('validation.fromRequired') });
          else if (v.from && !SENDER_RE.test(v.from))
            ctx.addIssue({
              code: 'custom',
              path: ['from'],
              message: t('validation.from', { example: SENDER_EXAMPLE }),
            });
        }),
    [t],
  );
  type Values = z.input<typeof schema>;

  const toValues = (s: EmailSettings): Values => ({
    enabled: s.enabled,
    host: s.host,
    port: String(s.port),
    tls: s.secure ? 'tls' : 'starttls',
    username: s.username,
    passwordMode: s.passwordSet ? 'keep' : 'replace',
    password: '',
    from: s.from,
  });

  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: toValues(settings) });
  const enabled = useWatch({ control: form.control, name: 'enabled' });
  const passwordMode = useWatch({ control: form.control, name: 'passwordMode' });
  const dirty = form.formState.isDirty;

  // Pick up changes saved elsewhere while nothing is being edited here.
  const last = useRef(settings);
  useEffect(() => {
    if (last.current === settings) return;
    last.current = settings;
    if (!form.formState.isDirty) form.reset(toValues(settings));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings]);

  const save = useApiMutation((api, body: UpdateEmailSettingsInput) => api.put<EmailSettings>(PATH, body), {
    // Users' preferences show whether email can be chosen.
    invalidate: [PATH, PREFS_PATH],
    success: t('saved'),
    onSuccess: (s) => {
      last.current = s;
      form.reset(toValues(s));
    },
    silent: true,
  });

  const onSubmit = form.handleSubmit(async (v) => {
    const body: UpdateEmailSettingsInput = {
      enabled: v.enabled,
      host: v.host.trim(),
      port: Number(v.port),
      secure: v.tls === 'tls',
      username: v.username.trim(),
      from: v.from.trim(),
    };
    if (v.passwordMode === 'remove') body.password = '';
    else if (v.passwordMode === 'replace' && v.password) body.password = v.password;
    try {
      await save.mutateAsync(body);
    } catch (err) {
      if (applyServerErrors(err, form.setError as never)) return;
      form.setError('root', { message: errorText(err) });
    }
  });

  const onTlsChange = (next: 'starttls' | 'tls', current: 'starttls' | 'tls') => {
    // Follow the usual port for the mode unless a custom one was typed.
    const port = form.getValues('port');
    if (port === String(DEFAULT_PORT[current]))
      form.setValue('port', String(DEFAULT_PORT[next]), { shouldDirty: true });
  };

  const setPasswordMode = (mode: PasswordMode) => {
    form.setValue('passwordMode', mode, { shouldDirty: true });
    form.setValue('password', '', { shouldDirty: true });
  };

  const testBlocked = dirty ? t('test.saveFirst') : !settings.available ? t('test.notReady') : null;

  return (
    <Card className="max-w-3xl">
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('description')}</CardDescription>
        <CardAction>
          <EmailStatusBadge settings={settings} />
        </CardAction>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={onSubmit} noValidate>
            <VStack gap={5}>
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

              <VStack gap={3}>
                <Text type="label">{t('server')}</Text>
                <FormLayout defaultOptionality="optional">
                  <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_7rem]">
                    <FormField
                      control={form.control}
                      name="host"
                      render={({ field, fieldState }) => (
                        <TextInput
                          label={t('host')}
                          autoComplete="off"
                          placeholder="smtp.example.com"
                          isRequired={enabled}
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
                      name="port"
                      render={({ field, fieldState }) => (
                        <TextInput
                          label={t('port')}
                          autoComplete="off"
                          isRequired
                          value={field.value}
                          onChange={field.onChange}
                          onBlur={field.onBlur}
                          ref={field.ref}
                          status={fieldStatus(fieldState)}
                        />
                      )}
                    />
                  </div>
                  <FormField
                    control={form.control}
                    name="tls"
                    render={({ field, fieldState }) => (
                      <Selector
                        label={t('tls')}
                        description={t('tlsHint')}
                        width="min(100%, 20rem)"
                        options={[
                          { value: 'starttls', label: t('tlsModes.starttls') },
                          { value: 'tls', label: t('tlsModes.tls') },
                        ]}
                        value={field.value}
                        onChange={(v) => {
                          if (v !== 'starttls' && v !== 'tls') return;
                          onTlsChange(v, field.value);
                          field.onChange(v);
                        }}
                        status={fieldStatus(fieldState)}
                      />
                    )}
                  />
                </FormLayout>
              </VStack>

              <VStack gap={3}>
                <VStack gap={0.5}>
                  <Text type="label">{t('auth')}</Text>
                  <Text type="supporting" color="secondary">
                    {t('authHint')}
                  </Text>
                </VStack>
                <div className="grid items-end gap-4 sm:grid-cols-2">
                  <FormField
                    control={form.control}
                    name="username"
                    render={({ field, fieldState }) => (
                      <TextInput
                        label={t('username')}
                        autoComplete="off"
                        value={field.value}
                        onChange={field.onChange}
                        onBlur={field.onBlur}
                        ref={field.ref}
                        status={fieldStatus(fieldState)}
                      />
                    )}
                  />
                  {passwordMode === 'replace' ? (
                    <VStack gap={1}>
                      <FormField
                        control={form.control}
                        name="password"
                        render={({ field, fieldState }) => (
                          <TextInput
                            label={t('password')}
                            type="password"
                            autoComplete="new-password"
                            placeholder={settings.passwordSet ? t('passwordNewPlaceholder') : undefined}
                            description={t('passwordHint')}
                            value={field.value}
                            onChange={field.onChange}
                            onBlur={field.onBlur}
                            ref={field.ref}
                            status={fieldStatus(fieldState)}
                          />
                        )}
                      />
                      {settings.passwordSet && (
                        <HStack>
                          <Button
                            label={t('passwordKeep')}
                            variant="ghost"
                            size="sm"
                            onClick={() => setPasswordMode('keep')}
                          />
                        </HStack>
                      )}
                    </VStack>
                  ) : (
                    <Field label={t('password')} inputID={passwordId} description={t('passwordHint')}>
                      {passwordMode === 'keep' ? (
                        <HStack gap={2} vAlign="center" wrap="wrap">
                          <Icon icon={KeyRoundIcon} color="success" />
                          <StackItem size="fill">
                            <Text id={passwordId}>{t('passwordStored')}</Text>
                          </StackItem>
                          <Button
                            label={t('passwordReplace')}
                            variant="ghost"
                            size="sm"
                            onClick={() => setPasswordMode('replace')}
                          />
                          <Button
                            label={t('passwordRemove')}
                            variant="ghost"
                            size="sm"
                            onClick={() => setPasswordMode('remove')}
                          />
                        </HStack>
                      ) : (
                        <HStack gap={2} vAlign="center" wrap="wrap">
                          <StackItem size="fill">
                            <Text id={passwordId}>{t('passwordWillRemove')}</Text>
                          </StackItem>
                          <Button
                            label={t('undo')}
                            variant="ghost"
                            size="sm"
                            icon={<Icon icon={Undo2Icon} />}
                            onClick={() => setPasswordMode('keep')}
                          />
                        </HStack>
                      )}
                    </Field>
                  )}
                </div>
              </VStack>

              <FormLayout defaultOptionality="optional">
                <FormField
                  control={form.control}
                  name="from"
                  render={({ field, fieldState }) => (
                    <TextInput
                      label={t('from')}
                      autoComplete="off"
                      placeholder={SENDER_EXAMPLE}
                      description={t('fromHint', { example: SENDER_EXAMPLE })}
                      isRequired={enabled}
                      value={field.value}
                      onChange={field.onChange}
                      onBlur={field.onBlur}
                      ref={field.ref}
                      status={fieldStatus(fieldState)}
                    />
                  )}
                />
              </FormLayout>

              {enabled && !settings.enabled && (
                <Text type="supporting" color="secondary">
                  {t('enableNote')}
                </Text>
              )}
              {form.formState.errors.root && (
                <Banner status="error" title={form.formState.errors.root.message ?? ''} collapsible={false} />
              )}

              <div className="flex flex-col gap-3 border-t pt-5 sm:flex-row sm:items-center">
                <HStack gap={3} vAlign="center" wrap="wrap">
                  <Button
                    label={t('test.button')}
                    variant="secondary"
                    icon={<Icon icon={SendIcon} />}
                    isDisabled={Boolean(testBlocked)}
                    onClick={() => {
                      setTestKey((k) => k + 1);
                      setTestOpen(true);
                    }}
                  />
                  {testBlocked && (
                    <Text type="supporting" color="secondary">
                      {testBlocked}
                    </Text>
                  )}
                </HStack>
                <HStack gap={2} className="sm:ml-auto">
                  <Button
                    label={t('discard')}
                    variant="ghost"
                    isDisabled={!dirty || save.isPending}
                    onClick={() => form.reset(toValues(settings))}
                  />
                  <Button
                    label={tc('saveChanges')}
                    variant="primary"
                    type="submit"
                    isLoading={save.isPending}
                    isDisabled={!dirty}
                  />
                </HStack>
              </div>
            </VStack>
          </form>
        </Form>
      </CardContent>
      <TestEmailDialog key={testKey} open={testOpen} onOpenChange={setTestOpen} />
    </Card>
  );
}

type TestState = { ok: true; to: string } | { ok: false; message: string; reason: string | null } | null;

function TestEmailDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useTranslations('notifications.admin.email.test');
  const tc = useTranslations('common');
  const errorText = useErrorText();
  const { user } = usePlatform();
  const [to, setTo] = useState(user.email);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TestState>(null);
  const formId = useId();

  const send = useApiMutation((api, address: string) => api.post(`${PATH}/test`, { to: address }), {
    silent: true,
  });
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const address = to.trim();
    if (!EMAIL_RE.test(address)) {
      setError(t('invalid'));
      return;
    }
    setError(null);
    setResult(null);
    try {
      await send.mutateAsync(address);
      setResult({ ok: true, to: address });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'EMAIL_NOT_CONFIGURED')
        setResult({ ok: false, message: t('notConfigured'), reason: null });
      else if (err instanceof ApiError && err.code === 'DELIVERY_FAILED')
        setResult({
          ok: false,
          message: t('failed'),
          reason: (err.details as { reason?: string } | undefined)?.reason ?? null,
        });
      else setResult({ ok: false, message: errorText(err), reason: null });
    }
  };

  return (
    <Dialog isOpen={open} onOpenChange={onOpenChange} width={448} purpose="form">
      <Layout
        header={<DialogHeader title={t('title')} subtitle={t('description')} onOpenChange={onOpenChange} />}
        content={
          <LayoutContent padding={4}>
            <form id={formId} onSubmit={submit} noValidate>
              <VStack gap={4}>
                <TextInput
                  label={t('to')}
                  type="email"
                  autoComplete="email"
                  isRequired
                  value={to}
                  onChange={setTo}
                  status={error ? { type: 'error', message: error } : undefined}
                />
                <div aria-live="polite">
                  {result &&
                    (result.ok ? (
                      <Banner status="success" title={t('sent', { to: result.to })} collapsible={false} />
                    ) : (
                      <Banner status="error" title={result.message} collapsible={false}>
                        {result.reason && (
                          <Text type="code" color="secondary">
                            {result.reason}
                          </Text>
                        )}
                      </Banner>
                    ))}
                </div>
              </VStack>
            </form>
          </LayoutContent>
        }
        footer={
          <LayoutFooter hasDivider padding={3}>
            <HStack gap={2} hAlign="end">
              <Button label={tc('close')} variant="ghost" onClick={() => onOpenChange(false)} />
              <Button
                label={t('send')}
                variant="primary"
                type="submit"
                form={formId}
                icon={<Icon icon={SendIcon} />}
                isLoading={send.isPending}
              />
            </HStack>
          </LayoutFooter>
        }
      />
    </Dialog>
  );
}
