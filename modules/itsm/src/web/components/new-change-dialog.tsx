'use client';

import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Field } from '@astryxdesign/core/Field';
import { FormLayout } from '@astryxdesign/core/FormLayout';
import { Icon } from '@astryxdesign/core/Icon';
import { VStack } from '@astryxdesign/core/Layout';
import { Heading } from '@astryxdesign/core/Text';
import { TextArea } from '@astryxdesign/core/TextArea';
import { TextInput } from '@astryxdesign/core/TextInput';
import { useCan, usePlatform } from '@isbp/sdk/web';
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
import { toast } from '@isbp/ui/toast';
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
  type ChangePlanPart,
  type ChangePlanValues,
  ConflictCheck,
  emptyPlan,
  windowInvalid,
} from './change-plan';
import { LinkedRecordChip } from './linked-record-chip';
import { CiPicker } from './pickers';

// Constant, so the memoized plan fields skip re-rendering while the title or description is typed.
const WHAT_PARTS: readonly ChangePlanPart[] = ['window', 'classification'];
const PLAN_PARTS: readonly ChangePlanPart[] = ['reason', 'plans'];

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
            <section aria-labelledby={`${id}-what`}>
              <VStack gap={4}>
                <Heading level={4} accessibilityLevel={3} id={`${id}-what`}>
                  {t('whatAndWhen')}
                </Heading>
                <FormLayout defaultOptionality="optional">
                  <TextInput
                    label={t('titleLabel')}
                    isRequired
                    value={title}
                    onChange={(v) => setTitle(v.slice(0, 200))}
                    placeholder={t('titlePlaceholder')}
                    status={
                      touched && titleInvalid ? { type: 'error', message: t('titleTooShort') } : undefined
                    }
                  />
                  {canPickCis && (
                    <CiPicker label={t('cis')} description={t('cisHint')} value={cis} onChange={setCis} />
                  )}
                  <ChangePlanFields
                    value={plan}
                    onChange={setPlan}
                    showErrors={Boolean(touched)}
                    windowRequired={touched === 'submit'}
                    parts={WHAT_PARTS}
                  />
                </FormLayout>
                {touched === 'submit' && submitBlocked === 'past' && (
                  <Banner status="error" title={t('windowPast')} collapsible={false} />
                )}
                <ConflictCheck
                  plannedStart={plan.plannedStart}
                  plannedEnd={plan.plannedEnd}
                  ciIds={cis.map((c) => c.id)}
                />
                <Field label={t('requester')} inputID={`${id}-requester`} description={t('requesterHint')}>
                  <PersonPicker
                    id={`${id}-requester`}
                    value={requester}
                    clearable={false}
                    onChange={(p) => p && setRequester(p)}
                  />
                </Field>
              </VStack>
            </section>
            <OptionalFields label={t('plans')} hint={t('plansHint')} filled={plansFilled}>
              <VStack gap={4}>
                <TextArea
                  label={t('descriptionLabel')}
                  isOptional
                  rows={3}
                  value={description}
                  onChange={setDescription}
                />
                <ChangePlanFields value={plan} onChange={setPlan} parts={PLAN_PARTS} />
              </VStack>
            </OptionalFields>
          </SheetBody>
          <SheetFooter>
            <Button
              label={tc('cancel')}
              variant="secondary"
              type="button"
              onClick={() => onOpenChange(false)}
            />
            <Button
              label={t('saveDraft')}
              variant="secondary"
              isLoading={pending === 'draft'}
              isDisabled={create.isPending}
              type="button"
              onClick={() => save('draft')}
            />
            <Button
              label={t('createAndSubmit')}
              variant="primary"
              icon={<Icon icon={GavelIcon} />}
              isLoading={pending === 'submit'}
              isDisabled={create.isPending}
              type="submit"
            />
          </SheetFooter>
        </SheetForm>
      </SheetContent>
    </Sheet>
  );
}
