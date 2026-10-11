'use client';

import { Button } from '@astryxdesign/core/Button';
import { Field } from '@astryxdesign/core/Field';
import { Icon } from '@astryxdesign/core/Icon';
import { HStack, StackItem, VStack } from '@astryxdesign/core/Layout';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import { FormField, fieldStatus } from '@isbp/ui/form';
import { CircleXIcon, KeyRoundIcon, TriangleAlertIcon, Undo2Icon } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useTranslations } from 'next-intl';
import { type ReactNode, useId } from 'react';
import { useFormContext, useWatch } from 'react-hook-form';
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
  const id = useId();
  const form = useFormContext<ModelsValues>();
  const mode = useWatch({ control: form.control, name: `${section}.keyMode` });

  const setMode = (next: KeyMode) => {
    form.setValue(`${section}.keyMode`, next, { shouldDirty: true });
    form.setValue(`${section}.apiKey`, '', { shouldDirty: true });
    form.clearErrors(`${section}.apiKey`);
  };

  // The stored-key rows are not an input, so they get the same label / hint frame from `Field`.
  const frame = (row: ReactNode) => (
    <Field
      label={t('label')}
      inputID={`${id}-row`}
      labelID={`${id}-label`}
      isGroupLabel
      isOptional={optional}
      description={t('hint')}
    >
      <div id={`${id}-row`} role="group" aria-labelledby={`${id}-label`}>
        {row}
      </div>
    </Field>
  );

  return (
    <VStack gap={2}>
      <AnimatePresence mode="wait" initial={false}>
        {mode === 'keep' ? (
          <motion.div key="keep" {...fade}>
            {frame(
              <HStack gap={2} vAlign="center" wrap="wrap">
                <Icon icon={KeyRoundIcon} color="success" />
                <StackItem size="fill">
                  <Text>{t('stored')}</Text>
                </StackItem>
                <Button
                  label={t('replace')}
                  variant="ghost"
                  size="sm"
                  type="button"
                  onClick={() => setMode('replace')}
                />
                <Button
                  label={t('remove')}
                  variant="ghost"
                  size="sm"
                  type="button"
                  onClick={() => setMode('remove')}
                />
              </HStack>,
            )}
          </motion.div>
        ) : mode === 'remove' ? (
          <motion.div key="remove" {...fade}>
            {frame(
              <HStack gap={2} vAlign="center">
                <Icon icon={CircleXIcon} color="error" />
                <StackItem size="fill">
                  <Text>{t('willRemove')}</Text>
                </StackItem>
                <Button
                  label={t('undo')}
                  variant="ghost"
                  size="sm"
                  icon={<Icon icon={Undo2Icon} />}
                  type="button"
                  onClick={() => setMode('keep')}
                />
              </HStack>,
            )}
          </motion.div>
        ) : (
          <motion.div key="replace" {...fade}>
            <VStack gap={1}>
              <FormField
                control={form.control}
                name={`${section}.apiKey`}
                render={({ field, fieldState }) => (
                  <TextInput
                    type="password"
                    autoComplete="new-password"
                    label={t('label')}
                    isOptional={optional}
                    description={t('hint')}
                    placeholder={stored ? t('newPlaceholder') : undefined}
                    value={field.value}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                    status={
                      fieldStatus(fieldState) ?? (notice ? { type: 'warning', message: notice } : undefined)
                    }
                  />
                )}
              />
              {stored && !notice && (
                <div>
                  <Button
                    label={t('keep')}
                    variant="ghost"
                    size="sm"
                    type="button"
                    onClick={() => setMode('keep')}
                  />
                </div>
              )}
            </VStack>
          </motion.div>
        )}
      </AnimatePresence>
      {notice && mode !== 'replace' && (
        <HStack gap={1.5} vAlign="start">
          <Icon icon={TriangleAlertIcon} color="warning" />
          <Text type="supporting">{notice}</Text>
        </HStack>
      )}
    </VStack>
  );
}
