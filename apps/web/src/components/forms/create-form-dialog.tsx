'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import type { CreateFormInput, FormDetail } from '@isbp/contracts';
import { type LocalizedText, localizedTextSchema } from '@isbp/sdk';
import { ApiError } from '@isbp/sdk/web';
import { Button } from '@isbp/ui/button';
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
import { LocalizedInput } from '@isbp/ui/localized-input';
import { countFilled, OptionalFields, useFieldList } from '@isbp/ui/optional-fields';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useId, useMemo, useRef } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import { suggestKey } from '@/components/groups/group-form';
import { applyServerErrors, useApiMutation, useErrorText } from '@/lib/api';
import { CategoryInput, IconPicker } from './form-inputs';

interface Values {
  name: LocalizedText;
  key: string;
  description: LocalizedText;
  icon: string;
  category: string;
}

const EMPTY: Values = { name: {}, key: '', description: {}, icon: 'file-text', category: '' };

/** New form: name, key (from the English name until edited), description, icon and category. */
export function CreateFormDialog({
  open,
  onOpenChange,
  categories,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categories: readonly string[];
}) {
  const t = useTranslations('forms.create');
  const tc = useTranslations('common');
  const locale = useLocale();
  const router = useRouter();
  const errorText = useErrorText();
  const iconLabel = useId();
  const list = useFieldList();

  const schema = useMemo(
    () =>
      z.object({
        name: z.custom<LocalizedText>((v) => localizedTextSchema.safeParse(v).success, t('nameRequired')),
        key: z
          .string()
          .trim()
          .min(2, t('keyInvalid'))
          .max(64, t('keyInvalid'))
          .regex(/^[a-z0-9][a-z0-9-_]*$/, t('keyInvalid')),
        description: z.custom<LocalizedText>(),
        icon: z.string(),
        category: z.string().trim().max(64),
      }),
    [t],
  );
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: EMPTY });

  const wasOpen = useRef(false);
  useEffect(() => {
    const opening = open && !wasOpen.current;
    wasOpen.current = open;
    if (opening) form.reset(EMPTY);
  }, [open, form]);

  // The key follows the English name (or any latin name) until it is edited by hand.
  const name = useWatch({ control: form.control, name: 'name' });
  const [descriptionValue, categoryValue] = useWatch({
    control: form.control,
    name: ['description', 'category'],
  });
  useEffect(() => {
    if (form.getFieldState('key').isDirty) return;
    form.setValue('key', suggestKey(name?.en || name?.[locale as keyof LocalizedText] || ''), {
      shouldValidate: form.formState.isSubmitted,
    });
  }, [name, locale, form]);

  const create = useApiMutation((api, body: CreateFormInput) => api.post<FormDetail>('/forms', body), {
    invalidate: ['/forms', '/audit-logs'],
    success: t('created'),
    onSuccess: (f) => router.push(`/admin/forms/${f.id}`),
    silent: true,
  });

  const onSubmit = form.handleSubmit(async (v) => {
    const description = Object.values(v.description ?? {}).some((x) => x?.trim()) ? v.description : null;
    try {
      await create.mutateAsync({
        key: v.key.trim(),
        name: v.name,
        description,
        icon: v.icon,
        category: v.category.trim() || null,
      });
    } catch (err) {
      if (applyServerErrors(err, form.setError as never)) return;
      if (err instanceof ApiError && err.code === 'CONFLICT') {
        form.setError('key', { message: t('keyTaken') }, { shouldFocus: true });
        return;
      }
      form.setError('root', { message: errorText(err) });
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={tc('close')} className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={onSubmit} noValidate className="space-y-5">
            <FormField
              control={form.control}
              name="name"
              render={({ field, fieldState }) => (
                <FormItem>
                  <FormLabel>{t('name')}</FormLabel>
                  <FormControl>
                    <LocalizedInput
                      value={field.value}
                      onChange={field.onChange}
                      invalid={Boolean(fieldState.error)}
                      placeholder={t('namePlaceholder')}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="key"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('key')}</FormLabel>
                  <FormControl>
                    <Input
                      autoComplete="off"
                      spellCheck={false}
                      className="font-mono text-sm"
                      {...field}
                      onChange={(e) => field.onChange(e.target.value.toLowerCase())}
                    />
                  </FormControl>
                  <FormDescription>{t('keyHint')}</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <OptionalFields
              hint={list([t('descriptionLabel'), t('icon'), t('category')])}
              filled={countFilled(
                Object.values(descriptionValue).some((x) => x?.trim()),
                categoryValue,
              )}
            >
              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      {t('descriptionLabel')}{' '}
                      <span className="font-normal text-muted-foreground">({tc('optional')})</span>
                    </FormLabel>
                    <FormControl>
                      <LocalizedInput multiline value={field.value} onChange={field.onChange} />
                    </FormControl>
                  </FormItem>
                )}
              />
              <div className="grid gap-5 sm:grid-cols-[1fr_12rem]">
                <FormField
                  control={form.control}
                  name="icon"
                  render={({ field }) => (
                    <div className="grid gap-2">
                      <Label id={iconLabel}>{t('icon')}</Label>
                      <IconPicker value={field.value} onChange={field.onChange} labelledBy={iconLabel} />
                    </div>
                  )}
                />
                <FormField
                  control={form.control}
                  name="category"
                  render={({ field }) => (
                    <FormItem className="content-start">
                      <FormLabel>
                        {t('category')}{' '}
                        <span className="font-normal text-muted-foreground">({tc('optional')})</span>
                      </FormLabel>
                      <FormControl>
                        <CategoryInput
                          value={field.value}
                          onChange={field.onChange}
                          suggestions={categories}
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />
              </div>
            </OptionalFields>
            {form.formState.errors.root && (
              <p role="alert" className="text-sm text-destructive">
                {form.formState.errors.root.message}
              </p>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {tc('cancel')}
              </Button>
              <Button type="submit" loading={create.isPending}>
                {t('submit')}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
