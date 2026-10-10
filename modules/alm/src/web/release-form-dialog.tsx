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
import { countFilled, OptionalFields, useFieldList } from '@isbp/ui/optional-fields';
import { applyServerErrors, useApiMutation, useErrorText } from '@isbp/ui/query';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@isbp/ui/select';
import { Textarea } from '@isbp/ui/textarea';
import { useTranslations } from 'next-intl';
import { useMemo } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import { type CreateReleaseInput, type ReleaseDetail, VERSION_RE } from '../contracts';
import { ReleaseStatusBadge } from './badges';
import { INVALIDATE } from './lib';

const CREATE_STATUSES = ['planned', 'in_progress', 'ready'] as const;

/** Plan a release (no `release`) or edit one: version, name, planned date and release notes. */
export function ReleaseFormDialog({
  open,
  onOpenChange,
  app,
  release,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  app: { code: string; name: string };
  release?: ReleaseDetail;
  onSaved?: (r: ReleaseDetail) => void;
}) {
  const t = useTranslations('alm.releaseForm');
  const tc = useTranslations('common');
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl" closeLabel={tc('close')}>
        <DialogHeader>
          <DialogTitle>
            {release ? t('editTitle', { version: release.version }) : t('createTitle', { name: app.name })}
          </DialogTitle>
          <DialogDescription>{t('hint')}</DialogDescription>
        </DialogHeader>
        {open && (
          <ReleaseForm
            app={app}
            release={release}
            onCancel={() => onOpenChange(false)}
            onSaved={(r) => {
              onOpenChange(false);
              onSaved?.(r);
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function ReleaseForm({
  app,
  release,
  onCancel,
  onSaved,
}: {
  app: { code: string };
  release?: ReleaseDetail;
  onCancel: () => void;
  onSaved: (r: ReleaseDetail) => void;
}) {
  const t = useTranslations('alm');
  const tc = useTranslations('common');
  const errorText = useErrorText();
  const schema = useMemo(
    () =>
      z.object({
        version: z.string().trim().regex(VERSION_RE, t('releaseForm.versionInvalid')),
        name: z.string().max(200),
        status: z.enum(CREATE_STATUSES),
        plannedDate: z.string(),
        notes: z.string().max(50_000),
      }),
    [t],
  );
  type Values = z.infer<typeof schema>;
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      version: release?.version ?? '',
      name: release?.name ?? '',
      status: 'planned',
      plannedDate: release?.plannedDate ?? '',
      notes: release?.notes ?? '',
    },
  });
  const list = useFieldList();
  const [releaseName, status, notes] = useWatch({ control: form.control, name: ['name', 'status', 'notes'] });
  // The status starts as "planned": only a change from that is something the person chose.
  const detailsFilled = countFilled(releaseName, status === 'planned' ? '' : status, notes);
  const save = useApiMutation(
    (api, body: CreateReleaseInput) =>
      release
        ? api.patch<ReleaseDetail>(`/alm/releases/${release.id}`, {
            ...(body.version !== release.version ? { version: body.version } : {}),
            name: body.name,
            plannedDate: body.plannedDate,
            notes: body.notes,
          })
        : api.post<ReleaseDetail>(`/alm/applications/${app.code}/releases`, body),
    {
      invalidate: INVALIDATE,
      success: (r) => (release ? t('releaseForm.saved') : t('releaseForm.created', { version: r.version })),
      onSuccess: onSaved,
      silent: true,
    },
  );
  const deployed = Boolean(release && release.deploymentCount > 0);

  const onSubmit = form.handleSubmit(async (v) => {
    form.clearErrors('root');
    try {
      await save.mutateAsync({
        version: v.version.trim(),
        name: v.name.trim() || null,
        status: v.status,
        plannedDate: v.plannedDate || null,
        notes: v.notes.trim() || null,
      });
    } catch (err) {
      if (applyServerErrors(err, form.setError as never)) return;
      form.setError('root', { message: err instanceof ApiError ? errorText(err) : errorText(null) });
    }
  });

  return (
    <Form {...form}>
      <form onSubmit={onSubmit} className="grid gap-4" noValidate>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="version"
            render={({ field }) => (
              <FormItem className="min-w-0">
                <FormLabel>{t('fields.version')}</FormLabel>
                <FormControl>
                  <Input
                    autoFocus={!release}
                    className="font-mono"
                    placeholder="12.1.0"
                    maxLength={40}
                    readOnly={deployed}
                    {...field}
                  />
                </FormControl>
                <FormDescription>
                  {deployed ? t('releaseForm.versionLocked') : t('releaseForm.versionHint')}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="plannedDate"
            render={({ field }) => (
              <FormItem className="min-w-0">
                <FormLabel>{t('fields.plannedDate')}</FormLabel>
                <FormControl>
                  <Input type="date" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        <OptionalFields
          hint={list([t('fields.releaseName'), t('fields.status'), t('fields.notes')])}
          filled={detailsFilled}
          contentClassName="grid gap-4 pt-3 sm:grid-cols-2"
        >
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem className="min-w-0">
                <FormLabel>{t('fields.releaseName')}</FormLabel>
                <FormControl>
                  <Input maxLength={200} placeholder={t('releaseForm.namePlaceholder')} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          {!release && (
            <FormField
              control={form.control}
              name="status"
              render={({ field }) => (
                <FormItem className="min-w-0">
                  <FormLabel>{t('fields.status')}</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {CREATE_STATUSES.map((s) => (
                        <SelectItem key={s} value={s}>
                          <ReleaseStatusBadge status={s} />
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
          )}
          <FormField
            control={form.control}
            name="notes"
            render={({ field }) => (
              <FormItem className="sm:col-span-2">
                <FormLabel>{t('fields.notes')}</FormLabel>
                <FormControl>
                  <Textarea rows={6} placeholder={t('releaseForm.notesPlaceholder')} {...field} />
                </FormControl>
                <FormDescription>{t('form.markdownHint')}</FormDescription>
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
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel}>
            {tc('cancel')}
          </Button>
          <Button type="submit" loading={save.isPending}>
            {release ? tc('saveChanges') : tc('create')}
          </Button>
        </DialogFooter>
      </form>
    </Form>
  );
}
