'use client';

import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { CheckboxInput } from '@astryxdesign/core/CheckboxInput';
import { Icon } from '@astryxdesign/core/Icon';
import { IconButton } from '@astryxdesign/core/IconButton';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import { MAX_AI_HEADERS } from '@isbp/contracts';
import { FormField, fieldStatus } from '@isbp/ui/form';
import { KeyRoundIcon, PlusIcon, ShieldAlertIcon, Trash2Icon } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useTranslations } from 'next-intl';
import { useId } from 'react';
import { type FieldValues, type Path, useFieldArray, useFormContext, useWatch } from 'react-hook-form';

/** One header row of a connection form: a stored header keeps its value unless a new one is typed. */
export interface HeaderRow {
  name: string;
  value: string;
  /** Saved before: its value is on the server and never shown. */
  stored: boolean;
}

/** The connection options every AI endpoint has, below its address and key: custom headers and the TLS switch. */
export function ConnectionFields<T extends FieldValues>({ section }: { section: string }) {
  return (
    <VStack gap={5}>
      <HeadersField<T> section={section} />
      <InsecureTlsField<T> section={section} />
    </VStack>
  );
}

function HeadersField<T extends FieldValues>({ section }: { section: string }) {
  const t = useTranslations('ai.models.connection');
  const id = useId();
  const form = useFormContext<T>();
  const name = `${section}.headers` as Path<T>;
  const { fields, append, remove, update } = useFieldArray({ control: form.control, name: name as never });
  const rows = (useWatch({ control: form.control, name }) ?? []) as HeaderRow[];

  return (
    <VStack gap={2}>
      <VStack gap={0.5}>
        <Text id={`${id}-label`} type="label">
          {t('headers')}
        </Text>
        <Text as="p" display="block" type="supporting" color="secondary">
          {t('headersHint')}
        </Text>
      </VStack>
      {fields.length > 0 && (
        // Column labels stay visible at every width: the inputs below hide theirs (R60).
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_2.25rem] gap-2" aria-hidden>
          <Text type="supporting" color="secondary">
            {t('headerName')}
          </Text>
          <Text type="supporting" color="secondary">
            {t('headerValue')}
          </Text>
        </div>
      )}
      <ul className="space-y-2" aria-labelledby={`${id}-label`}>
        <AnimatePresence initial={false}>
          {fields.map((f, i) => {
            const row = rows[i];
            const keepsStored = row?.stored && !row.value;
            return (
              <motion.li
                key={f.id}
                layout
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden motion-reduce:transition-none"
              >
                <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_2.25rem] items-start gap-2">
                  <FormField
                    control={form.control}
                    name={`${name}.${i}.name` as Path<T>}
                    render={({ field, fieldState }) => (
                      <TextInput
                        label={t('headerName')}
                        isLabelHidden
                        placeholder="X-Tenant-Id"
                        autoComplete="off"
                        isReadOnly={row?.stored}
                        value={field.value ?? ''}
                        onChange={field.onChange}
                        onBlur={field.onBlur}
                        ref={field.ref}
                        status={fieldStatus(fieldState)}
                      />
                    )}
                  />
                  <div className="min-w-0">
                    {keepsStored ? (
                      <HStack gap={2} vAlign="center" wrap="wrap">
                        <Icon icon={KeyRoundIcon} color="success" />
                        <Text type="supporting">{t('valueStored')}</Text>
                        <Button
                          label={t('replaceValue')}
                          variant="ghost"
                          size="sm"
                          type="button"
                          onClick={() => update(i, { ...row, value: '', stored: false } as never)}
                        />
                      </HStack>
                    ) : (
                      <FormField
                        control={form.control}
                        name={`${name}.${i}.value` as Path<T>}
                        render={({ field, fieldState }) => (
                          <TextInput
                            type="password"
                            autoComplete="new-password"
                            label={t('headerValue')}
                            isLabelHidden
                            value={field.value ?? ''}
                            onChange={field.onChange}
                            onBlur={field.onBlur}
                            ref={field.ref}
                            status={fieldStatus(fieldState)}
                          />
                        )}
                      />
                    )}
                  </div>
                  <IconButton
                    label={t('removeHeader', { name: row?.name || t('newHeader') })}
                    icon={<Icon icon={Trash2Icon} />}
                    variant="ghost"
                    type="button"
                    onClick={() => remove(i)}
                  />
                </div>
              </motion.li>
            );
          })}
        </AnimatePresence>
      </ul>
      <div>
        <Button
          label={t('addHeader')}
          variant="secondary"
          size="sm"
          icon={<Icon icon={PlusIcon} />}
          type="button"
          isDisabled={fields.length >= MAX_AI_HEADERS}
          onClick={() => append({ name: '', value: '', stored: false } as never)}
        />
      </div>
    </VStack>
  );
}

function InsecureTlsField<T extends FieldValues>({ section }: { section: string }) {
  const t = useTranslations('ai.models.connection');
  const form = useFormContext<T>();
  const name = `${section}.insecureTls` as Path<T>;
  const on = useWatch({ control: form.control, name }) === true;
  return (
    <VStack gap={2}>
      <FormField
        control={form.control}
        name={name}
        render={({ field }) => (
          <CheckboxInput
            label={t('insecureTls')}
            description={t('insecureTlsHint')}
            value={field.value === true}
            onChange={(checked) => field.onChange(checked)}
            onBlur={field.onBlur}
            ref={field.ref}
          />
        )}
      />
      {on && (
        <Banner
          status="warning"
          icon={<Icon icon={ShieldAlertIcon} />}
          title={t('insecureTlsWarning')}
          collapsible={false}
        />
      )}
    </VStack>
  );
}
