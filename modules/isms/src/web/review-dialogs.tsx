'use client';

import { Button } from '@isbp/ui/button';
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
import { useCan } from '@isbp/sdk/web';
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
  REVIEW_DECISIONS,
  type Review,
  type ReviewImportReport,
  type ReviewItem,
} from '../contracts';
import { TARGET_TYPES } from './account-dialogs';
import { CsvImportDialog } from './import-dialog';
import { INVALIDATE, todayLocal } from './lib';
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
  const ids = {
    target: useId(),
    ref: useId(),
    reviewer: useId(),
    start: useId(),
    due: useId(),
    rec: useId(),
    app: useId(),
  };
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
  return (
    <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col" noValidate>
      <SheetBody className="space-y-4">
        <div className="grid gap-1.5">
          <Label htmlFor={ids.target}>{t('fields.target')}</Label>
          <Input
            id={ids.target}
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            placeholder={t('newReview.targetPlaceholder')}
          />
        </div>
        <div className="grid min-w-0 gap-1.5">
          <Label htmlFor={ids.ref}>{t('fields.targetRecord')}</Label>
          <RecordPicker
            id={ids.ref}
            types={TARGET_TYPES}
            value={targetRef ? [targetRef] : []}
            onChange={(r: string[]) => setTargetRef(r[0] ?? null)}
          />
        </div>
        <div className="grid min-w-0 gap-1.5">
          <Label htmlFor={ids.reviewer}>{t('fields.reviewer')}</Label>
          <PersonField id={ids.reviewer} value={reviewerId} onChange={setReviewerId} clearable={false} />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="grid gap-1.5">
            <Label htmlFor={ids.start}>{t('fields.startOn')}</Label>
            <Input
              id={ids.start}
              type="date"
              min={today}
              value={startOn}
              onChange={(e) => setStartOn(e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={ids.due}>{t('fields.dueOn')}</Label>
            <Input
              id={ids.due}
              type="date"
              min={startOn || today}
              value={dueOn}
              onChange={(e) => setDueOn(e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={ids.rec}>{t('fields.recurrence')}</Label>
            <Select value={recurrence} onValueChange={(v) => setRecurrence(v as typeof recurrence)}>
              <SelectTrigger id={ids.rec} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RECURRENCES.map((r) => (
                  <SelectItem key={r} value={r}>
                    {t(`recurrence.${r}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="grid min-w-0 gap-1.5">
          <Label htmlFor={ids.app}>{t('newReview.source')}</Label>
          <Select value={applicationId} onValueChange={setApplicationId}>
            <SelectTrigger id={ids.app} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>{t('newReview.sourceCsv')}</SelectItem>
              {(apps?.items ?? []).map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {t('newReview.sourceApp', { name: a.name })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">{t('newReview.sourceHint')}</p>
        </div>
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
          {startOn > today ? t('newReview.schedule') : t('newReview.start')}
        </Button>
      </SheetFooter>
    </form>
  );
}

/** Decide one or several accounts: keep, disable or delete, with the date it was done and a note. */
export function DecideDialog({
  review,
  items,
  onOpenChange,
}: {
  review: string;
  items: ReviewItem[];
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('isms');
  const tc = useTranslations('common');
  const errorText = useErrorText();
  const timeZone = useTimeZone();
  const today = todayLocal(timeZone);
  const name = useId();
  const first = items[0];
  const [decision, setDecision] = useState<(typeof REVIEW_DECISIONS)[number]>(first?.decision ?? 'keep');
  const [doneOn, setDoneOn] = useState(first?.doneOn ?? '');
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
    <Dialog open={items.length > 0} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={tc('close')}>
        <DialogHeader>
          <DialogTitle>
            {items.length === 1
              ? t('decide.title', { account: first?.accountName ?? '' })
              : t('decide.titleMany', { count: items.length })}
          </DialogTitle>
          <DialogDescription>
            {first?.userName ?? first?.user?.displayName ?? t('decide.description')}
          </DialogDescription>
        </DialogHeader>
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">{t('fields.decision')}</legend>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {REVIEW_DECISIONS.map((d) => (
              <label
                key={d}
                htmlFor={`${name}-${d}`}
                className="flex cursor-pointer items-center gap-2 rounded-md border p-2.5 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary/5 has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50"
              >
                <input
                  id={`${name}-${d}`}
                  type="radio"
                  name={name}
                  checked={decision === d}
                  onChange={() => setDecision(d)}
                  className="size-4 accent-primary"
                />
                {t(`reviewDecision.${d}`)}
              </label>
            ))}
          </div>
        </fieldset>
        {decision !== 'keep' && (
          <div className="grid gap-1.5">
            <Label htmlFor={`${name}-done`}>{t('fields.doneOn')}</Label>
            <Input
              id={`${name}-done`}
              type="date"
              max={today}
              value={doneOn}
              onChange={(e) => setDoneOn(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">{t('decide.doneHint')}</p>
          </div>
        )}
        <div className="grid gap-1.5">
          <Label htmlFor={`${name}-note`}>{t('fields.note')}</Label>
          <Textarea id={`${name}-note`} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
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
            loading={save.isPending}
            onClick={async () => {
              setError(null);
              try {
                await save.mutateAsync({
                  decision,
                  doneOn: decision === 'keep' ? null : doneOn || null,
                  ...(items.length === 1 || note.trim() ? { note: note.trim() || null } : {}),
                });
                onOpenChange(false);
              } catch (err) {
                setError(errorText(err));
              }
            }}
          >
            {tc('save')}
          </Button>
        </DialogFooter>
      </DialogContent>
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
  const ids = { account: useId(), user: useId(), person: useId(), privilege: useId(), status: useId() };
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={tc('close')}>
        <DialogHeader>
          <DialogTitle>{t('addAccount.title')}</DialogTitle>
          <DialogDescription>{t('addAccount.description')}</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor={ids.account}>{t('fields.account')}</Label>
            <Input id={ids.account} value={accountName} onChange={(e) => setAccountName(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={ids.user}>{t('fields.userName')}</Label>
            <Input id={ids.user} value={userName} onChange={(e) => setUserName(e.target.value)} />
          </div>
          <div className="grid min-w-0 gap-1.5 sm:col-span-2">
            <Label htmlFor={ids.person}>{t('fields.person')}</Label>
            <PersonField id={ids.person} value={userId} onChange={setUserId} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={ids.privilege}>{t('fields.privilege')}</Label>
            <Select value={privilege} onValueChange={(v) => setPrivilege(v as typeof privilege)}>
              <SelectTrigger id={ids.privilege} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PRIVILEGES.map((p) => (
                  <SelectItem key={p} value={p}>
                    {t(`privilege.${p}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={ids.status}>{t('fields.accountState')}</Label>
            <Select value={accountStatus} onValueChange={(v) => setAccountStatus(v as typeof accountStatus)}>
              <SelectTrigger id={ids.status} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ACCOUNT_STATES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {t(`accountState.${s}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
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
            disabled={!accountName.trim()}
            loading={save.isPending}
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
          >
            {tc('add')}
          </Button>
        </DialogFooter>
      </DialogContent>
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
          <p>{t('import.accountsHelp')}</p>
          <p className="mt-1 text-xs">{REVIEW_COLUMNS.map((c) => t(`reviewColumns.${c}`)).join(' · ')}</p>
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
