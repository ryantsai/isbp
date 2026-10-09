'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { type AuthProviderPublic, loginSchema } from '@isbp/contracts';
import { ApiError, createApiClient } from '@isbp/sdk/web';
import { Button } from '@isbp/ui/button';
import { Checkbox } from '@isbp/ui/checkbox';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@isbp/ui/form';
import { Input } from '@isbp/ui/input';
import { Label } from '@isbp/ui/label';
import { Disclosure, easeOut, Stagger, StaggerItem } from '@isbp/ui/motion';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@isbp/ui/select';
import {
  ClipboardCheckIcon,
  CircleAlertIcon,
  InfoIcon,
  KeyRoundIcon,
  LifeBuoyIcon,
  SmartphoneIcon,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { BrandMark } from '@/components/shell/brand';
import { LocaleSwitcher, ThemeToggle } from '@/components/shell/preferences';

type LoginValues = z.input<typeof loginSchema>;

export function LoginView({
  providers,
  productName,
  banner,
  next,
  error,
  signedOut,
}: {
  providers: AuthProviderPublic[];
  productName: string;
  banner: string | null;
  next: string;
  error: string | null;
  signedOut: boolean;
}) {
  const t = useTranslations('auth');
  const [serverError, setServerError] = useState<string | null>(error);
  const directories = providers.filter((p) => p.type === 'ldap');
  const sso = providers.filter((p) => p.type !== 'ldap');
  const form = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { username: '', password: '', remember: false, provider: undefined },
  });

  const errorText = (code: string) => (t.has(`errors.${code}`) ? t(`errors.${code}`) : t('errors.generic'));

  const onSubmit = form.handleSubmit(async (values) => {
    setServerError(null);
    try {
      // Login is the one unsafe request made without a session, so no CSRF token exists yet.
      await createApiClient('').post('/auth/login', values);
      window.location.assign(next);
    } catch (err) {
      setServerError(err instanceof ApiError ? err.code : 'generic');
      form.setValue('password', '');
      form.setFocus('password');
    }
  });

  const features = [
    { icon: LifeBuoyIcon, label: t('features.help') },
    { icon: ClipboardCheckIcon, label: t('features.requests') },
    { icon: SmartphoneIcon, label: t('features.approve') },
  ];

  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.05fr_1fr]">
      {/* Brand panel */}
      <aside className="relative hidden overflow-hidden bg-[oklch(0.22_0.06_272)] p-12 text-white lg:flex lg:flex-col">
        <motion.div
          aria-hidden
          className="absolute -top-40 -left-40 size-[520px] rounded-full bg-indigo-500/40 blur-3xl"
          animate={{ x: [0, 60, 0], y: [0, 40, 0] }}
          transition={{ duration: 18, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.div
          aria-hidden
          className="absolute -right-32 bottom-0 size-[460px] rounded-full bg-violet-500/30 blur-3xl"
          animate={{ x: [0, -50, 0], y: [0, -30, 0] }}
          transition={{ duration: 22, repeat: Infinity, ease: 'easeInOut' }}
        />
        <div
          aria-hidden
          className="absolute inset-0 opacity-[0.07] [background-image:linear-gradient(white_1px,transparent_1px),linear-gradient(90deg,white_1px,transparent_1px)] [background-size:44px_44px]"
        />
        <div className="relative flex items-center gap-3">
          <BrandMark className="size-10" />
          <span className="text-lg font-semibold tracking-tight">{productName}</span>
        </div>
        <div className="relative mt-auto max-w-lg space-y-6">
          <motion.h2
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: easeOut }}
            className="text-4xl leading-tight font-semibold tracking-tight text-balance"
          >
            {t('tagline')}
          </motion.h2>
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.2, duration: 0.6 }}
            className="text-base text-white/70"
          >
            {t('taglineDetail')}
          </motion.p>
          <Stagger className="space-y-3 pt-2">
            {features.map(({ icon: Icon, label }) => (
              <StaggerItem key={label} className="flex items-center gap-3 text-sm text-white/85">
                <span className="grid size-8 place-items-center rounded-lg bg-white/10 ring-1 ring-white/15">
                  <Icon className="size-4" />
                </span>
                {label}
              </StaggerItem>
            ))}
          </Stagger>
        </div>
      </aside>

      {/* Form panel */}
      <main className="relative flex flex-col px-6 py-6 sm:px-10">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 lg:invisible">
            <BrandMark />
            <span className="font-semibold">{productName}</span>
          </div>
          <div className="flex items-center gap-1">
            <ThemeToggle />
            <LocaleSwitcher variant="full" />
          </div>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: easeOut }}
          className="m-auto w-full max-w-sm py-10"
        >
          <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">{t('subtitle', { product: productName })}</p>

          <AnimatePresence>
            {(serverError || signedOut) && (
              <motion.div
                key={serverError ?? 'signedOut'}
                role={serverError ? 'alert' : 'status'}
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden"
              >
                <div
                  className={`mt-5 flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm ${serverError ? 'border-destructive/30 bg-destructive/5 text-destructive' : 'border-success/30 bg-success/5 text-success'}`}
                >
                  {serverError ? (
                    <CircleAlertIcon className="mt-0.5 size-4 shrink-0" />
                  ) : (
                    <InfoIcon className="mt-0.5 size-4 shrink-0" />
                  )}
                  {serverError ? errorText(serverError) : t('signedOut')}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {banner && (
            <p className="mt-5 rounded-lg border bg-muted/50 px-3 py-2.5 text-xs text-muted-foreground">
              {banner}
            </p>
          )}

          {sso.length > 0 && (
            <div className="mt-6 space-y-2">
              {sso.map((p) => (
                <Button key={p.key} variant="outline" className="w-full" asChild>
                  <a href={`${p.startUrl}?next=${encodeURIComponent(next)}`}>
                    <KeyRoundIcon />
                    {t('ssoWith', { name: p.name })}
                  </a>
                </Button>
              ))}
              <div className="relative py-3 text-center text-xs text-muted-foreground">
                <span className="absolute inset-x-0 top-1/2 h-px bg-border" />
                <span className="relative bg-background px-2">{t('or')}</span>
              </div>
            </div>
          )}

          <Form {...form}>
            <form onSubmit={onSubmit} className={`space-y-4 ${sso.length ? '' : 'mt-6'}`} noValidate>
              {directories.length > 0 && (
                <FormField
                  control={form.control}
                  name="provider"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('directory')}</FormLabel>
                      <Select
                        value={field.value ?? 'local'}
                        onValueChange={(v) => field.onChange(v === 'local' ? undefined : v)}
                      >
                        <FormControl>
                          <SelectTrigger className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="local">{t('localAccount')}</SelectItem>
                          {directories.map((d) => (
                            <SelectItem key={d.key} value={d.key}>
                              {d.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormItem>
                  )}
                />
              )}
              <FormField
                control={form.control}
                name="username"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('username')}</FormLabel>
                    <FormControl>
                      <Input autoComplete="username" autoFocus {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('password')}</FormLabel>
                    <FormControl>
                      <Input type="password" autoComplete="current-password" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="remember"
                render={({ field }) => (
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="remember"
                      checked={field.value}
                      onCheckedChange={(v) => field.onChange(v === true)}
                    />
                    <Label htmlFor="remember" className="font-normal text-muted-foreground">
                      {t('remember')}
                    </Label>
                  </div>
                )}
              />
              <Button type="submit" className="w-full" loading={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? t('submitting') : t('submit')}
              </Button>
            </form>
          </Form>
          <Disclosure
            summary={t('cantSignIn')}
            className="mt-6 rounded-lg border"
            triggerClassName="w-full justify-between px-4 py-3 text-sm font-medium"
            contentClassName="px-4 pb-4 text-sm text-muted-foreground"
          >
            <p>{t('cantSignInBody')}</p>
          </Disclosure>
        </motion.div>
      </main>
    </div>
  );
}
