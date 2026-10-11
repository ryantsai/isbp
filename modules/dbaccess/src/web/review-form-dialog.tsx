'use client';

import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { CheckboxList, CheckboxListItem } from '@astryxdesign/core/CheckboxList';
import { DateInput } from '@astryxdesign/core/DateInput';
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import { FormLayout } from '@astryxdesign/core/FormLayout';
import { Grid } from '@astryxdesign/core/Grid';
import { HStack, Layout, LayoutContent, LayoutFooter } from '@astryxdesign/core/Layout';
import { Selector } from '@astryxdesign/core/Selector';
import { TextInput } from '@astryxdesign/core/TextInput';
import { countFilled, OptionalFields, useFieldList } from '@isbp/ui/optional-fields';
import { useApiMutation, useApiQuery, useErrorText } from '@isbp/ui/query';
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
import { asDay, INVALIDATE, useToday } from './lib';

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
  return (
    <Dialog isOpen={open} onOpenChange={onOpenChange} width={576} purpose="form" aria-label={t('title')}>
      {open && (
        <ReviewForm
          onOpenChange={onOpenChange}
          onCreated={(r) => {
            onOpenChange(false);
            onCreated(r);
          }}
        />
      )}
    </Dialog>
  );
}

function ReviewForm({
  onOpenChange,
  onCreated,
}: {
  onOpenChange: (open: boolean) => void;
  onCreated: (r: Review) => void;
}) {
  const t = useTranslations('dbaccess.reviewForm');
  const tr = useTranslations('dbaccess.risk');
  const trr = useTranslations('dbaccess.reviewerRule');
  const tp = useTranslations('dbaccess.policy');
  const trc = useTranslations('dbaccess.recurrence');
  const tc = useTranslations('common');
  const errorText = useErrorText();
  const today = useToday();
  const list = useFieldList();
  const formId = useId();
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
  return (
    <Layout
      header={<DialogHeader title={t('title')} subtitle={t('description')} onOpenChange={onOpenChange} />}
      content={
        <LayoutContent padding={4}>
          <form
            id={formId}
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
            <FormLayout defaultOptionality="optional">
              <TextInput
                label={t('name')}
                isRequired
                value={v.name}
                placeholder={t('namePlaceholder')}
                onChange={(name) => patch({ name: name.slice(0, 200) })}
              />
              <CheckboxList
                label={t('servers')}
                description={t('serversHint')}
                value={v.serverIds ?? []}
                onChange={(serverIds) => patch({ serverIds })}
              >
                {(servers.data?.items ?? []).map((s) => (
                  <CheckboxListItem key={s.id} value={s.id} label={s.displayName} />
                ))}
              </CheckboxList>
              <Grid columns={{ minWidth: 240 }} gap={4}>
                <Selector
                  label={t('minRisk')}
                  value={v.minRisk}
                  onChange={(x) => patch({ minRisk: x as CreateReviewInput['minRisk'] })}
                  options={RISKS.map((r) => ({ value: r, label: t('riskAtLeast', { risk: tr(r) }) }))}
                />
                <Selector
                  label={t('reviewers')}
                  value={v.reviewerRule}
                  onChange={(x) => patch({ reviewerRule: x as CreateReviewInput['reviewerRule'] })}
                  options={REVIEWER_RULES.map((r) => ({ value: r, label: trr(r) }))}
                />
                <DateInput
                  label={t('dueOn')}
                  isRequired
                  min={asDay(addDays(today, 1))}
                  value={asDay(v.dueOn)}
                  onChange={(d) => patch({ dueOn: d ?? '' })}
                />
                <Selector
                  label={t('policy')}
                  value={v.policy}
                  onChange={(x) => patch({ policy: x as CreateReviewInput['policy'] })}
                  options={REVIEW_POLICIES.map((p) => ({ value: p, label: tp(p) }))}
                />
              </Grid>
              <OptionalFields
                hint={list([t('startOn'), t('recurrence')])}
                filled={detailsFilled}
                open={moreOpen}
                onOpenChange={setMoreOpen}
              >
                <Grid columns={{ minWidth: 240 }} gap={4}>
                  <DateInput
                    label={t('startOn')}
                    hasClear
                    min={asDay(today)}
                    value={asDay(v.startOn)}
                    onChange={(d) => patch({ startOn: d || null })}
                  />
                  <Selector
                    label={t('recurrence')}
                    value={v.recurrence}
                    onChange={(x) => patch({ recurrence: x as CreateReviewInput['recurrence'] })}
                    options={RECURRENCES.map((r) => ({ value: r, label: trc(r) }))}
                  />
                </Grid>
              </OptionalFields>
              {error && <Banner status="error" title={error} collapsible={false} />}
            </FormLayout>
          </form>
        </LayoutContent>
      }
      footer={
        <LayoutFooter hasDivider padding={3}>
          <HStack gap={2} hAlign="end">
            <Button label={tc('cancel')} variant="ghost" type="button" onClick={() => onOpenChange(false)} />
            <Button
              label={t('create')}
              variant="primary"
              isLoading={create.isPending}
              type="submit"
              form={formId}
            />
          </HStack>
        </LayoutFooter>
      }
    />
  );
}
