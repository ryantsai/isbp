'use client';

import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Card as AstryxCard } from '@astryxdesign/core/Card';
import { CheckboxInput } from '@astryxdesign/core/CheckboxInput';
import { Grid } from '@astryxdesign/core/Grid';
import { Icon } from '@astryxdesign/core/Icon';
import { InputGroup, InputGroupText } from '@astryxdesign/core/InputGroup';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { Switch } from '@astryxdesign/core/Switch';
import { Text } from '@astryxdesign/core/Text';
import { TextArea } from '@astryxdesign/core/TextArea';
import { TextInput } from '@astryxdesign/core/TextInput';
import { zodResolver } from '@hookform/resolvers/zod';
import type { AiConfigInfo, MaskCategory, UpdateAiConfigInput } from '@isbp/contracts';
import { ApiError } from '@isbp/sdk/web';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@isbp/ui/card';
import { Form, FormField, fieldStatus } from '@isbp/ui/form';
import { Skeleton } from '@isbp/ui/skeleton';
import { ArrowRightIcon, ShieldAlertIcon } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useRef } from 'react';
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
      <form onSubmit={onSubmit} noValidate className="max-w-3xl space-y-5">
        <Card>
          <CardHeader>
            <CardTitle>{t('masking.title')}</CardTitle>
            <CardDescription>{t('masking.description')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <FormField
              control={form.control}
              name="enabled"
              render={({ field }) => (
                <Switch
                  label={t('masking.enabled')}
                  description={t('masking.enabledHint')}
                  value={field.value}
                  onChange={field.onChange}
                />
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
                  <Banner
                    status="warning"
                    icon={<Icon icon={ShieldAlertIcon} />}
                    title={t('masking.offWarning')}
                    collapsible={false}
                  />
                </motion.div>
              )}
            </AnimatePresence>

            <VStack gap={3}>
              <VStack gap={1}>
                <Text as="div" display="block" type="label">
                  {t('masking.categories')}
                </Text>
                <Text as="p" display="block" type="supporting" color="secondary">
                  {t('masking.categoriesHint')}
                </Text>
              </VStack>
              <Grid columns={{ minWidth: 260 }} gap={2}>
                {CATEGORIES.map((c) => (
                  <CategoryOption
                    key={c.id}
                    category={c}
                    checked={categories.includes(c.id)}
                    active={enabled}
                    onChange={(on) => toggle(c.id, on)}
                  />
                ))}
              </Grid>
            </VStack>

            <FormField
              control={form.control}
              name="custom"
              render={({ field, fieldState }) => (
                <TextArea
                  label={t('masking.custom')}
                  description={t('masking.customHint', { placeholder: '[REDACTED_1]' })}
                  rows={4}
                  hasSpellCheck={false}
                  autoComplete="off"
                  isDisabled={!enabled}
                  placeholder={'EMP-\\d{6}\nASSET-[A-Z]{2}\\d{4}'}
                  value={field.value}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  status={fieldStatus(fieldState)}
                />
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
              render={({ field, fieldState }) => (
                <div className="sm:max-w-sm">
                  <InputGroup
                    label={t('budget.label')}
                    description={`${t('budget.hint', { code: 'AI_BUDGET_EXCEEDED' })} ${t('budget.spent', { spent: usd(config.spentThisMonthUsd) })}`}
                    status={fieldStatus(fieldState)}
                  >
                    <TextInput
                      label={t('budget.label')}
                      isLabelHidden
                      autoComplete="off"
                      placeholder="0"
                      value={field.value}
                      onChange={field.onChange}
                      onBlur={field.onBlur}
                    />
                    <InputGroupText>USD</InputGroupText>
                  </InputGroup>
                </div>
              )}
            />
          </CardContent>
        </Card>

        {form.formState.errors.root && (
          <Banner status="error" title={form.formState.errors.root.message} collapsible={false} />
        )}
        <HStack gap={2} hAlign="end" wrap="wrap">
          <Button
            label={t('discard')}
            variant="ghost"
            isDisabled={!dirty || save.isPending}
            type="button"
            onClick={() => form.reset(toValues(config))}
          />
          <Button
            label={tc('saveChanges')}
            variant="primary"
            isLoading={save.isPending}
            isDisabled={!dirty}
            type="submit"
          />
        </HStack>
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
  const masked = active && checked;
  return (
    <AstryxCard padding={3} variant={masked ? 'blue' : 'default'}>
      <VStack gap={1.5}>
        <CheckboxInput
          label={t(`category.${category.id}.label`)}
          description={t(`category.${category.id}.hint`)}
          value={checked}
          isDisabled={!active}
          onChange={onChange}
        />
        <HStack gap={1.5} wrap="wrap" vAlign="center">
          <span className="sr-only">{t('example')}</span>
          <Text type="code" color="secondary" wordBreak="break-all">
            {category.example}
          </Text>
          <Icon icon={ArrowRightIcon} color="secondary" size="xsm" />
          <span className="sr-only">{t('becomes')}</span>
          {masked ? (
            <Text type="code" weight="medium" color="accent">
              {category.masked}
            </Text>
          ) : (
            <Text type="supporting" color="secondary">
              {t('sentAsIs')}
            </Text>
          )}
        </HStack>
      </VStack>
    </AstryxCard>
  );
}
