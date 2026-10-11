'use client';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { CheckboxList, CheckboxListItem } from '@astryxdesign/core/CheckboxList';
import { DateInput } from '@astryxdesign/core/DateInput';
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import { Field } from '@astryxdesign/core/Field';
import { FormLayout } from '@astryxdesign/core/FormLayout';
import { Grid, GridSpan } from '@astryxdesign/core/Grid';
import { HStack, Layout, LayoutContent, LayoutFooter, VStack } from '@astryxdesign/core/Layout';
import { Selector } from '@astryxdesign/core/Selector';
import { Text } from '@astryxdesign/core/Text';
import { TextArea } from '@astryxdesign/core/TextArea';
import { TextInput } from '@astryxdesign/core/TextInput';
import { countFilled, OptionalFields, useFieldList } from '@isbp/ui/optional-fields';
import { useApiMutation, useApiQuery, useErrorText } from '@isbp/ui/query';
import { RecordPicker } from '@isbp/ui/record-picker';
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
import { useTimeZone, useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import type { CreateSharedAccountInput, LookupItem, SharedAccount } from '../contracts';
import { asDay, INVALIDATE, todayLocal } from './lib';
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
  const ids = { target: useId(), custodian: useId(), members: useId() };
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
    label: string,
    isRequired?: boolean,
  ) => (
    <TextInput
      label={label}
      isRequired={isRequired}
      value={v[key]}
      onChange={(value) => setV({ ...v, [key]: value })}
    />
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
    <SheetForm onSubmit={submit} noValidate>
      <SheetBody className="py-2">
        <FormLayout defaultOptionality="optional">
          <Grid columns={{ minWidth: 240 }} gap={4}>
            {input('accountName', t('fields.accountName'), true)}
            {input('targetSystem', t('fields.targetSystem'))}
          </Grid>
          <Field label={t('fields.custodian')} inputID={ids.custodian} isRequired>
            <PersonField
              id={ids.custodian}
              value={v.custodianId}
              onChange={(id) => setV({ ...v, custodianId: id })}
              clearable={false}
            />
          </Field>
          <Field
            label={t('fields.members')}
            inputID={ids.members}
            description={account ? t('accountForm.removeHint') : undefined}
          >
            <PeoplePicker
              id={ids.members}
              value={v.memberIds}
              onChange={(m) => setV({ ...v, memberIds: m })}
              addLabel={t('accountForm.addMember')}
            />
          </Field>
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
          >
            <FormLayout defaultOptionality="optional">
              <Field
                label={t('fields.targetRecord')}
                inputID={ids.target}
                description={t('accountForm.targetHint')}
              >
                <RecordPicker
                  id={ids.target}
                  types={TARGET_TYPES}
                  value={v.targetRef ? [v.targetRef] : []}
                  onChange={(refs: string[]) => setV({ ...v, targetRef: refs[0] ?? null })}
                />
              </Field>
              <Grid columns={{ minWidth: 240 }} gap={4}>
                <Selector
                  label={t('fields.department')}
                  value={v.departmentId}
                  onChange={(d) => setV({ ...v, departmentId: d })}
                  options={[
                    { value: NONE, label: t('accountForm.noDepartment') },
                    ...(depts?.items ?? []).map((d) => ({ value: d.id, label: d.name })),
                  ]}
                />
                {input('project', t('fields.project'))}
                {input('requestReference', t('fields.requestReference'))}
                {!account && (
                  <DateInput
                    label={t('fields.lastPasswordChangeOn')}
                    hasClear
                    value={asDay(v.lastPasswordChangeOn)}
                    onChange={(d) => setV({ ...v, lastPasswordChangeOn: d ?? '' })}
                  />
                )}
                <DateInput
                  label={t('fields.nextReviewOn')}
                  hasClear
                  value={asDay(v.nextReviewOn)}
                  onChange={(d) => setV({ ...v, nextReviewOn: d ?? '' })}
                />
                <GridSpan columns="full">
                  <TextArea
                    label={t('fields.purpose')}
                    rows={2}
                    value={v.purpose}
                    onChange={(value) => setV({ ...v, purpose: value })}
                  />
                </GridSpan>
                <GridSpan columns="full">
                  <TextArea
                    label={t('fields.notes')}
                    rows={2}
                    value={v.notes}
                    onChange={(value) => setV({ ...v, notes: value })}
                  />
                </GridSpan>
              </Grid>
            </FormLayout>
          </OptionalFields>
          {error && <Banner status="error" title={error} collapsible={false} />}
        </FormLayout>
      </SheetBody>
      <SheetFooter>
        <Button label={tc('cancel')} variant="secondary" type="button" onClick={onCancel} />
        <Button
          label={account ? tc('saveChanges') : t('accountForm.register')}
          variant="primary"
          isLoading={save.isPending}
          type="submit"
        />
      </SheetFooter>
    </SheetForm>
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
    <Dialog isOpen={open} onOpenChange={onOpenChange} width={448} purpose="form">
      <Layout
        header={
          <DialogHeader
            title={t('title', { account: account.accountName })}
            subtitle={t('description')}
            onOpenChange={onOpenChange}
          />
        }
        content={
          <LayoutContent padding={4}>
            <FormLayout defaultOptionality="optional">
              <DateInput
                label={t('changedOn')}
                isRequired
                max={asDay(today)}
                value={asDay(changedOn)}
                onChange={(d) => setChangedOn(d ?? '')}
              />
              <TextArea label={t('note')} rows={2} value={note} onChange={setNote} />
              {error && <Banner status="error" title={error} collapsible={false} />}
            </FormLayout>
          </LayoutContent>
        }
        footer={
          <LayoutFooter hasDivider padding={3}>
            <HStack gap={2} hAlign="end">
              <Button label={tc('cancel')} variant="ghost" onClick={() => onOpenChange(false)} />
              <Button
                label={t('submit')}
                variant="primary"
                isLoading={save.isPending}
                isDisabled={!changedOn}
                onClick={async () => {
                  setError(null);
                  try {
                    await save.mutateAsync(undefined);
                    onOpenChange(false);
                  } catch (err) {
                    setError(errorText(err));
                  }
                }}
              />
            </HStack>
          </LayoutFooter>
        }
      />
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
    <Dialog isOpen={open} onOpenChange={onOpenChange} width={448} purpose="form">
      <Layout
        header={
          <DialogHeader
            title={t('title', { account: account.accountName })}
            subtitle={t('description')}
            onOpenChange={onOpenChange}
          />
        }
        content={
          <LayoutContent padding={4}>
            <VStack gap={4}>
              <CheckboxList label={t('members')} value={keep} onChange={setKeep}>
                {account.members.map((m) => (
                  <CheckboxListItem
                    key={m.user.id}
                    value={m.user.id}
                    label={m.user.displayName}
                    description={m.active ? undefined : t('inactive')}
                  />
                ))}
              </CheckboxList>
              <TextArea label={t('note')} rows={2} value={note} onChange={setNote} />
              <Text as="p" color="secondary" aria-live="polite">
                {removed > 0 ? t('removing', { count: removed }) : t('keepingAll')}
              </Text>
              {error && <Banner status="error" title={error} collapsible={false} />}
            </VStack>
          </LayoutContent>
        }
        footer={
          <LayoutFooter hasDivider padding={3}>
            <HStack gap={2} hAlign="end">
              <Button label={tc('cancel')} variant="ghost" onClick={() => onOpenChange(false)} />
              <Button
                label={t('submit')}
                variant="primary"
                isLoading={save.isPending}
                onClick={async () => {
                  setError(null);
                  try {
                    await save.mutateAsync(undefined);
                    onOpenChange(false);
                  } catch (err) {
                    setError(errorText(err));
                  }
                }}
              />
            </HStack>
          </LayoutFooter>
        }
      />
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
    <Dialog isOpen onOpenChange={onOpenChange} width={448} purpose="form">
      <Layout
        header={
          <DialogHeader
            title={t('addPersonTitle', { account: account.accountName })}
            subtitle={t('addPersonDescription')}
            onOpenChange={onOpenChange}
          />
        }
        content={
          <LayoutContent padding={4}>
            <VStack gap={4}>
              <Field label={t('person')} inputID={id} isRequired>
                <PersonField id={id} value={person} onChange={setPerson} invalid={Boolean(error)} />
              </Field>
              {error && <Banner status="error" title={error} collapsible={false} />}
            </VStack>
          </LayoutContent>
        }
        footer={
          <LayoutFooter hasDivider padding={3}>
            <HStack gap={2} hAlign="end">
              <Button label={tc('cancel')} variant="ghost" onClick={() => onOpenChange(false)} />
              <Button
                label={t('addPerson')}
                variant="primary"
                isLoading={save.isPending}
                isDisabled={!person}
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
              />
            </HStack>
          </LayoutFooter>
        }
      />
    </Dialog>
  );
}
