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
import { useApiMutation } from '@isbp/ui/query';
import { Textarea } from '@isbp/ui/textarea';
import { BugIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import type { CreateTicketInput, TicketDetail } from '../../contracts';
import {
  CategorySelect,
  CiPicker,
  GroupSelect,
  TicketPicker,
  type TicketOption,
} from '../components/pickers';
import { INVALIDATE } from '../lib';
import type { CmdbCiOption } from '../types';

/** The incident a problem starts from: its title, description, category and CIs prefill the problem. */
type Source = Pick<
  TicketDetail,
  'id' | 'type' | 'reference' | 'title' | 'description' | 'status' | 'category' | 'cis'
>;

const initial = (from?: Source | null) => ({
  title: from?.title ?? '',
  description: from?.description ?? '',
  categoryId: null as string | null,
  groupId: null as string | null,
  cis: (from?.cis ?? []).map((c): CmdbCiOption => ({
    id: c.id,
    number: c.number,
    reference: c.reference,
    name: c.name,
  })),
  incidents: from
    ? [{ id: from.id, type: from.type, reference: from.reference, title: from.title, status: from.status }]
    : ([] as TicketOption[]),
});

/**
 * "Create problem": record a root-cause investigation, with the incidents it explains linked from the start (picked
 * by number or title). From an incident, everything is prefilled and the incident is already linked.
 */
export function NewProblemDialog({
  open,
  onOpenChange,
  from,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  from?: Source | null;
  onCreated?: (reference: string) => void;
}) {
  const t = useTranslations('itsm.newProblem');
  const tc = useTranslations('common');
  const id = useId();
  const [values, setValues] = useState(() => initial(from));
  const [touched, setTouched] = useState(false);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setValues(initial(from));
      setTouched(false);
    }
  }
  const create = useApiMutation(
    (api, body: CreateTicketInput) => api.post<TicketDetail>('/itsm/tickets', body),
    {
      invalidate: INVALIDATE,
      success: (r) => t('created', { reference: r.reference }),
      onSuccess: (r) => {
        onOpenChange(false);
        onCreated?.(r.reference);
      },
    },
  );
  const invalid = values.title.trim().length < 3;
  const set = (patch: Partial<typeof values>) => setValues((v) => ({ ...v, ...patch }));
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl" closeLabel={tc('close')}>
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
            if (invalid) return;
            create.mutate({
              type: 'problem',
              title: values.title.trim(),
              description: values.description.trim(),
              categoryId: values.categoryId,
              assignmentGroupId: values.groupId,
              ciIds: values.cis.map((c) => c.id),
              ticketLinks: values.incidents.map((i) => ({
                target: i.reference,
                type: 'caused_by',
                direction: 'incoming',
              })),
            });
          }}
        >
          <div className="grid gap-2">
            <Label htmlFor={`${id}-title`}>{t('titleLabel')}</Label>
            <Input
              id={`${id}-title`}
              value={values.title}
              maxLength={200}
              onChange={(e) => set({ title: e.target.value })}
              aria-invalid={touched && invalid ? true : undefined}
              aria-describedby={touched && invalid ? `${id}-title-error` : undefined}
            />
            {touched && invalid && (
              <p id={`${id}-title-error`} className="text-sm text-destructive">
                {t('titleRequired')}
              </p>
            )}
          </div>
          <div className="grid gap-2">
            <Label htmlFor={`${id}-incidents`}>{t('incidents')}</Label>
            <TicketPicker
              id={`${id}-incidents`}
              value={values.incidents}
              onChange={(incidents) => set({ incidents })}
              types={['incident', 'service_request']}
              aria-describedby={`${id}-incidents-hint`}
            />
            <p id={`${id}-incidents-hint`} className="text-xs text-muted-foreground">
              {t('incidentsHint')}
            </p>
          </div>
          <div className="grid gap-2">
            <Label htmlFor={`${id}-description`}>{t('details')}</Label>
            <Textarea
              id={`${id}-description`}
              rows={4}
              value={values.description}
              onChange={(e) => set({ description: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="grid min-w-0 gap-2">
              <Label htmlFor={`${id}-category`}>{t('category')}</Label>
              <CategorySelect
                id={`${id}-category`}
                type="problem"
                value={values.categoryId}
                onChange={(categoryId) => set({ categoryId })}
                noneLabel={t('noCategory')}
              />
            </div>
            <div className="grid min-w-0 gap-2">
              <Label htmlFor={`${id}-group`}>{t('group')}</Label>
              <GroupSelect
                id={`${id}-group`}
                value={values.groupId}
                onChange={(groupId) => set({ groupId })}
                noneLabel={t('defaultGroup')}
              />
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor={`${id}-cis`}>{t('cis')}</Label>
            <CiPicker id={`${id}-cis`} value={values.cis} onChange={(cis) => set({ cis })} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {tc('cancel')}
            </Button>
            <Button type="submit" loading={create.isPending}>
              <BugIcon aria-hidden />
              {t('submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
