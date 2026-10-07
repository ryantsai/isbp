'use client';

import type { ConnectorConfigSlotProps } from '@isbp/contracts';
import { Input } from '@isbp/ui/input';
import { Label } from '@isbp/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@isbp/ui/select';
import { Switch } from '@isbp/ui/switch';
import { useTranslations } from 'next-intl';
import { type ReactNode, useId } from 'react';

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

function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  error?: string;
  children: (p: { id: string; 'aria-invalid'?: true; 'aria-describedby'?: string }) => ReactNode;
}) {
  const note = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div className="grid min-w-0 gap-2">
      <Label htmlFor={id}>{label}</Label>
      {children({
        id,
        ...(error ? { 'aria-invalid': true as const } : {}),
        ...(note ? { 'aria-describedby': note } : {}),
      })}
      {error ? (
        <p id={`${id}-error`} className="text-xs text-destructive">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
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
  const tc = useTranslations('common');
  const id = useId();
  const cfg = (configSchema ?? {}) as JsonObject;
  const sec = (secretsSchema ?? {}) as JsonObject;
  const required = new Set(cfg.required ?? []);
  const requiredSecrets = new Set(sec.required ?? []);
  const optional = <span className="font-normal text-muted-foreground">({tc('optional')})</span>;

  const configFields = Object.entries(cfg.properties ?? {}).map(([key, raw]) => {
    const p = shapeOf(raw);
    const fid = `${id}-c-${key}`;
    const label = (
      <>
        {p.title ?? humanize(key)} {!required.has(key) && p.default === undefined && optional}
      </>
    );
    const error = errors?.[`config.${key}`];
    const value = config[key];
    const type = typeOf(p);
    if (p.enum?.length)
      return (
        <Field key={key} id={fid} label={label} hint={p.description} error={error}>
          {(a) => (
            <Select
              value={value === undefined || value === null ? '' : String(value)}
              onValueChange={(v) => onConfigChange({ ...config, [key]: v })}
              disabled={disabled}
            >
              <SelectTrigger
                id={a.id}
                aria-invalid={a['aria-invalid']}
                aria-describedby={a['aria-describedby']}
                className="w-full"
              >
                <SelectValue placeholder={p.default !== undefined ? String(p.default) : t('choose')} />
              </SelectTrigger>
              <SelectContent>
                {p.enum!.map((o) => (
                  <SelectItem key={String(o)} value={String(o)}>
                    {String(o)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </Field>
      );
    if (type === 'boolean')
      return (
        <div key={key} className="flex items-start gap-3">
          <Switch
            id={fid}
            checked={value === undefined ? Boolean(p.default) : Boolean(value)}
            onCheckedChange={(v) => onConfigChange({ ...config, [key]: v })}
            disabled={disabled}
            aria-describedby={p.description ? `${fid}-hint` : undefined}
          />
          <div className="grid gap-0.5">
            <Label htmlFor={fid}>{p.title ?? humanize(key)}</Label>
            {p.description && (
              <p id={`${fid}-hint`} className="text-xs text-muted-foreground">
                {p.description}
              </p>
            )}
          </div>
        </div>
      );
    const numeric = type === 'number' || type === 'integer';
    return (
      <Field key={key} id={fid} label={label} hint={p.description} error={error}>
        {(a) => (
          <Input
            {...a}
            type={p.format === 'uri' ? 'url' : 'text'}
            inputMode={numeric ? 'numeric' : undefined}
            spellCheck={false}
            autoComplete="off"
            className={p.format === 'uri' ? 'font-mono text-sm' : undefined}
            value={value === undefined || value === null ? '' : String(value)}
            placeholder={p.default !== undefined ? String(p.default) : undefined}
            disabled={disabled}
            onChange={(e) => {
              const v = e.target.value;
              const next = { ...config };
              if (v === '') delete next[key];
              else next[key] = numeric && v.trim() !== '' && !Number.isNaN(Number(v)) ? Number(v) : v;
              onConfigChange(next);
            }}
          />
        )}
      </Field>
    );
  });

  const secretFields = Object.entries(sec.properties ?? {}).map(([key, raw]) => {
    const p = shapeOf(raw);
    const fid = `${id}-s-${key}`;
    const stored = storedSecrets.includes(key) && !removed.includes(key);
    const canRemove = storedSecrets.includes(key) && !requiredSecrets.has(key);
    return (
      <Field
        key={key}
        id={fid}
        label={
          <>
            {p.title ?? humanize(key)} {!requiredSecrets.has(key) && optional}
          </>
        }
        hint={removed.includes(key) ? t('secretRemoved') : stored ? t('secretStored') : p.description}
        error={errors?.[`secrets.${key}`]}
      >
        {(a) => (
          <div className="flex min-w-0 gap-2">
            <Input
              {...a}
              type="password"
              autoComplete="new-password"
              spellCheck={false}
              className="min-w-0"
              value={secrets[key] ?? ''}
              placeholder={stored ? '••••••••' : undefined}
              disabled={disabled}
              onChange={(e) => {
                onSecretsChange({ ...secrets, [key]: e.target.value });
                if (removed.includes(key)) onRemovedChange(removed.filter((k) => k !== key));
              }}
            />
            {canRemove && (
              <button
                type="button"
                className="shrink-0 rounded-md px-2 text-sm text-destructive underline-offset-4 hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
                onClick={() =>
                  onRemovedChange(
                    removed.includes(key) ? removed.filter((k) => k !== key) : [...removed, key],
                  )
                }
                aria-pressed={removed.includes(key)}
              >
                {removed.includes(key) ? t('keepSecret') : t('removeSecret')}
              </button>
            )}
          </div>
        )}
      </Field>
    );
  });

  return (
    <div className="grid min-w-0 gap-4">
      {configFields}
      {secretFields.length > 0 && (
        <fieldset className="grid min-w-0 gap-4">
          <legend className="mb-1 text-sm font-semibold">{t('secrets')}</legend>
          {secretFields}
        </fieldset>
      )}
    </div>
  );
}
