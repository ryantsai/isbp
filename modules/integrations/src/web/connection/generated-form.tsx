'use client';

import { Button } from '@astryxdesign/core/Button';
import { FormLayout } from '@astryxdesign/core/FormLayout';
import { HStack, StackItem, VStack } from '@astryxdesign/core/Layout';
import { NumberInput } from '@astryxdesign/core/NumberInput';
import { Selector } from '@astryxdesign/core/Selector';
import { Switch } from '@astryxdesign/core/Switch';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import type { ConnectorConfigSlotProps } from '@isbp/contracts';
import { useTranslations } from 'next-intl';
import { useId } from 'react';

interface JsonProp {
  type?: string | string[];
  enum?: unknown[];
  format?: string;
  title?: string;
  description?: string;
  default?: unknown;
  anyOf?: JsonProp[];
}

interface JsonObject {
  properties?: Record<string, JsonProp>;
  required?: string[];
}

const humanize = (key: string) =>
  key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/^./, (c) => c.toUpperCase());

/** The first concrete type of a property (optional fields come as `anyOf: [x, null]`). */
function shapeOf(p: JsonProp): JsonProp {
  if (p.anyOf?.length)
    return {
      ...(p.anyOf.find((x) => x.type !== 'null') ?? {}),
      title: p.title,
      description: p.description,
      default: p.default,
    };
  return p;
}

function typeOf(p: JsonProp): string {
  const t = Array.isArray(p.type) ? p.type.find((x) => x !== 'null') : p.type;
  return t ?? 'string';
}

/**
 * The settings form for connectors that contribute none: generated from their JSON Schemas (strings,
 * numbers, enums and booleans; every secret as a password field that keeps the stored value when empty).
 */
export function GeneratedConnectorForm({
  configSchema,
  secretsSchema,
  config,
  onConfigChange,
  secrets,
  onSecretsChange,
  storedSecrets,
  errors,
  disabled,
  removed,
  onRemovedChange,
}: Omit<ConnectorConfigSlotProps, 'type' | 'editing'> & {
  configSchema: unknown;
  secretsSchema: unknown;
  removed: string[];
  onRemovedChange: (keys: string[]) => void;
}) {
  const t = useTranslations('integrations.connectionForm');
  const id = useId();
  const cfg = (configSchema ?? {}) as JsonObject;
  const sec = (secretsSchema ?? {}) as JsonObject;
  const required = new Set(cfg.required ?? []);
  const requiredSecrets = new Set(sec.required ?? []);

  const configFields = Object.entries(cfg.properties ?? {}).map(([key, raw]) => {
    const p = shapeOf(raw);
    const title = p.title ?? humanize(key);
    const optional = !required.has(key) && p.default === undefined;
    const message = errors?.[`config.${key}`];
    const status = message ? { type: 'error' as const, message } : undefined;
    const value = config[key];
    const type = typeOf(p);
    if (p.enum?.length)
      return (
        <Selector
          key={key}
          label={title}
          isOptional={optional}
          description={p.description}
          isDisabled={disabled}
          placeholder={p.default !== undefined ? String(p.default) : t('choose')}
          options={p.enum.map((o) => String(o))}
          value={value === undefined || value === null ? undefined : String(value)}
          onChange={(v) => onConfigChange({ ...config, [key]: v })}
          status={status}
        />
      );
    if (type === 'boolean')
      return (
        <Switch
          key={key}
          label={title}
          description={p.description}
          isDisabled={disabled}
          value={value === undefined ? Boolean(p.default) : Boolean(value)}
          onChange={(v) => onConfigChange({ ...config, [key]: v })}
        />
      );
    if (type === 'number' || type === 'integer')
      return (
        <NumberInput
          key={key}
          label={title}
          isOptional={optional}
          description={p.description}
          isDisabled={disabled}
          isIntegerOnly={type === 'integer'}
          hasClear
          placeholder={p.default !== undefined ? String(p.default) : undefined}
          value={typeof value === 'number' ? value : null}
          onChange={(v) => {
            const next = { ...config };
            if (v === null) delete next[key];
            else next[key] = v;
            onConfigChange(next);
          }}
          status={status}
        />
      );
    return (
      <TextInput
        key={key}
        label={title}
        isOptional={optional}
        description={p.description}
        isDisabled={disabled}
        autoComplete="off"
        placeholder={p.default !== undefined ? String(p.default) : undefined}
        value={value === undefined || value === null ? '' : String(value)}
        onChange={(v) => {
          const next = { ...config };
          if (v === '') delete next[key];
          else next[key] = v;
          onConfigChange(next);
        }}
        status={status}
      />
    );
  });

  const secretFields = Object.entries(sec.properties ?? {}).map(([key, raw]) => {
    const p = shapeOf(raw);
    const stored = storedSecrets.includes(key) && !removed.includes(key);
    const canRemove = storedSecrets.includes(key) && !requiredSecrets.has(key);
    const message = errors?.[`secrets.${key}`];
    return (
      <HStack key={key} gap={2} vAlign="end" className="min-w-0">
        <StackItem size="fill">
          <TextInput
            type="password"
            label={p.title ?? humanize(key)}
            isOptional={!requiredSecrets.has(key)}
            description={
              removed.includes(key) ? t('secretRemoved') : stored ? t('secretStored') : p.description
            }
            autoComplete="new-password"
            isDisabled={disabled}
            value={secrets[key] ?? ''}
            placeholder={stored ? '••••••••' : undefined}
            status={message ? { type: 'error', message } : undefined}
            onChange={(v) => {
              onSecretsChange({ ...secrets, [key]: v });
              if (removed.includes(key)) onRemovedChange(removed.filter((k) => k !== key));
            }}
          />
        </StackItem>
        {canRemove && (
          <Button
            label={removed.includes(key) ? t('keepSecret') : t('removeSecret')}
            variant="ghost"
            size="sm"
            type="button"
            aria-pressed={removed.includes(key)}
            onClick={() =>
              onRemovedChange(removed.includes(key) ? removed.filter((k) => k !== key) : [...removed, key])
            }
          />
        )}
      </HStack>
    );
  });

  return (
    <FormLayout defaultOptionality="required">
      {configFields}
      {secretFields.length > 0 && (
        <VStack gap={4} role="group" aria-labelledby={`${id}-secrets`} className="min-w-0">
          <Text type="label" id={`${id}-secrets`}>
            {t('secrets')}
          </Text>
          {secretFields}
        </VStack>
      )}
    </FormLayout>
  );
}
