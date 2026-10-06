'use client';

import type { FormSubmission, PublishedForm } from '@isbp/contracts';
import { defaultFieldValues, formFields, localize } from '@isbp/sdk';
import { ApiError } from '@isbp/sdk/web';
import { Button } from '@isbp/ui/button';
import { EmptyState } from '@isbp/ui/empty-state';
import { Form } from '@isbp/ui/form';
import { FormFields, useFieldErrorText, useFieldsResolver } from '@isbp/ui/form-renderer';
import { PageHeader } from '@isbp/ui/page-header';
import { Skeleton } from '@isbp/ui/skeleton';
import { toast } from '@isbp/ui/sonner';
import { ArrowLeftIcon, FileQuestionIcon, InfoIcon, SendIcon } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo } from 'react';
import { type FieldValues, useForm } from 'react-hook-form';
import { useApiMutation, useApiQuery } from '@/lib/api';
import { NavIcon } from '../nav-icon';

function FormBody({ form: published }: { form: PublishedForm }) {
  const t = useTranslations('requests.form');
  const router = useRouter();
  const fieldError = useFieldErrorText();
  const fields = useMemo(() => formFields(published.schema), [published.schema]);
  const resolver = useFieldsResolver(fields);
  const form = useForm<FieldValues>({ resolver, defaultValues: defaultFieldValues(fields) });
  const submit = useApiMutation(
    (api, data: Record<string, unknown>) =>
      api.post<FormSubmission>(`/forms/by-key/${published.key}/submissions`, { data }),
    {
      silent: true,
      invalidate: ['/me/requests', '/me/badges'],
      onSuccess: (s) => {
        toast.success(t('submitted', { reference: s.reference }));
        router.push(`/requests/${s.reference}`);
      },
    },
  );
  const onError = (err: unknown) => {
    if (err instanceof ApiError && err.code === 'VALIDATION_FAILED') {
      const issues =
        (err.details as { issues?: { path: string; code?: string; params?: Record<string, number> }[] })
          ?.issues ?? [];
      for (const i of issues)
        form.setError(i.path.replace(/^data\./, ''), {
          message: i.code ? fieldError({ code: i.code as never, params: i.params }) : i.path,
        });
      return;
    }
    toast.error(t('failed'));
  };

  return (
    <Form {...form}>
      <form
        noValidate
        onSubmit={form.handleSubmit((values) => submit.mutate(values, { onError }))}
        className="grid gap-2 rounded-xl border bg-card p-5 sm:p-6"
      >
        {published.hasApproval && (
          <div className="mb-4 flex gap-2 rounded-lg border border-info/30 bg-info/5 px-3 py-2.5 text-sm">
            <InfoIcon className="mt-0.5 size-4 shrink-0 text-info" aria-hidden />
            <p>{t('needsApproval')}</p>
          </div>
        )}
        <FormFields elements={published.schema.elements} form={form} />
        <div className="flex items-center justify-end gap-2 border-t pt-4">
          <Button asChild variant="ghost">
            <Link href="/requests">{t('cancel')}</Link>
          </Button>
          <Button type="submit" disabled={submit.isPending}>
            <SendIcon />
            {t('submit')}
          </Button>
        </div>
      </form>
    </Form>
  );
}

/** A published form, filled in by anyone in its audience; validated exactly like the API does. */
export function FormFillView({ formKey }: { formKey: string }) {
  const t = useTranslations('requests.form');
  const locale = useLocale();
  const { data, error, isLoading } = useApiQuery<PublishedForm>(
    `/forms/by-key/${encodeURIComponent(formKey)}`,
  );
  return (
    <div className="mx-auto grid max-w-3xl gap-2">
      <PageHeader
        eyebrow={
          <Link href="/requests" className="inline-flex items-center gap-1 hover:text-foreground">
            <ArrowLeftIcon className="size-3.5" aria-hidden />
            {t('back')}
          </Link>
        }
        title={
          data ? (
            <span className="flex items-center gap-3">
              <span className="grid size-9 place-items-center rounded-xl bg-primary/10 text-primary [&_svg]:size-5">
                <NavIcon name={data.icon} />
              </span>
              {localize(data.name, locale)}
            </span>
          ) : (
            <Skeleton className="h-8 w-72" />
          )
        }
        description={data ? localize(data.description, locale) : undefined}
      />
      {isLoading ? (
        <Skeleton className="h-96 w-full rounded-xl" />
      ) : error || !data ? (
        <EmptyState
          icon={<FileQuestionIcon />}
          title={t('unavailable')}
          description={t('unavailableHint')}
          action={
            <Button asChild variant="outline">
              <Link href="/requests">{t('back')}</Link>
            </Button>
          }
          className="rounded-xl border border-dashed"
        />
      ) : (
        <FormBody key={`${data.key}-${data.version}`} form={data} />
      )}
    </div>
  );
}
