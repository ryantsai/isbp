'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { type AuthProviderPublic, loginSchema } from '@isbp/contracts';
import { ApiError, createApiClient } from '@isbp/sdk/web';
import { Form, FormField, fieldStatus } from '@isbp/ui/form';
import { Disclosure, easeOut, Stagger, StaggerItem } from '@isbp/ui/motion';
import { ClipboardCheckIcon, KeyRoundIcon, LifeBuoyIcon, SmartphoneIcon } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { BrandMark } from '@/components/shell/brand';
import { LocaleSwitcher, ThemeToggle } from '@/components/shell/preferences';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { CheckboxInput } from '@astryxdesign/core/CheckboxInput';
import { FormLayout } from '@astryxdesign/core/FormLayout';
import { Icon as AstryxIcon } from '@astryxdesign/core/Icon';
import { Selector } from '@astryxdesign/core/Selector';
import { TextInput } from '@astryxdesign/core/TextInput';

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
      <aside className="relative hidden overflow-hidden bg-sidebar p-12 text-white lg:flex lg:flex-col">
        <Wafer />
        <div className="relative flex items-center gap-3">
          <BrandMark className="size-10" />
          <span className="text-lg font-semibold tracking-tight">{productName}</span>
        </div>
        <div className="relative mt-auto max-w-lg space-y-6">
          <motion.h2
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: easeOut }}
            className="text-[2.5rem] leading-[1.15] font-semibold tracking-tight text-balance text-white"
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
                <span className="grid size-8 place-items-center rounded-md bg-white/10 ring-1 ring-white/15">
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
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden"
              >
                <div className="pt-5">
                  <Banner
                    status={serverError ? 'error' : 'info'}
                    title={serverError ? errorText(serverError) : t('signedOut')}
                    collapsible={false}
                  />
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
                <Button
                  key={p.key}
                  label={t('ssoWith', { name: p.name })}
                  variant="secondary"
                  icon={<AstryxIcon icon={KeyRoundIcon} />}
                  href={`${p.startUrl}?next=${encodeURIComponent(next)}`}
                  width="100%"
                />
              ))}
              <div className="relative py-3 text-center text-xs text-muted-foreground">
                <span className="absolute inset-x-0 top-1/2 h-px bg-border" />
                <span className="relative bg-background px-2">{t('or')}</span>
              </div>
            </div>
          )}

          <Form {...form}>
            <form onSubmit={onSubmit} className={sso.length ? '' : 'mt-6'} noValidate>
              <FormLayout defaultOptionality="required">
                {directories.length > 0 && (
                  <FormField
                    control={form.control}
                    name="provider"
                    render={({ field }) => (
                      <Selector
                        label={t('directory')}
                        value={field.value ?? 'local'}
                        onChange={(v) => field.onChange(v === 'local' ? undefined : v)}
                        options={[
                          { value: 'local', label: t('localAccount') },
                          ...directories.map((d) => ({ value: d.key, label: d.name })),
                        ]}
                      />
                    )}
                  />
                )}
                <FormField
                  control={form.control}
                  name="username"
                  render={({ field, fieldState }) => (
                    <TextInput
                      label={t('username')}
                      autoComplete="username"
                      hasAutoFocus
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
                  name="password"
                  render={({ field, fieldState }) => (
                    <TextInput
                      label={t('password')}
                      type="password"
                      autoComplete="current-password"
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
                  name="remember"
                  render={({ field }) => (
                    <CheckboxInput
                      label={t('remember')}
                      value={field.value === true}
                      onChange={field.onChange}
                    />
                  )}
                />
                <Button
                  label={form.formState.isSubmitting ? t('submitting') : t('submit')}
                  variant="primary"
                  isLoading={form.formState.isSubmitting}
                  type="submit"
                  width="100%"
                />
              </FormLayout>
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

/** A wafer of dies in outline, one die lit in TEL green: what the company makes, drawn quietly behind the tagline. */
function Wafer() {
  const pitch = 36;
  const lines = Array.from({ length: Math.floor(600 / pitch) + 1 }, (_, i) => i * pitch + 12);
  return (
    <svg
      aria-hidden
      viewBox="0 0 600 600"
      className="pointer-events-none absolute -top-24 -right-56 size-[680px] text-white"
      fill="none"
    >
      <defs>
        <clipPath id="wafer-clip">
          <circle cx="300" cy="300" r="276" />
        </clipPath>
      </defs>
      <g clipPath="url(#wafer-clip)" stroke="currentColor" strokeOpacity="0.09">
        {lines.map((x) => (
          <line key={`v${x}`} x1={x} y1="0" x2={x} y2="600" />
        ))}
        {lines.map((y) => (
          <line key={`h${y}`} x1="0" y1={y} x2="600" y2={y} />
        ))}
      </g>
      <path
        // The wafer's edge, with its orientation notch at the bottom.
        d="M 312 575.74 A 276 276 0 1 0 288 575.74 A 12 12 0 0 1 312 575.74 Z"
        stroke="currentColor"
        strokeOpacity="0.22"
      />
      <rect
        x={12 + pitch * 6 + 3}
        y={12 + pitch * 7 + 3}
        width={pitch - 6}
        height={pitch - 6}
        className="fill-brand-green"
      />
    </svg>
  );
}
