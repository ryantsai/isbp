'use client';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { DateInput } from '@astryxdesign/core/DateInput';
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import { Field } from '@astryxdesign/core/Field';
import { FormLayout } from '@astryxdesign/core/FormLayout';
import { Grid, GridSpan } from '@astryxdesign/core/Grid';
import { HStack, Layout, LayoutContent, LayoutFooter, StackItem } from '@astryxdesign/core/Layout';
import { Selector } from '@astryxdesign/core/Selector';
import { Text } from '@astryxdesign/core/Text';
import { TextArea } from '@astryxdesign/core/TextArea';
import { TextInput } from '@astryxdesign/core/TextInput';
import { useCan } from '@isbp/sdk/web';
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
import {
  ACCOUNT_STATES,
  type CreateReviewInput,
  type DecideItemInput,
  type LookupItem,
  PRIVILEGES,
  RECURRENCES,
  REVIEW_COLUMNS,
  type Review,
  type ReviewImportReport,
  type ReviewItem,
} from '../contracts';
import { TARGET_TYPES } from './account-dialogs';
import { CsvImportDialog } from './import-dialog';
import { asDay, INVALIDATE, todayLocal } from './lib';
import { PersonField } from './people';

const NONE = '__none__';

/** Start or schedule an account review: target, reviewer, dates, recurrence and where the accounts come from. */
export function NewReviewSheet({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (r: Review) => void;
}) {
  const t = useTranslations('isms.newReview');
  const tc = useTranslations('common');
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-xl" closeLabel={tc('close')}>
        <SheetHeader>
          <SheetTitle>{t('title')}</SheetTitle>
          <SheetDescription>{t('description')}</SheetDescription>
        </SheetHeader>
        {open && (
          <NewReviewForm
            onCancel={() => onOpenChange(false)}
            onCreated={(r) => {
              onOpenChange(false);
              onCreated(r);
            }}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

function NewReviewForm({ onCancel, onCreated }: { onCancel: () => void; onCreated: (r: Review) => void }) {
  const t = useTranslations('isms');
  const tc = useTranslations('common');
  const errorText = useErrorText();
  const timeZone = useTimeZone();
  const today = todayLocal(timeZone);
  const canApps = useCan('isms.reviews.manage');
  const { data: apps } = useApiQuery<{ items: LookupItem[] }>(canApps ? '/isms/lookups/applications' : null);
  const ids = { ref: useId(), reviewer: useId() };
  const list = useFieldList();
  const [target, setTarget] = useState('');
  const [targetRef, setTargetRef] = useState<string | null>(null);
  const [reviewerId, setReviewerId] = useState<string | null>(null);
  const [startOn, setStartOn] = useState(today);
  const [dueOn, setDueOn] = useState('');
  const [recurrence, setRecurrence] = useState<(typeof RECURRENCES)[number]>('none');
  const [applicationId, setApplicationId] = useState(NONE);
  const [error, setError] = useState<string | null>(null);
  const save = useApiMutation((api, body: CreateReviewInput) => api.post<Review>('/isms/reviews', body), {
    invalidate: INVALIDATE,
    success: (r) => t('newReview.created', { reference: r.reference }),
    silent: true,
  });
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!target.trim() || !reviewerId || !dueOn) return setError(t('newReview.required'));
    try {
      onCreated(
        await save.mutateAsync({
          target: target.trim(),
          targetRef,
          reviewerId,
          startOn: startOn || null,
          dueOn,
          recurrence,
          applicationId: applicationId === NONE ? null : applicationId,
        }),
      );
    } catch (err) {
      setError(errorText(err));
    }
  };
  const detailsFilled = countFilled(
    targetRef,
    recurrence === 'none' ? '' : recurrence,
    applicationId === NONE ? '' : applicationId,
  );
  return (
    <SheetForm onSubmit={submit} noValidate>
      <SheetBody className="py-2">
        <FormLayout defaultOptionality="optional">
          <TextInput
            label={t('fields.target')}
            isRequired
            value={target}
            onChange={setTarget}
            placeholder={t('newReview.targetPlaceholder')}
          />
          <Field label={t('fields.reviewer')} inputID={ids.reviewer} isRequired>
            <PersonField id={ids.reviewer} value={reviewerId} onChange={setReviewerId} clearable={false} />
          </Field>
          <Grid columns={{ minWidth: 200 }} gap={4}>
            <DateInput
              label={t('fields.startOn')}
              min={asDay(today)}
              value={asDay(startOn)}
              onChange={(d) => setStartOn(d ?? '')}
            />
            <DateInput
              label={t('fields.dueOn')}
              isRequired
              min={asDay(startOn || today)}
              value={asDay(dueOn)}
              onChange={(d) => setDueOn(d ?? '')}
            />
          </Grid>
          <OptionalFields
            hint={list([t('fields.targetRecord'), t('fields.recurrence'), t('newReview.source')])}
            filled={detailsFilled}
          >
            <FormLayout defaultOptionality="optional">
              <Field label={t('fields.targetRecord')} inputID={ids.ref}>
                <RecordPicker
                  id={ids.ref}
                  types={TARGET_TYPES}
                  value={targetRef ? [targetRef] : []}
                  onChange={(r: string[]) => setTargetRef(r[0] ?? null)}
                />
              </Field>
              <Selector
                label={t('fields.recurrence')}
                value={recurrence}
                onChange={(v) => setRecurrence(v as typeof recurrence)}
                options={RECURRENCES.map((r) => ({ value: r, label: t(`recurrence.${r}`) }))}
              />
              <Selector
                label={t('newReview.source')}
                description={t('newReview.sourceHint')}
                value={applicationId}
                onChange={setApplicationId}
                options={[
                  { value: NONE, label: t('newReview.sourceCsv') },
                  ...(apps?.items ?? []).map((a) => ({
                    value: a.id,
                    label: t('newReview.sourceApp', { name: a.name }),
                  })),
                ]}
              />
            </FormLayout>
          </OptionalFields>
          {error && <Banner status="error" title={error} collapsible={false} />}
        </FormLayout>
      </SheetBody>
      <SheetFooter>
        <Button label={tc('cancel')} variant="secondary" type="button" onClick={onCancel} />
        <Button
          label={startOn > today ? t('newReview.schedule') : t('newReview.start')}
          variant="primary"
          isLoading={save.isPending}
          type="submit"
        />
      </SheetFooter>
    </SheetForm>
  );
}

/**
 * Disable or delete one or more accounts: the date it was done (empty while it isn't done yet) and a note. Keep is
 * one click in the list; this dialog is for the decisions that need a date.
 */
export function DecideDialog({
  review,
  items,
  decision,
  onOpenChange,
}: {
  review: string;
  items: ReviewItem[];
  decision: 'disable' | 'delete';
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('isms');
  const tc = useTranslations('common');
  const errorText = useErrorText();
  const timeZone = useTimeZone();
  const today = todayLocal(timeZone);
  const first = items[0];
  const [doneOn, setDoneOn] = useState(first?.decision === decision ? (first.doneOn ?? '') : '');
  const [note, setNote] = useState(items.length === 1 ? (first?.note ?? '') : '');
  const [error, setError] = useState<string | null>(null);
  const save = useApiMutation(
    (api, body: DecideItemInput) =>
      items.length === 1
        ? api.post(`/isms/reviews/${review}/items/${first!.id}/decision`, body)
        : api.post(`/isms/reviews/${review}/decisions`, { ...body, itemIds: items.map((i) => i.id) }),
    { invalidate: INVALIDATE, success: t('decide.saved', { count: items.length }), silent: true },
  );
  return (
    <Dialog isOpen={items.length > 0} onOpenChange={onOpenChange} width={448} purpose="form">
      <Layout
        header={
          <DialogHeader
            title={
              items.length === 1
                ? t(`decide.title.${decision}`, { account: first?.accountName ?? '' })
                : t(`decide.titleMany.${decision}`, { count: items.length })
            }
            subtitle={
              items.length === 1
                ? (first?.userName ?? first?.user?.displayName ?? t('decide.description'))
                : t('decide.description')
            }
            onOpenChange={onOpenChange}
          />
        }
        content={
          <LayoutContent padding={4}>
            <FormLayout defaultOptionality="optional">
              <HStack gap={2} vAlign="end">
                <StackItem size="fill">
                  <DateInput
                    label={t('decide.doneOn')}
                    description={t('decide.doneHint')}
                    hasClear
                    max={asDay(today)}
                    value={asDay(doneOn)}
                    onChange={(d) => setDoneOn(d ?? '')}
                  />
                </StackItem>
                <StackItem>
                  <Button label={t('decide.today')} variant="secondary" onClick={() => setDoneOn(today)} />
                </StackItem>
              </HStack>
              <TextArea label={t('fields.note')} rows={2} value={note} onChange={setNote} />
              {error && <Banner status="error" title={error} collapsible={false} />}
            </FormLayout>
          </LayoutContent>
        }
        footer={
          <LayoutFooter hasDivider padding={3}>
            <HStack gap={2} hAlign="end">
              <Button label={tc('cancel')} variant="ghost" onClick={() => onOpenChange(false)} />
              <Button
                label={t(`reviewDecision.${decision}`)}
                variant={decision === 'delete' ? 'destructive' : 'primary'}
                isLoading={save.isPending}
                onClick={async () => {
                  setError(null);
                  try {
                    await save.mutateAsync({
                      decision,
                      doneOn: doneOn || null,
                      ...(items.length === 1 || note.trim() ? { note: note.trim() || null } : {}),
                    });
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

/** Add an account by hand. */
export function AddAccountDialog({
  review,
  open,
  onOpenChange,
}: {
  review: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const t = useTranslations('isms');
  const tc = useTranslations('common');
  const errorText = useErrorText();
  const personId = useId();
  const [accountName, setAccountName] = useState('');
  const [userName, setUserName] = useState('');
  const [userId, setUserId] = useState<string | null>(null);
  const [privilege, setPrivilege] = useState<(typeof PRIVILEGES)[number]>('user');
  const [accountStatus, setAccountStatus] = useState<(typeof ACCOUNT_STATES)[number]>('enabled');
  const [error, setError] = useState<string | null>(null);
  const save = useApiMutation(
    (api) =>
      api.post(`/isms/reviews/${review}/items`, {
        accountName: accountName.trim(),
        userName: userName.trim() || null,
        userId,
        privilege,
        accountStatus,
      }),
    { invalidate: INVALIDATE, success: t('addAccount.saved'), silent: true },
  );
  return (
    <Dialog isOpen={open} onOpenChange={onOpenChange} width={512} purpose="form">
      <Layout
        header={
          <DialogHeader
            title={t('addAccount.title')}
            subtitle={t('addAccount.description')}
            onOpenChange={onOpenChange}
          />
        }
        content={
          <LayoutContent padding={4}>
            <FormLayout defaultOptionality="optional">
              <Grid columns={{ minWidth: 200 }} gap={4}>
                <TextInput
                  label={t('fields.account')}
                  isRequired
                  value={accountName}
                  onChange={setAccountName}
                />
                <TextInput label={t('fields.userName')} value={userName} onChange={setUserName} />
                <GridSpan columns="full">
                  <Field label={t('fields.person')} inputID={personId}>
                    <PersonField id={personId} value={userId} onChange={setUserId} />
                  </Field>
                </GridSpan>
                <Selector
                  label={t('fields.privilege')}
                  value={privilege}
                  onChange={(v) => setPrivilege(v as typeof privilege)}
                  options={PRIVILEGES.map((p) => ({ value: p, label: t(`privilege.${p}`) }))}
                />
                <Selector
                  label={t('fields.accountState')}
                  value={accountStatus}
                  onChange={(v) => setAccountStatus(v as typeof accountStatus)}
                  options={ACCOUNT_STATES.map((s) => ({ value: s, label: t(`accountState.${s}`) }))}
                />
              </Grid>
              {error && <Banner status="error" title={error} collapsible={false} />}
            </FormLayout>
          </LayoutContent>
        }
        footer={
          <LayoutFooter hasDivider padding={3}>
            <HStack gap={2} hAlign="end">
              <Button label={tc('cancel')} variant="ghost" onClick={() => onOpenChange(false)} />
              <Button
                label={tc('add')}
                variant="primary"
                isLoading={save.isPending}
                isDisabled={!accountName.trim()}
                onClick={async () => {
                  setError(null);
                  try {
                    await save.mutateAsync(undefined);
                    setAccountName('');
                    setUserName('');
                    setUserId(null);
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

/** Import the system's exported account list into a review. */
export function ImportAccountsDialog({
  review,
  open,
  onOpenChange,
}: {
  review: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const t = useTranslations('isms');
  return (
    <CsvImportDialog<ReviewImportReport>
      open={open}
      onOpenChange={onOpenChange}
      title={t('import.accountsTitle')}
      description={t('import.accountsDescription')}
      help={
        <>
          <Text as="p">{t('import.accountsHelp')}</Text>
          <Text as="p" type="supporting">
            {REVIEW_COLUMNS.map((c) => t(`reviewColumns.${c}`)).join(' · ')}
          </Text>
        </>
      }
      endpoint={`/isms/reviews/${review}/import`}
      columnLabel={(c) =>
        (REVIEW_COLUMNS as readonly string[]).includes(c) ? t(`reviewColumns.${c as 'account'}`) : c
      }
      summary={(r) => t('import.accountsSummary', { added: r.added, updated: r.updated, matched: r.matched })}
    />
  );
}
