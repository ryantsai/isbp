'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { type LocalizedText, localizedTextSchema } from '@isbp/sdk';
import { ApiError } from '@isbp/sdk/web';
import { cn } from '@isbp/ui';
import { Button } from '@isbp/ui/button';
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
import { LocalizedInput } from '@isbp/ui/localized-input';
import { countFilled, OptionalFields, useFieldList } from '@isbp/ui/optional-fields';
import { useApiMutation, useErrorText } from '@isbp/ui/query';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@isbp/ui/sheet';
import { useTranslations } from 'next-intl';
import { useId, useMemo } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import { CLASS_KEY_RE, type CiClass, type CreateClassInput } from '../contracts';
import { CLASS_ICONS } from './class-icon';
import { INVALIDATE } from './data';

/** Create (no `cls`) or edit a CI class: key, name and description per language, icon and order. */
export function ClassSheet({
  open,
  onOpenChange,
  cls,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cls: CiClass | null;
}) {
  const t = useTranslations('cmdb.classes');
  const tc = useTranslations('common');
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-lg" closeLabel={tc('close')}>
        <SheetHeader>
          <SheetTitle>{cls ? t('editTitle') : t('createTitle')}</SheetTitle>
          <SheetDescription>{t('formHint')}</SheetDescription>
        </SheetHeader>
        {/* Mounted per opening, so it always starts from the class as it is now. */}
        <ClassForm cls={cls} onDone={() => onOpenChange(false)} />
      </SheetContent>
    </Sheet>
  );
}

function ClassForm({ cls, onDone }: { cls: CiClass | null; onDone: () => void }) {
  const t = useTranslations('cmdb.classes');
  const ti = useTranslations('cmdb.icons');
  const tc = useTranslations('common');
  const errorText = useErrorText();
  const iconLabel = useId();
  const schema = useMemo(
    () =>
      z.object({
        key: z.string().trim().regex(CLASS_KEY_RE, t('keyInvalid')),
        name: z.custom<LocalizedText>((v) => localizedTextSchema.safeParse(v).success, t('nameRequired')),
        description: z.custom<LocalizedText>(),
        icon: z.string().min(1),
        sortOrder: z.coerce.number<string | number>().int().min(0).max(10_000),
      }),
    [t],
  );
  type Values = z.input<typeof schema>;
  const form = useForm<Values, unknown, z.output<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: {
      key: cls?.key ?? '',
      name: cls?.name ?? {},
      description: cls?.description ?? {},
      icon: cls?.icon ?? 'box',
      sortOrder: cls?.sortOrder ?? 100,
    },
  });

  const list = useFieldList();
  const watchedDescription = useWatch({ control: form.control, name: 'description' });
  const detailsFilled = countFilled(Object.values(watchedDescription).some((v) => v?.trim()));

  const save = useApiMutation(
    (api, v: z.output<typeof schema>) => {
      const description = Object.values(v.description ?? {}).some(Boolean) ? v.description : null;
      const body = { name: v.name, description, icon: v.icon, sortOrder: v.sortOrder };
      return cls
        ? api.patch<CiClass>(`/cmdb/classes/${cls.key}`, body)
        : api.post<CiClass>('/cmdb/classes', { ...body, key: v.key } satisfies CreateClassInput);
    },
    { invalidate: INVALIDATE, success: cls ? t('saved') : t('created'), onSuccess: onDone, silent: true },
  );

  const onSubmit = form.handleSubmit(async (v) => {
    form.clearErrors('root');
    try {
      await save.mutateAsync(v);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'CONFLICT') {
        form.setError('key', { message: t('keyTaken') }, { shouldFocus: true });
        return;
      }
      form.setError('root', { message: errorText(err) });
    }
  });

  return (
    <Form {...form}>
      <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col" noValidate>
        <SheetBody className="space-y-5">
          <FormField
            control={form.control}
            name="key"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('key')}</FormLabel>
                <FormControl>
                  <Input {...field} disabled={Boolean(cls)} className="font-mono" autoFocus={!cls} />
                </FormControl>
                <FormDescription>{t('keyHint')}</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
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
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <OptionalFields
            hint={list([t('classDescription'), t('icon'), t('sortOrder')])}
            filled={detailsFilled}
          >
            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('classDescription')}</FormLabel>
                  <FormControl>
                    <LocalizedInput multiline value={field.value} onChange={field.onChange} />
                  </FormControl>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="icon"
              render={({ field }) => (
                <FormItem>
                  <span id={iconLabel} className="text-sm leading-none font-medium">
                    {t('icon')}
                  </span>
                  <div
                    role="radiogroup"
                    aria-labelledby={iconLabel}
                    className="grid grid-cols-6 gap-1.5 sm:grid-cols-8"
                  >
                    {Object.entries(CLASS_ICONS).map(([name, Icon]) => {
                      const checked = field.value === name;
                      return (
                        <button
                          key={name}
                          type="button"
                          role="radio"
                          aria-checked={checked}
                          aria-label={ti.has(name) ? ti(name) : name}
                          title={ti.has(name) ? ti(name) : name}
                          tabIndex={checked || (!field.value && name === 'box') ? 0 : -1}
                          onClick={() => field.onChange(name)}
                          onKeyDown={(e) => {
                            const names = Object.keys(CLASS_ICONS);
                            const i = names.indexOf(name);
                            const step =
                              e.key === 'ArrowRight' || e.key === 'ArrowDown'
                                ? 1
                                : e.key === 'ArrowLeft' || e.key === 'ArrowUp'
                                  ? -1
                                  : 0;
                            if (!step) return;
                            e.preventDefault();
                            const next = names[(i + step + names.length) % names.length]!;
                            field.onChange(next);
                            (
                              e.currentTarget.parentElement?.querySelector(
                                `[data-icon="${next}"]`,
                              ) as HTMLElement | null
                            )?.focus();
                          }}
                          data-icon={name}
                          className={cn(
                            'grid aspect-square place-items-center rounded-lg border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
                            checked &&
                              'border-primary bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary',
                          )}
                        >
                          <Icon className="size-4" aria-hidden />
                        </button>
                      );
                    })}
                  </div>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="sortOrder"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('sortOrder')}</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      min={0}
                      max={10000}
                      className="w-32"
                      name={field.name}
                      ref={field.ref}
                      onBlur={field.onBlur}
                      value={String(field.value ?? '')}
                      onChange={(e) => field.onChange(e.target.value)}
                    />
                  </FormControl>
                  <FormDescription>{t('sortOrderHint')}</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </OptionalFields>
          {form.formState.errors.root && (
            <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {form.formState.errors.root.message}
            </p>
          )}
        </SheetBody>
        <SheetFooter>
          <Button type="button" variant="outline" onClick={onDone}>
            {tc('cancel')}
          </Button>
          <Button type="submit" loading={save.isPending}>
            {cls ? tc('saveChanges') : tc('create')}
          </Button>
        </SheetFooter>
      </form>
    </Form>
  );
}
