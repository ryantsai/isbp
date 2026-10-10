'use client';

import { Button } from '@isbp/ui/button';
import { Checkbox } from '@isbp/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@isbp/ui/dialog';
import { Input } from '@isbp/ui/input';
import { Label } from '@isbp/ui/label';
import { countFilled, OptionalFields, useFieldList } from '@isbp/ui/optional-fields';
import { useApiMutation, useApiQuery, useErrorText } from '@isbp/ui/query';
import { RecordPicker } from '@isbp/ui/record-picker';
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
import { useTimeZone, useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import type { CreateSharedAccountInput, LookupItem, SharedAccount } from '../contracts';
import { INVALIDATE, todayLocal } from './lib';
import { PeoplePicker, PersonField } from './people';

const NONE = '__none__';
/** Record types a shared account's target system can be. */
export const TARGET_TYPES = ['alm.application', 'cmdb.ci', 'itam.asset'];

/** Register a shared account, or edit one (members taken off make the password due). */
export function AccountFormSheet({
  open,
  onOpenChange,
  account,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  account?: SharedAccount;
  onSaved?: (a: SharedAccount) => void;
}) {
  const t = useTranslations('isms.accountForm');
  const tc = useTranslations('common');
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-xl" closeLabel={tc('close')}>
        <SheetHeader>
          <SheetTitle>
            {account ? t('editTitle', { reference: account.reference }) : t('createTitle')}
          </SheetTitle>
          <SheetDescription>{t('hint')}</SheetDescription>
        </SheetHeader>
        {open && (
          <AccountForm
            account={account}
            onCancel={() => onOpenChange(false)}
            onSaved={(a) => {
              onOpenChange(false);
              onSaved?.(a);
            }}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

function AccountForm({
  account,
  onCancel,
  onSaved,
}: {
  account?: SharedAccount;
  onCancel: () => void;
  onSaved: (a: SharedAccount) => void;
}) {
  const t = useTranslations('isms');
  const tc = useTranslations('common');
  const errorText = useErrorText();
  const { data: depts } = useApiQuery<{ items: LookupItem[] }>('/isms/lookups/departments');
  const ids = {
    name: useId(),
    system: useId(),
    target: useId(),
    custodian: useId(),
    members: useId(),
    dept: useId(),
    purpose: useId(),
    project: useId(),
    request: useId(),
    changed: useId(),
    review: useId(),
    notes: useId(),
  };
  const list = useFieldList();
  const [v, setV] = useState({
    accountName: account?.accountName ?? '',
    targetSystem: account?.targetSystem ?? '',
    targetRef: account?.targetRef ?? null,
    custodianId: account?.custodian?.id ?? null,
    memberIds: account?.members.map((m) => m.user.id) ?? [],
    departmentId: account?.department?.id ?? NONE,
    purpose: account?.purpose ?? '',
    project: account?.project ?? '',
    requestReference: account?.requestReference ?? '',
    lastPasswordChangeOn: account?.lastPasswordChangeOn ?? '',
    nextReviewOn: account?.nextReviewOn ?? '',
    notes: account?.notes ?? '',
  });
  const [error, setError] = useState<string | null>(null);
  const save = useApiMutation(
    (api, body: CreateSharedAccountInput) =>
      account
        ? api.patch<SharedAccount>(`/isms/accounts/${account.reference}`, body)
        : api.post<SharedAccount>('/isms/accounts', body),
    {
      invalidate: INVALIDATE,
      success: (a) =>
        account ? t('accountForm.saved') : t('accountForm.created', { reference: a.reference }),
      onSuccess: onSaved,
      silent: true,
    },
  );
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!v.accountName.trim() || !v.custodianId) return setError(t('accountForm.required'));
    const body: CreateSharedAccountInput = {
      accountName: v.accountName.trim(),
      targetSystem: v.targetSystem.trim() || null,
      targetRef: v.targetRef,
      custodianId: v.custodianId,
      memberIds: v.memberIds,
      departmentId: v.departmentId === NONE ? null : v.departmentId,
      purpose: v.purpose.trim() || null,
      project: v.project.trim() || null,
      requestReference: v.requestReference.trim() || null,
      nextReviewOn: v.nextReviewOn || null,
      notes: v.notes.trim() || null,
      ...(account ? {} : { lastPasswordChangeOn: v.lastPasswordChangeOn || null }),
    };
    try {
      await save.mutateAsync(body);
    } catch (err) {
      setError(errorText(err));
    }
  };
  const input = (
    key: 'accountName' | 'targetSystem' | 'project' | 'requestReference',
    id: string,
    label: string,
  ) => (
    <div className="grid min-w-0 gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} value={v[key]} onChange={(e) => setV({ ...v, [key]: e.target.value })} />
    </div>
  );
  const detailsFilled = countFilled(
    v.targetRef,
    v.departmentId === NONE ? '' : v.departmentId,
    v.project,
    v.requestReference,
    account ? '' : v.lastPasswordChangeOn,
    v.nextReviewOn,
    v.purpose,
    v.notes,
  );
  return (
    <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col" noValidate>
      <SheetBody className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {input('accountName', ids.name, t('fields.accountName'))}
          {input('targetSystem', ids.system, t('fields.targetSystem'))}
        </div>
        <div className="grid min-w-0 gap-1.5">
          <Label htmlFor={ids.custodian}>{t('fields.custodian')}</Label>
          <PersonField
            id={ids.custodian}
            value={v.custodianId}
            onChange={(id) => setV({ ...v, custodianId: id })}
            clearable={false}
          />
        </div>
        <div className="grid min-w-0 gap-1.5">
          <Label htmlFor={ids.members}>{t('fields.members')}</Label>
          <PeoplePicker
            id={ids.members}
            value={v.memberIds}
            onChange={(m) => setV({ ...v, memberIds: m })}
            addLabel={t('accountForm.addMember')}
          />
          {account && <p className="text-xs text-muted-foreground">{t('accountForm.removeHint')}</p>}
        </div>
        <OptionalFields
          hint={list([
            t('fields.targetRecord'),
            t('fields.department'),
            t('fields.project'),
            t('fields.requestReference'),
            ...(account ? [] : [t('fields.lastPasswordChangeOn')]),
            t('fields.nextReviewOn'),
            t('fields.purpose'),
            t('fields.notes'),
          ])}
          filled={detailsFilled}
          contentClassName="grid gap-4 pt-3 sm:grid-cols-2"
        >
          <div className="grid min-w-0 gap-1.5 sm:col-span-2">
            <Label htmlFor={ids.target}>{t('fields.targetRecord')}</Label>
            <RecordPicker
              id={ids.target}
              types={TARGET_TYPES}
              value={v.targetRef ? [v.targetRef] : []}
              onChange={(refs: string[]) => setV({ ...v, targetRef: refs[0] ?? null })}
            />
            <p className="text-xs text-muted-foreground">{t('accountForm.targetHint')}</p>
          </div>
          <div className="grid min-w-0 gap-1.5">
            <Label htmlFor={ids.dept}>{t('fields.department')}</Label>
            <Select value={v.departmentId} onValueChange={(d) => setV({ ...v, departmentId: d })}>
              <SelectTrigger id={ids.dept} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>{t('accountForm.noDepartment')}</SelectItem>
                {(depts?.items ?? []).map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {input('project', ids.project, t('fields.project'))}
          {input('requestReference', ids.request, t('fields.requestReference'))}
          {!account && (
            <div className="grid min-w-0 gap-1.5">
              <Label htmlFor={ids.changed}>{t('fields.lastPasswordChangeOn')}</Label>
              <Input
                id={ids.changed}
                type="date"
                value={v.lastPasswordChangeOn}
                onChange={(e) => setV({ ...v, lastPasswordChangeOn: e.target.value })}
              />
            </div>
          )}
          <div className="grid min-w-0 gap-1.5">
            <Label htmlFor={ids.review}>{t('fields.nextReviewOn')}</Label>
            <Input
              id={ids.review}
              type="date"
              value={v.nextReviewOn}
              onChange={(e) => setV({ ...v, nextReviewOn: e.target.value })}
            />
          </div>
          <div className="grid gap-1.5 sm:col-span-2">
            <Label htmlFor={ids.purpose}>{t('fields.purpose')}</Label>
            <Textarea
              id={ids.purpose}
              rows={2}
              value={v.purpose}
              onChange={(e) => setV({ ...v, purpose: e.target.value })}
            />
          </div>
          <div className="grid gap-1.5 sm:col-span-2">
            <Label htmlFor={ids.notes}>{t('fields.notes')}</Label>
            <Textarea
              id={ids.notes}
              rows={2}
              value={v.notes}
              onChange={(e) => setV({ ...v, notes: e.target.value })}
            />
          </div>
        </OptionalFields>
        {error && (
          <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}
      </SheetBody>
      <SheetFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          {tc('cancel')}
        </Button>
        <Button type="submit" loading={save.isPending}>
          {account ? tc('saveChanges') : t('accountForm.register')}
        </Button>
      </SheetFooter>
    </form>
  );
}

/** "Password changed": the date it was changed (today by default) and a note. */
export function PasswordChangedDialog({
  account,
  open,
  onOpenChange,
}: {
  account: Pick<SharedAccount, 'reference' | 'accountName'>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('isms.password');
  const tc = useTranslations('common');
  const errorText = useErrorText();
  const timeZone = useTimeZone();
  const today = todayLocal(timeZone);
  const ids = { date: useId(), note: useId() };
  const [changedOn, setChangedOn] = useState(today);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const save = useApiMutation(
    (api) =>
      api.post<SharedAccount>(`/isms/accounts/${account.reference}/password-changed`, {
        changedOn,
        note: note.trim() || null,
      }),
    { invalidate: INVALIDATE, success: t('saved'), silent: true },
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={tc('close')}>
        <DialogHeader>
          <DialogTitle>{t('title', { account: account.accountName })}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-1.5">
            <Label htmlFor={ids.date}>{t('changedOn')}</Label>
            <Input
              id={ids.date}
              type="date"
              max={today}
              value={changedOn}
              onChange={(e) => setChangedOn(e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={ids.note}>{t('note')}</Label>
            <Textarea id={ids.note} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          {error && (
            <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {tc('cancel')}
          </Button>
          <Button
            type="button"
            loading={save.isPending}
            disabled={!changedOn}
            onClick={async () => {
              setError(null);
              try {
                await save.mutateAsync(undefined);
                onOpenChange(false);
              } catch (err) {
                setError(errorText(err));
              }
            }}
          >
            {t('submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The yearly review: tick the members who still need the account. */
export function ReviewAccountDialog({
  account,
  open,
  onOpenChange,
}: {
  account: SharedAccount;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('isms.accountReview');
  const tc = useTranslations('common');
  const errorText = useErrorText();
  const base = useId();
  const [keep, setKeep] = useState<string[]>(account.members.filter((m) => m.active).map((m) => m.user.id));
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const save = useApiMutation(
    (api) =>
      api.post<SharedAccount>(`/isms/accounts/${account.reference}/review`, {
        memberIds: keep,
        note: note.trim() || null,
      }),
    { invalidate: INVALIDATE, success: t('saved'), silent: true },
  );
  const removed = account.members.length - keep.length;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={tc('close')}>
        <DialogHeader>
          <DialogTitle>{t('title', { account: account.accountName })}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">{t('members')}</legend>
          {account.members.map((m) => (
            <div key={m.user.id} className="flex items-center gap-2 text-sm">
              <Checkbox
                id={`${base}-${m.user.id}`}
                checked={keep.includes(m.user.id)}
                onCheckedChange={(v) =>
                  setKeep((k) => (v ? [...k, m.user.id] : k.filter((x) => x !== m.user.id)))
                }
              />
              <Label htmlFor={`${base}-${m.user.id}`} className="font-normal">
                {m.user.displayName}
                {!m.active && <span className="text-muted-foreground"> · {t('inactive')}</span>}
              </Label>
            </div>
          ))}
        </fieldset>
        <div className="grid gap-1.5">
          <Label htmlFor={`${base}-note`}>{t('note')}</Label>
          <Textarea id={`${base}-note`} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {removed > 0 ? t('removing', { count: removed }) : t('keepingAll')}
        </p>
        {error && (
          <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {tc('cancel')}
          </Button>
          <Button
            type="button"
            loading={save.isPending}
            onClick={async () => {
              setError(null);
              try {
                await save.mutateAsync(undefined);
                onOpenChange(false);
              } catch (err) {
                setError(errorText(err));
              }
            }}
          >
            {t('submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Put one more person on the account's list (account managers). */
export function AddPersonDialog({
  account,
  onOpenChange,
}: {
  account: SharedAccount;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('isms.account');
  const tc = useTranslations('common');
  const errorText = useErrorText();
  const id = useId();
  const [person, setPerson] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const save = useApiMutation(
    (api, userId: string) =>
      api.patch<SharedAccount>(`/isms/accounts/${account.reference}`, {
        memberIds: [...account.members.map((m) => m.user.id), userId],
      }),
    { invalidate: INVALIDATE, success: t('personAdded'), silent: true },
  );
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent closeLabel={tc('close')}>
        <DialogHeader>
          <DialogTitle>{t('addPersonTitle', { account: account.accountName })}</DialogTitle>
          <DialogDescription>{t('addPersonDescription')}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-1.5">
          <Label htmlFor={id}>{t('person')}</Label>
          <PersonField id={id} value={person} onChange={setPerson} invalid={Boolean(error)} />
        </div>
        {error && (
          <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {tc('cancel')}
          </Button>
          <Button
            type="button"
            disabled={!person}
            loading={save.isPending}
            onClick={async () => {
              if (!person) return;
              setError(null);
              try {
                await save.mutateAsync(person);
                onOpenChange(false);
              } catch (err) {
                setError(errorText(err));
              }
            }}
          >
            {t('addPerson')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
