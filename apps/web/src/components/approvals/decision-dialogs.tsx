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
import { Label } from '@isbp/ui/label';
import { type PersonOption, PersonPicker } from '@isbp/ui/person-picker';
import { Textarea } from '@isbp/ui/textarea';
import { CheckIcon, ForwardIcon, XIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import { useApiMutation } from '@/lib/api';

const INVALIDATE = [
  '/me/approvals',
  '/me/badges',
  '/workflow-instances',
  '/me/requests',
  '/requests',
  '/access-requests',
];

export type Decision = 'approve' | 'reject';

/** Approve (comment optional) or reject (comment required — the requester sees it). */
export function DecisionDialog({
  taskId,
  decision,
  subject,
  open,
  onOpenChange,
  onDone,
}: {
  taskId: string;
  decision: Decision;
  subject: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone?: () => void;
}) {
  const t = useTranslations('approvals.decide');
  const id = useId();
  const [comment, setComment] = useState('');
  const [touched, setTouched] = useState(false);
  const mutation = useApiMutation(
    (api, vars: { comment: string }) =>
      api.post(`/approvals/${taskId}/${decision}`, { comment: vars.comment || null }),
    {
      invalidate: INVALIDATE,
      success: t(decision === 'approve' ? 'approvedToast' : 'rejectedToast'),
      onSuccess: () => {
        onOpenChange(false);
        setComment('');
        onDone?.();
      },
    },
  );
  const missing = decision === 'reject' && !comment.trim();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t(decision === 'approve' ? 'approveTitle' : 'rejectTitle')}</DialogTitle>
          <DialogDescription>{subject}</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setTouched(true);
            if (!missing) mutation.mutate({ comment: comment.trim() });
          }}
        >
          <Label htmlFor={`${id}-comment`}>
            {t(decision === 'approve' ? 'commentOptional' : 'commentRequired')}
          </Label>
          <Textarea
            id={`${id}-comment`}
            autoFocus
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
