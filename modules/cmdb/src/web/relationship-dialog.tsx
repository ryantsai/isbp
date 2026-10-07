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
import { Label } from '@isbp/ui/label';
import { useApiMutation, useErrorText } from '@isbp/ui/query';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@isbp/ui/select';
import { Textarea } from '@isbp/ui/textarea';
import { ArrowRightIcon, InfoIcon, ZapIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type FormEvent, useId, useState } from 'react';
import {
  type CiRef,
  type CreateRelationshipInput,
  IMPACT_FROM_SOURCE,
  IMPACT_FROM_TARGET,
  type RelationDirection,
  type Relationship,
  RELATIONSHIP_TYPES,
  type RelationshipType,
} from '../contracts';
import { CiPicker } from './ci-picker';
import { ClassIcon } from './class-icon';
import { INVALIDATE } from './data';

type Choice = `${RelationshipType}:${RelationDirection}`;
const PROPAGATING = new Set<RelationshipType>([...IMPACT_FROM_TARGET, ...IMPACT_FROM_SOURCE]);

function CiChip({ ci }: { ci: Pick<CiRef, 'name' | 'reference' | 'class'> }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 rounded-md border bg-card px-2 py-1 text-sm shadow-xs">
      <ClassIcon name={ci.class.icon} className="size-3.5 shrink-0 text-primary" />
      <span className="truncate font-medium">{ci.name}</span>
    </span>
  );
}

/** Relate this CI to another one, choosing the link from this CI's point of view. */
export function RelationshipDialog({
  ci,
  open,
  onOpenChange,
}: {
  ci: CiRef;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('cmdb');
  const tc = useTranslations('common');
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" closeLabel={tc('close')}>
        <DialogHeader>
          <DialogTitle>{t('rel.dialogTitle')}</DialogTitle>
          <DialogDescription>{t('rel.dialogDescription', { name: ci.name })}</DialogDescription>
        </DialogHeader>
        {/* Mounted per opening, so every opening starts from a clean form. */}
        <RelationshipForm ci={ci} onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function RelationshipForm({ ci, onDone }: { ci: CiRef; onDone: () => void }) {
  const t = useTranslations('cmdb');
  const tc = useTranslations('common');
  const errorText = useErrorText();
  const ids = { type: useId(), other: useId(), note: useId(), error: useId() };
  const [choice, setChoice] = useState<Choice>('depends_on:outgoing');
  const [other, setOther] = useState<CiRef | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);

  const [type, direction] = choice.split(':') as [RelationshipType, RelationDirection];
  const label = (rt: RelationshipType, d: RelationDirection) =>
    t(`relationships.${rt}.${d === 'outgoing' ? 'forward' : 'reverse'}`);

  const add = useApiMutation(
    (api, body: CreateRelationshipInput) => api.post<Relationship>('/cmdb/relationships', body),
    {
      invalidate: INVALIDATE,
      success: t('rel.added'),
      onSuccess: onDone,
      silent: true,
    },
  );

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    setError(null);
    if (!other) return;
    const body: CreateRelationshipInput =
      direction === 'outgoing'
        ? { sourceId: ci.id, targetId: other.id, type, note: note.trim() || null }
        : { sourceId: other.id, targetId: ci.id, type, note: note.trim() || null };
    try {
      await add.mutateAsync(body);
    } catch (err) {
      const reason =
        err instanceof ApiError ? (err.details as { reason?: string } | undefined)?.reason : null;
      setError(
        err instanceof ApiError &&
          err.code === 'RELATIONSHIP_INVALID' &&
          reason &&
          t.has(`rel.errors.${reason}`)
          ? t(`rel.errors.${reason}` as 'rel.errors.self')
          : errorText(err),
      );
    }
  };

  const missing = touched && !other;

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <div className="grid gap-2">
        <Label htmlFor={ids.type}>{t('rel.type')}</Label>
        <Select value={choice} onValueChange={(v) => setChoice(v as Choice)}>
          <SelectTrigger id={ids.type} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {RELATIONSHIP_TYPES.map((rt) => (
              <SelectGroup key={rt}>
                {(['outgoing', 'incoming'] as const).map((d) => (
                  <SelectItem key={d} value={`${rt}:${d}`}>
                    {label(rt, d)}
                  </SelectItem>
                ))}
              </SelectGroup>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-2">
        <Label htmlFor={ids.other}>{t('rel.other')}</Label>
        <CiPicker
          id={ids.other}
          value={other}
          onChange={(c) => {
            setOther(c);
            setError(null);
          }}
          excludeId={ci.id}
          invalid={missing}
          aria-describedby={missing ? ids.error : undefined}
        />
        {missing && (
          <p id={ids.error} className="text-xs text-destructive">
            {t('rel.otherPlaceholder')}
          </p>
        )}
      </div>
      <div className="grid gap-2">
        <Label htmlFor={ids.note}>{t('rel.note')}</Label>
        <Textarea
          id={ids.note}
          rows={2}
          maxLength={500}
          value={note}
          placeholder={t('rel.notePlaceholder')}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>

      <div className="space-y-2 rounded-lg border bg-muted/40 p-3">
        <p className="text-xs font-medium text-muted-foreground">{t('rel.preview')}</p>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <CiChip ci={ci} />
          <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
            {label(type, direction)}
            <ArrowRightIcon className="size-3.5" aria-hidden />
          </span>
          {other ? (
            <CiChip ci={other} />
          ) : (
            <span className="rounded-md border border-dashed px-2 py-1 text-sm text-muted-foreground">
              {t('rel.other')}
            </span>
          )}
        </div>
        <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
          {PROPAGATING.has(type) ? (
            <ZapIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          ) : (
            <InfoIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          )}
          {PROPAGATING.has(type) ? t('rel.propagates') : t('rel.noPropagation')}
        </p>
      </div>

      {error && (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          {tc('cancel')}
        </Button>
        <Button type="submit" loading={add.isPending}>
          {tc('add')}
        </Button>
      </DialogFooter>
    </form>
  );
}
