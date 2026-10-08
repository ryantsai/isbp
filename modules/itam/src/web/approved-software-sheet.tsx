'use client';

import { useCan } from '@isbp/sdk/web';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@isbp/ui/alert-dialog';
import { Button } from '@isbp/ui/button';
import { Checkbox } from '@isbp/ui/checkbox';
import { Input } from '@isbp/ui/input';
import { Label } from '@isbp/ui/label';
import { applyServerErrors, useApiMutation, useErrorText } from '@isbp/ui/query';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@isbp/ui/select';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@isbp/ui/sheet';
import { Textarea } from '@isbp/ui/textarea';
import { Trash2Icon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type FormEvent, type ReactNode, useId, useState } from 'react';
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
}

type Errors = Partial<Record<'title' | 'departmentIds' | 'validUntil' | 'root', string>>;

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

function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="grid min-w-0 gap-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error ? (
        <p id={`${id}-error`} className="text-xs text-destructive">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
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
  const id = useId();
  const f = (k: string) => `${id}-${k}`;
  const [title, setTitle] = useState(entry?.title ?? prefill?.title ?? '');
  const [publisher, setPublisher] = useState(entry?.publisher ?? prefill?.publisher ?? '');
  const [version, setVersion] = useState(entry?.version ?? prefill?.version ?? '');
  const [licenseModel, setLicenseModel] = useState<LicenseModel>(entry?.licenseModel ?? 'free');
  const [license, setLicense] = useState<PickedLicense | null>(entry?.license ?? null);
  const [contract, setContract] = useState<PickedContract | null>(entry?.contract ?? null);
  const [scope, setScope] = useState<ApprovalScope>(entry?.scope ?? 'company');
  const [departmentIds, setDepartmentIds] = useState<string[]>(entry?.departments.map((d) => d.id) ?? []);
  const [status, setStatus] = useState<ApprovalStatus>(entry?.status ?? prefill?.status ?? 'allowed');
  const [validUntil, setValidUntil] = useState(entry?.validUntil ?? '');
  const [notes, setNotes] = useState(entry?.notes ?? '');
  const [requestReference, setRequestReference] = useState(entry?.requestReference ?? '');
  const [errors, setErrors] = useState<Errors>({});
  const [confirmDelete, setConfirmDelete] = useState(false);

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
    setErrors(next);
    if (Object.keys(next).length) return;
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

  const describedBy = (k: keyof Errors, hint = false) =>
    errors[k] ? `${f(k)}-error` : hint ? `${f(k)}-hint` : undefined;

  return (
    <form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col">
      <SheetBody className="grid content-start gap-4 overflow-y-auto">
        <Field id={f('title')} label={t('fields.title')} error={errors.title}>
          <Input
            id={f('title')}
            value={title}
            maxLength={200}
            required
            aria-invalid={errors.title ? true : undefined}
            aria-describedby={describedBy('title')}
            onChange={(e) => setTitle(e.target.value)}
          />
        </Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field id={f('publisher')} label={t('fields.publisher')}>
            <Input
              id={f('publisher')}
              value={publisher}
              maxLength={200}
              onChange={(e) => setPublisher(e.target.value)}
            />
          </Field>
          <Field id={f('version')} label={t('fields.version')} hint={t('form.versionHint')}>
            <Input
              id={f('version')}
              value={version}
              maxLength={64}
              placeholder={t('anyVersion')}
              aria-describedby={`${f('version')}-hint`}
              onChange={(e) => setVersion(e.target.value)}
            />
          </Field>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field id={f('status')} label={t('fields.status')}>
            <Select value={status} onValueChange={(v) => setStatus(v as ApprovalStatus)}>
              <SelectTrigger id={f('status')} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {APPROVAL_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {ts(s)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field id={f('model')} label={t('fields.licenseModel')}>
            <Select value={licenseModel} onValueChange={(v) => setLicenseModel(v as LicenseModel)}>
              <SelectTrigger id={f('model')} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LICENSE_MODELS.map((m) => (
                  <SelectItem key={m} value={m}>
                    {tm(m)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>
        <Field id={f('license')} label={t('fields.license')} hint={t('form.licenseHint')}>
          <LicensePicker id={f('license')} value={license} onChange={setLicense} />
        </Field>
        {canContracts && (
          <Field id={f('contract')} label={t('fields.contract')}>
            <ContractPicker id={f('contract')} value={contract} onChange={setContract} />
          </Field>
        )}
        <fieldset className="grid min-w-0 gap-2">
          <legend className="mb-2 text-sm font-medium">{t('fields.scope')}</legend>
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            {APPROVAL_SCOPES.map((s) => (
              <label key={s} className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name={f('scope')}
                  value={s}
                  checked={scope === s}
                  onChange={() => setScope(s)}
                  className="size-4 accent-primary"
                />
                {t(`scope.${s}`)}
              </label>
            ))}
          </div>
          {scope === 'departments' && (
            <div
              className="grid max-h-56 gap-1.5 overflow-y-auto rounded-md border p-3"
              role="group"
              aria-label={t('fields.departments')}
              aria-describedby={describedBy('departmentIds')}
            >
              {departments.map((d) => {
                const checked = departmentIds.includes(d.id);
                return (
                  <label key={d.id} className="flex min-w-0 items-center gap-2 text-sm">
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(v) =>
                        setDepartmentIds((ids) =>
                          v === true ? [...ids, d.id] : ids.filter((x) => x !== d.id),
                        )
                      }
                    />
                    <span className="truncate">{d.name}</span>
                    <span className="font-mono text-xs text-muted-foreground">{d.code}</span>
                  </label>
                );
              })}
            </div>
          )}
          {errors.departmentIds && (
            <p id={`${f('departmentIds')}-error`} className="text-xs text-destructive">
              {errors.departmentIds}
            </p>
          )}
        </fieldset>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field
            id={f('until')}
            label={t('fields.validUntil')}
            hint={t('form.validUntilHint')}
            error={errors.validUntil}
          >
            <Input
              id={f('until')}
              type="date"
              value={validUntil}
              aria-describedby={describedBy('validUntil', true) ?? `${f('until')}-hint`}
              onChange={(e) => setValidUntil(e.target.value)}
            />
          </Field>
          <Field id={f('request')} label={t('fields.request')} hint={t('form.requestHint')}>
            <Input
              id={f('request')}
              value={requestReference}
              maxLength={40}
              placeholder="REQ-01042"
              aria-describedby={`${f('request')}-hint`}
              onChange={(e) => setRequestReference(e.target.value)}
            />
          </Field>
        </div>
        <Field id={f('notes')} label={t('fields.notes')}>
          <Textarea
            id={f('notes')}
            rows={3}
            value={notes}
            maxLength={5000}
            onChange={(e) => setNotes(e.target.value)}
          />
        </Field>
        {errors.root && (
          <p role="alert" className="text-sm text-destructive">
            {errors.root}
          </p>
        )}
      </SheetBody>
      <SheetFooter className="flex-col-reverse gap-2 sm:flex-row sm:justify-between">
        {entry ? (
          <Button
            type="button"
            variant="ghost"
            className="text-destructive hover:text-destructive"
            onClick={() => setConfirmDelete(true)}
          >
            <Trash2Icon aria-hidden /> {tc('delete')}
          </Button>
        ) : (
          <span />
        )}
        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          <Button type="button" variant="outline" onClick={onDone}>
            {tc('cancel')}
          </Button>
          <Button type="submit" loading={save.isPending}>
            {entry ? tc('save') : t('form.add')}
          </Button>
        </div>
      </SheetFooter>
      {entry && (
        <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t('form.deleteTitle', { title: entry.title })}</AlertDialogTitle>
              <AlertDialogDescription>{t('form.deleteDescription')}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{tc('cancel')}</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-white hover:bg-destructive/90"
                onClick={() => remove.mutate(undefined)}
              >
                {tc('delete')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </form>
  );
}
