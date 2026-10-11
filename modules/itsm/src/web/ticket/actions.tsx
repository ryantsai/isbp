'use client';

import { Button } from '@astryxdesign/core/Button';
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import { DropdownMenu } from '@astryxdesign/core/DropdownMenu';
import { FormLayout } from '@astryxdesign/core/FormLayout';
import { Icon } from '@astryxdesign/core/Icon';
import { HStack, Layout, LayoutContent, LayoutFooter } from '@astryxdesign/core/Layout';
import { Selector } from '@astryxdesign/core/Selector';
import { Text } from '@astryxdesign/core/Text';
import { TextArea } from '@astryxdesign/core/TextArea';
import { TextInput } from '@astryxdesign/core/TextInput';
import { ApiError } from '@isbp/sdk/web';
import { useApiMutation, useErrorText } from '@isbp/ui/query';
import { toast } from '@isbp/ui/toast';
import {
  BugIcon,
  CheckCircle2Icon,
  ClipboardCheckIcon,
  FilePenLineIcon,
  FlagIcon,
  GavelIcon,
  HammerIcon,
  type LucideIcon,
  RotateCcwIcon,
  SearchIcon,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useState } from 'react';
import {
  type ReplyArticle,
  type ResolutionCode,
  resolutionCodeSchema,
  type TicketDetail,
  type TicketStatus,
  type TransitionInput,
  type UpdateTicketInput,
} from '../../contracts';
import { statusIcon } from '../components/badges';
import { ArticlePicker } from '../components/pickers';
import { INVALIDATE, ticketApi } from '../lib';
import type { NextStep } from '../logic';
import { NEEDS_CODE } from '../statuses';

const CODES = resolutionCodeSchema.options;

/** What a failed status change means for the person, with a way forward when there is one. */
export function useTransitionError() {
  const t = useTranslations('itsm.actions.errors');
  const errorText = useErrorText();
  return (err: unknown, onEditPlan?: () => void) => {
    const fields =
      err instanceof ApiError
        ? ((err.details as { fields?: Record<string, string> } | undefined)?.fields ?? {})
        : {};
    const reason =
      err instanceof ApiError ? (err.details as { reason?: string } | undefined)?.reason : undefined;
    const editPlan = onEditPlan ? { action: { label: t('editPlan'), onClick: onEditPlan } } : {};
    if (
      err instanceof ApiError &&
      err.code === 'VALIDATION_FAILED' &&
      (fields.plannedStart || fields.plannedEnd)
    )
      toast.error(t('windowMissing'), editPlan);
    else if (err instanceof ApiError && err.code === 'SCHEDULE_CONFLICT')
      toast.error(t('windowPast'), editPlan);
    else if (reason === 'acceptance_required') toast.error(t('acceptanceRequired'));
    else toast.error(errorText(err));
  };
}

export function useTransition(ticket: TicketDetail, onDone?: () => void) {
  const t = useTranslations('itsm.actions');
  const ts = useTranslations('itsm.status');
  return useApiMutation(
    (api, body: TransitionInput) => api.post<TicketDetail>(`${ticketApi(ticket.reference)}/transition`, body),
    {
      invalidate: INVALIDATE,
      silent: true,
      success: (r) =>
        r.signOff
          ? t('sentForSignOff')
          : r.status === 'authorization'
            ? t('submitted')
            : t('statusChanged', { status: ts(r.status) }),
      onSuccess: () => onDone?.(),
    },
  );
}

/** The resolve dialog's starting point: "Send and resolve" brings the reply and the article it cites. */
export interface ResolveIntent {
  status: TicketStatus;
  notes?: string;
  article?: ReplyArticle | null;
}

/**
 * Resolve / fulfil / cancel: a resolution code is required, notes too unless cancelling. Resolving can record the
 * knowledge article that solved it (linked to the ticket).
 */
export function ResolveDialog({
  ticket,
  intent,
  onOpenChange,
  onResolved,
}: {
  ticket: TicketDetail;
  intent: ResolveIntent | null;
  onOpenChange: (open: boolean) => void;
  onResolved?: () => void;
}) {
  const t = useTranslations('itsm.actions.resolve');
  const tr = useTranslations('itsm.resolution');
  const tc = useTranslations('common');
  const formId = useId();
  const status = intent?.status ?? null;
  const [code, setCode] = useState<ResolutionCode | ''>('');
  const [notes, setNotes] = useState('');
  const [article, setArticle] = useState<ReplyArticle | null>(null);
  const [touched, setTouched] = useState(false);
  const open = status !== null;
  useEffect(() => {
    if (!intent) return;
    setCode(intent.status === 'cancelled' ? '' : 'solved');
    setNotes(intent.notes ?? '');
    setArticle(intent.article ?? null);
    setTouched(false);
  }, [intent]);
  const onError = useTransitionError();
  const transition = useTransition(ticket, () => {
    onOpenChange(false);
    onResolved?.();
  });
  const cancelling = status === 'cancelled';
  const kind = cancelling ? 'cancel' : status === 'fulfilled' ? 'fulfil' : 'resolve';
  const missingCode = !code;
  const missingNotes = !notes.trim();
  const codes = cancelling
    ? CODES.filter((c) => ['duplicate', 'cancelled_by_requester', 'user_error', 'no_fault_found'].includes(c))
    : CODES.filter((c) => c !== 'cancelled_by_requester');

  return (
    <Dialog isOpen={open} onOpenChange={onOpenChange} width={512} purpose="form">
      <Layout
        header={
          <DialogHeader
            title={t(`${kind}.title`)}
            subtitle={`${ticket.reference} · ${ticket.title}`}
            onOpenChange={onOpenChange}
          />
        }
        content={
          <LayoutContent padding={4}>
            <form
              id={formId}
              noValidate
              onSubmit={(e) => {
                e.preventDefault();
                setTouched(true);
                if (missingCode || missingNotes || !status) return;
                transition.mutate(
                  {
                    status,
                    resolutionCode: code as ResolutionCode,
                    resolutionNotes: notes.trim(),
                    ...(article && !cancelling ? { articleId: article.id } : {}),
                  },
                  { onError: (err) => onError(err) },
                );
              }}
            >
              <FormLayout defaultOptionality="optional">
                <Selector
                  label={t('code')}
                  isRequired
                  placeholder={t('codePlaceholder')}
                  value={code || undefined}
                  onChange={(v) => setCode(v as ResolutionCode)}
                  options={codes.map((c) => ({ value: c, label: tr(c) }))}
                  status={touched && missingCode ? { type: 'error', message: t('codeRequired') } : undefined}
                />
                <TextArea
                  label={t(cancelling ? 'reason' : 'notes')}
                  isRequired
                  rows={5}
                  value={notes}
                  onChange={setNotes}
                  description={t(cancelling ? 'cancelHint' : 'notesHint')}
                  status={
                    touched && missingNotes
                      ? { type: 'error', message: t(cancelling ? 'reasonRequired' : 'notesRequired') }
                      : undefined
                  }
                />
                {!cancelling && (
                  <ArticlePicker
                    label={t('article')}
                    description={t('articleHint')}
                    value={article}
                    onChange={(a) =>
                      setArticle(a ? { id: a.id, reference: a.reference ?? '', title: a.title } : null)
                    }
                  />
                )}
              </FormLayout>
            </form>
          </LayoutContent>
        }
        footer={
          <LayoutFooter hasDivider padding={3}>
            <HStack gap={2} hAlign="end">
              <Button label={tc('cancel')} variant="ghost" onClick={() => onOpenChange(false)} />
              <Button
                label={t(`${kind}.submit`)}
                variant={cancelling ? 'destructive' : 'primary'}
                type="submit"
                form={formId}
                isLoading={transition.isPending}
              />
            </HStack>
          </LayoutFooter>
        }
      />
    </Dialog>
  );
}

/** Title and description (Markdown). */
export function EditDialog({
  ticket,
  open,
  onOpenChange,
}: {
  ticket: TicketDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('itsm.actions.edit');
  const tc = useTranslations('common');
  const formId = useId();
  const [title, setTitle] = useState(ticket.title);
  const [description, setDescription] = useState(ticket.description);
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (!open) return;
    setTitle(ticket.title);
    setDescription(ticket.description);
    setTouched(false);
  }, [open, ticket.title, ticket.description]);
  const save = useApiMutation(
    (api, body: UpdateTicketInput) => api.patch<TicketDetail>(ticketApi(ticket.reference), body),
    { invalidate: INVALIDATE, success: tc('saved'), onSuccess: () => onOpenChange(false) },
  );
  const invalid = title.trim().length < 3;
  return (
    <Dialog isOpen={open} onOpenChange={onOpenChange} width={672} purpose="form">
      <Layout
        header={<DialogHeader title={t('title')} subtitle={ticket.reference} onOpenChange={onOpenChange} />}
        content={
          <LayoutContent padding={4}>
            <form
              id={formId}
              noValidate
              onSubmit={(e) => {
                e.preventDefault();
                setTouched(true);
                if (!invalid) save.mutate({ title: title.trim(), description: description.trim() });
              }}
            >
              <FormLayout defaultOptionality="optional">
                <TextInput
                  label={t('titleLabel')}
                  isRequired
                  value={title}
                  onChange={(v) => setTitle(v.slice(0, 200))}
                  status={touched && invalid ? { type: 'error', message: t('titleTooShort') } : undefined}
                />
                <TextArea
                  label={t('descriptionLabel')}
                  rows={10}
                  value={description}
                  onChange={setDescription}
                  description={t('markdownHint')}
                />
              </FormLayout>
            </form>
          </LayoutContent>
        }
        footer={
          <LayoutFooter hasDivider padding={3}>
            <HStack gap={2} hAlign="end">
              <Button label={tc('cancel')} variant="ghost" onClick={() => onOpenChange(false)} />
              <Button
                label={tc('saveChanges')}
                variant="primary"
                type="submit"
                form={formId}
                isLoading={save.isPending}
              />
            </HStack>
          </LayoutFooter>
        }
      />
    </Dialog>
  );
}

const NEXT_ICON: Record<NextStep['key'], LucideIcon> = {
  resolve: CheckCircle2Icon,
  fulfil: CheckCircle2Icon,
  reopen: RotateCcwIcon,
  startInvestigating: SearchIcon,
  markKnownError: BugIcon,
  closeProblem: CheckCircle2Icon,
  submitForApproval: GavelIcon,
  revise: FilePenLineIcon,
  startImplementation: HammerIcon,
  finishImplementation: ClipboardCheckIcon,
  closeChange: FlagIcon,
};

/** The next lifecycle step as the page's primary button (and a hint when it can't be taken yet). */
export function NextStepButton({
  step,
  pending,
  disabledHint,
  onClick,
}: {
  step: NextStep;
  pending: boolean;
  /** Why it can't be taken now (e.g. waiting for the requester's acceptance). */
  disabledHint?: string | null;
  onClick: () => void;
}) {
  const t = useTranslations('itsm.actions.next');
  return (
    <HStack gap={2} wrap="wrap" vAlign="center">
      {disabledHint && <Text color="secondary">{disabledHint}</Text>}
      <Button
        label={t(step.key)}
        variant="primary"
        icon={<Icon icon={NEXT_ICON[step.key]} />}
        isLoading={pending}
        isDisabled={Boolean(disabledHint)}
        onClick={onClick}
      />
    </HStack>
  );
}

/** "Other status": the side exits of the lifecycle (on hold, cancel, back to draft…). */
export function StatusMenu({
  ticket,
  statuses,
  pending,
  onSelect,
}: {
  ticket: TicketDetail;
  statuses: readonly TicketStatus[];
  pending: boolean;
  onSelect: (status: TicketStatus) => void;
}) {
  const t = useTranslations('itsm.actions');
  const ts = useTranslations('itsm.status');
  if (!statuses.length) return null;
  const item = (s: TicketStatus) => ({
    label: ticket.signOff && s === 'in_progress' ? t('withdrawResolution') : ts(s),
    icon: statusIcon(s),
    variant: s === 'cancelled' || s === 'rejected' ? ('destructive' as const) : undefined,
    onClick: () => onSelect(s),
  });
  // Exits that end the ticket go last (they open the dialog that asks for the reason).
  const ends = (s: TicketStatus) => s === 'cancelled' || s === 'rejected';
  return (
    <DropdownMenu
      button={{ label: t('otherStatus'), variant: 'secondary', isLoading: pending }}
      menuWidth={208}
      items={[
        {
          type: 'section',
          title: t('moveTo'),
          items: [...statuses.filter((s) => !ends(s)), ...statuses.filter(ends)].map(item),
        },
      ]}
    />
  );
}

export { NEEDS_CODE };
