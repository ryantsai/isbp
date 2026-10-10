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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@isbp/ui/select';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import {
  addDays,
  type CreateReviewInput,
  RECURRENCES,
  REVIEW_POLICIES,
  REVIEWER_RULES,
  type Review,
  RISKS,
  type ServerOption,
} from '../contracts';
import { INVALIDATE, useToday } from './lib';

/** New access review campaign: scope, reviewers, due date, policy for undecided items, recurrence. */
export function ReviewFormDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (r: Review) => void;
}) {
  const t = useTranslations('dbaccess.reviewForm');
  const tc = useTranslations('common');
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl" closeLabel={tc('close')}>
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>
        {open && (
          <ReviewForm
            onCancel={() => onOpenChange(false)}
            onCreated={(r) => {
              onOpenChange(false);
              onCreated(r);
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function ReviewForm({ onCancel, onCreated }: { onCancel: () => void; onCreated: (r: Review) => void }) {
  const t = useTranslations('dbaccess.reviewForm');
  const tr = useTranslations('dbaccess.risk');
  const trr = useTranslations('dbaccess.reviewerRule');
  const tp = useTranslations('dbaccess.policy');
  const trc = useTranslations('dbaccess.recurrence');
  const tc = useTranslations('common');
  const errorText = useErrorText();
  const today = useToday();
  const list = useFieldList();
  const ids = {
    name: useId(),
    due: useId(),
    start: useId(),
    risk: useId(),
    rule: useId(),
    policy: useId(),
    rec: useId(),
    servers: useId(),
  };
  const servers = useApiQuery<{ items: ServerOption[] }>('/dbaccess/lookups/servers');
  const [v, setV] = useState<CreateReviewInput>({
    name: '',
    serverIds: [],
    minRisk: 'low',
    reviewerRule: 'owner',
    startOn: today,
    dueOn: addDays(today, 14),
    policy: 'revoke',
    recurrence: 'quarterly',
  });
  const [error, setError] = useState<string | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const create = useApiMutation(
    (api, body: CreateReviewInput) => api.post<Review>('/dbaccess/reviews', body),
    {
      invalidate: INVALIDATE,
      success: (r) => t('created', { name: r.name }),
      onSuccess: onCreated,
      silent: true,
    },
  );
  const patch = (p: Partial<CreateReviewInput>) => setV((x) => ({ ...x, ...p }));
  const detailsFilled = countFilled(v.startOn !== today, v.recurrence !== 'quarterly');
  const selected = new Set(v.serverIds ?? []);
  return (
    <form
      className="grid gap-4"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (v.name.trim().length < 3) return setError(t('nameRequired'));
        if (!v.dueOn || v.dueOn <= (v.startOn ?? today)) {
          setMoreOpen(true);
          return setError(t('dueAfterStart'));
        }
        setError(null);
        create.mutate({ ...v, name: v.name.trim() }, { onError: (err) => setError(errorText(err)) });
      }}
    >
      <div className="grid gap-2">
        <Label htmlFor={ids.name}>{t('name')}</Label>
        <Input
          id={ids.name}
          value={v.name}
          maxLength={200}
          placeholder={t('namePlaceholder')}
          onChange={(e) => patch({ name: e.target.value })}
        />
      </div>
      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-medium">{t('servers')}</legend>
        <p className="text-xs text-muted-foreground">{t('serversHint')}</p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {(servers.data?.items ?? []).map((s) => (
            <div key={s.id} className="flex min-w-0 items-center gap-2">
              <Checkbox
                id={`${ids.servers}-${s.id}`}
                checked={selected.has(s.id)}
                onCheckedChange={(c) =>
                  patch({
                    serverIds: c === true ? [...selected, s.id] : [...selected].filter((x) => x !== s.id),
                  })
                }
              />
              <Label htmlFor={`${ids.servers}-${s.id}`} className="min-w-0 truncate font-normal">
                {s.displayName}
              </Label>
            </div>
          ))}
        </div>
      </fieldset>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="grid min-w-0 gap-2">
          <Label htmlFor={ids.risk}>{t('minRisk')}</Label>
          <Select
            value={v.minRisk}
            onValueChange={(x) => patch({ minRisk: x as CreateReviewInput['minRisk'] })}
          >
            <SelectTrigger id={ids.risk} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RISKS.map((r) => (
                <SelectItem key={r} value={r}>
                  {t('riskAtLeast', { risk: tr(r) })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid min-w-0 gap-2">
          <Label htmlFor={ids.rule}>{t('reviewers')}</Label>
          <Select
            value={v.reviewerRule}
            onValueChange={(x) => patch({ reviewerRule: x as CreateReviewInput['reviewerRule'] })}
          >
            <SelectTrigger id={ids.rule} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {REVIEWER_RULES.map((r) => (
                <SelectItem key={r} value={r}>
                  {trr(r)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid min-w-0 gap-2">
          <Label htmlFor={ids.due}>{t('dueOn')}</Label>
          <Input
            id={ids.due}
            type="date"
            min={addDays(today, 1)}
            value={v.dueOn}
            onChange={(e) => patch({ dueOn: e.target.value })}
          />
        </div>
        <div className="grid min-w-0 gap-2">
          <Label htmlFor={ids.policy}>{t('policy')}</Label>
          <Select value={v.policy} onValueChange={(x) => patch({ policy: x as CreateReviewInput['policy'] })}>
            <SelectTrigger id={ids.policy} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {REVIEW_POLICIES.map((p) => (
                <SelectItem key={p} value={p}>
                  {tp(p)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <OptionalFields
        hint={list([t('startOn'), t('recurrence')])}
        filled={detailsFilled}
        open={moreOpen}
        onOpenChange={setMoreOpen}
        contentClassName="grid gap-4 pt-3 sm:grid-cols-2"
      >
        <div className="grid min-w-0 gap-2">
          <Label htmlFor={ids.start}>{t('startOn')}</Label>
          <Input
            id={ids.start}
            type="date"
            min={today}
            value={v.startOn ?? ''}
            onChange={(e) => patch({ startOn: e.target.value || null })}
          />
        </div>
        <div className="grid min-w-0 gap-2">
          <Label htmlFor={ids.rec}>{t('recurrence')}</Label>
          <Select
            value={v.recurrence}
            onValueChange={(x) => patch({ recurrence: x as CreateReviewInput['recurrence'] })}
          >
            <SelectTrigger id={ids.rec} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RECURRENCES.map((r) => (
                <SelectItem key={r} value={r}>
                  {trc(r)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </OptionalFields>
      {error && (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          {tc('cancel')}
        </Button>
        <Button type="submit" loading={create.isPending}>
          {t('create')}
        </Button>
      </DialogFooter>
    </form>
  );
}
