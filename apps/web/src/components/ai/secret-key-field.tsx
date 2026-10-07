'use client';

import { Button } from '@isbp/ui/button';
import { FormField } from '@isbp/ui/form';
import { Input } from '@isbp/ui/input';
import { Label } from '@isbp/ui/label';
import { CircleXIcon, KeyRoundIcon, TriangleAlertIcon, Undo2Icon } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useTranslations } from 'next-intl';
import { useId } from 'react';
import { useFormContext, useFormState, useWatch } from 'react-hook-form';
import type { KeyMode, ModelsValues, Section } from './models-schema';

const fade = { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } };

/**
 * A stored secret is never shown: the field offers keep / replace / remove. `notice` explains when the
 * stored key may not fit the new provider or address.
 */
export function SecretKeyField({
  section,
  stored,
  optional,
  notice,
}: {
  section: Section;
  stored: boolean;
  optional?: boolean;
  notice?: string | null;
}) {
  const t = useTranslations('ai.models.key');
  const tc = useTranslations('common');
  const id = useId();
  const form = useFormContext<ModelsValues>();
  const mode = useWatch({ control: form.control, name: `${section}.keyMode` });
  const { errors } = useFormState({ control: form.control, name: `${section}.apiKey` });
  const error = errors[section]?.apiKey?.message;
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;

  const setMode = (next: KeyMode) => {
    form.setValue(`${section}.keyMode`, next, { shouldDirty: true });
    form.setValue(`${section}.apiKey`, '', { shouldDirty: true });
    form.clearErrors(`${section}.apiKey`);
  };

  return (
    <div className="grid content-start gap-2">
      <Label htmlFor={id} data-error={Boolean(error)} className="data-[error=true]:text-destructive">
        {t('label')}
        {optional && <span className="font-normal text-muted-foreground">({tc('optional')})</span>}
      </Label>
      <AnimatePresence mode="wait" initial={false}>
        {mode === 'keep' ? (
          <motion.div
            key="keep"
            {...fade}
            className="flex min-h-9 flex-wrap items-center gap-x-2 gap-y-1 rounded-md border bg-muted/30 px-3 py-1.5"
          >
            <KeyRoundIcon className="size-4 text-success" aria-hidden />
            <span id={id} className="flex-1 text-sm">
              {t('stored')}
            </span>
            <Button
              type="button"
              variant="link"
              size="sm"
              className="h-auto px-0"
              onClick={() => setMode('replace')}
            >
              {t('replace')}
            </Button>
            <Button
              type="button"
              variant="link"
              size="sm"
              className="h-auto px-0 text-destructive"
              onClick={() => setMode('remove')}
            >
              {t('remove')}
            </Button>
          </motion.div>
        ) : mode === 'remove' ? (
          <motion.div
            key="remove"
            {...fade}
            className="flex min-h-9 items-center gap-2 rounded-md border border-dashed px-3 py-1.5"
          >
            <CircleXIcon className="size-4 shrink-0 text-destructive" aria-hidden />
            <span id={id} className="flex-1 text-sm">
              {t('willRemove')}
            </span>
            <Button type="button" variant="ghost" size="sm" onClick={() => setMode('keep')}>
              <Undo2Icon /> {t('undo')}
            </Button>
          </motion.div>
        ) : (
          <motion.div key="replace" {...fade}>
            <FormField
              control={form.control}
              name={`${section}.apiKey`}
              render={({ field }) => (
                <Input
                  id={id}
                  type="password"
                  autoComplete="new-password"
                  spellCheck={false}
                  placeholder={stored ? t('newPlaceholder') : undefined}
                  aria-invalid={Boolean(error)}
                  aria-describedby={error ? `${hintId} ${errorId}` : hintId}
                  {...field}
                />
              )}
            />
            {stored && !notice && (
              <Button
                type="button"
                variant="link"
                size="sm"
                className="h-auto px-0 pt-1.5"
                onClick={() => setMode('keep')}
              >
                {t('keep')}
              </Button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
      {notice && (
        <p className="flex items-start gap-1.5 text-xs text-warning-foreground">
          <TriangleAlertIcon className="mt-px size-3.5 shrink-0" aria-hidden />
          {notice}
        </p>
      )}
      {error && (
        <p id={errorId} className="text-xs text-destructive">
          {error}
        </p>
      )}
      <p id={hintId} className="text-xs text-muted-foreground">
        {t('hint')}
      </p>
    </div>
  );
}
