'use client';
import { Button } from '@astryxdesign/core/Button';
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import { FormLayout } from '@astryxdesign/core/FormLayout';
import { Grid } from '@astryxdesign/core/Grid';
import { Icon } from '@astryxdesign/core/Icon';
import { HStack, Layout, LayoutContent, LayoutFooter } from '@astryxdesign/core/Layout';
import { TextArea } from '@astryxdesign/core/TextArea';
import { TextInput } from '@astryxdesign/core/TextInput';
import { useApiMutation } from '@isbp/ui/query';
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
  const formId = useId();
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
    <Dialog isOpen={open} onOpenChange={onOpenChange} width={576} purpose="form">
      <Layout
        header={<DialogHeader title={t('title')} subtitle={t('description')} onOpenChange={onOpenChange} />}
        content={
          <LayoutContent padding={4}>
            <form
              id={formId}
              noValidate
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
              <FormLayout defaultOptionality="optional">
                <TextInput
                  label={t('titleLabel')}
                  isRequired
                  value={values.title}
                  onChange={(title) => set({ title: title.slice(0, 200) })}
                  status={touched && invalid ? { type: 'error', message: t('titleRequired') } : undefined}
                />
                <TicketPicker
                  label={t('incidents')}
                  description={t('incidentsHint')}
                  value={values.incidents}
                  onChange={(incidents) => set({ incidents })}
                  types={['incident', 'service_request']}
                />
                <TextArea
                  label={t('details')}
                  rows={4}
                  value={values.description}
                  onChange={(description) => set({ description })}
                />
                <Grid columns={{ minWidth: 220 }} gap={4}>
                  <CategorySelect
                    label={t('category')}
                    width="100%"
                    type="problem"
                    value={values.categoryId}
                    onChange={(categoryId) => set({ categoryId })}
                    noneLabel={t('noCategory')}
                  />
                  <GroupSelect
                    label={t('group')}
                    width="100%"
                    value={values.groupId}
                    onChange={(groupId) => set({ groupId })}
                    noneLabel={t('defaultGroup')}
                  />
                </Grid>
                <CiPicker label={t('cis')} value={values.cis} onChange={(cis) => set({ cis })} />
              </FormLayout>
            </form>
          </LayoutContent>
        }
        footer={
          <LayoutFooter hasDivider padding={3}>
            <HStack gap={2} hAlign="end">
              <Button label={tc('cancel')} variant="ghost" onClick={() => onOpenChange(false)} />
              <Button
                label={t('submit')}
                variant="primary"
                icon={<Icon icon={BugIcon} />}
                type="submit"
                form={formId}
                isLoading={create.isPending}
              />
            </HStack>
          </LayoutFooter>
        }
      />
    </Dialog>
  );
}
