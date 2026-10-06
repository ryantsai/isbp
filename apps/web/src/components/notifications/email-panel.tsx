'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import type { EmailSettings, UpdateEmailSettingsInput } from '@isbp/contracts';
import { ApiError, usePlatform } from '@isbp/sdk/web';
import { Badge } from '@isbp/ui/badge';
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
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@isbp/ui/form';
import { Input } from '@isbp/ui/input';
import { Label } from '@isbp/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@isbp/ui/select';
import { Skeleton } from '@isbp/ui/skeleton';
import { Switch } from '@isbp/ui/switch';
import {
  CircleCheckIcon,
  CircleMinusIcon,
  CircleXIcon,
  KeyRoundIcon,
  SendIcon,
  TriangleAlertIcon,
  Undo2Icon,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
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
    return (
      <Badge variant="success">
        <CircleCheckIcon aria-hidden /> {t('ready')}
      </Badge>
    );
  if (settings.enabled)
    return (
      <Badge variant="warning">
        <TriangleAlertIcon aria-hidden /> {t('incomplete')}
      </Badge>
    );
  return (
    <Badge variant="muted">
      <CircleMinusIcon aria-hidden /> {t('off')}
    </Badge>
  );
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
          <form onSubmit={onSubmit} noValidate className="space-y-6">
            <FormField
              control={form.control}
              name="enabled"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center justify-between gap-4 rounded-lg border px-3 py-3">
                  <div className="space-y-0.5">
                    <FormLabel>{t('enabled')}</FormLabel>
                    <FormDescription>{t('enabledHint')}</FormDescription>
                  </div>
                  <FormControl>
                    <Switch checked={field.value} onCheckedChange={field.onChange} />
                  </FormControl>
                </FormItem>
              )}
            />

            <fieldset className="space-y-4">
              <legend className="mb-3 text-sm font-semibold">{t('server')}</legend>
              <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_7rem]">
                <FormField
                  control={form.control}
                  name="host"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('host')}</FormLabel>
                      <FormControl>
                        <Input
                          autoComplete="off"
                          spellCheck={false}
                          placeholder="smtp.example.com"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="port"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('port')}</FormLabel>
                      <FormControl>
                        <Input inputMode="numeric" autoComplete="off" className="tabular-nums" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <FormField
                control={form.control}
                name="tls"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('tls')}</FormLabel>
                    <Select
                      value={field.value}
                      onValueChange={(v) => {
                        onTlsChange(v as 'starttls' | 'tls', field.value);
                        field.onChange(v);
                      }}
                    >
                      <FormControl>
                        <SelectTrigger className="w-full sm:w-80">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="starttls">{t('tlsModes.starttls')}</SelectItem>
                        <SelectItem value="tls">{t('tlsModes.tls')}</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormDescription>{t('tlsHint')}</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </fieldset>

            <fieldset className="space-y-4">
              <legend className="mb-1 text-sm font-semibold">{t('auth')}</legend>
              <p className="text-xs text-muted-foreground">{t('authHint')}</p>
              <div className="grid items-start gap-4 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="username"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('username')}</FormLabel>
                      <FormControl>
                        <Input autoComplete="off" spellCheck={false} {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="grid content-start gap-2">
                  <Label htmlFor={passwordId}>{t('password')}</Label>
                  <AnimatePresence mode="wait" initial={false}>
                    {passwordMode === 'keep' ? (
                      <motion.div
                        key="keep"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="flex min-h-9 flex-wrap items-center gap-x-2 gap-y-1 rounded-md border bg-muted/30 px-3 py-1.5"
                      >
                        <KeyRoundIcon className="size-4 text-success" aria-hidden />
                        <span id={passwordId} className="flex-1 text-sm">
                          {t('passwordStored')}
                        </span>
                        <Button
                          type="button"
                          variant="link"
                          size="sm"
                          className="h-auto px-0"
                          onClick={() => setPasswordMode('replace')}
                        >
                          {t('passwordReplace')}
                        </Button>
                        <Button
                          type="button"
                          variant="link"
                          size="sm"
                          className="h-auto px-0 text-destructive"
                          onClick={() => setPasswordMode('remove')}
                        >
                          {t('passwordRemove')}
                        </Button>
                      </motion.div>
                    ) : passwordMode === 'remove' ? (
                      <motion.div
                        key="remove"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="flex min-h-9 items-center gap-2 rounded-md border border-dashed px-3 py-1.5"
                      >
                        <CircleXIcon className="size-4 text-destructive" aria-hidden />
                        <span id={passwordId} className="flex-1 text-sm">
                          {t('passwordWillRemove')}
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setPasswordMode('keep')}
                        >
                          <Undo2Icon /> {t('undo')}
                        </Button>
                      </motion.div>
                    ) : (
                      <motion.div
                        key="replace"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                      >
                        <FormField
                          control={form.control}
                          name="password"
                          render={({ field }) => (
                            <>
                              <Input
                                id={passwordId}
                                type="password"
                                autoComplete="new-password"
                                placeholder={settings.passwordSet ? t('passwordNewPlaceholder') : undefined}
                                {...field}
                              />
                              {settings.passwordSet && (
                                <Button
                                  type="button"
                                  variant="link"
                                  size="sm"
                                  className="h-auto px-0 pt-1.5"
                                  onClick={() => setPasswordMode('keep')}
                                >
                                  {t('passwordKeep')}
                                </Button>
                              )}
                            </>
                          )}
                        />
                      </motion.div>
                    )}
                  </AnimatePresence>
                  <p className="text-xs text-muted-foreground">{t('passwordHint')}</p>
                </div>
              </div>
            </fieldset>

            <FormField
              control={form.control}
              name="from"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('from')}</FormLabel>
                  <FormControl>
                    <Input autoComplete="off" spellCheck={false} placeholder={SENDER_EXAMPLE} {...field} />
                  </FormControl>
                  <FormDescription>{t('fromHint', { example: SENDER_EXAMPLE })}</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            {enabled && !settings.enabled && (
              <p className="text-xs text-muted-foreground">{t('enableNote')}</p>
            )}
            {form.formState.errors.root && (
              <p role="alert" className="text-sm text-destructive">
                {form.formState.errors.root.message}
              </p>
            )}

            <div className="flex flex-col gap-3 border-t pt-5 sm:flex-row sm:items-center">
              <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3">
                <Button
                  type="button"
                  variant="outline"
                  disabled={Boolean(testBlocked)}
                  onClick={() => {
                    setTestKey((k) => k + 1);
                    setTestOpen(true);
                  }}
                  aria-describedby={testBlocked ? `${passwordId}-test` : undefined}
                >
                  <SendIcon /> {t('test.button')}
                </Button>
                {testBlocked && (
                  <span id={`${passwordId}-test`} className="text-xs text-muted-foreground">
                    {testBlocked}
                  </span>
                )}
              </div>
              <div className="flex gap-2 sm:ml-auto">
                <Button
                  type="button"
                  variant="ghost"
                  disabled={!dirty || save.isPending}
                  onClick={() => form.reset(toValues(settings))}
                  className="flex-1 sm:flex-none"
                >
                  {t('discard')}
                </Button>
                <Button
                  type="submit"
                  disabled={!dirty}
                  loading={save.isPending}
                  className="flex-1 sm:flex-none"
                >
                  {tc('saveChanges')}
                </Button>
              </div>
            </div>
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
  const inputId = useId();

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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={tc('close')}>
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} noValidate className="space-y-4">
          <div className="grid gap-2">
            <Label htmlFor={inputId}>{t('to')}</Label>
            <Input
              id={inputId}
              type="email"
              autoComplete="email"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              aria-invalid={Boolean(error) || undefined}
              aria-describedby={error ? `${inputId}-error` : undefined}
            />
            {error && (
              <p id={`${inputId}-error`} className="text-xs text-destructive">
                {error}
              </p>
            )}
          </div>
          <div aria-live="polite">
            <AnimatePresence initial={false}>
              {result && (
                <motion.div
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className={
                    result.ok
                      ? 'flex items-start gap-2 rounded-lg bg-success/10 px-3 py-2.5 text-sm'
                      : 'flex items-start gap-2 rounded-lg bg-destructive/8 px-3 py-2.5 text-sm'
                  }
                >
                  {result.ok ? (
                    <CircleCheckIcon className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
                  ) : (
                    <CircleXIcon className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
                  )}
                  <div className="min-w-0">
                    <p className="font-medium">{result.ok ? t('sent', { to: result.to }) : result.message}</p>
                    {!result.ok && result.reason && (
                      <p className="mt-0.5 font-mono text-xs break-words text-muted-foreground">
                        {result.reason}
                      </p>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {tc('close')}
            </Button>
            <Button type="submit" loading={send.isPending}>
              {!send.isPending && <SendIcon />} {t('send')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
