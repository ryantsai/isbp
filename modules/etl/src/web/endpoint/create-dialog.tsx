'use client';

import { zodResolver } from '@hookform/resolvers/zod';
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
import { applyServerErrors, useApiMutation, useErrorText } from '@isbp/ui/query';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@isbp/ui/select';
import { Textarea } from '@isbp/ui/textarea';
import { useTranslations } from 'next-intl';
import { useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import {
  type CreateEndpointInput,
  type EndpointDetail,
  ENDPOINT_KINDS,
  ENDPOINT_METHODS,
  SLUG_RE,
} from '../../contracts';
import { INVALIDATE, useConnections } from '../lib';

/** `Customers by region` → `customers-by-region`. */
export function slugify(name: string) {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/^[^a-z]+/, '')
    .slice(0, 64)
    .replace(/-+$/, '');
}

/** New Data API: name, URL slug, method, data connection and kind; the SQL comes next, in the editor. */
export function CreateEndpointDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (e: EndpointDetail) => void;
}) {
  const t = useTranslations('etl.create');
  const tc = useTranslations('common');
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" closeLabel={tc('close')}>
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('hint')}</DialogDescription>
        </DialogHeader>
        {open && <CreateForm onCancel={() => onOpenChange(false)} onCreated={onCreated} />}
      </DialogContent>
    </Dialog>
  );
}

function CreateForm({
  onCancel,
  onCreated,
}: {
  onCancel: () => void;
  onCreated: (e: EndpointDetail) => void;
}) {
  const t = useTranslations('etl');
  const tc = useTranslations('common');
  const errorText = useErrorText();
  const connections = useConnections('endpoints');
  const schema = useMemo(
    () =>
      z.object({
        name: z.string().trim().min(1, t('create.nameRequired')).max(120),
        slug: z.string().trim().min(2).max(64).regex(SLUG_RE, t('create.slugInvalid')),
        description: z.string().max(2_000),
        method: z.enum(ENDPOINT_METHODS),
        connectionId: z.string().min(1, t('create.connectionRequired')),
        kind: z.enum(ENDPOINT_KINDS),
      }),
    [t],
  );
  type Values = z.infer<typeof schema>;
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', slug: '', description: '', method: 'GET', connectionId: '', kind: 'query' },
  });
  const create = useApiMutation(
    (api, body: CreateEndpointInput) => api.post<EndpointDetail>('/etl/endpoints', body),
    {
      invalidate: INVALIDATE,
      success: (e) => t('create.created', { name: e.name }),
      onSuccess: onCreated,
      silent: true,
    },
  );
  const onSubmit = form.handleSubmit(async (v) => {
    form.clearErrors('root');
    try {
      await create.mutateAsync({ ...v, description: v.description.trim() || null });
    } catch (err) {
      if (applyServerErrors(err, form.setError as never)) return;
      form.setError('root', { message: err instanceof ApiError ? errorText(err) : errorText(null) });
    }
  });

  return (
    <Form {...form}>
      <form onSubmit={onSubmit} className="grid gap-4" noValidate>
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('fields.name')}</FormLabel>
              <FormControl>
                <Input
                  autoFocus
                  maxLength={120}
                  placeholder={t('create.namePlaceholder')}
                  {...field}
                  onChange={(e) => {
                    field.onChange(e);
                    if (!form.getFieldState('slug').isDirty)
                      form.setValue('slug', slugify(e.target.value), { shouldValidate: false });
                  }}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="slug"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('fields.slug')}</FormLabel>
              <FormControl>
                <Input className="font-mono" maxLength={64} placeholder="customers-by-region" {...field} />
              </FormControl>
              <FormDescription>{t('create.slugHint', { slug: field.value || 'slug' })}</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="method"
            render={({ field }) => (
              <FormItem className="min-w-0">
                <FormLabel>{t('fields.method')}</FormLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {ENDPOINT_METHODS.map((m) => (
                      <SelectItem key={m} value={m}>
                        {m}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="kind"
            render={({ field }) => (
              <FormItem className="min-w-0">
                <FormLabel>{t('fields.kind')}</FormLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {ENDPOINT_KINDS.map((k) => (
                      <SelectItem key={k} value={k}>
                        {t(`kind.${k}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        <FormField
          control={form.control}
          name="connectionId"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('fields.connection')}</FormLabel>
              <Select value={field.value} onValueChange={field.onChange}>
                <FormControl>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder={t('create.pickConnection')} />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {connections.items.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name} · {t(`engine.${c.engine}`)}
                      {c.readOnly ? ` · ${t('connection.readOnly')}` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormDescription>{t('create.connectionHint')}</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('fields.description')}</FormLabel>
              <FormControl>
                <Textarea rows={3} maxLength={2_000} {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        {form.formState.errors.root && (
          <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {form.formState.errors.root.message}
          </p>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel}>
            {tc('cancel')}
          </Button>
          <Button type="submit" loading={create.isPending}>
            {tc('create')}
          </Button>
        </DialogFooter>
      </form>
    </Form>
  );
}
