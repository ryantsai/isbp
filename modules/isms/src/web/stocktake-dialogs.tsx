'use client';

import { Button } from '@isbp/ui/button';
import { Checkbox } from '@isbp/ui/checkbox';
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
import { useApiMutation, useErrorText } from '@isbp/ui/query';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@isbp/ui/select';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@isbp/ui/sheet';
import { Textarea } from '@isbp/ui/textarea';
import { useTimeZone, useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import {
  type CreateStocktakeInput,
  RECURRENCES,
  type RecordItemInput,
  STOCKTAKE_EDITABLE,
  STOCKTAKE_RESULTS,
  type Stocktake,
  type StocktakeItem,
} from '../contracts';
import { INVALIDATE, todayLocal, useGroups, useLocalized, useTaxonomy } from './lib';
import { PeoplePicker } from './people';

type Editable = (typeof STOCKTAKE_EDITABLE)[number];

/** Record one item: confirmed, changed (with the corrections), missing or disposed (with a note). */
export function RecordItemDialog({
  stocktake,
  item,
  onOpenChange,
}: {
  stocktake: string;
  item: StocktakeItem | null;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('isms');
  const tc = useTranslations('common');
  return (
    <Dialog open={Boolean(item)} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl" closeLabel={tc('close')}>
        <DialogHeader>
          <DialogTitle>{item ? t('record.title', { number: item.snapshot.number }) : ''}</DialogTitle>
          <DialogDescription>{item?.snapshot.name}</DialogDescription>
        </DialogHeader>
        {item && <RecordForm stocktake={stocktake} item={item} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function RecordForm({
  stocktake,
  item,
  onDone,
}: {
  stocktake: string;
  item: StocktakeItem;
  onDone: () => void;
}) {
  const t = useTranslations('isms');
  const tc = useTranslations('common');
  const errorText = useErrorText();
  const name = useId();
  const noteId = useId();
  const [result, setResult] = useState<(typeof STOCKTAKE_RESULTS)[number]>(item.result ?? 'confirmed');
  const [note, setNote] = useState(item.note ?? '');
  const snap = item.snapshot;
  const [values, setValues] = useState<Record<Editable, string>>({
    name: snap.name,
    location: snap.location ?? '',
    usersText: snap.usersText ?? '',
    brand: snap.brand ?? '',
    model: snap.model ?? '',
    version: snap.version ?? '',
    quantity: String(snap.quantity),
  });
  const [error, setError] = useState<string | null>(null);
  const save = useApiMutation(
    (api, body: RecordItemInput) =>
      api.post<StocktakeItem>(`/isms/stocktakes/${stocktake}/items/${item.id}`, body),
    { invalidate: INVALIDATE, success: t('record.saved'), silent: true },
  );
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const changes: Record<string, string | number | null> = {};
    if (result === 'changed')
      for (const k of STOCKTAKE_EDITABLE) {
        const before = k === 'quantity' ? String(snap.quantity) : ((snap[k] as string | null) ?? '');
        if (values[k].trim() !== before)
          changes[k] = k === 'quantity' ? Number(values[k]) : values[k].trim() || null;
      }
    if (result === 'changed' && !Object.keys(changes).length) return setError(t('record.changesRequired'));
    if ((result === 'missing' || result === 'disposed') && !note.trim())
      return setError(t('record.noteRequired'));
    try {
      await save.mutateAsync({
        result,
        note: note.trim() || null,
        ...(result === 'changed' ? { changes } : {}),
      });
      onDone();
    } catch (err) {
      setError(errorText(err));
    }
  };
  return (
    <form onSubmit={submit} className="min-w-0 space-y-4" noValidate>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">{t('record.result')}</legend>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {STOCKTAKE_RESULTS.map((r) => (
            <label
              key={r}
              htmlFor={`${name}-${r}`}
              className="flex cursor-pointer items-start gap-2 rounded-md border p-2.5 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary/5 has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50"
            >
              <input
                id={`${name}-${r}`}
                type="radio"
                name={name}
                checked={result === r}
                onChange={() => setResult(r)}
                className="mt-0.5 size-4 accent-primary"
              />
              <span>
                <span className="font-medium">{t(`stocktakeResult.${r}`)}</span>
                <span className="block text-xs text-muted-foreground">{t(`record.hints.${r}`)}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      {result === 'changed' && (
        <fieldset className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <legend className="mb-2 text-sm font-medium">{t('record.corrections')}</legend>
          {STOCKTAKE_EDITABLE.map((k) => (
            <div key={k} className="grid min-w-0 gap-1.5">
              <Label htmlFor={`${name}-${k}`}>{t(`fields.${k}`)}</Label>
              <Input
                id={`${name}-${k}`}
                inputMode={k === 'quantity' ? 'numeric' : undefined}
                value={values[k]}
                onChange={(e) => setValues((v) => ({ ...v, [k]: e.target.value }))}
              />
            </div>
          ))}
        </fieldset>
      )}
      <div className="grid gap-1.5">
        <Label htmlFor={noteId}>{t('record.note')}</Label>
        <Textarea id={noteId} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
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
        <Button type="submit" loading={save.isPending}>
          {t('record.submit')}
        </Button>
      </DialogFooter>
    </form>
  );
}

/** Start or schedule a stocktake: name, dates, recurrence and scope (classes, sites, managers). */
export function NewStocktakeSheet({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (s: Stocktake) => void;
}) {
  const t = useTranslations('isms.newStocktake');
  const tc = useTranslations('common');
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-xl" closeLabel={tc('close')}>
        <SheetHeader>
          <SheetTitle>{t('title')}</SheetTitle>
          <SheetDescription>{t('description')}</SheetDescription>
        </SheetHeader>
        {open && (
          <NewStocktakeForm
            onCancel={() => onOpenChange(false)}
            onCreated={(s) => {
              onOpenChange(false);
              onCreated(s);
            }}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

function CheckList({
  legend,
  items,
  value,
  onChange,
}: {
  legend: string;
  items: { id: string; label: string }[];
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const base = useId();
  return (
    <fieldset className="min-w-0">
      <legend className="mb-2 text-sm font-medium">{legend}</legend>
      <div className="grid max-h-44 grid-cols-1 gap-1.5 overflow-y-auto rounded-md border p-2 sm:grid-cols-2">
        {items.map((i) => (
          <div key={i.id} className="flex min-w-0 items-center gap-2 text-sm">
            <Checkbox
              id={`${base}-${i.id}`}
              checked={value.includes(i.id)}
              onCheckedChange={(v) => onChange(v ? [...value, i.id] : value.filter((x) => x !== i.id))}
            />
            <Label htmlFor={`${base}-${i.id}`} className="truncate font-normal">
              {i.label}
            </Label>
          </div>
        ))}
      </div>
    </fieldset>
  );
}

function NewStocktakeForm({
  onCancel,
  onCreated,
}: {
  onCancel: () => void;
  onCreated: (s: Stocktake) => void;
}) {
  const t = useTranslations('isms');
  const tc = useTranslations('common');
  const errorText = useErrorText();
  const localized = useLocalized();
  const timeZone = useTimeZone();
  const { data: taxonomy } = useTaxonomy();
  const { data: groups } = useGroups();
  const ids = { name: useId(), start: useId(), due: useId(), recurrence: useId(), managers: useId() };
  const today = todayLocal(timeZone);
  const [name, setName] = useState(t('newStocktake.defaultName', { year: today.slice(0, 4) }));
  const [startOn, setStartOn] = useState(today);
  const [dueOn, setDueOn] = useState('');
  const [recurrence, setRecurrence] = useState<(typeof RECURRENCES)[number]>('none');
  const [classIds, setClassIds] = useState<string[]>([]);
  const [siteIds, setSiteIds] = useState<string[]>([]);
  const [managerIds, setManagerIds] = useState<string[]>([]);
  const [managerGroupIds, setManagerGroupIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const save = useApiMutation(
    (api, body: CreateStocktakeInput) => api.post<Stocktake>('/isms/stocktakes', body),
    {
      invalidate: INVALIDATE,
      success: (s) => t('newStocktake.created', { reference: s.reference }),
      silent: true,
    },
  );
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!name.trim() || !dueOn) return setError(t('newStocktake.required'));
    try {
      onCreated(
        await save.mutateAsync({
          name: name.trim(),
          startOn: startOn || null,
          dueOn,
          recurrence,
          scope: { classIds, siteIds, managerIds, managerGroupIds },
        }),
      );
    } catch (err) {
      setError(errorText(err));
    }
  };
  return (
    <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col" noValidate>
      <SheetBody className="space-y-5">
        <div className="grid gap-1.5">
          <Label htmlFor={ids.name}>{t('fields.stocktakeName')}</Label>
          <Input id={ids.name} value={name} onChange={(e) => setName(e.target.value)} maxLength={200} />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="grid gap-1.5">
            <Label htmlFor={ids.start}>{t('fields.startOn')}</Label>
            <Input
              id={ids.start}
              type="date"
              value={startOn}
              min={today}
              onChange={(e) => setStartOn(e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={ids.due}>{t('fields.dueOn')}</Label>
            <Input
              id={ids.due}
              type="date"
              value={dueOn}
              min={startOn || today}
              onChange={(e) => setDueOn(e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={ids.recurrence}>{t('fields.recurrence')}</Label>
            <Select value={recurrence} onValueChange={(v) => setRecurrence(v as typeof recurrence)}>
              <SelectTrigger id={ids.recurrence} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RECURRENCES.map((r) => (
                  <SelectItem key={r} value={r}>
                    {t(`recurrence.${r}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">{t('newStocktake.scopeHint')}</p>
        <CheckList
          legend={t('fields.class')}
          items={(taxonomy?.classes ?? []).map((c) => ({
            id: c.id,
            label: `${c.code} · ${localized(c.name)}`,
          }))}
          value={classIds}
          onChange={setClassIds}
        />
        <CheckList
          legend={t('fields.site')}
          items={(taxonomy?.sites ?? []).map((s) => ({ id: s.id, label: `${s.code} · ${s.name}` }))}
          value={siteIds}
          onChange={setSiteIds}
        />
        <div className="grid gap-1.5">
          <Label htmlFor={ids.managers}>{t('newStocktake.managers')}</Label>
          <PeoplePicker
            id={ids.managers}
            value={managerIds}
            onChange={setManagerIds}
            addLabel={t('newStocktake.addManager')}
          />
        </div>
        <CheckList
          legend={t('fields.managerGroup')}
          items={(groups?.items ?? []).map((g) => ({ id: g.id, label: g.name }))}
          value={managerGroupIds}
          onChange={setManagerGroupIds}
        />
        {error && (
          <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}
      </SheetBody>
      <SheetFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          {tc('cancel')}
        </Button>
        <Button type="submit" loading={save.isPending}>
          {startOn > today ? t('newStocktake.schedule') : t('newStocktake.start')}
        </Button>
      </SheetFooter>
    </form>
  );
}

/** Sign off (stocktakes and account reviews): an optional note, then the decision. */
export function SignOffDialog({
  open,
  onOpenChange,
  title,
  description,
  onConfirm,
  pending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  onConfirm: (note: string | null) => void;
  pending: boolean;
}) {
  const t = useTranslations('isms.signOff');
  const tc = useTranslations('common');
  const id = useId();
  const [note, setNote] = useState('');
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={tc('close')}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-1.5">
          <Label htmlFor={id}>{t('note')}</Label>
          <Textarea id={id} rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {tc('cancel')}
          </Button>
          <Button type="button" loading={pending} onClick={() => onConfirm(note.trim() || null)}>
            {t('confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
