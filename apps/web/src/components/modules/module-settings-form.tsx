'use client';

import type { ModuleInfo } from '@isbp/contracts';
import { useCan } from '@isbp/sdk/web';
import { Badge } from '@isbp/ui/badge';
import { Button } from '@isbp/ui/button';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@isbp/ui/form';
import { Input } from '@isbp/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@isbp/ui/select';
import { Switch } from '@isbp/ui/switch';
import { Textarea } from '@isbp/ui/textarea';
import { ChevronDownIcon, LockIcon } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
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
    const description = s.description ? text(s.description) : null;
    const stored = s.type === 'secret' && Boolean(s.value);
    return (
      <FormField
        key={s.key}
        control={form.control}
        name={fieldOf(i)}
        render={({ field }) =>
          s.type === 'boolean' ? (
            <FormItem className="flex flex-row items-start justify-between gap-4 rounded-lg border p-3">
              <div className="space-y-1">
                <FormLabel>{label}</FormLabel>
                {description && <FormDescription>{description}</FormDescription>}
              </div>
              <FormControl>
                <Switch
                  checked={field.value === true}
                  onCheckedChange={field.onChange}
                  disabled={!canManage}
                />
              </FormControl>
            </FormItem>
          ) : (
            <FormItem>
              <FormLabel>
                {label}
                {stored && (
                  <Badge variant="muted" className="font-normal">
                    <LockIcon aria-hidden /> {t('stored')}
                  </Badge>
                )}
              </FormLabel>
              {s.type === 'select' ? (
                <Select value={String(field.value)} onValueChange={field.onChange} disabled={!canManage}>
                  <FormControl>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder={t('choose')} />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {(s.options ?? []).map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {text(o.label)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <FormControl>
                  {s.type === 'text' ? (
                    <Textarea {...field} value={String(field.value)} disabled={!canManage} rows={4} />
                  ) : (
                    <Input
                      {...field}
                      value={String(field.value)}
                      disabled={!canManage}
                      type={s.type === 'secret' ? 'password' : s.type === 'number' ? 'number' : 'text'}
                      inputMode={s.type === 'number' ? 'decimal' : undefined}
                      autoComplete={s.type === 'secret' ? 'new-password' : 'off'}
                      placeholder={s.type === 'secret' ? (stored ? '••••••••' : t('secretEmpty')) : undefined}
                    />
                  )}
                </FormControl>
              )}
              {(description || stored) && (
                <FormDescription>
                  {[description, stored ? t('secretKeep') : null].filter(Boolean).join(' ')}
                </FormDescription>
              )}
              <FormMessage />
            </FormItem>
          )
        }
      />
    );
  };

  return (
    <Form {...form}>
      <form onSubmit={onSubmit} noValidate className="space-y-5">
        {!canManage && (
          <p className="rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">{t('readOnly')}</p>
        )}
        {basic.map(renderField)}
        {extra.length > 0 && (
          <div>
            <button
              type="button"
              onClick={() => setAdvanced((a) => !a)}
              aria-expanded={advanced}
              className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
            >
              <ChevronDownIcon
                className={`size-4 transition-transform duration-200 ${advanced ? 'rotate-180' : ''}`}
              />
              {advanced ? tc('hideAdvanced') : t('showAdvanced', { count: extra.length })}
            </button>
            <AnimatePresence initial={false}>
              {advanced && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden"
                >
                  <div className="space-y-5 pt-4">{extra.map(renderField)}</div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
        {form.formState.errors.root && (
          <p className="text-sm text-destructive">{form.formState.errors.root.message}</p>
        )}
        {canManage && (
          <div className="sticky bottom-0 -mx-5 flex justify-end gap-2 border-t bg-background/95 px-5 py-3 backdrop-blur">
            <Button
              type="button"
              variant="ghost"
              disabled={!form.formState.isDirty || save.isPending}
              onClick={() => form.reset(defaults)}
            >
              {t('discard')}
            </Button>
            <Button type="submit" loading={save.isPending} disabled={!form.formState.isDirty}>
              {tc('saveChanges')}
            </Button>
          </div>
        )}
      </form>
    </Form>
  );
}
