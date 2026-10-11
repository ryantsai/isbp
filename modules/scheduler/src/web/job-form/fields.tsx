'use client';

import { Button } from '@astryxdesign/core/Button';
import { CheckboxInput } from '@astryxdesign/core/CheckboxInput';
import { Icon } from '@astryxdesign/core/Icon';
import { IconButton } from '@astryxdesign/core/IconButton';
import { HStack, StackItem, VStack } from '@astryxdesign/core/Layout';
import { Heading, Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import { Card, CardContent, CardDescription, CardHeader } from '@isbp/ui/card';
import { PlusIcon, Trash2Icon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type ReactNode, useId } from 'react';
import { isPlaceholder, type SecretValue } from '../../contracts';

/** Field errors keyed by path (`name`, `trigger.cron`, `config.url`). */
export type Errors = Record<string, string>;

export interface EditorProps {
  value: Record<string, unknown>;
  onChange: (value: Record<string, unknown>) => void;
  /** Errors of the config, keyed by config path (`url`, `headers.0.value`). */
  errors: Errors;
  disabled?: boolean;
}

/** The `status` prop of an Astryx input for the error stored under a path (none when there is none). */
export function errorStatus(message: string | undefined): { type: 'error'; message: string } | undefined {
  return message ? { type: 'error', message } : undefined;
}

/** A form section: a card with a heading the section is labelled by. */
export function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <Card role="region" aria-labelledby={id} className="min-w-0">
      <CardHeader>
        <Heading level={2} id={id}>
          {title}
        </Heading>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent>
        <VStack gap={4}>{children}</VStack>
      </CardContent>
    </Card>
  );
}

/**
 * A secret value: a stored one shows as "stored (hidden)" with Replace; a new one is a password field. The
 * stored value is never sent to the browser.
 */
export function SecretInput({
  label,
  isLabelHidden,
  value,
  onChange,
  status,
  isDisabled,
}: {
  label: string;
  isLabelHidden?: boolean;
  value: unknown;
  onChange: (v: SecretValue) => void;
  status?: { type: 'error'; message: string };
  isDisabled?: boolean;
}) {
  const t = useTranslations('scheduler.secret');
  if (isPlaceholder(value) && value.set)
    return (
      <HStack gap={2} vAlign="end">
        <StackItem size="fill">
          <TextInput label={label} isLabelHidden={isLabelHidden} isReadOnly value={t('stored')} />
        </StackItem>
        <Button
          label={t('replace')}
          variant="secondary"
          isDisabled={isDisabled}
          onClick={() => onChange('')}
        />
      </HStack>
    );
  return (
    <TextInput
      type="password"
      autoComplete="new-password"
      label={label}
      isLabelHidden={isLabelHidden}
      value={typeof value === 'string' ? value : ''}
      onChange={(v) => onChange(v)}
      status={status}
      isDisabled={isDisabled}
    />
  );
}

export interface Pair {
  name: string;
  value: unknown;
  secret: boolean;
}

/** Name / value / secret rows (HTTP headers, script environment variables). */
export function PairsEditor({
  items,
  onChange,
  errors,
  prefix,
  labels,
  disabled,
}: {
  items: Pair[];
  onChange: (items: Pair[]) => void;
  errors: Errors;
  /** Config field (`headers`, `env`) for error paths. */
  prefix: string;
  labels: { name: string; value: string; add: string; empty: string; remove: string };
  disabled?: boolean;
}) {
  const t = useTranslations('scheduler.secret');
  const update = (i: number, patch: Partial<Pair>) =>
    onChange(items.map((p, k) => (k === i ? { ...p, ...patch } : p)));
  return (
    <VStack gap={2}>
      {items.length === 0 && <Text color="secondary">{labels.empty}</Text>}
      {items.map((p, i) => {
        const nameError = errorStatus(errors[`${prefix}.${i}.name`]);
        const valueError = errorStatus(errors[`${prefix}.${i}.value`]);
        return (
          <div
            key={i}
            className="grid min-w-0 grid-cols-1 items-center gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto_auto]"
          >
            <TextInput
              label={`${labels.name} ${i + 1}`}
              isLabelHidden
              value={p.name}
              onChange={(v) => update(i, { name: v })}
              status={nameError}
              statusVariant="detached"
              isDisabled={disabled}
            />
            {p.secret ? (
              <SecretInput
                label={`${labels.value} ${i + 1}`}
                isLabelHidden
                value={p.value}
                onChange={(v) => update(i, { value: v })}
                status={valueError}
                isDisabled={disabled}
              />
            ) : (
              <TextInput
                label={`${labels.value} ${i + 1}`}
                isLabelHidden
                value={typeof p.value === 'string' ? p.value : ''}
                onChange={(v) => update(i, { value: v })}
                status={valueError}
                statusVariant="detached"
                isDisabled={disabled}
              />
            )}
            <CheckboxInput
              label={t('secret')}
              value={p.secret}
              isDisabled={disabled}
              onChange={(checked) =>
                update(i, { secret: checked, value: isPlaceholder(p.value) ? '' : p.value })
              }
            />
            <IconButton
              label={`${labels.remove} ${i + 1}`}
              variant="ghost"
              icon={<Icon icon={Trash2Icon} />}
              isDisabled={disabled}
              onClick={() => onChange(items.filter((_, k) => k !== i))}
            />
          </div>
        );
      })}
      <HStack>
        <Button
          label={labels.add}
          variant="secondary"
          size="sm"
          icon={<Icon icon={PlusIcon} />}
          isDisabled={disabled}
          onClick={() => onChange([...items, { name: '', value: '', secret: false }])}
        />
      </HStack>
    </VStack>
  );
}

/** Errors under `prefix.` with the prefix removed (`config.url` → `url`). */
export function scoped(errors: Errors, prefix: string): Errors {
  const out: Errors = {};
  for (const [k, v] of Object.entries(errors)) {
    if (k === prefix) out[''] = v;
    else if (k.startsWith(`${prefix}.`)) out[k.slice(prefix.length + 1)] = v;
  }
  return out;
}
