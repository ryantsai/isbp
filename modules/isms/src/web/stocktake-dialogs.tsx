'use client';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { CheckboxList, CheckboxListItem } from '@astryxdesign/core/CheckboxList';
import { DateInput } from '@astryxdesign/core/DateInput';
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import { Divider } from '@astryxdesign/core/Divider';
import { Field } from '@astryxdesign/core/Field';
import { FormLayout } from '@astryxdesign/core/FormLayout';
import { Grid, GridSpan } from '@astryxdesign/core/Grid';
import { HStack, Layout, LayoutContent, LayoutFooter, VStack } from '@astryxdesign/core/Layout';
import { MetadataList, MetadataListItem } from '@astryxdesign/core/MetadataList';
import { NumberInput } from '@astryxdesign/core/NumberInput';
import { RadioList, RadioListItem } from '@astryxdesign/core/RadioList';
import { Selector } from '@astryxdesign/core/Selector';
import { Text } from '@astryxdesign/core/Text';
import { TextArea } from '@astryxdesign/core/TextArea';
import { TextInput } from '@astryxdesign/core/TextInput';
import { Collapse } from '@isbp/ui/motion';
import { countFilled, OptionalFields, useFieldList } from '@isbp/ui/optional-fields';
import { useApiMutation, useErrorText } from '@isbp/ui/query';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetForm,
  SheetHeader,
  SheetTitle,
} from '@isbp/ui/sheet';
import { useTimeZone, useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import {
  type CreateStocktakeInput,
  RECURRENCES,
  type RecordItemInput,
  STOCKTAKE_EDITABLE,
  type Stocktake,
  type StocktakeItem,
} from '../contracts';
import { asDay, INVALIDATE, todayLocal, useGroups, useLocalized, useTaxonomy } from './lib';
import { PeoplePicker } from './people';

type Editable = (typeof STOCKTAKE_EDITABLE)[number];

const DIFFERENT = ['changed', 'missing', 'disposed'] as const;
type Different = (typeof DIFFERENT)[number];

/**
 * "Something's different": shows what the register says, then asks what is different — details changed (correct
 * them), missing or disposed of (with a note). Nothing is pre-selected. Confirming an item is the inline "It's right".
 */
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
  return (
    <Dialog
      isOpen={Boolean(item)}
      onOpenChange={onOpenChange}
      width={576}
      purpose="form"
      aria-label={item ? t('record.title', { name: item.snapshot.name }) : undefined}
    >
      {item && (
        <RecordForm key={item.id} stocktake={stocktake} item={item} onDone={() => onOpenChange(false)} />
      )}
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
  const [result, setResult] = useState<Different | null>(
    item.result && item.result !== 'confirmed' ? item.result : null,
  );
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
  const register: [string, string | number | null][] = [
    [t('fields.location'), snap.location],
    [t('fields.quantity'), snap.quantity],
    [t('fields.users'), snap.usersText],
    [t('fields.brand'), snap.brand],
    [t('fields.model'), snap.model],
    [t('fields.version'), snap.version],
    [t('fields.manager'), item.assignee?.displayName ?? item.assigneeGroup?.name ?? null],
  ];
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!result) return setError(t('record.chooseWhat'));
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
    <Layout
      header={
        <DialogHeader
          title={t('record.title', { name: item.snapshot.name })}
          subtitle={item.snapshot.number}
          onOpenChange={(o) => !o && onDone()}
        />
      }
      content={
        <LayoutContent padding={4}>
          <form id={`${name}-form`} onSubmit={submit} noValidate>
            <VStack gap={4}>
              <MetadataList title={<Text weight="medium">{t('record.registerSays')}</Text>} columns={2}>
                {register
                  .filter(([, v]) => v !== null && v !== '')
                  .map(([k, v]) => (
                    <MetadataListItem key={k} label={k}>
                      {v}
                    </MetadataListItem>
                  ))}
              </MetadataList>
              <Divider />
              <RadioList
                label={t('record.whatsDifferent')}
                value={result ?? ''}
                onChange={(v) => setResult(v as Different)}
              >
                {DIFFERENT.map((r) => (
                  <RadioListItem
                    key={r}
                    value={r}
                    label={t(`record.choices.${r}`)}
                    description={t(`record.hints.${r}`)}
                  />
                ))}
              </RadioList>
              <Collapse open={result === 'changed'} id={`${name}-corrections`}>
                <VStack gap={3}>
                  <Text type="label">{t('record.corrections')}</Text>
                  <FormLayout defaultOptionality="optional">
                    <Grid columns={{ minWidth: 200 }} gap={3}>
                      {STOCKTAKE_EDITABLE.map((k) =>
                        k === 'quantity' ? (
                          <NumberInput
                            key={k}
                            label={t(`fields.${k}`)}
                            isIntegerOnly
                            min={0}
                            value={values.quantity === '' ? null : Number(values.quantity)}
                            onChange={(n) => setValues((v) => ({ ...v, quantity: String(n) }))}
                          />
                        ) : (
                          <TextInput
                            key={k}
                            label={t(`fields.${k}`)}
                            value={values[k]}
                            onChange={(value) => setValues((v) => ({ ...v, [k]: value }))}
                          />
                        ),
                      )}
                    </Grid>
                  </FormLayout>
                </VStack>
              </Collapse>
              <TextArea
                label={
                  result === 'missing' || result === 'disposed' ? t('record.noteNeeded') : t('record.note')
                }
                rows={2}
                value={note}
                onChange={setNote}
              />
              {error && <Banner status="error" title={error} collapsible={false} />}
            </VStack>
          </form>
        </LayoutContent>
      }
      footer={
        <LayoutFooter hasDivider padding={3}>
          <HStack gap={2} hAlign="end">
            <Button label={tc('cancel')} variant="ghost" onClick={onDone} />
            <Button
              label={t('record.submit')}
              variant="primary"
              isLoading={save.isPending}
              type="submit"
              form={`${name}-form`}
            />
          </HStack>
        </LayoutFooter>
      }
    />
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
  return (
    <div className="max-h-56 min-w-0 overflow-y-auto">
      <CheckboxList label={legend} value={value} onChange={onChange} density="compact">
        {items.map((i) => (
          <CheckboxListItem key={i.id} value={i.id} label={i.label} />
        ))}
      </CheckboxList>
    </div>
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
  const managersId = useId();
  const list = useFieldList();
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
  const detailsFilled = countFilled(
    recurrence === 'none' ? '' : recurrence,
    classIds,
    siteIds,
    managerIds,
    managerGroupIds,
  );
  return (
    <SheetForm onSubmit={submit} noValidate>
      <SheetBody className="py-2">
        <FormLayout defaultOptionality="optional">
          <TextInput
            label={t('fields.stocktakeName')}
            isRequired
            value={name}
            onChange={(value) => setName(value.slice(0, 200))}
          />
          <Grid columns={{ minWidth: 200 }} gap={4}>
            <DateInput
              label={t('fields.startOn')}
              min={asDay(today)}
              value={asDay(startOn)}
              onChange={(d) => setStartOn(d ?? '')}
            />
            <DateInput
              label={t('fields.dueOn')}
              isRequired
              min={asDay(startOn || today)}
              value={asDay(dueOn)}
              onChange={(d) => setDueOn(d ?? '')}
            />
          </Grid>
          <OptionalFields
            hint={list([
              t('fields.recurrence'),
              t('fields.class'),
              t('fields.site'),
              t('newStocktake.managers'),
              t('fields.managerGroup'),
            ])}
            filled={detailsFilled}
          >
            <FormLayout defaultOptionality="optional">
              <Selector
                label={t('fields.recurrence')}
                value={recurrence}
                onChange={(v) => setRecurrence(v as typeof recurrence)}
                options={RECURRENCES.map((r) => ({ value: r, label: t(`recurrence.${r}`) }))}
              />
              <Text as="p" color="secondary">
                {t('newStocktake.scopeHint')}
              </Text>
              <Grid columns={{ minWidth: 220 }} gap={4}>
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
                <GridSpan columns="full">
                  <Field label={t('newStocktake.managers')} inputID={managersId}>
                    <PeoplePicker
                      id={managersId}
                      value={managerIds}
                      onChange={setManagerIds}
                      addLabel={t('newStocktake.addManager')}
                    />
                  </Field>
                </GridSpan>
                <CheckList
                  legend={t('fields.managerGroup')}
                  items={(groups?.items ?? []).map((g) => ({ id: g.id, label: g.name }))}
                  value={managerGroupIds}
                  onChange={setManagerGroupIds}
                />
              </Grid>
            </FormLayout>
          </OptionalFields>
          {error && <Banner status="error" title={error} collapsible={false} />}
        </FormLayout>
      </SheetBody>
      <SheetFooter>
        <Button label={tc('cancel')} variant="secondary" type="button" onClick={onCancel} />
        <Button
          label={startOn > today ? t('newStocktake.schedule') : t('newStocktake.start')}
          variant="primary"
          isLoading={save.isPending}
          type="submit"
        />
      </SheetFooter>
    </SheetForm>
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
  const [note, setNote] = useState('');
  return (
    <Dialog isOpen={open} onOpenChange={onOpenChange} width={448} purpose="form">
      <Layout
        header={<DialogHeader title={title} subtitle={description} onOpenChange={onOpenChange} />}
        content={
          <LayoutContent padding={4}>
            <TextArea label={t('note')} rows={3} value={note} onChange={setNote} />
          </LayoutContent>
        }
        footer={
          <LayoutFooter hasDivider padding={3}>
            <HStack gap={2} hAlign="end">
              <Button label={tc('cancel')} variant="ghost" onClick={() => onOpenChange(false)} />
              <Button
                label={t('confirm')}
                variant="primary"
                isLoading={pending}
                onClick={() => onConfirm(note.trim() || null)}
              />
            </HStack>
          </LayoutFooter>
        }
      />
    </Dialog>
  );
}
