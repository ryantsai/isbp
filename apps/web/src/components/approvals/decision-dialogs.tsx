'use client';

import { type ApprovalStep, defaultFieldValues, type LocalizedText, stepDecisionFields } from '@isbp/sdk';
import { ApiError } from '@isbp/sdk/web';
import { Button } from '@isbp/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@isbp/ui/dialog';
import { Form } from '@isbp/ui/form';
import { FormFields, useFieldErrorText, useFieldsResolver } from '@isbp/ui/form-renderer';
import { Label } from '@isbp/ui/label';
import { type PersonOption, PersonPicker } from '@isbp/ui/person-picker';
import { Textarea } from '@isbp/ui/textarea';
import { cn } from '@isbp/ui';
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
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn(fields.length > 0 && 'max-h-[90dvh] overflow-y-auto sm:max-w-2xl')}>
        <DialogHeader>
          <DialogTitle>{t(decision === 'approve' ? 'approveTitle' : 'rejectTitle')}</DialogTitle>
          <DialogDescription>{subject}</DialogDescription>
        </DialogHeader>
        <form
          noValidate
          className="grid gap-2"
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
          {fields.length > 0 && (
            <section aria-labelledby={`${id}-fields`} className="mb-2 grid gap-3 rounded-lg border p-4">
              <div className="grid gap-0.5">
                <h3 id={`${id}-fields`} className="flex items-center gap-2 text-sm font-semibold">
                  <ClipboardListIcon className="size-4 text-muted-foreground" aria-hidden />
                  {t('fieldsTitle')}
                </h3>
                <p className="text-xs text-muted-foreground">
                  {optional ? t('fieldsOptionalHint') : t('fieldsHint')}
                </p>
              </div>
              <Form {...form}>
                <FormFields elements={elements} form={form} />
              </Form>
            </section>
          )}
          <Label htmlFor={`${id}-comment`}>
            {t(decision === 'approve' ? 'commentOptional' : 'commentRequired')}
          </Label>
          <Textarea
            id={`${id}-comment`}
            autoFocus={!fields.length}
            rows={4}
            value={comment}
            maxLength={2000}
            aria-invalid={touched && missing}
            aria-describedby={`${id}-hint`}
            onChange={(e) => setComment(e.target.value)}
            placeholder={t(decision === 'approve' ? 'approvePlaceholder' : 'rejectPlaceholder')}
          />
          <p
            id={`${id}-hint`}
            className={touched && missing ? 'text-sm text-destructive' : 'text-xs text-muted-foreground'}
          >
            {touched && missing ? t('reasonNeeded') : t('visibleToRequester')}
          </p>
          {rootError && (
            <p role="alert" className="text-sm text-destructive">
              {rootError}
            </p>
          )}
          <DialogFooter className="mt-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {t('cancel')}
            </Button>
            <Button
              type="submit"
              variant={decision === 'approve' ? 'default' : 'destructive'}
              disabled={mutation.isPending}
            >
              {decision === 'approve' ? <CheckIcon /> : <XIcon />}
              {t(decision === 'approve' ? 'approve' : 'reject')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
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
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{subject}</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (person) mutation.mutate({ userId: person.id, comment: comment.trim() });
          }}
        >
          <div className="grid gap-2">
            <Label htmlFor={`${id}-person`}>{t('person')}</Label>
            <PersonPicker id={`${id}-person`} value={person} onChange={setPerson} excludeIds={excludeIds} />
            <p className="text-xs text-muted-foreground">{t('hint')}</p>
          </div>
          <div className="grid gap-2">
            <Label htmlFor={`${id}-comment`}>{t('note')}</Label>
            <Textarea
              id={`${id}-comment`}
              rows={3}
              value={comment}
              maxLength={2000}
              onChange={(e) => setComment(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {t('cancel')}
            </Button>
            <Button type="submit" disabled={!person || mutation.isPending}>
              <ForwardIcon />
              {t('submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
