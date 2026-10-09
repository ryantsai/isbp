'use client';

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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@isbp/ui/dropdown-menu';
import { Input } from '@isbp/ui/input';
import { Label } from '@isbp/ui/label';
import { useApiMutation, useErrorText } from '@isbp/ui/query';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@isbp/ui/select';
import { toast } from '@isbp/ui/sonner';
import { Textarea } from '@isbp/ui/textarea';
import {
  BugIcon,
  CheckCircle2Icon,
  ChevronDownIcon,
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
  const id = useId();
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={tc('close')}>
        <DialogHeader>
          <DialogTitle>{t(`${kind}.title`)}</DialogTitle>
          <DialogDescription>
            {ticket.reference} · {ticket.title}
          </DialogDescription>
        </DialogHeader>
        <form
          noValidate
          className="grid gap-4"
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
          <div className="grid gap-2">
            <Label htmlFor={`${id}-code`}>{t('code')}</Label>
            <Select value={code || undefined} onValueChange={(v) => setCode(v as ResolutionCode)}>
              <SelectTrigger
                id={`${id}-code`}
                className="w-full"
                aria-invalid={touched && missingCode ? true : undefined}
                aria-describedby={touched && missingCode ? `${id}-code-error` : undefined}
              >
                <SelectValue placeholder={t('codePlaceholder')} />
              </SelectTrigger>
              <SelectContent>
                {codes.map((c) => (
                  <SelectItem key={c} value={c}>
                    {tr(c)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {touched && missingCode && (
              <p id={`${id}-code-error`} className="text-sm text-destructive">
                {t('codeRequired')}
              </p>
            )}
          </div>
          <div className="grid gap-2">
            <Label htmlFor={`${id}-notes`}>{t(cancelling ? 'reason' : 'notes')}</Label>
            <Textarea
              id={`${id}-notes`}
              rows={5}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              aria-invalid={touched && missingNotes ? true : undefined}
              aria-describedby={`${id}-notes-hint${touched && missingNotes ? ` ${id}-notes-error` : ''}`}
            />
            <p id={`${id}-notes-hint`} className="text-xs text-muted-foreground">
              {t(cancelling ? 'cancelHint' : 'notesHint')}
            </p>
            {touched && missingNotes && (
              <p id={`${id}-notes-error`} className="text-sm text-destructive">
                {t(cancelling ? 'reasonRequired' : 'notesRequired')}
              </p>
            )}
          </div>
          {!cancelling && (
            <div className="grid gap-2">
              <Label htmlFor={`${id}-article`}>{t('article')}</Label>
              <ArticlePicker
                id={`${id}-article`}
                value={article}
                onChange={(a) =>
                  setArticle(a ? { id: a.id, reference: a.reference ?? '', title: a.title } : null)
                }
                aria-describedby={`${id}-article-hint`}
              />
              <p id={`${id}-article-hint`} className="text-xs text-muted-foreground">
                {t('articleHint')}
              </p>
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {tc('cancel')}
            </Button>
            <Button
              type="submit"
              variant={cancelling ? 'destructive' : 'default'}
              loading={transition.isPending}
            >
              {t(`${kind}.submit`)}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
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
  const id = useId();
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl" closeLabel={tc('close')}>
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{ticket.reference}</DialogDescription>
        </DialogHeader>
        <form
          noValidate
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            setTouched(true);
            if (!invalid) save.mutate({ title: title.trim(), description: description.trim() });
          }}
        >
          <div className="grid gap-2">
            <Label htmlFor={`${id}-title`}>{t('titleLabel')}</Label>
            <Input
              id={`${id}-title`}
              value={title}
              maxLength={200}
              onChange={(e) => setTitle(e.target.value)}
              aria-invalid={touched && invalid ? true : undefined}
              aria-describedby={touched && invalid ? `${id}-title-error` : undefined}
            />
            {touched && invalid && (
              <p id={`${id}-title-error`} className="text-sm text-destructive">
                {t('titleTooShort')}
              </p>
            )}
          </div>
          <div className="grid gap-2">
            <Label htmlFor={`${id}-description`}>{t('descriptionLabel')}</Label>
            <Textarea
              id={`${id}-description`}
              rows={10}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              aria-describedby={`${id}-description-hint`}
            />
            <p id={`${id}-description-hint`} className="text-xs text-muted-foreground">
              {t('markdownHint')}
            </p>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {tc('cancel')}
            </Button>
            <Button type="submit" loading={save.isPending}>
              {tc('saveChanges')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
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
  const Icon = NEXT_ICON[step.key];
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      {disabledHint && <span className="text-sm text-muted-foreground">{disabledHint}</span>}
      <Button onClick={onClick} loading={pending} disabled={Boolean(disabledHint)}>
        <Icon aria-hidden />
        {t(step.key)}
      </Button>
    </span>
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
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" loading={pending}>
          {t('otherStatus')}
          <ChevronDownIcon aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-52">
        <DropdownMenuLabel>{t('moveTo')}</DropdownMenuLabel>
        {statuses.map((s) => {
          const Icon: LucideIcon = statusIcon(s);
          return (
            <DropdownMenuItem
              key={s}
              onSelect={() => onSelect(s)}
              variant={s === 'cancelled' || s === 'rejected' ? 'destructive' : 'default'}
            >
              <Icon aria-hidden />
              {ticket.signOff && s === 'in_progress' ? t('withdrawResolution') : ts(s)}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export { NEEDS_CODE };
