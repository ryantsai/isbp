'use client';

import { AlertDialog } from '@astryxdesign/core/AlertDialog';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import type { ISODateString } from '@astryxdesign/core/Calendar';
import { CheckboxList, CheckboxListItem } from '@astryxdesign/core/CheckboxList';
import { DateInput } from '@astryxdesign/core/DateInput';
import { FormLayout } from '@astryxdesign/core/FormLayout';
import { Grid } from '@astryxdesign/core/Grid';
import { Icon } from '@astryxdesign/core/Icon';
import { HStack } from '@astryxdesign/core/Layout';
import { RadioList, RadioListItem } from '@astryxdesign/core/RadioList';
import { Selector } from '@astryxdesign/core/Selector';
import { Text } from '@astryxdesign/core/Text';
import { TextArea } from '@astryxdesign/core/TextArea';
import { TextInput } from '@astryxdesign/core/TextInput';
import { useCan } from '@isbp/sdk/web';
import { countFilled, OptionalFields, useFieldList } from '@isbp/ui/optional-fields';
import { applyServerErrors, useApiMutation, useErrorText } from '@isbp/ui/query';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetForm,
  SheetHeader,
  SheetTitle,
} from '@isbp/ui/sheet';
import { Trash2Icon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type FormEvent, useState } from 'react';
import {
  APPROVAL_SCOPES,
  APPROVAL_STATUSES,
  type ApprovalScope,
  type ApprovalStatus,
  type ApprovedSoftware,
  type CreateApprovedSoftwareInput,
  LICENSE_MODELS,
  type LicenseModel,
} from '../contracts';
import { INVALIDATE, useDepartments } from './lib';
import { ContractPicker, LicensePicker, type PickedContract, type PickedLicense } from './pickers';

/** What "Add to approved list" / "Block" on a discovered title fills in. */
export interface ApprovedSoftwarePrefill {
  title: string;
  publisher?: string | null;
  version?: string | null;
  status?: ApprovalStatus;
  /** The flagged device's department: allowing defaults to it, not to the whole company. */
  department?: { id: string; name: string } | null;
}

type Errors = Partial<Record<'title' | 'departmentIds' | 'validUntil' | 'licenseModel' | 'root', string>>;

/** An error text as the `status` of an Astryx field. */
const failure = (message: string | undefined) =>
  message ? ({ type: 'error', message } as const) : undefined;

/**
 * Add or edit an entry of the approved-software list: title, publisher, version (empty = any), licence type and the
 * licence or contract it is used under, scope (company or departments), allowed or blocked, valid until, notes and
 * the request it was approved with. Mounted per opening (`entry` to edit, `prefill` to add from a discovered title).
 */
export function ApprovedSoftwareSheet({
  entry,
  prefill,
  onClose,
}: {
  entry?: ApprovedSoftware;
  prefill?: ApprovedSoftwarePrefill;
  onClose: () => void;
}) {
  const t = useTranslations('itam.approvedSoftware');
  const tc = useTranslations('common');
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent closeLabel={tc('close')} className="sm:max-w-xl">
        <SheetHeader>
          <SheetTitle className="pr-6">{entry ? t('form.editTitle') : t('form.createTitle')}</SheetTitle>
          <SheetDescription>{t('form.hint')}</SheetDescription>
        </SheetHeader>
        <EntryForm entry={entry} prefill={prefill} onDone={onClose} />
      </SheetContent>
    </Sheet>
  );
}

function EntryForm({
  entry,
  prefill,
  onDone,
}: {
  entry?: ApprovedSoftware;
  prefill?: ApprovedSoftwarePrefill;
  onDone: () => void;
}) {
  const t = useTranslations('itam.approvedSoftware');
  const tm = useTranslations('itam.licenseModel');
  const ts = useTranslations('itam.approvalStatus');
  const tc = useTranslations('common');
  const errorText = useErrorText();
  const canContracts = useCan('itam.contracts.read');
  const departments = useDepartments();
  const [title, setTitle] = useState(entry?.title ?? prefill?.title ?? '');
  const [publisher, setPublisher] = useState(entry?.publisher ?? prefill?.publisher ?? '');
  const [version, setVersion] = useState(entry?.version ?? prefill?.version ?? '');
  // No default licence type for a new entry: "Free" would wrongly mark shareware or paid software.
  const [licenseModel, setLicenseModel] = useState<LicenseModel | null>(entry?.licenseModel ?? null);
  const [license, setLicense] = useState<PickedLicense | null>(entry?.license ?? null);
  const [contract, setContract] = useState<PickedContract | null>(entry?.contract ?? null);
  const [scope, setScope] = useState<ApprovalScope>(
    entry?.scope ?? (prefill?.department ? 'departments' : 'company'),
  );
  const [departmentIds, setDepartmentIds] = useState<string[]>(
    entry?.departments.map((d) => d.id) ?? (prefill?.department ? [prefill.department.id] : []),
  );
  const [status, setStatus] = useState<ApprovalStatus>(entry?.status ?? prefill?.status ?? 'allowed');
  const [validUntil, setValidUntil] = useState(entry?.validUntil ?? '');
  const [notes, setNotes] = useState(entry?.notes ?? '');
  const [requestReference, setRequestReference] = useState(entry?.requestReference ?? '');
  const [errors, setErrors] = useState<Errors>({});
  const [confirmDelete, setConfirmDelete] = useState(false);

  const list = useFieldList();
  const detailsFilled = countFilled(
    publisher,
    version,
    license,
    canContracts ? contract : null,
    validUntil,
    requestReference,
    notes,
  );

  const save = useApiMutation(
    (api, body: CreateApprovedSoftwareInput) =>
      entry
        ? api.patch<ApprovedSoftware>(`/itam/approved-software/${entry.id}`, body)
        : api.post<ApprovedSoftware>('/itam/approved-software', body),
    {
      invalidate: INVALIDATE,
      success: (e) => (entry ? t('form.saved', { title: e.title }) : t('form.created', { title: e.title })),
      onSuccess: onDone,
      silent: true,
    },
  );
  const remove = useApiMutation((api) => api.delete(`/itam/approved-software/${entry!.id}`), {
    invalidate: INVALIDATE,
    success: t('form.deleted', { title: entry?.title ?? '' }),
    onSuccess: onDone,
  });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const next: Errors = {};
    if (!title.trim()) next.title = t('form.titleRequired');
    if (scope === 'departments' && !departmentIds.length) next.departmentIds = t('form.departmentsRequired');
    if (!licenseModel) next.licenseModel = t('form.licenseModelRequired');
    setErrors(next);
    if (Object.keys(next).length || !licenseModel) return;
    try {
      await save.mutateAsync({
        title: title.trim(),
        publisher: publisher.trim() || null,
        version: version.trim() || null,
        licenseModel,
        licenseId: license?.id ?? null,
        ...(canContracts ? { contractId: contract?.id ?? null } : {}),
        scope,
        departmentIds: scope === 'departments' ? departmentIds : [],
        status,
        validUntil: validUntil || null,
        notes: notes.trim() || null,
        requestReference: requestReference.trim() || null,
      });
    } catch (err) {
      const fields: Errors = {};
      if (
        applyServerErrors(
          err,
          ((name: keyof Errors, v: { message: string }) => (fields[name] = v.message)) as never,
        )
      )
        setErrors(fields);
      else setErrors({ root: errorText(err) });
    }
  };

  return (
    <>
      <SheetForm onSubmit={submit} noValidate>
        <SheetBody>
          <FormLayout defaultOptionality="optional">
            <TextInput
              label={t('fields.title')}
              isRequired
              value={title}
              onChange={setTitle}
              status={failure(errors.title)}
            />
            <Grid columns={{ minWidth: 220 }} gap={4}>
              <Selector
                label={t('fields.status')}
                value={status}
                onChange={(v) => setStatus(v as ApprovalStatus)}
                options={APPROVAL_STATUSES.map((s) => ({ value: s, label: ts(s) }))}
              />
              <Selector
                label={t('fields.licenseModel')}
                isRequired
                placeholder={t('form.chooseLicenseModel')}
                value={licenseModel ?? undefined}
                onChange={(v) => setLicenseModel(v as LicenseModel)}
                status={failure(errors.licenseModel)}
                options={LICENSE_MODELS.map((m) => ({ value: m, label: tm(m) }))}
              />
            </Grid>
            <RadioList
              label={t('fields.scope')}
              orientation="horizontal"
              value={scope}
              onChange={(v) => setScope(v as ApprovalScope)}
            >
              {APPROVAL_SCOPES.map((s) => (
                <RadioListItem key={s} value={s} label={t(`scope.${s}`)} />
              ))}
            </RadioList>
            {scope === 'departments' && (
              <CheckboxList
                label={t('fields.departments')}
                density="compact"
                value={departmentIds}
                onChange={setDepartmentIds}
                status={failure(errors.departmentIds)}
              >
                {departments.map((d) => (
                  <CheckboxListItem
                    key={d.id}
                    value={d.id}
                    label={d.name}
                    endContent={<Text type="code">{d.code}</Text>}
                  />
                ))}
              </CheckboxList>
            )}
            <OptionalFields
              hint={list([
                t('fields.publisher'),
                t('fields.version'),
                t('fields.license'),
                t('fields.validUntil'),
                t('fields.notes'),
              ])}
              filled={detailsFilled}
            >
              <FormLayout defaultOptionality="optional">
                <Grid columns={{ minWidth: 220 }} gap={4} align="end">
                  <TextInput label={t('fields.publisher')} value={publisher} onChange={setPublisher} />
                  <TextInput
                    label={t('fields.version')}
                    description={t('form.versionHint')}
                    placeholder={t('anyVersion')}
                    value={version}
                    onChange={setVersion}
                  />
                </Grid>
                <LicensePicker
                  label={t('fields.license')}
                  description={t('form.licenseHint')}
                  value={license}
                  onChange={setLicense}
                />
                {canContracts && (
                  <ContractPicker label={t('fields.contract')} value={contract} onChange={setContract} />
                )}
                <Grid columns={{ minWidth: 220 }} gap={4}>
                  <DateInput
                    label={t('fields.validUntil')}
                    description={t('form.validUntilHint')}
                    hasClear
                    value={(validUntil || undefined) as ISODateString | undefined}
                    onChange={(v) => setValidUntil(v ?? '')}
                    status={failure(errors.validUntil)}
                  />
                  <TextInput
                    label={t('fields.request')}
                    description={t('form.requestHint')}
                    value={requestReference}
                    onChange={setRequestReference}
                  />
                </Grid>
                <TextArea
                  label={t('fields.notes')}
                  rows={3}
                  maxLength={5000}
                  value={notes}
                  onChange={setNotes}
                />
              </FormLayout>
            </OptionalFields>
            {errors.root && <Banner status="error" title={errors.root} collapsible={false} />}
          </FormLayout>
        </SheetBody>
        <SheetFooter className="flex-col-reverse gap-2 sm:flex-row sm:justify-between">
          {entry ? (
            <Button
              label={tc('delete')}
              variant="ghost"
              icon={<Icon icon={Trash2Icon} />}
              type="button"
              onClick={() => setConfirmDelete(true)}
            />
          ) : (
            <span />
          )}
          <HStack gap={2} wrap="wrap" hAlign="end">
            <Button label={tc('cancel')} variant="secondary" type="button" onClick={onDone} />
            <Button
              label={entry ? tc('save') : t('form.add')}
              variant="primary"
              isLoading={save.isPending}
              type="submit"
            />
          </HStack>
        </SheetFooter>
      </SheetForm>
      {entry && (
        <AlertDialog
          isOpen={confirmDelete}
          onOpenChange={setConfirmDelete}
          title={t('form.deleteTitle', { title: entry.title })}
          description={t('form.deleteDescription')}
          actionLabel={tc('delete')}
          cancelLabel={tc('cancel')}
          isActionLoading={remove.isPending}
          onAction={() => remove.mutate(undefined)}
        />
      )}
    </>
  );
}
