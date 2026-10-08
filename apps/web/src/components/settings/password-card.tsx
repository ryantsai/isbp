'use client';

import { changePasswordSchema, type Me } from '@isbp/contracts';
import { ApiError } from '@isbp/sdk/web';
import { Button } from '@isbp/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@isbp/ui/card';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@isbp/ui/form';
import { Input } from '@isbp/ui/input';
import { Skeleton } from '@isbp/ui/skeleton';
import { CheckIcon, CircleIcon, KeyRoundIcon, ShieldCheckIcon, TriangleAlertIcon } from 'lucide-react';
import { motion } from 'motion/react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import {
  type FieldProblem,
  problemResolver,
  type ValidationText,
  zodProblems,
} from '@/components/idp/contract-resolver';
import { SourceBadge } from '@/components/status-badge';
import { applyServerErrors, useApiMutation, useErrorText } from '@/lib/api';
import { PASSWORD_REQUIRED_PARAM, safeNextPath } from '@/lib/password-change';

interface Values {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

/** Mirrors the contract's password policy for live feedback; the API stays authoritative. */
const MIN_LENGTH = 10;
const MIN_DISTINCT = 5;

function Rule({ ok, state, children }: { ok: boolean; state: string; children: string }) {
  return (
    <li
      className={
        ok ? 'flex items-center gap-2 text-success' : 'flex items-center gap-2 text-muted-foreground'
      }
    >
      <motion.span
        key={String(ok)}
        initial={{ scale: 0.5 }}
        animate={{ scale: 1 }}
        transition={{ type: 'spring', stiffness: 500, damping: 25 }}
      >
        {ok ? (
          <CheckIcon className="size-3.5" aria-hidden />
        ) : (
          <CircleIcon className="size-3.5" aria-hidden />
        )}
      </motion.span>
      <span>{children}</span>
      <span className="sr-only">{state}</span>
    </li>
  );
}

export function PasswordCard({ me, loading }: { me: Me | undefined; loading: boolean }) {
  const t = useTranslations('settings.password');
  const tv = useTranslations('settings.validation');
  const errorText = useErrorText();
  const vt: ValidationText = (key, values) => tv(key, values);

  const form = useForm<Values>({
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
    resolver: problemResolver<Values>((v) => {
      const parsed = changePasswordSchema.safeParse({
        currentPassword: v.currentPassword,
        newPassword: v.newPassword,
      });
      const problems: FieldProblem[] = zodProblems(parsed.error?.issues, vt, {
        message: (issue, field) => {
          if (field !== 'newPassword') return undefined;
          if (issue.code === 'too_small')
            return v.newPassword ? t('rules.length', { min: MIN_LENGTH }) : tv('required');
          if (issue.code === 'custom') return t('rules.variety');
          return undefined;
        },
      });
      if (v.confirmPassword !== v.newPassword)
        problems.push({ path: 'confirmPassword', message: t('mismatch') });
      return problems;
    }),
  });

  const router = useRouter();
  const sp = useSearchParams();
  // Sent here right after sign-in because an administrator requires a new password.
  const prompted = sp.get(PASSWORD_REQUIRED_PARAM) === 'required';
  const mustChange = Boolean(me?.mustChangePassword && me.authSource === 'local');

  useEffect(() => {
    if (!prompted || !mustChange) return;
    document.getElementById('security')?.scrollIntoView({ block: 'start' });
    form.setFocus('currentPassword');
  }, [prompted, mustChange, form]);

  const change = useApiMutation(
    (api, body: { currentPassword: string; newPassword: string }) => api.post('/me/password', body),
    {
      invalidate: ['/me'],
      success: t('changed'),
      onSuccess: () => {
        form.reset();
        if (!mustChange) return;
        // The session the shell holds still says "must change": reload it, going on to where they were going.
        if (prompted) window.location.assign(safeNextPath(sp.get('next')) ?? '/');
        else router.refresh();
      },
      silent: true,
    },
  );

  const onSubmit = form.handleSubmit(async ({ currentPassword, newPassword }) => {
    try {
      await change.mutateAsync({ currentPassword, newPassword });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'INVALID_CREDENTIALS')
        form.setError('currentPassword', { message: t('wrongCurrent') });
      else if (!applyServerErrors(err, form.setError as never))
        form.setError('root', { message: errorText(err) });
    }
  });

  const [next, confirm] = useWatch({ control: form.control, name: ['newPassword', 'confirmPassword'] });
  const rules = [
    { ok: (next ?? '').length >= MIN_LENGTH, label: t('rules.length', { min: MIN_LENGTH }) },
    { ok: new Set(next ?? '').size >= MIN_DISTINCT, label: t('rules.variety') },
    { ok: Boolean(next) && next === confirm, label: t('rules.match') },
  ];

  return (
    <Card id="security" className="scroll-mt-20">
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent>
        {loading || !me ? (
          <div className="space-y-3">
            <Skeleton className="h-9 w-full sm:w-80" />
            <Skeleton className="h-9 w-full sm:w-80" />
          </div>
        ) : me.authSource !== 'local' ? (
          <div className="flex items-start gap-3 rounded-lg border bg-muted/30 p-4 text-sm">
            <ShieldCheckIcon className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
            <div className="space-y-1.5">
              <p className="flex flex-wrap items-center gap-2 font-medium">
                {t('external.title')} <SourceBadge source={me.authSource} />
              </p>
              <p className="text-muted-foreground">{t('external.body')}</p>
            </div>
          </div>
        ) : (
          <Form {...form}>
            <form onSubmit={onSubmit} noValidate className="space-y-4">
              {me.mustChangePassword && (
                <p className="flex items-center gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning-foreground">
                  <TriangleAlertIcon className="size-4 shrink-0" aria-hidden />
                  {t('mustChange')}
                </p>
              )}
              <div className="grid gap-4 sm:max-w-sm">
                <FormField
                  control={form.control}
                  name="currentPassword"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('current')}</FormLabel>
                      <FormControl>
                        <Input type="password" autoComplete="current-password" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="newPassword"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('new')}</FormLabel>
                      <FormControl>
                        <Input type="password" autoComplete="new-password" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="confirmPassword"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('confirm')}</FormLabel>
                      <FormControl>
                        <Input type="password" autoComplete="new-password" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <ul aria-label={t('rules.label')} className="space-y-1 text-xs">
                {rules.map((r) => (
                  <Rule key={r.label} ok={r.ok} state={r.ok ? t('rules.met') : t('rules.notMet')}>
                    {r.label}
                  </Rule>
                ))}
              </ul>
              {form.formState.errors.root && (
                <p role="alert" className="text-sm text-destructive">
                  {form.formState.errors.root.message}
                </p>
              )}
              <div className="flex flex-wrap items-center gap-3">
                <Button type="submit" loading={change.isPending}>
                  {!change.isPending && <KeyRoundIcon />} {t('submit')}
                </Button>
                <p className="text-xs text-muted-foreground">{t('signOutNote')}</p>
              </div>
            </form>
          </Form>
        )}
      </CardContent>
    </Card>
  );
}
