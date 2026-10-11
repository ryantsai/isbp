'use client';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { CheckboxList, CheckboxListItem } from '@astryxdesign/core/CheckboxList';
import { Field } from '@astryxdesign/core/Field';
import { FormLayout } from '@astryxdesign/core/FormLayout';
import { Grid } from '@astryxdesign/core/Grid';
import { VStack } from '@astryxdesign/core/Layout';
import { Link } from '@astryxdesign/core/Link';
import { Selector } from '@astryxdesign/core/Selector';
import { Text } from '@astryxdesign/core/Text';
import { useApiMutation, useApiQuery, useErrorText } from '@isbp/ui/query';
import { SearchInput } from '@isbp/ui/search-input';
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
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: number | null;
  onChange: (v: number) => void;
  placeholder: string;
}) {
  return (
    <Selector
      label={label}
      isRequired
      placeholder={placeholder}
      value={value === null ? undefined : String(value)}
      onChange={(v) => onChange(Number(v))}
      options={CIA_LEVELS.map((l) => String(l))}
    />
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
  const managerFieldId = useId();
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
        <Text as="p" color="secondary">
          {t('createFrom.noSources')}
        </Text>
      </SheetBody>
    );

  return (
    <>
      <SheetBody className="py-2">
        <VStack gap={5}>
          <div className="grid grid-cols-1 items-end gap-4 sm:grid-cols-[12rem_minmax(0,1fr)]">
            <Selector
              label={t('createFrom.type')}
              value={current ?? undefined}
              onChange={(v) => {
                setType(v as SourceType);
                setPicked([]);
              }}
              options={available.map((s) => ({
                value: s,
                label: t(`createFrom.types.${s.replace('.', '_') as 'cmdb_ci'}`),
              }))}
            />
            <div className="min-w-0">
              <SearchInput value={q} onChange={setQ} placeholder={t('createFrom.search')} />
            </div>
          </div>
          {isLoading ? (
            <Skeleton className="h-32 w-full" />
          ) : !data?.items.length ? (
            <Text as="p" color="secondary">
              {t('createFrom.none')}
            </Text>
          ) : (
            <div className="max-h-72 min-w-0 overflow-y-auto">
              <CheckboxList
                label={t('createFrom.records', { count: picked.length })}
                value={picked}
                onChange={setPicked}
                hasDividers
              >
                {data.items.map((r) => (
                  <CheckboxListItem
                    key={r.ref}
                    value={r.ref}
                    isDisabled={Boolean(r.registered)}
                    label={r.reference ? `${r.reference} ${r.title}` : r.title}
                    description={r.subtitle ?? undefined}
                    endContent={
                      r.registered ? (
                        <Link href={assetHref(r.registered.number)}>
                          {t('createFrom.registered', { number: r.registered.number })}
                        </Link>
                      ) : undefined
                    }
                  />
                ))}
              </CheckboxList>
            </div>
          )}
          <VStack gap={3}>
            <Text type="label">{t('createFrom.defaults')}</Text>
            <FormLayout defaultOptionality="optional">
              <Grid columns={{ minWidth: 240 }} gap={4}>
                <Selector
                  label={t('fields.class')}
                  hasSearch
                  placeholder={t('assetForm.choose')}
                  value={classId || undefined}
                  onChange={(v) => {
                    setClassId(v);
                    setSubclassId(NONE);
                  }}
                  options={(taxonomy?.classes ?? []).map((c) => ({
                    value: c.id,
                    label: `${c.code} · ${localized(c.name)}`,
                  }))}
                />
                <Selector
                  label={t('fields.subclass')}
                  value={subclassId}
                  onChange={setSubclassId}
                  options={[
                    { value: NONE, label: t('assetForm.noSubclass') },
                    ...(klass?.subclasses ?? []).map((s) => ({ value: s.id, label: localized(s.name) })),
                  ]}
                />
                <Selector
                  label={t('fields.site')}
                  isRequired
                  placeholder={t('assetForm.choose')}
                  value={siteId || undefined}
                  onChange={setSiteId}
                  options={(taxonomy?.sites ?? []).map((s) => ({
                    value: s.id,
                    label: `${s.code} · ${s.name}`,
                  }))}
                />
                <Selector
                  label={t('fields.classification')}
                  value={labelId}
                  onChange={setLabelId}
                  options={[
                    { value: NONE, label: t('assetForm.noClassification') },
                    ...(taxonomy?.labels ?? []).map((l) => ({ value: l.id, label: localized(l.name) })),
                  ]}
                />
              </Grid>
              <Field label={t('fields.manager')} inputID={managerFieldId}>
                <PersonField
                  id={managerFieldId}
                  value={managerId}
                  onChange={setManagerId}
                  placeholder={t('assetForm.managerPlaceholder')}
                />
              </Field>
              <Grid columns={{ minWidth: 168 }} gap={3}>
                {(['confidentiality', 'integrity', 'availability'] as const).map((k) => (
                  <LevelSelect
                    key={k}
                    label={t(`fields.${k}`)}
                    value={cia[k]}
                    placeholder={t('assetForm.notScored')}
                    onChange={(v) => setCia((c) => ({ ...c, [k]: v }))}
                  />
                ))}
              </Grid>
            </FormLayout>
          </VStack>
          <div role="status" aria-live="polite">
            {result && (
              <Text as="p">
                {t('createFrom.done', { created: result.created.length, skipped: result.skipped.length })}
              </Text>
            )}
          </div>
          {error && <Banner status="error" title={error} collapsible={false} />}
        </VStack>
      </SheetBody>
      <SheetFooter>
        <Button label={tc('close')} variant="secondary" type="button" onClick={onDone} />
        <Button
          label={t('createFrom.submit', { count: picked.length })}
          variant="primary"
          isLoading={save.isPending}
          isDisabled={!picked.length}
          type="button"
          onClick={submit}
        />
      </SheetFooter>
    </>
  );
}
