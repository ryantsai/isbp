'use client';

import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { DateInput } from '@astryxdesign/core/DateInput';
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import { FormLayout } from '@astryxdesign/core/FormLayout';
import { Grid, GridSpan } from '@astryxdesign/core/Grid';
import { HStack, Layout, LayoutContent, LayoutFooter } from '@astryxdesign/core/Layout';
import { Selector } from '@astryxdesign/core/Selector';
import { TextArea } from '@astryxdesign/core/TextArea';
import { TextInput } from '@astryxdesign/core/TextInput';
import { zodResolver } from '@hookform/resolvers/zod';
import { ApiError } from '@isbp/sdk/web';
import { Form, FormField, fieldStatus } from '@isbp/ui/form';
import { countFilled, OptionalFields, useFieldList } from '@isbp/ui/optional-fields';
import { applyServerErrors, useApiMutation, useErrorText } from '@isbp/ui/query';
import { useTranslations } from 'next-intl';
import { useId, useMemo } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import { type CreateReleaseInput, type ReleaseDetail, VERSION_RE } from '../contracts';
import { RELEASE_META } from './badges';
import { asDay, INVALIDATE } from './lib';

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
  // The dialog's name is set here, not left to the header: the form inside is mounted per opening, after the dialog.
  const title = release ? t('editTitle', { version: release.version }) : t('createTitle', { name: app.name });
  return (
    <Dialog isOpen={open} onOpenChange={onOpenChange} width={576} purpose="form" aria-label={title}>
      {/* Mounted per opening: the form starts from the release as it is now. */}
      {open && (
        <ReleaseForm
          title={title}
          app={app}
          release={release}
          onCancel={() => onOpenChange(false)}
          onSaved={(r) => {
            onOpenChange(false);
            onSaved?.(r);
          }}
        />
      )}
    </Dialog>
  );
}

function ReleaseForm({
  title,
  app,
  release,
  onCancel,
  onSaved,
}: {
  title: string;
  app: { code: string; name: string };
  release?: ReleaseDetail;
  onCancel: () => void;
  onSaved: (r: ReleaseDetail) => void;
}) {
  const t = useTranslations('alm');
  const tc = useTranslations('common');
  const errorText = useErrorText();
  const formId = useId();
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
      <Layout
        header={
          <DialogHeader
            title={title}
            subtitle={t('releaseForm.hint')}
            onOpenChange={(next) => !next && onCancel()}
          />
        }
        content={
          <LayoutContent padding={4}>
            <form id={formId} onSubmit={onSubmit} noValidate>
              <FormLayout defaultOptionality="optional">
                <Grid columns={{ minWidth: 220, repeat: 'fit' }} gap={4} align="end">
                  <FormField
                    control={form.control}
                    name="version"
                    render={({ field, fieldState }) => (
                      <TextInput
                        label={t('fields.version')}
                        isRequired
                        hasAutoFocus={!release}
                        placeholder="12.1.0"
                        isReadOnly={deployed}
                        description={deployed ? t('releaseForm.versionLocked') : t('releaseForm.versionHint')}
                        value={field.value}
                        onChange={field.onChange}
                        onBlur={field.onBlur}
                        ref={field.ref}
                        status={fieldStatus(fieldState)}
                      />
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="plannedDate"
                    render={({ field, fieldState }) => (
                      <DateInput
                        label={t('fields.plannedDate')}
                        hasClear
                        value={asDay(field.value)}
                        onChange={(d) => field.onChange(d ?? '')}
                        status={fieldStatus(fieldState)}
                      />
                    )}
                  />
                </Grid>
                <OptionalFields
                  hint={list([t('fields.releaseName'), t('fields.status'), t('fields.notes')])}
                  filled={detailsFilled}
                >
                  <FormLayout defaultOptionality="optional">
                    <Grid columns={{ minWidth: 220, repeat: 'fit' }} gap={4} align="end">
                      <FormField
                        control={form.control}
                        name="name"
                        render={({ field, fieldState }) => (
                          <TextInput
                            label={t('fields.releaseName')}
                            placeholder={t('releaseForm.namePlaceholder')}
                            value={field.value}
                            onChange={field.onChange}
                            onBlur={field.onBlur}
                            ref={field.ref}
                            status={fieldStatus(fieldState)}
                          />
                        )}
                      />
                      {!release && (
                        <FormField
                          control={form.control}
                          name="status"
                          render={({ field, fieldState }) => (
                            <Selector
                              label={t('fields.status')}
                              value={field.value}
                              onChange={(v) => field.onChange(v)}
                              options={CREATE_STATUSES.map((s) => ({
                                value: s,
                                label: t(`releaseStatus.${s}`),
                                icon: RELEASE_META[s].icon,
                              }))}
                              status={fieldStatus(fieldState)}
                            />
                          )}
                        />
                      )}
                      <GridSpan columns="full">
                        <FormField
                          control={form.control}
                          name="notes"
                          render={({ field, fieldState }) => (
                            <TextArea
                              label={t('fields.notes')}
                              rows={6}
                              placeholder={t('releaseForm.notesPlaceholder')}
                              description={t('form.markdownHint')}
                              value={field.value}
                              onChange={field.onChange}
                              onBlur={field.onBlur}
                              ref={field.ref}
                              status={fieldStatus(fieldState)}
                            />
                          )}
                        />
                      </GridSpan>
                    </Grid>
                  </FormLayout>
                </OptionalFields>
                {form.formState.errors.root && (
                  <Banner
                    status="error"
                    title={form.formState.errors.root.message ?? ''}
                    collapsible={false}
                  />
                )}
              </FormLayout>
            </form>
          </LayoutContent>
        }
        footer={
          <LayoutFooter hasDivider padding={3}>
            <HStack gap={2} hAlign="end">
              <Button label={tc('cancel')} variant="ghost" onClick={onCancel} />
              <Button
                label={release ? tc('saveChanges') : tc('create')}
                variant="primary"
                type="submit"
                form={formId}
                isLoading={save.isPending}
              />
            </HStack>
          </LayoutFooter>
        }
      />
    </Form>
  );
}
