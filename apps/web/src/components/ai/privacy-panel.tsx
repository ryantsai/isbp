'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import type { AiConfigInfo, MaskCategory, UpdateAiConfigInput } from '@isbp/contracts';
import { ApiError } from '@isbp/sdk/web';
import { cn } from '@isbp/ui';
import { Button } from '@isbp/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@isbp/ui/card';
import { Checkbox } from '@isbp/ui/checkbox';
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
import { Skeleton } from '@isbp/ui/skeleton';
import { Switch } from '@isbp/ui/switch';
import { Textarea } from '@isbp/ui/textarea';
import { ArrowRightIcon, ShieldAlertIcon } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useMemo, useRef } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import { applyServerErrors, useApiMutation, useApiQuery, useErrorText } from '@/lib/api';
import { AI_PREFIX, CONFIG_PATH, useUsd } from './ai-meta';

/**
 * Category order and a static before → after example per category. The examples are what the gateway's
 * masker produces for them; the preview only reflects which categories are on, so it can't drift from
 * the server's patterns.
 */
const CATEGORIES: { id: MaskCategory; example: string; masked: string }[] = [
  { id: 'email', example: 'jane@example.com', masked: '[EMAIL_1]' },
  { id: 'phone', example: '+886 2 1234 5678', masked: '[PHONE_1]' },
  { id: 'ip', example: '10.0.4.17', masked: '[IP_1]' },
  { id: 'card', example: '4111 1111 1111 1111', masked: '[CARD_1]' },
  { id: 'id', example: 'A123456789', masked: '[ID_1]' },
  { id: 'secret', example: 'password=Tr0ub4dor&3', masked: 'password=[SECRET_1]' },
];

const AMOUNT_RE = /^\d+(?:\.\d{1,2})?$/;

export function PrivacyPanel() {
  const { data } = useApiQuery<AiConfigInfo>(CONFIG_PATH);
  if (!data)
    return (
      <Card className="max-w-3xl">
        <CardContent className="space-y-4">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-9 w-2/3" />
        </CardContent>
      </Card>
    );
  return <PrivacyForm config={data} />;
}

function PrivacyForm({ config }: { config: AiConfigInfo }) {
  const t = useTranslations('ai.privacy');
  const tc = useTranslations('common');
  const errorText = useErrorText();
  const usd = useUsd();

  const schema = useMemo(
    () =>
      z.object({
        enabled: z.boolean(),
        categories: z.array(z.enum(['email', 'phone', 'ip', 'card', 'id', 'secret'])),
        custom: z
          .string()
          .max(5000, t('validation.tooLong'))
          .superRefine((text, ctx) => {
            // The server compiles each line the same way and refuses the save on the first bad one.
            text.split('\n').forEach((raw, i) => {
              const line = raw.trim();
              if (!line) return;
              try {
                new RegExp(line);
              } catch {
                ctx.addIssue({ code: 'custom', message: t('validation.pattern', { line: i + 1 }) });
              }
            });
          }),
        budget: z
          .string()
          .trim()
          .refine((v) => v === '' || (AMOUNT_RE.test(v) && Number(v) <= 1_000_000), t('validation.budget')),
      }),
    [t],
  );
  type Values = z.input<typeof schema>;

  const toValues = (c: AiConfigInfo): Values => ({
    enabled: c.masking.enabled,
    categories: [...c.masking.categories],
    custom: c.masking.custom,
    budget: c.monthlyBudgetUsd ? String(c.monthlyBudgetUsd) : '',
  });

  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: toValues(config) });
  const enabled = useWatch({ control: form.control, name: 'enabled' });
  const categories = useWatch({ control: form.control, name: 'categories' });
  const dirty = form.formState.isDirty;

  const last = useRef(config);
  useEffect(() => {
    if (last.current === config) return;
    last.current = config;
    if (!form.formState.isDirty) form.reset(toValues(config));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config]);

  const save = useApiMutation((api, body: UpdateAiConfigInput) => api.put<AiConfigInfo>(CONFIG_PATH, body), {
    invalidate: [AI_PREFIX],
    success: t('saved'),
    onSuccess: (c) => {
      last.current = c;
      form.reset(toValues(c));
    },
    silent: true,
  });

  const onSubmit = form.handleSubmit(async (v) => {
    try {
      await save.mutateAsync({
        masking: {
          enabled: v.enabled,
          // Keep the canonical order whatever order the boxes were ticked in.
          categories: CATEGORIES.map((c) => c.id).filter((id) => v.categories.includes(id)),
          custom: v.custom
            .split('\n')
            .map((l) => l.trim())
            .filter(Boolean)
            .join('\n'),
        },
        monthlyBudgetUsd: v.budget.trim() ? Number(v.budget) : 0,
      });
    } catch (err) {
      if (applyServerErrors(err, form.setError as never)) return;
      const field = err instanceof ApiError ? (err.details as { field?: string } | undefined)?.field : null;
      if (field === 'masking.custom') {
        form.setError('custom', { message: t('validation.patternServer') });
        return;
      }
      form.setError('root', { message: errorText(err) });
    }
  });

  const toggle = (id: MaskCategory, on: boolean) => {
    const next = on ? [...categories, id] : categories.filter((c) => c !== id);
    form.setValue('categories', next, { shouldDirty: true });
  };

  return (
    <Form {...form}>
      <form onSubmit={onSubmit} noValidate className="max-w-3xl space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>{t('masking.title')}</CardTitle>
            <CardDescription>{t('masking.description')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <FormField
              control={form.control}
              name="enabled"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center justify-between gap-4 rounded-lg border px-3 py-3">
                  <div className="space-y-0.5">
                    <FormLabel>{t('masking.enabled')}</FormLabel>
                    <FormDescription>{t('masking.enabledHint')}</FormDescription>
                  </div>
                  <FormControl>
                    <Switch checked={field.value} onCheckedChange={field.onChange} />
                  </FormControl>
                </FormItem>
              )}
            />
            <AnimatePresence initial={false}>
              {!enabled && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden"
                >
                  <p className="flex items-start gap-2 rounded-lg bg-warning/15 px-3 py-2.5 text-sm text-warning-foreground">
                    <ShieldAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
                    {t('masking.offWarning')}
                  </p>
                </motion.div>
              )}
            </AnimatePresence>

            <fieldset className="space-y-3" disabled={!enabled}>
              <legend className="mb-1 text-sm font-semibold">{t('masking.categories')}</legend>
              <p className="text-xs text-muted-foreground">{t('masking.categoriesHint')}</p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {CATEGORIES.map((c) => (
                  <CategoryOption
                    key={c.id}
                    category={c}
                    checked={categories.includes(c.id)}
                    active={enabled}
                    onChange={(on) => toggle(c.id, on)}
                  />
                ))}
              </div>
            </fieldset>

            <FormField
              control={form.control}
              name="custom"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('masking.custom')}</FormLabel>
                  <FormControl>
                    <Textarea
                      rows={4}
                      spellCheck={false}
                      autoComplete="off"
                      disabled={!enabled}
                      placeholder={'EMP-\\d{6}\nASSET-[A-Z]{2}\\d{4}'}
                      className="font-mono text-sm"
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    {t('masking.customHint', { placeholder: '[REDACTED_1]' })}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('budget.title')}</CardTitle>
            <CardDescription>{t('budget.description')}</CardDescription>
          </CardHeader>
          <CardContent>
            <FormField
              control={form.control}
              name="budget"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('budget.label')}</FormLabel>
                  <div className="flex items-center gap-2">
                    <FormControl>
                      <Input
                        inputMode="decimal"
                        autoComplete="off"
                        placeholder="0"
                        className="tabular-nums sm:max-w-48"
                        {...field}
                      />
                    </FormControl>
                    <span className="text-sm text-muted-foreground" aria-hidden>
                      USD
                    </span>
                  </div>
                  <FormDescription>
                    {t('budget.hint', { code: 'AI_BUDGET_EXCEEDED' })}{' '}
                    {t('budget.spent', { spent: usd(config.spentThisMonthUsd) })}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </CardContent>
        </Card>

        {form.formState.errors.root && (
          <p role="alert" className="text-sm text-destructive">
            {form.formState.errors.root.message}
          </p>
        )}
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="ghost"
            disabled={!dirty || save.isPending}
            onClick={() => form.reset(toValues(config))}
          >
            {t('discard')}
          </Button>
          <Button type="submit" disabled={!dirty} loading={save.isPending}>
            {tc('saveChanges')}
          </Button>
        </div>
      </form>
    </Form>
  );
}

/** One category: checkbox, what it covers, and its before → after example (live with the switches). */
function CategoryOption({
  category,
  checked,
  active,
  onChange,
}: {
  category: (typeof CATEGORIES)[number];
  checked: boolean;
  active: boolean;
  onChange: (checked: boolean) => void;
}) {
  const t = useTranslations('ai.privacy.masking');
  const id = useId();
  const masked = active && checked;
  return (
    <div
      className={cn(
        'flex min-w-0 items-start gap-3 rounded-lg border p-3 transition-[border-color,background-color,opacity] duration-200',
        masked && 'border-primary/40 bg-primary/5',
        !active && 'opacity-60',
      )}
    >
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={(v) => onChange(v === true)}
        aria-describedby={`${id}-hint ${id}-example`}
        className="mt-0.5"
      />
      <div className="min-w-0 flex-1 space-y-1">
        <Label htmlFor={id} className="leading-snug">
          {t(`category.${category.id}.label`)}
        </Label>
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {t(`category.${category.id}.hint`)}
        </p>
        <p
          id={`${id}-example`}
          className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 font-mono text-[11px]"
        >
          <span className="sr-only">{t('example')}</span>
          <span className="break-all text-muted-foreground">{category.example}</span>
          <ArrowRightIcon className="size-3 shrink-0 text-muted-foreground" aria-hidden />
          <span className="sr-only">{t('becomes')}</span>
          {masked ? (
            <span className="rounded bg-primary/10 px-1 font-medium text-primary">{category.masked}</span>
          ) : (
            <span className="font-sans text-muted-foreground italic">{t('sentAsIs')}</span>
          )}
        </p>
      </div>
    </div>
  );
}
