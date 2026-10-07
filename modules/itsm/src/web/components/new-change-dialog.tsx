'use client';

import { useCan, usePlatform } from '@isbp/sdk/web';
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
import { useApiMutation } from '@isbp/ui/query';
import { Textarea } from '@isbp/ui/textarea';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useState } from 'react';
import type { CreateTicketInput, TicketDetail } from '../../contracts';
import { fromLocalInput, INVALIDATE, ticketHref } from '../lib';
import type { CmdbCiOption } from '../types';
import {
  ChangePlanFields,
  type ChangePlanValues,
  ConflictCheck,
  emptyPlan,
  windowInvalid,
} from './change-plan';
import { CiPicker } from './pickers';

/** Raise a change: what, why, when, which CIs and the plans — with a live conflict check. */
export function NewChangeDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const t = useTranslations('itsm.newChange');
  const tc = useTranslations('common');
  const router = useRouter();
  const id = useId();
  const { enabledModules } = usePlatform();
  const canPickCis = useCan('cmdb.cis.read') && enabledModules.includes('cmdb');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [cis, setCis] = useState<CmdbCiOption[]>([]);
  const [plan, setPlan] = useState<ChangePlanValues>(emptyPlan);
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (!open) return;
    setTitle('');
    setDescription('');
    setCis([]);
    setPlan(emptyPlan);
    setTouched(false);
  }, [open]);
  const create = useApiMutation(
    (api, body: CreateTicketInput) => api.post<TicketDetail>('/itsm/tickets', body),
    {
      invalidate: INVALIDATE,
      success: (r) => t('created', { reference: r.reference }),
      onSuccess: (r) => {
        onOpenChange(false);
        router.push(ticketHref(r.reference));
      },
    },
  );
  const titleInvalid = title.trim().length < 3;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl" closeLabel={tc('close')}>
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>
        <form
          noValidate
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            setTouched(true);
            if (titleInvalid || windowInvalid(plan)) return;
            create.mutate({
              type: 'change',
              channel: 'agent',
              title: title.trim(),
              description: description.trim(),
              ciIds: cis.map((c) => c.id),
              change: {
                ...plan,
                reason: plan.reason.trim(),
                plannedStart: fromLocalInput(plan.plannedStart),
                plannedEnd: fromLocalInput(plan.plannedEnd),
              },
            });
          }}
        >
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
          <div className="grid gap-2">
            <Label htmlFor={`${id}-description`}>{t('descriptionLabel')}</Label>
            <Textarea
              id={`${id}-description`}
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          {canPickCis && (
            <div className="grid gap-2">
              <Label htmlFor={`${id}-cis`}>{t('cis')}</Label>
              <CiPicker id={`${id}-cis`} value={cis} onChange={setCis} aria-describedby={`${id}-cis-hint`} />
              <p id={`${id}-cis-hint`} className="text-xs text-muted-foreground">
                {t('cisHint')}
              </p>
            </div>
          )}
          <ChangePlanFields value={plan} onChange={setPlan} showErrors={touched} />
          <ConflictCheck
            plannedStart={plan.plannedStart}
            plannedEnd={plan.plannedEnd}
            ciIds={cis.map((c) => c.id)}
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {tc('cancel')}
            </Button>
            <Button type="submit" loading={create.isPending}>
              {t('submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
