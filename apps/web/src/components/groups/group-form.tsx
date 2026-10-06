'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { createGroupSchema, type Group, updateGroupSchema } from '@isbp/contracts';
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
import { Textarea } from '@isbp/ui/textarea';
import { LockIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useRef } from 'react';
import { type FieldValues, type Resolver, type UseFormReturn, useForm, useWatch } from 'react-hook-form';
import type { z } from 'zod';
import {
  attributesPayload,
  CustomFieldsSection,
  useApplyEntityErrors,
  useAttributeDefaults,
  useAttributesResolver,
  useEntityFields,
} from '@/components/fields/entity-fields';
import { useApiMutation, useErrorText } from '@/lib/api';

type Values = z.input<typeof createGroupSchema>;

/** "Finance & Procurement" → "finance-procurement" (empty for names without latin letters/digits). */
export function suggestKey(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .slice(0, 64)
    .replace(/-+$/, '');
}

const INVALIDATE = ['/groups', '/platform/dashboard', '/audit-logs'];

/** Create (no `group`) or edit (`group`: name + description; the key is immutable). */
export function GroupFormDialog({
  open,
  onOpenChange,
  group,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  group?: Group;
}) {
  const t = useTranslations('groups.form');
  const tc = useTranslations('common');
  const router = useRouter();
  const errorText = useErrorText();
  const editing = Boolean(group);

  const custom = useEntityFields('core.group', open);
  const applyErrors = useApplyEntityErrors();
  const resolver = useAttributesResolver(
    zodResolver(
      editing ? (updateGroupSchema as unknown as typeof createGroupSchema) : createGroupSchema,
    ) as Resolver<Values>,
    custom.fields,
  );

  const form = useForm<Values>({
    resolver,
    defaultValues: { key: '', name: '', description: '' },
  });

  // Reset only when the dialog opens, so background refetches never clobber what's being typed.
  const wasOpen = useRef(false);
  useEffect(() => {
    const opening = open && !wasOpen.current;
    wasOpen.current = open;
    if (!opening) return;
    form.reset(
      group
        ? { key: group.key, name: group.name, description: group.description ?? '' }
        : { key: '', name: '', description: '' },
    );
  }, [open, group, form]);
  useAttributeDefaults(
    form as unknown as UseFormReturn<FieldValues>,
    custom.fields,
    custom.ready,
    open,
    group?.attributes,
  );

  // Suggest a key from the name until the key is edited by hand.
  const name = useWatch({ control: form.control, name: 'name' });
  useEffect(() => {
    if (editing || form.getFieldState('key').isDirty) return;
    form.setValue('key', suggestKey(name ?? ''), { shouldValidate: form.formState.isSubmitted });
  }, [name, editing, form]);

  const create = useApiMutation((api, values: Values) => api.post<Group>('/groups', values), {
    invalidate: INVALIDATE,
    success: (g) => t('created', { name: g.name }),
    onSuccess: (g) => {
      onOpenChange(false);
      router.push(`/admin/groups/${g.id}`);
    },
    silent: true,
  });
  const update = useApiMutation((api, values: Values) => api.patch<Group>(`/groups/${group!.id}`, values), {
    invalidate: INVALIDATE,
    success: t('saved'),
    onSuccess: () => onOpenChange(false),
    silent: true,
  });
  const mutation = editing ? update : create;

  const onSubmit = form.handleSubmit(async (values) => {
    const description = values.description?.trim() ? values.description.trim() : null;
    // Custom-field values only once their definitions are loaded (never wipe them by accident).
    const customValues = custom.ready
      ? { attributes: attributesPayload(custom.fields, values.attributes) }
      : {};
    try {
      await mutation.mutateAsync(
        editing
          ? ({ name: values.name, description, ...customValues } as Values)
          : { ...values, description, attributes: undefined, ...customValues },
      );
    } catch (err) {
      if (applyErrors(err, form.setError as never)) return;
      if (!editing && err instanceof ApiError && err.code === 'CONFLICT') {
        form.setError('key', { message: t('keyTaken') }, { shouldFocus: true });
        return;
      }
      form.setError('root', { message: errorText(err) });
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={tc('close')}>
        <DialogHeader>
          <DialogTitle>{editing ? t('editTitle', { name: group!.name }) : t('createTitle')}</DialogTitle>
          <DialogDescription>{editing ? t('editDescription') : t('createDescription')}</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={onSubmit} className="space-y-5" noValidate>
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('name')}</FormLabel>
                  <FormControl>
                    <Input autoComplete="off" placeholder={t('namePlaceholder')} autoFocus {...field} />
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
                  <div className="relative">
                    <FormControl>
                      <Input
                        autoComplete="off"
                        spellCheck={false}
                        readOnly={editing}
                        className="font-mono text-sm read-only:bg-muted/50 read-only:text-muted-foreground"
                        {...field}
                        onChange={(e) => field.onChange(e.target.value.toLowerCase())}
                      />
                    </FormControl>
                    {editing && (
                      <LockIcon
                        className="pointer-events-none absolute top-1/2 right-3 size-3.5 -translate-y-1/2 text-muted-foreground"
                        aria-hidden
                      />
                    )}
                  </div>
                  <FormDescription>{editing ? t('keyLocked') : t('keyHint')}</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    {t('description')}{' '}
                    <span className="font-normal text-muted-foreground">({tc('optional')})</span>
                  </FormLabel>
                  <FormControl>
                    <Textarea
                      rows={3}
                      placeholder={t('descriptionPlaceholder')}
                      {...field}
                      value={field.value ?? ''}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <CustomFieldsSection
              elements={custom.elements}
              form={form as unknown as UseFormReturn<FieldValues>}
              className="pt-1"
            />
            {form.formState.errors.root && (
              <p role="alert" className="text-sm text-destructive">
                {form.formState.errors.root.message}
              </p>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {tc('cancel')}
              </Button>
              <Button type="submit" loading={mutation.isPending}>
                {editing ? tc('saveChanges') : tc('create')}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
