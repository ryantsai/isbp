'use client';

import { Button } from '@isbp/ui/button';
import { Checkbox } from '@isbp/ui/checkbox';
import { Label } from '@isbp/ui/label';
import { useApiMutation, useApiQuery, useErrorText } from '@isbp/ui/query';
import { SearchInput } from '@isbp/ui/search-input';
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
import { Skeleton } from '@isbp/ui/skeleton';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import { CIA_LEVELS, SOURCE_TYPES, type SourceRecord } from '../contracts';
import { assetHref, INVALIDATE, useLocalized, useTaxonomy } from './lib';
import { PersonField } from './people';

const NONE = '__none__';
type SourceType = (typeof SOURCE_TYPES)[number];

/**
 * "Create from…": register CMDB CIs, ITAM assets, licences, contracts, applications or knowledge articles as
 * information assets in bulk. Only records the person can read are offered; each new asset is linked to its record.
 */
export function CreateFromSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('isms.createFrom');
  const tc = useTranslations('common');
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-2xl" closeLabel={tc('close')}>
        <SheetHeader>
          <SheetTitle>{t('title')}</SheetTitle>
          <SheetDescription>{t('description')}</SheetDescription>
        </SheetHeader>
        {open && <CreateFrom onDone={() => onOpenChange(false)} />}
      </SheetContent>
    </Sheet>
  );
}

function LevelSelect({
  id,
  value,
  onChange,
  placeholder,
}: {
  id: string;
  value: number | null;
  onChange: (v: number) => void;
  placeholder: string;
}) {
  return (
    <Select value={value === null ? undefined : String(value)} onValueChange={(v) => onChange(Number(v))}>
      <SelectTrigger id={id} className="w-full">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {CIA_LEVELS.map((l) => (
          <SelectItem key={l} value={String(l)}>
            {l}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function CreateFrom({ onDone }: { onDone: () => void }) {
  const t = useTranslations('isms');
  const tc = useTranslations('common');
  const errorText = useErrorText();
  const localized = useLocalized();
  const { data: types } = useApiQuery<{ items: { type: string }[] }>('/records/types');
  const available = SOURCE_TYPES.filter((s) => types?.items.some((x) => x.type === s));
  const [type, setType] = useState<SourceType | null>(null);
  const current = type ?? available[0] ?? null;
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const { data: taxonomy } = useTaxonomy();
  const [classId, setClassId] = useState('');
  const [subclassId, setSubclassId] = useState(NONE);
  const [siteId, setSiteId] = useState('');
  const [labelId, setLabelId] = useState(NONE);
  const [managerId, setManagerId] = useState<string | null>(null);
  // No default score (as in the asset form): the value drives risk and stocktakes.
  const [cia, setCia] = useState<Record<'confidentiality' | 'integrity' | 'availability', number | null>>({
    confidentiality: null,
    integrity: null,
    availability: null,
  });
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    created: { id: string; number: string; name: string }[];
    skipped: unknown[];
  } | null>(null);
  const ids = {
    type: useId(),
    cls: useId(),
    sub: useId(),
    site: useId(),
    label: useId(),
    manager: useId(),
    c: useId(),
    i: useId(),
    a: useId(),
  };
  const { data, isLoading } = useApiQuery<{ items: SourceRecord[] }>(current ? '/isms/sources' : null, {
    type: current ?? undefined,
    q,
    limit: 50,
  });
  const klass = taxonomy?.classes.find((c) => c.id === classId);
  const save = useApiMutation(
    (api) =>
      api.post<{ created: { id: string; number: string; name: string }[]; skipped: unknown[] }>(
        '/isms/assets/from-records',
        {
          refs: picked,
          classId,
          subclassId: subclassId === NONE ? null : subclassId,
          siteId,
          managerId,
          classificationId: labelId === NONE ? null : labelId,
          ...cia,
        },
      ),
    { invalidate: INVALIDATE, silent: true },
  );
  const submit = async () => {
    setError(null);
    if (!classId || !siteId) {
      setError(t('createFrom.needClassSite'));
      return;
    }
    if (cia.confidentiality === null || cia.integrity === null || cia.availability === null) {
      setError(t('createFrom.needScores'));
      return;
    }
    try {
      setResult(await save.mutateAsync(undefined));
      setPicked([]);
    } catch (err) {
      setError(errorText(err));
    }
  };

  if (types && !available.length)
    return (
      <SheetBody>
        <p className="text-sm text-muted-foreground">{t('createFrom.noSources')}</p>
      </SheetBody>
    );

  return (
    <>
      <SheetBody className="space-y-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-[12rem_minmax(0,1fr)]">
          <div className="grid gap-2">
            <Label htmlFor={ids.type}>{t('createFrom.type')}</Label>
            <Select
              value={current ?? undefined}
              onValueChange={(v) => {
                setType(v as SourceType);
                setPicked([]);
              }}
            >
              <SelectTrigger id={ids.type} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {available.map((s) => (
                  <SelectItem key={s} value={s}>
                    {t(`createFrom.types.${s.replace('.', '_') as 'cmdb_ci'}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid min-w-0 gap-2">
            <span className="text-sm font-medium" aria-hidden>
              {tc('search')}
            </span>
            <SearchInput value={q} onChange={setQ} placeholder={t('createFrom.search')} />
          </div>
        </div>
        <fieldset className="min-w-0">
          <legend className="mb-2 text-sm font-medium">
            {t('createFrom.records', { count: picked.length })}
          </legend>
          {isLoading ? (
            <Skeleton className="h-32 w-full" />
          ) : !data?.items.length ? (
            <p className="text-sm text-muted-foreground">{t('createFrom.none')}</p>
          ) : (
            <ul className="max-h-72 divide-y overflow-y-auto rounded-md border">
              {data.items.map((r) => {
                const id = `pick-${r.ref}`;
                return (
                  <li key={r.ref} className="flex min-w-0 items-start gap-3 px-3 py-2 text-sm">
                    <Checkbox
                      id={id}
                      disabled={Boolean(r.registered)}
                      checked={picked.includes(r.ref)}
                      onCheckedChange={(v) =>
                        setPicked((p) => (v ? [...p, r.ref] : p.filter((x) => x !== r.ref)))
                      }
                      className="mt-0.5"
                    />
                    <label htmlFor={id} className="min-w-0 flex-1">
                      <span className="block truncate font-medium">
                        {r.reference && (
                          <span className="font-mono text-xs text-muted-foreground">{r.reference} </span>
                        )}
                        {r.title}
                      </span>
                      {r.subtitle && (
                        <span className="block truncate text-xs text-muted-foreground">{r.subtitle}</span>
                      )}
                    </label>
                    {r.registered && (
                      <Link href={assetHref(r.registered.number)} className="shrink-0 text-xs underline">
                        {t('createFrom.registered', { number: r.registered.number })}
                      </Link>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </fieldset>
        <fieldset className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <legend className="mb-2 text-sm font-medium">{t('createFrom.defaults')}</legend>
          <div className="grid gap-2">
            <Label htmlFor={ids.cls}>{t('fields.class')}</Label>
            <Select
              value={classId || undefined}
              onValueChange={(v) => {
                setClassId(v);
                setSubclassId(NONE);
              }}
            >
              <SelectTrigger id={ids.cls} className="w-full">
                <SelectValue placeholder={t('assetForm.choose')} />
              </SelectTrigger>
              <SelectContent>
                {(taxonomy?.classes ?? []).map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.code} · {localized(c.name)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor={ids.sub}>{t('fields.subclass')}</Label>
            <Select value={subclassId} onValueChange={setSubclassId}>
              <SelectTrigger id={ids.sub} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>{t('assetForm.noSubclass')}</SelectItem>
                {(klass?.subclasses ?? []).map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {localized(s.name)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor={ids.site}>{t('fields.site')}</Label>
            <Select value={siteId || undefined} onValueChange={setSiteId}>
              <SelectTrigger id={ids.site} className="w-full">
                <SelectValue placeholder={t('assetForm.choose')} />
              </SelectTrigger>
              <SelectContent>
                {(taxonomy?.sites ?? []).map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.code} · {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor={ids.label}>{t('fields.classification')}</Label>
            <Select value={labelId} onValueChange={setLabelId}>
              <SelectTrigger id={ids.label} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>{t('assetForm.noClassification')}</SelectItem>
                {(taxonomy?.labels ?? []).map((l) => (
                  <SelectItem key={l.id} value={l.id}>
                    {localized(l.name)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2 sm:col-span-2">
            <Label htmlFor={ids.manager}>{t('fields.manager')}</Label>
            <PersonField
              id={ids.manager}
              value={managerId}
              onChange={setManagerId}
              placeholder={t('assetForm.managerPlaceholder')}
            />
          </div>
          <div className="grid grid-cols-3 gap-3 sm:col-span-2">
            {(
              [
                ['confidentiality', ids.c],
                ['integrity', ids.i],
                ['availability', ids.a],
              ] as const
            ).map(([k, id]) => (
              <div key={k} className="grid min-w-0 gap-2">
                <Label htmlFor={id} className="truncate">
                  {t(`fields.${k}`)}
                </Label>
                <LevelSelect
                  id={id}
                  value={cia[k]}
                  placeholder={t('assetForm.notScored')}
                  onChange={(v) => setCia((c) => ({ ...c, [k]: v }))}
                />
              </div>
            ))}
          </div>
        </fieldset>
        <div role="status" aria-live="polite">
          {result && (
            <p className="text-sm">
              {t('createFrom.done', { created: result.created.length, skipped: result.skipped.length })}
            </p>
          )}
        </div>
        {error && (
          <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}
      </SheetBody>
      <SheetFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          {tc('close')}
        </Button>
        <Button type="button" disabled={!picked.length} loading={save.isPending} onClick={submit}>
          {t('createFrom.submit', { count: picked.length })}
        </Button>
      </SheetFooter>
    </>
  );
}
