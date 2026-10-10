'use client';

import { useCan, usePlatform } from '@isbp/sdk/web';
import { Button } from '@isbp/ui/button';
import { Input } from '@isbp/ui/input';
import { Label } from '@isbp/ui/label';
import { countFilled, OptionalFields } from '@isbp/ui/optional-fields';
import { type PersonOption, PersonPicker } from '@isbp/ui/person-picker';
import { useApiMutation, useErrorText } from '@isbp/ui/query';
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
import { toast } from '@isbp/ui/sonner';
import { Textarea } from '@isbp/ui/textarea';
import { GavelIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useState } from 'react';
import type { CreateTicketInput, TicketDetail } from '../../contracts';
import { fromLocalInput, INVALIDATE, ticketHref, toLocalInput } from '../lib';
import { windowProblem } from '../logic';
import { useTransitionError } from '../ticket/actions';
import type { CmdbCiOption } from '../types';
import {
  ChangePlanFields,
  type ChangePlanValues,
  ConflictCheck,
  emptyPlan,
  windowInvalid,
} from './change-plan';
import { LinkedRecordChip } from './linked-record-chip';
import { CiPicker } from './pickers';

/** Opened from another module, e.g. ALM's "Raise a change" (`?new=1&title=…&link=…&start=…&end=…`). */
export interface NewChangePrefill {
  title: string;
  link: { type: string; id: string } | null;
  /** ISO times of the planned window, when the caller knows it (a release date). */
  start?: string | null;
  end?: string | null;
}

/**
 * Raise a change in a sheet: what and when first (title, CIs, window, type and risk, who requests it), the plans
 * folded below. "Create and submit for approval" does both in one go; "Save draft" keeps it for later.
 */
export function NewChangeDialog({
  open,
  onOpenChange,
  prefill,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  prefill?: NewChangePrefill | null;
}) {
  const t = useTranslations('itsm.newChange');
  const tc = useTranslations('common');
  const router = useRouter();
  const errorText = useErrorText();
  const onTransitionError = useTransitionError();
  const id = useId();
  const { user, enabledModules } = usePlatform();
  const canPickCis = useCan('cmdb.cis.read') && enabledModules.includes('cmdb');
  const me: PersonOption = { id: user.id, displayName: user.displayName, avatarUrl: user.avatarUrl ?? null };
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [cis, setCis] = useState<CmdbCiOption[]>([]);
  const [plan, setPlan] = useState<ChangePlanValues>(emptyPlan);
  const [requester, setRequester] = useState<PersonOption | null>(me);
  const [touched, setTouched] = useState<'draft' | 'submit' | null>(null);
  const [link, setLink] = useState<{ type: string; id: string } | null>(null);
  const prefillTitle = prefill?.title ?? '';
  const prefillLink = prefill?.link ?? null;
  const prefillStart = prefill?.start ?? null;
  const prefillEnd = prefill?.end ?? null;
  useEffect(() => {
    if (!open) return;
    setTitle(prefillTitle);
    setLink(prefillLink);
    setDescription('');
    setCis([]);
    setPlan({ ...emptyPlan, plannedStart: toLocalInput(prefillStart), plannedEnd: toLocalInput(prefillEnd) });
    setRequester(me);
    setTouched(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only when the sheet opens
  }, [open]);
  const titleInvalid = title.trim().length < 3;
  const plannedStart = fromLocalInput(plan.plannedStart);
  const plannedEnd = fromLocalInput(plan.plannedEnd);
  const submitBlocked = windowProblem({ changeType: plan.changeType, plannedStart, plannedEnd }, new Date());
  const dirty = Boolean(title.trim() || description.trim() || cis.length);
  const plansFilled = countFilled(
    description,
    plan.reason,
    plan.implementationPlan,
    plan.backoutPlan,
    plan.testPlan,
  );

  const create = useApiMutation(
    async (a, { body, mode }: { body: CreateTicketInput; mode: 'draft' | 'submit' }) => {
      const created = await a.post<TicketDetail>('/itsm/tickets', body);
      let submitError: unknown = null;
      if (mode === 'submit')
        try {
          await a.post(`/itsm/tickets/${encodeURIComponent(created.reference)}/transition`, {
            status: 'authorization',
          });
        } catch (err) {
          submitError = err;
        }
      return { created, submitError, mode };
    },
    {
      invalidate: INVALIDATE,
      silent: true,
      onSuccess: ({ created, submitError, mode }) => {
        // Created as a draft when submitting failed: the change page offers the way forward.
        if (submitError) onTransitionError(submitError);
        else
          toast.success(
            t(mode === 'submit' ? 'createdAndSubmitted' : 'created', { reference: created.reference }),
          );
        onOpenChange(false);
        router.push(ticketHref(created.reference));
      },
    },
  );
  const pending = create.isPending ? create.variables?.mode : null;

  const save = (mode: 'draft' | 'submit') => {
    setTouched(mode);
    if (titleInvalid || windowInvalid(plan) || (mode === 'submit' && submitBlocked)) return;
    const body: CreateTicketInput = {
      type: 'change',
      channel: 'agent',
      title: title.trim(),
      description: description.trim(),
      ciIds: cis.map((c) => c.id),
      links: link ? [link] : [],
      ...(requester && requester.id !== user.id ? { requesterId: requester.id } : {}),
      change: { ...plan, reason: plan.reason.trim(), plannedStart, plannedEnd },
    };
    create.mutate({ body, mode }, { onError: (err) => toast.error(errorText(err)) });
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-xl" closeLabel={tc('close')} dirty={dirty}>
        <SheetHeader>
          <SheetTitle>{t('title')}</SheetTitle>
          <SheetDescription>{t('description')}</SheetDescription>
        </SheetHeader>
        <SheetForm
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            save('submit');
          }}
        >
          <SheetBody className="grid content-start gap-5 pb-6">
            {link && <LinkedRecordChip record={link} onRemove={() => setLink(null)} />}
            <section className="grid gap-4" aria-labelledby={`${id}-what`}>
              <h3 id={`${id}-what`} className="text-sm font-semibold">
                {t('whatAndWhen')}
              </h3>
              <div className="grid gap-2">
                <Label htmlFor={`${id}-title`}>{t('titleLabel')}</Label>
                <Input
                  id={`${id}-title`}
                  value={title}
                  maxLength={200}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={t('titlePlaceholder')}
                  aria-invalid={touched && titleInvalid ? true : undefined}
                  aria-describedby={touched && titleInvalid ? `${id}-title-error` : undefined}
                />
                {touched && titleInvalid && (
                  <p id={`${id}-title-error`} className="text-sm text-destructive">
                    {t('titleTooShort')}
                  </p>
                )}
              </div>
              {canPickCis && (
                <div className="grid gap-2">
                  <Label htmlFor={`${id}-cis`}>{t('cis')}</Label>
                  <CiPicker
                    id={`${id}-cis`}
                    value={cis}
                    onChange={setCis}
                    aria-describedby={`${id}-cis-hint`}
                  />
                  <p id={`${id}-cis-hint`} className="text-xs text-muted-foreground">
                    {t('cisHint')}
                  </p>
                </div>
              )}
              <ChangePlanFields
                value={plan}
                onChange={setPlan}
                showErrors={Boolean(touched)}
                windowRequired={touched === 'submit'}
                parts={['window', 'classification']}
              />
              {touched === 'submit' && submitBlocked === 'past' && (
                <p role="alert" className="text-sm text-destructive">
                  {t('windowPast')}
                </p>
              )}
              <ConflictCheck
                plannedStart={plan.plannedStart}
                plannedEnd={plan.plannedEnd}
                ciIds={cis.map((c) => c.id)}
              />
              <div className="grid gap-2">
                <Label htmlFor={`${id}-requester`}>{t('requester')}</Label>
                <PersonPicker
                  id={`${id}-requester`}
                  value={requester}
                  clearable={false}
                  onChange={(p) => p && setRequester(p)}
                  aria-describedby={`${id}-requester-hint`}
                />
                <p id={`${id}-requester-hint`} className="text-xs text-muted-foreground">
                  {t('requesterHint')}
                </p>
              </div>
            </section>
            <OptionalFields label={t('plans')} hint={t('plansHint')} filled={plansFilled}>
              <div className="grid gap-2">
                <Label htmlFor={`${id}-description`}>{t('descriptionLabel')}</Label>
                <Textarea
                  id={`${id}-description`}
                  rows={3}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>
              <ChangePlanFields value={plan} onChange={setPlan} parts={['reason', 'plans']} />
            </OptionalFields>
          </SheetBody>
          <SheetFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {tc('cancel')}
            </Button>
            <Button
              type="button"
              variant="outline"
              loading={pending === 'draft'}
              disabled={create.isPending}
              onClick={() => save('draft')}
            >
              {t('saveDraft')}
            </Button>
            <Button type="submit" loading={pending === 'submit'} disabled={create.isPending}>
              <GavelIcon aria-hidden />
              {t('createAndSubmit')}
            </Button>
          </SheetFooter>
        </SheetForm>
      </SheetContent>
    </Sheet>
  );
}
