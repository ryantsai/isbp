'use client';

import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import { FormLayout } from '@astryxdesign/core/FormLayout';
import { Icon } from '@astryxdesign/core/Icon';
import { HStack, Layout, LayoutContent, LayoutFooter, VStack } from '@astryxdesign/core/Layout';
import { Field } from '@astryxdesign/core/Field';
import { Text } from '@astryxdesign/core/Text';
import { TextArea } from '@astryxdesign/core/TextArea';
import { type ApprovalStep, defaultFieldValues, type LocalizedText, stepDecisionFields } from '@isbp/sdk';
import { ApiError } from '@isbp/sdk/web';
import { Form } from '@isbp/ui/form';
import { FormFields, useFieldErrorText, useFieldsResolver } from '@isbp/ui/form-renderer';
import { type PersonOption, PersonPicker } from '@isbp/ui/person-picker';
import { CheckIcon, ClipboardListIcon, ForwardIcon, XIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useMemo, useState } from 'react';
import { type FieldValues, useForm } from 'react-hook-form';
import { useApiMutation, useErrorText } from '@/lib/api';

const INVALIDATE = [
  '/me/approvals',
  '/me/badges',
  '/workflow-instances',
  '/me/requests',
  '/requests',
  '/access-requests',
];

export type Decision = 'approve' | 'reject';

/** What a step asks its approver to fill in (`ApprovalStep.fields`). */
export type StepFieldsInfo = Pick<ApprovalStep, 'fields' | 'fieldsRequiredOn'>;

/**
 * Approve (comment optional) or reject (comment required — the requester sees it). When the step has fields, the
 * approver fills them in here: validated as the API does (`validateStepFields`), so the decision is only sent once
 * the required ones are valid — required to approve, and to reject too when the step says so.
 */
export function DecisionDialog({
  taskId,
  decision,
  subject,
  step,
  open,
  onOpenChange,
  onDone,
}: {
  taskId: string;
  decision: Decision;
  subject: string;
  step?: StepFieldsInfo;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone?: () => void;
}) {
  const t = useTranslations('approvals.decide');
  const errorText = useErrorText();
  const fieldError = useFieldErrorText();
  const id = useId();
  const [comment, setComment] = useState('');
  const [touched, setTouched] = useState(false);
  const [rootError, setRootError] = useState<string | null>(null);
  const fields = useMemo(() => stepDecisionFields(step ?? {}, decision), [step, decision]);
  const elements = useMemo(() => fields.map((f) => ({ ...f, id: `step-field-${f.key}` })), [fields]);
  const resolver = useFieldsResolver(fields);
  const form = useForm<FieldValues>({ resolver, defaultValues: defaultFieldValues(fields) });
  const optional = decision === 'reject' && step?.fieldsRequiredOn !== 'both';
  const mutation = useApiMutation(
    (api, vars: { comment: string; data?: Record<string, unknown> }) =>
      api.post(`/approvals/${taskId}/${decision}`, { comment: vars.comment || null, data: vars.data }),
    {
      invalidate: INVALIDATE,
      silent: true,
      success: t(decision === 'approve' ? 'approvedNamed' : 'rejectedNamed', { subject }),
      onSuccess: () => {
        onOpenChange(false);
        setComment('');
        form.reset(defaultFieldValues(fields));
        onDone?.();
      },
    },
  );
  const onError = (err: unknown) => {
    if (err instanceof ApiError && err.code === 'VALIDATION_FAILED') {
      const issues =
        (
          err.details as {
            issues?: { path: string; code?: string; params?: Record<string, number>; text?: LocalizedText }[];
          }
        )?.issues ?? [];
      const own = issues.filter((i) => i.path.startsWith('data.'));
      for (const i of own)
        form.setError(i.path.slice('data.'.length), {
          message: i.code ? fieldError({ code: i.code as never, params: i.params, message: i.text }) : i.path,
        });
      if (own.length) return;
    }
    setRootError(errorText(err));
  };
  const missing = decision === 'reject' && !comment.trim();
  const formId = `${id}-form`;
  return (
    <Dialog isOpen={open} onOpenChange={onOpenChange} width={fields.length > 0 ? 672 : 512} purpose="form">
      <Layout
        header={
          <DialogHeader
            title={t(decision === 'approve' ? 'approveTitle' : 'rejectTitle')}
            subtitle={subject}
            onOpenChange={onOpenChange}
          />
        }
        content={
          <LayoutContent padding={4}>
            <form
              id={formId}
              noValidate
              onSubmit={(e) => {
                setTouched(true);
                setRootError(null);
                void form.handleSubmit((values) => {
                  if (missing) return;
                  mutation.mutate(
                    { comment: comment.trim(), data: fields.length ? values : undefined },
                    { onError },
                  );
                })(e);
              }}
            >
              <VStack gap={4}>
                {fields.length > 0 && (
                  <section aria-labelledby={`${id}-fields`}>
                    <VStack gap={3}>
                      <VStack gap={0.5}>
                        <HStack gap={2} vAlign="center">
                          <Icon icon={ClipboardListIcon} color="secondary" />
                          <Text type="label" as="div" role="heading" aria-level={3} id={`${id}-fields`}>
                            {t('fieldsTitle')}
                          </Text>
                        </HStack>
                        <Text type="supporting">{optional ? t('fieldsOptionalHint') : t('fieldsHint')}</Text>
                      </VStack>
                      <Form {...form}>
                        <FormFields elements={elements} form={form} />
                      </Form>
                    </VStack>
                  </section>
                )}
                <TextArea
                  label={t(decision === 'approve' ? 'commentOptional' : 'commentRequired')}
                  hasAutoFocus={!fields.length}
                  rows={4}
                  value={comment}
                  onChange={(v) => setComment(v.slice(0, 2000))}
                  description={t('visibleToRequester')}
                  status={touched && missing ? { type: 'error', message: t('reasonNeeded') } : undefined}
                  placeholder={t(decision === 'approve' ? 'approvePlaceholder' : 'rejectPlaceholder')}
                />
                {rootError && <Banner status="error" title={rootError} collapsible={false} />}
              </VStack>
            </form>
          </LayoutContent>
        }
        footer={
          <LayoutFooter hasDivider padding={3}>
            <HStack gap={2} hAlign="end">
              <Button label={t('cancel')} variant="ghost" type="button" onClick={() => onOpenChange(false)} />
              <Button
                label={t(decision === 'approve' ? 'approve' : 'reject')}
                variant={decision === 'approve' ? 'primary' : 'destructive'}
                icon={<Icon icon={decision === 'approve' ? CheckIcon : XIcon} />}
                isLoading={mutation.isPending}
                type="submit"
                form={formId}
              />
            </HStack>
          </LayoutFooter>
        }
      />
    </Dialog>
  );
}

/** Hand the task to a colleague (they get it in their inbox with your note). */
export function DelegateDialog({
  taskId,
  subject,
  excludeIds,
  open,
  onOpenChange,
  onDone,
}: {
  taskId: string;
  subject: string;
  excludeIds: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone?: () => void;
}) {
  const t = useTranslations('approvals.delegate');
  const id = useId();
  const [person, setPerson] = useState<PersonOption | null>(null);
  const [comment, setComment] = useState('');
  const mutation = useApiMutation(
    (api, vars: { userId: string; comment: string }) =>
      api.post(`/approvals/${taskId}/delegate`, { userId: vars.userId, comment: vars.comment || null }),
    {
      invalidate: INVALIDATE,
      success: t('toast'),
      onSuccess: () => {
        onOpenChange(false);
        setPerson(null);
        setComment('');
        onDone?.();
      },
    },
  );
  const formId = `${id}-form`;
  return (
    <Dialog isOpen={open} onOpenChange={onOpenChange} width={448} purpose="form">
      <Layout
        header={<DialogHeader title={t('title')} subtitle={subject} onOpenChange={onOpenChange} />}
        content={
          <LayoutContent padding={4}>
            <form
              id={formId}
              onSubmit={(e) => {
                e.preventDefault();
                if (person) mutation.mutate({ userId: person.id, comment: comment.trim() });
              }}
            >
              <FormLayout defaultOptionality="optional">
                <Field label={t('person')} inputID={`${id}-person`} description={t('hint')} isRequired>
                  <PersonPicker
                    id={`${id}-person`}
                    value={person}
                    onChange={setPerson}
                    excludeIds={excludeIds}
                  />
                </Field>
                <TextArea
                  label={t('note')}
                  rows={3}
                  value={comment}
                  onChange={(v) => setComment(v.slice(0, 2000))}
                />
              </FormLayout>
            </form>
          </LayoutContent>
        }
        footer={
          <LayoutFooter hasDivider padding={3}>
            <HStack gap={2} hAlign="end">
              <Button label={t('cancel')} variant="ghost" type="button" onClick={() => onOpenChange(false)} />
              <Button
                label={t('submit')}
                variant="primary"
                icon={<Icon icon={ForwardIcon} />}
                isDisabled={!person}
                isLoading={mutation.isPending}
                type="submit"
                form={formId}
              />
            </HStack>
          </LayoutFooter>
        }
      />
    </Dialog>
  );
}
