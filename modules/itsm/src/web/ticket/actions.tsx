'use client';

import { usePlatform } from '@isbp/sdk/web';
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
import { useApiMutation } from '@isbp/ui/query';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@isbp/ui/select';
import { Textarea } from '@isbp/ui/textarea';
import {
  CheckCircle2Icon,
  ChevronDownIcon,
  GavelIcon,
  HandIcon,
  PencilIcon,
  type LucideIcon,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useState } from 'react';
import {
  type ResolutionCode,
  resolutionCodeSchema,
  type TicketDetail,
  type TicketStatus,
  type TransitionInput,
  type UpdateTicketInput,
} from '../../contracts';
import { statusIcon } from '../components/badges';
import { INVALIDATE, ticketApi } from '../lib';
import { NEEDS_CODE } from '../statuses';

const CODES = resolutionCodeSchema.options;

export function useTransition(ticket: TicketDetail, onDone?: () => void) {
  const t = useTranslations('itsm.actions');
  const ts = useTranslations('itsm.status');
  return useApiMutation(
    (api, body: TransitionInput) => api.post<TicketDetail>(`${ticketApi(ticket.reference)}/transition`, body),
    {
      invalidate: INVALIDATE,
      success: (r) => t('statusChanged', { status: ts(r.status) }),
      onSuccess: () => onDone?.(),
    },
  );
}

/** Resolve / fulfil / cancel: a resolution code is required, notes too unless cancelling. */
export function ResolveDialog({
  ticket,
  status,
  onOpenChange,
}: {
  ticket: TicketDetail;
  status: TicketStatus | null;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('itsm.actions.resolve');
  const tr = useTranslations('itsm.resolution');
  const tc = useTranslations('common');
  const id = useId();
  const [code, setCode] = useState<ResolutionCode | ''>('');
  const [notes, setNotes] = useState('');
  const [touched, setTouched] = useState(false);
  const open = status !== null;
  useEffect(() => {
    if (!open) return;
    setCode(status === 'cancelled' ? '' : 'solved');
    setNotes('');
    setTouched(false);
  }, [open, status]);
  const transition = useTransition(ticket, () => onOpenChange(false));
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
            transition.mutate({
              status,
              resolutionCode: code as ResolutionCode,
              resolutionNotes: notes.trim(),
            });
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

/** Status menu, resolve/fulfil, assign to me, edit and (changes) submit for approval. */
export function ActionBar({ ticket }: { ticket: TicketDetail }) {
  const t = useTranslations('itsm.actions');
  const ts = useTranslations('itsm.status');
  const { user } = usePlatform();
  const [resolving, setResolving] = useState<TicketStatus | null>(null);
  const [editing, setEditing] = useState(false);
  const transition = useTransition(ticket);
  const assign = useApiMutation(
    (api) => api.post<TicketDetail>(`${ticketApi(ticket.reference)}/assign-to-me`),
    { invalidate: INVALIDATE, success: t('assignedToMe') },
  );
  const transitions = ticket.viewer.transitions;
  const finish = transitions.find((s) => s === 'resolved' || s === 'fulfilled');
  const canSubmit = ticket.type === 'change' && transitions.includes('authorization');
  const menu = transitions.filter((s) => s !== 'authorization');
  const go = (status: TicketStatus) => {
    if (NEEDS_CODE.includes(status)) setResolving(status);
    else transition.mutate({ status });
  };
  const item = (s: TicketStatus) => {
    const Icon: LucideIcon = statusIcon(s);
    return (
      <DropdownMenuItem
        key={s}
        onSelect={() => go(s)}
        variant={s === 'cancelled' || s === 'rejected' ? 'destructive' : 'default'}
      >
        <Icon aria-hidden />
        {ts(s)}
      </DropdownMenuItem>
    );
  };

  return (
    <div className="flex flex-wrap items-center gap-2" role="toolbar" aria-label={t('label')}>
      {menu.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" loading={transition.isPending && !resolving}>
              {t('changeStatus')}
              <ChevronDownIcon aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-52">
            <DropdownMenuLabel>{t('moveTo')}</DropdownMenuLabel>
            {menu.map(item)}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {finish && (
        <Button onClick={() => setResolving(finish)}>
          <CheckCircle2Icon aria-hidden />
          {t(finish === 'fulfilled' ? 'fulfilButton' : 'resolveButton')}
        </Button>
      )}
      {canSubmit && (
        <Button onClick={() => transition.mutate({ status: 'authorization' })} loading={transition.isPending}>
          <GavelIcon aria-hidden />
          {t('submitForApproval')}
        </Button>
      )}
      {ticket.viewer.canEdit && ticket.assignee?.id !== user.id && (
        <Button variant="outline" onClick={() => assign.mutate(undefined)} loading={assign.isPending}>
          <HandIcon aria-hidden />
          {t('assignToMe')}
        </Button>
      )}
      {ticket.viewer.canEdit && (
        <Button variant="ghost" onClick={() => setEditing(true)}>
          <PencilIcon aria-hidden />
          {t('editButton')}
        </Button>
      )}
      <ResolveDialog ticket={ticket} status={resolving} onOpenChange={(o) => !o && setResolving(null)} />
      <EditDialog ticket={ticket} open={editing} onOpenChange={setEditing} />
    </div>
  );
}
