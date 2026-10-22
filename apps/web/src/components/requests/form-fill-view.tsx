'use client';

import type { ApprovalPreview, FormAssignment, FormSubmission, PublishedForm } from '@isbp/contracts';
import {
  defaultFieldValues,
  FORM_ERROR_KEY,
  type FormSchema,
  formFields,
  type LocalizedText,
  localize,
} from '@isbp/sdk';
import { ApiError, useApi } from '@isbp/sdk/web';
import { EmptyState } from '@isbp/ui/empty-state';
import { Form } from '@isbp/ui/form';
import { FormErrorSummary, FormFields, useFieldErrorText, useFormResolver } from '@isbp/ui/form-renderer';
import { PageHeader } from '@isbp/ui/page-header';
import { Skeleton } from '@isbp/ui/skeleton';
import { toast } from '@isbp/ui/toast';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ArrowLeftIcon, FileQuestionIcon, InfoIcon, SendIcon } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useId, useMemo, useState } from 'react';
import { type FieldValues, type UseFormReturn, useForm } from 'react-hook-form';
import { useApiMutation, useApiQuery, useErrorText } from '@/lib/api';
import { AssignmentBanner } from '../assignments/assignment-banner';
import { NavIcon } from '../nav-icon';
import { ApprovalPath } from './request-access-view';
import { Button } from '@astryxdesign/core/Button';
import { Icon } from '@astryxdesign/core/Icon';

/**
 * "Who will approve this?" for the answers so far: a dry run of the form's workflow on the server (the same facts a
 * submission uses, records included), refreshed shortly after the answers change.
 */
function ApprovalPreviewPanel({
  formKey,
  form,
  schema,
  assignmentId,
}: {
  formKey: string;
  form: UseFormReturn<FieldValues>;
  schema: FormSchema;
  /** The to-do the form is filled in for (opens the form whatever its audience). */
  assignmentId?: string;
}) {
  const locale = useLocale();
  const t = useTranslations('requests.form.approval');
  const errorText = useErrorText();
  const api = useApi();
  const uid = useId();
  // The answers are read 600 ms after the last change, through a subscription: watching them would re-render the panel
  // (and the approval path) on every keystroke.
  const [debounced, setDebounced] = useState(() => JSON.stringify(form.getValues() ?? {}));
  const [typing, setTyping] = useState(false);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = form.subscribe({
      formState: { values: true },
      callback: () => {
        setTyping(true);
        clearTimeout(timer);
        timer = setTimeout(() => {
          setDebounced(JSON.stringify(form.getValues() ?? {}));
          setTyping(false);
        }, 600);
      },
    });
    return () => {
      clearTimeout(timer);
      unsubscribe();
    };
  }, [form]);
  const preview = useQuery({
    queryKey: ['/forms/by-key/preview', formKey, assignmentId, debounced],
    queryFn: () =>
      api.post<ApprovalPreview>(
        `/forms/by-key/${encodeURIComponent(formKey)}/preview${assignmentId ? `?assignment=${assignmentId}` : ''}`,
        {
          data: JSON.parse(debounced) as Record<string, unknown>,
        },
      ),
    placeholderData: keepPreviousData,
    retry: false,
  });
  // A step whose approver comes from answers still empty says which answer it waits for, rather than implying that
  // nobody could approve the request (the builder's preview does the same).
  const waiting = useMemo(() => {
    const blank = (v: unknown) =>
      v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length);
    const answered = JSON.parse(debounced) as Record<string, unknown>;
    const fields = formFields(schema);
    const out = new Map<string, string>();
    for (const s of preview.data?.steps ?? []) {
      const from = s.dependsOn ?? [];
      if (!from.length || s.outcome === 'ask' || s.outcome === 'skipped') continue;
      if (!from.every((k) => blank(answered[k]))) continue;
      const field = fields.find((f) => f.key === from[0]);
      if (field) out.set(s.id, localize(field.label, locale) || field.key);
    }
    return out;
  }, [debounced, preview.data, schema, locale]);
  return (
    <section aria-labelledby={uid} className="grid gap-3 rounded-xl border bg-muted/30 p-4">
      <div className="grid gap-0.5">
        <h2 id={uid} className="text-base font-semibold">
          {t('title')}
        </h2>
        <p className="text-sm text-muted-foreground">{t('description')}</p>
      </div>
      <div aria-live="polite" aria-busy={preview.isFetching || typing}>
        {preview.isError ? (
          <p className="text-sm text-destructive">{errorText(preview.error)}</p>
        ) : (
          <ApprovalPath preview={preview.data} waiting={waiting} />
        )}
      </div>
    </section>
  );
}

function FormBody({
  form: published,
  assignment,
}: {
  form: PublishedForm;
  /** The person's open to-do this submission completes. */
  assignment?: FormAssignment | null;
}) {
  const t = useTranslations('requests.form');
  const router = useRouter();
  const fieldError = useFieldErrorText();
  const schema = published.schema as FormSchema;
  const fields = useMemo(() => formFields(schema), [schema]);
  const resolver = useFormResolver(schema);
  const form = useForm<FieldValues>({ resolver, defaultValues: defaultFieldValues(fields) });
  const submit = useApiMutation(
    (api, data: Record<string, unknown>) =>
      api.post<FormSubmission>(
        `/forms/by-key/${published.key}/submissions${assignment ? `?assignment=${assignment.id}` : ''}`,
        { data },
      ),
    {
      silent: true,
      invalidate: ['/me/requests', '/me/badges', '/me/form-assignments'],
      onSuccess: (s) => {
        // A to-do's finish has its own banner on the request page; other requests confirm with a toast.
        if (!assignment) toast.success(t('submitted', { reference: s.reference }));
        // A to-do's finish is shown on the request page (`?todo=`): done, and where it is recorded.
        router.push(`/requests/${s.reference}${assignment ? `?todo=${assignment.id}` : ''}`);
      },
    },
  );
  const onError = (err: unknown) => {
    if (err instanceof ApiError && err.code === 'VALIDATION_FAILED') {
      const issues =
        (
          err.details as {
            issues?: { path: string; code?: string; params?: Record<string, number>; text?: LocalizedText }[];
          }
        )?.issues ?? [];
      for (const i of issues)
        form.setError(i.path.replace(/^data\./, '') || FORM_ERROR_KEY, {
          message: i.code ? fieldError({ code: i.code as never, params: i.params, message: i.text }) : i.path,
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
        className="grid gap-2 rounded-xl border bg-card p-4 sm:p-5"
      >
        {published.hasApproval && (
          <div className="mb-4 flex gap-2 rounded-lg border border-info/30 bg-info/5 px-3 py-2.5 text-sm">
            <InfoIcon className="mt-0.5 size-4 shrink-0 text-info" aria-hidden />
            <p>{t('needsApproval')}</p>
          </div>
        )}
        <FormErrorSummary schema={schema} form={form} className="mb-4" />
        <FormFields elements={published.schema.elements} form={form} />
        {published.hasApproval && (
          <ApprovalPreviewPanel
            formKey={published.key}
            form={form}
            schema={schema}
            assignmentId={assignment?.id}
          />
        )}
        <div className="flex items-center justify-end gap-2 border-t pt-4">
          <Button label={t('cancel')} variant="ghost" href="/requests" />
          <Button
            label={t('submit')}
            variant="primary"
            icon={<Icon icon={SendIcon} />}
            isDisabled={submit.isPending}
            type="submit"
          />
        </div>
      </form>
    </Form>
  );
}

/**
 * A published form, filled in by anyone in its audience; validated exactly like the API does. With `assignmentId`
 * (`?assignment=` — a to-do), the to-do is shown above the form and sending the form completes it.
 */
export function FormFillView({ formKey, assignmentId }: { formKey: string; assignmentId?: string }) {
  const t = useTranslations('requests.form');
  const locale = useLocale();
  const todo = useApiQuery<FormAssignment>(assignmentId ? `/me/form-assignments/${assignmentId}` : null);
  const { data, error, isLoading } = useApiQuery<PublishedForm>(
    `/forms/by-key/${encodeURIComponent(formKey)}`,
    assignmentId ? { assignment: assignmentId } : undefined,
  );
  // Only the person's open to-do for this form is completed by sending it.
  const assignment =
    todo.data && todo.data.status === 'open' && todo.data.form.key === formKey ? todo.data : null;
  return (
    <div className="mx-auto grid max-w-3xl grid-cols-1 gap-2">
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
              <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary [&_svg]:size-5">
                <NavIcon name={data.icon} />
              </span>
              <span className="min-w-0 truncate">{localize(data.name, locale)}</span>
            </span>
          ) : (
            <Skeleton className="h-8 w-72" />
          )
        }
        description={data ? localize(data.description, locale) : undefined}
      />
      {assignmentId && (
        <AssignmentBanner
          assignment={todo.data?.form.key === formKey ? todo.data : undefined}
          notFound={Boolean(todo.error) || Boolean(todo.data && todo.data.form.key !== formKey)}
        />
      )}
      {isLoading || (assignmentId && todo.isLoading) ? (
        <Skeleton className="h-96 w-full rounded-xl" />
      ) : error || !data ? (
        <EmptyState
          icon={<FileQuestionIcon />}
          title={t('unavailable')}
          description={t('unavailableHint')}
          action={<Button label={t('back')} variant="secondary" href="/requests" />}
          className="rounded-xl border border-dashed"
        />
      ) : (
        <FormBody key={`${data.key}-${data.version}`} form={data} assignment={assignment} />
      )}
    </div>
  );
}
