'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import type { Application, CreateApplicationInput } from '@isbp/contracts';
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
import { countFilled, OptionalFields, useFieldList } from '@isbp/ui/optional-fields';
import { Textarea } from '@isbp/ui/textarea';
import { AlertTriangleIcon, LockIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useRef } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import { UserPicker } from '@/components/pickers/user-picker';
import { slugify } from '@/components/roles/role-utils';
import { applyServerErrors, useApiMutation, useErrorText } from '@/lib/api';
import { APP_INVALIDATE } from './app-parts';

const KEY_RE = /^[a-z0-9][a-z0-9-_]*$/;

/** Register an application (no `app`) or edit one (`app`; the key is immutable). */
export function ApplicationFormDialog({
  open,
  onOpenChange,
  app,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  app?: Application;
}) {
  const t = useTranslations('applications.form');
  const tc = useTranslations('common');
  const router = useRouter();
  const errorText = useErrorText();
  const editing = Boolean(app);
  const list = useFieldList();

  const schema = useMemo(
    () =>
      z.object({
        name: z.string().trim().min(1, t('validation.name')).max(200, t('validation.nameLong')),
        key: z
          .string()
          .trim()
          .min(2, t('validation.key'))
          .max(64, t('validation.key'))
          .regex(KEY_RE, t('validation.key'))
          .refine((k) => k !== 'isbp', t('validation.keyReserved')),
        description: z.string().trim().max(2000, t('validation.descriptionLong')),
        homepageUrl: z
          .string()
          .trim()
          .max(500, t('validation.url'))
          .refine(
            (v) => v === '' || z.url({ protocol: /^https?$/ }).safeParse(v).success,
            t('validation.url'),
          ),
        owner: z.object({ id: z.string(), displayName: z.string() }).nullable(),
      }),
    [t],
  );
  type Values = z.input<typeof schema>;

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', key: '', description: '', homepageUrl: '', owner: null },
  });

  // Reset only when the dialog opens so background refetches never clobber what's being typed.
  const wasOpen = useRef(false);
  useEffect(() => {
    const opening = open && !wasOpen.current;
    wasOpen.current = open;
    if (!opening) return;
    form.reset(
      app
        ? {
            name: app.name,
            key: app.key,
            description: app.description ?? '',
            homepageUrl: app.homepageUrl ?? '',
            owner: app.owner ? { id: app.owner.id, displayName: app.owner.displayName } : null,
          }
        : { name: '', key: '', description: '', homepageUrl: '', owner: null },
    );
  }, [open, app, form]);

  // Suggest a key from the name until the key is edited by hand.
  const name = useWatch({ control: form.control, name: 'name' });
  useEffect(() => {
    if (editing || form.getFieldState('key').isDirty) return;
    form.setValue('key', slugify(name ?? ''), { shouldValidate: form.formState.isSubmitted });
  }, [name, editing, form]);

  const create = useApiMutation(
    (api, body: CreateApplicationInput) => api.post<Application>('/applications', body),
    {
      invalidate: APP_INVALIDATE,
      success: (a) => t('created', { name: a.name }),
      onSuccess: (a) => {
        onOpenChange(false);
        router.push(`/admin/applications/${a.id}`);
      },
      silent: true,
    },
  );
  const update = useApiMutation(
    (api, body: CreateApplicationInput) => {
      const { key: _key, ...rest } = body;
      return api.patch<Application>(`/applications/${app!.id}`, rest);
    },
    {
      invalidate: APP_INVALIDATE,
      success: t('saved'),
      onSuccess: () => onOpenChange(false),
      silent: true,
    },
  );
  const mutation = editing ? update : create;

  const onSubmit = form.handleSubmit(async (v) => {
    form.clearErrors('root');
    const body: CreateApplicationInput = {
      key: v.key.trim(),
      name: v.name.trim(),
      description: v.description.trim() || null,
      homepageUrl: v.homepageUrl.trim() || null,
      ownerId: v.owner?.id ?? null,
    };
    try {
      await mutation.mutateAsync(body);
    } catch (err) {
      if (applyServerErrors(err, form.setError as never)) return;
      if (!editing && err instanceof ApiError && err.code === 'CONFLICT') {
        form.setError('key', { message: t('validation.keyTaken') }, { shouldFocus: true });
        return;
      }
      form.setError('root', { message: errorText(err) });
    }
  });

  const owner = useWatch({ control: form.control, name: 'owner' });
  const [description, homepageUrl] = useWatch({
    control: form.control,
    name: ['description', 'homepageUrl'],
  });
  const rootError = form.formState.errors.root?.message;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={tc('close')} className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{editing ? t('editTitle', { name: app!.name }) : t('createTitle')}</DialogTitle>
          <DialogDescription>{editing ? t('editDescription') : t('createDescription')}</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={onSubmit} className="space-y-5" noValidate>
            <div className="grid gap-5 sm:grid-cols-2">
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
                          placeholder="finance-erp"
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
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <p className="-mt-3 text-xs text-muted-foreground">{editing ? t('keyLocked') : t('keyHint')}</p>
            <div className="grid gap-2">
              <label htmlFor="app-owner" className="text-sm font-medium">
                {t('owner')} <span className="font-normal text-muted-foreground">({tc('optional')})</span>
              </label>
              <UserPicker
                id="app-owner"
                value={owner}
                onChange={(u) => form.setValue('owner', u ? { id: u.id, displayName: u.displayName } : null)}
                placeholder={t('ownerPlaceholder')}
              />
              <p className="text-xs text-muted-foreground">{t('ownerHint')}</p>
            </div>
            <OptionalFields
              hint={list([t('description'), t('homepageUrl')])}
              filled={countFilled(description, homepageUrl)}
            >
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
                      <Textarea rows={2} placeholder={t('descriptionPlaceholder')} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="homepageUrl"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      {t('homepageUrl')}{' '}
                      <span className="font-normal text-muted-foreground">({tc('optional')})</span>
                    </FormLabel>
                    <FormControl>
                      <Input
                        type="url"
                        inputMode="url"
                        autoComplete="url"
                        placeholder="https://erp.example.com"
                        {...field}
                      />
                    </FormControl>
                    <FormDescription>{t('homepageHint')}</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </OptionalFields>
            {rootError && (
              <p
                role="alert"
                className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
              >
                <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
                {rootError}
              </p>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {tc('cancel')}
              </Button>
              <Button type="submit" loading={mutation.isPending}>
                {editing ? tc('saveChanges') : t('submit')}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
