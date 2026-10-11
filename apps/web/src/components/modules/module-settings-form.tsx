'use client';

import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { FormLayout } from '@astryxdesign/core/FormLayout';
import { Selector } from '@astryxdesign/core/Selector';
import { Switch } from '@astryxdesign/core/Switch';
import { TextArea } from '@astryxdesign/core/TextArea';
import { TextInput } from '@astryxdesign/core/TextInput';
import type { ModuleInfo } from '@isbp/contracts';
import { useCan } from '@isbp/sdk/web';
import { Form, FormField, fieldStatus } from '@isbp/ui/form';
import { OptionalFields } from '@isbp/ui/optional-fields';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { type FieldProblem, problemResolver } from '@/components/idp/contract-resolver';
import { applyServerErrors, useApiMutation, useErrorText } from '@/lib/api';
import { useManifestText } from './use-manifest-text';

type Setting = ModuleInfo['settings'][number];
type Values = Record<string, string | boolean>;

/** Setting keys contain dots, which React Hook Form treats as nesting — use positional field names. */
const fieldOf = (i: number) => `s${i}`;
const MAX_LENGTH: Record<string, number> = { string: 2000, text: 20000, secret: 2000 };

function initial(s: Setting): string | boolean {
  if (s.type === 'boolean') return s.value === true;
  if (s.type === 'secret' || s.value === null || s.value === undefined) return '';
  return String(s.value);
}

/**
 * Settings form generated from the manifest definitions. Only changed keys are sent; secrets are
 * write-only (the API returns a mask and keeps the stored value unless a new one is typed).
 */
export function ModuleSettingsForm({ module: m }: { module: ModuleInfo }) {
  const t = useTranslations('modules.settings');
  const tv = useTranslations('modules.validation');
  const tc = useTranslations('common');
  const text = useManifestText();
  const errorText = useErrorText();
  const canManage = useCan('core.modules.manage');
  const [advanced, setAdvanced] = useState(false);

  const defaults = useMemo<Values>(
    () => Object.fromEntries(m.settings.map((s, i) => [fieldOf(i), initial(s)])),
    [m.settings],
  );

  const form = useForm<Values>({
    defaultValues: defaults,
    resolver: problemResolver<Values>((values) => {
      const problems: FieldProblem[] = [];
      m.settings.forEach((s, i) => {
        const v = values[fieldOf(i)];
        if (typeof v !== 'string' || v === '') return;
        if (s.type === 'number' && !Number.isFinite(Number(v)))
          problems.push({ path: fieldOf(i), message: tv('number') });
        const max = MAX_LENGTH[s.type];
        if (max && v.length > max) problems.push({ path: fieldOf(i), message: tv('tooLong', { max }) });
      });
      return problems;
    }),
  });

  // Refetches (e.g. after toggling) refresh untouched fields without discarding edits in progress.
  useEffect(() => {
    form.reset(defaults, { keepDirtyValues: true });
  }, [defaults, form]);

  const save = useApiMutation(
    (api, values: Record<string, unknown>) => api.put<ModuleInfo>(`/modules/${m.id}/settings`, { values }),
    {
      invalidate: ['/modules'],
      success: t('saved'),
      silent: true,
    },
  );

  const onSubmit = form.handleSubmit(
    async (values) => {
      const dirty = form.formState.dirtyFields as Record<string, boolean | undefined>;
      const changed: Record<string, unknown> = {};
      m.settings.forEach((s, i) => {
        const name = fieldOf(i);
        if (!dirty[name]) return;
        const v = values[name];
        if (s.type === 'secret' && v === '') return;
        changed[s.key] = s.type === 'number' ? (v === '' ? null : Number(v)) : v;
      });
      if (!Object.keys(changed).length) return;
      try {
        const updated = await save.mutateAsync(changed);
        form.reset(Object.fromEntries(updated.settings.map((s, i) => [fieldOf(i), initial(s)])));
      } catch (err) {
        if (!applyServerErrors(err, form.setError as never))
          form.setError('root', { message: errorText(err) });
      }
    },
    (errors) => {
      if (m.settings.some((s, i) => s.advanced && errors[fieldOf(i)])) setAdvanced(true);
    },
  );

  const basic = m.settings.map((s, i) => ({ s, i })).filter(({ s }) => !s.advanced);
  const extra = m.settings.map((s, i) => ({ s, i })).filter(({ s }) => s.advanced);

  const renderField = ({ s, i }: { s: Setting; i: number }) => {
    const label = text(s.label);
    const description = s.description ? text(s.description) : undefined;
    const stored = s.type === 'secret' && Boolean(s.value);
    return (
      <FormField
        key={s.key}
        control={form.control}
        name={fieldOf(i)}
        render={({ field, fieldState }) => {
          if (s.type === 'boolean')
            return (
              <Switch
                label={label}
                description={description}
                value={field.value === true}
                onChange={field.onChange}
                isDisabled={!canManage}
              />
            );
          if (s.type === 'select')
            return (
              <Selector
                label={label}
                description={description}
                placeholder={t('choose')}
                value={String(field.value) || undefined}
                options={(s.options ?? []).map((o) => ({ value: o.value, label: text(o.label) }))}
                onChange={field.onChange}
                isDisabled={!canManage}
                status={fieldStatus(fieldState)}
              />
            );
          const hint =
            [description, stored ? `${t('stored')}. ${t('secretKeep')}` : null].filter(Boolean).join(' ') ||
            undefined;
          if (s.type === 'text')
            return (
              <TextArea
                label={label}
                description={hint}
                rows={4}
                value={String(field.value)}
                onChange={field.onChange}
                onBlur={field.onBlur}
                ref={field.ref}
                isDisabled={!canManage}
                status={fieldStatus(fieldState)}
              />
            );
          return (
            <TextInput
              label={label}
              description={hint}
              type={s.type === 'secret' ? 'password' : 'text'}
              value={String(field.value)}
              onChange={field.onChange}
              onBlur={field.onBlur}
              ref={field.ref}
              isDisabled={!canManage}
              autoComplete={s.type === 'secret' ? 'new-password' : 'off'}
              placeholder={s.type === 'secret' ? (stored ? '••••••••' : t('secretEmpty')) : undefined}
              status={fieldStatus(fieldState)}
            />
          );
        }}
      />
    );
  };

  return (
    <Form {...form}>
      <form onSubmit={onSubmit} noValidate>
        <FormLayout defaultOptionality="optional">
          {!canManage && <Banner status="info" title={t('readOnly')} collapsible={false} />}
          {basic.map(renderField)}
          {extra.length > 0 && (
            <OptionalFields
              label={t('showAdvanced', { count: extra.length })}
              open={advanced}
              onOpenChange={setAdvanced}
            >
              <FormLayout defaultOptionality="optional">{extra.map(renderField)}</FormLayout>
            </OptionalFields>
          )}
          {form.formState.errors.root && (
            <Banner status="error" title={form.formState.errors.root.message ?? ''} collapsible={false} />
          )}
        </FormLayout>
        {canManage && (
          <div className="sticky bottom-0 -mx-5 mt-5 flex justify-end gap-2 border-t bg-background/95 px-5 py-3 backdrop-blur">
            <Button
              label={t('discard')}
              variant="ghost"
              isDisabled={!form.formState.isDirty || save.isPending}
              type="button"
              onClick={() => form.reset(defaults)}
            />
            <Button
              label={tc('saveChanges')}
              variant="primary"
              isLoading={save.isPending}
              isDisabled={!form.formState.isDirty}
              type="submit"
            />
          </div>
        )}
      </form>
    </Form>
  );
}
