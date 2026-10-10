'use client';

import type { ConnectorConfigSlotProps } from '@isbp/contracts';
import { Input } from '@isbp/ui/input';
import { Label } from '@isbp/ui/label';
import { Textarea } from '@isbp/ui/textarea';
import { ChevronDownIcon, InfoIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type ReactNode, useId, useState } from 'react';
import {
  ASSET_API_NAME_RE,
  DEFAULT_ASSET_ENDPOINTS,
  SDP_MINIMUM_BUILD,
  SDP_TARGET_BUILD,
  WEBHOOK_TEMPLATE,
} from '../../contracts';

/** A labelled control with its hint or error, wired up with `aria-describedby`. */
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
  error?: string | null;
  children: (props: { id: string; 'aria-invalid'?: true; 'aria-describedby'?: string }) => ReactNode;
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

const text = (v: unknown) => (typeof v === 'string' ? v : '');

/** `Product type = api_name` per line ↔ the `assetEndpoints` map; the first line that doesn't parse, if any. */
function parseEndpoints(source: string): { map: Record<string, string>; badLine: number | null } {
  const map: Record<string, string> = {};
  let badLine: number | null = null;
  source.split('\n').forEach((line, i) => {
    if (!line.trim()) return;
    const at = line.lastIndexOf('=');
    const type = at > 0 ? line.slice(0, at).trim() : '';
    const api = at > 0 ? line.slice(at + 1).trim() : '';
    if (!type || (api && !ASSET_API_NAME_RE.test(api))) badLine ??= i + 1;
    else map[type] = api;
  });
  return { map, badLine };
}

const formatEndpoints = (map: unknown) =>
  map && typeof map === 'object'
    ? Object.entries(map as Record<string, unknown>)
        .map(([type, api]) => `${type} = ${text(api)}`)
        .join('\n')
    : '';

const DEFAULTS = Object.entries(DEFAULT_ASSET_ENDPOINTS)
  .map(([type, api]) => `${type} = ${api}`)
  .join(', ');

/**
 * `integrations.connector-config.sdp.server`: settings of a ServiceDesk Plus (on-premises) connection — server
 * address, optional portal id, the technician API key (a secret: never shown, kept when left empty) — and how
 * to set up the API key and the webhook on the ServiceDesk Plus side. The hub renders the connection's own
 * switches ("Allow insecure HTTP") around it.
 */
export default function SdpConnectorConfig({
  type,
  config,
  onConfigChange,
  secrets,
  onSecretsChange,
  storedSecrets,
  errors,
  disabled,
}: ConnectorConfigSlotProps) {
  const t = useTranslations('sdp.config');
  const id = useId();
  const [endpoints, setEndpoints] = useState(() => formatEndpoints(config.assetEndpoints));
  const [advanced, setAdvanced] = useState(() => Boolean(endpoints));
  if (type !== 'sdp.server') return null;

  const setConfig = (key: string, value: string) => {
    const next = { ...config, [key]: value };
    // The optional portal id is left out rather than saved empty.
    if (key === 'portalId' && !value.trim()) delete next[key];
    onConfigChange(next);
  };
  const setSecret = (key: string, value: string) => {
    const next = { ...secrets, [key]: value };
    if (!value) delete next[key];
    onSecretsChange(next);
  };
  const error = (path: string) => errors?.[path] ?? null;
  const parsed = parseEndpoints(endpoints);
  const endpointsError =
    parsed.badLine !== null
      ? t('assetEndpointsInvalid', { line: parsed.badLine })
      : (Object.entries(errors ?? {}).find(([k]) => k.startsWith('config.assetEndpoints'))?.[1] ?? null);
  const advancedOpen = advanced || Boolean(endpointsError);
  const changeEndpoints = (value: string) => {
    setEndpoints(value);
    const { map } = parseEndpoints(value);
    const { assetEndpoints: _previous, ...rest } = config;
    onConfigChange(Object.keys(map).length ? { ...rest, assetEndpoints: map } : rest);
  };
  const optional = <span className="font-normal text-muted-foreground">{t('optional')}</span>;

  return (
    <div className="grid min-w-0 gap-4">
      <fieldset className="grid min-w-0 gap-4">
        <legend className="mb-2 text-sm font-semibold">{t('server')}</legend>
        <Field id={`${id}-url`} label={t('baseUrl')} hint={t('baseUrlHint')} error={error('config.baseUrl')}>
          {(p) => (
            <Input
              {...p}
              type="url"
              inputMode="url"
              value={text(config.baseUrl)}
              disabled={disabled}
              autoComplete="off"
              spellCheck={false}
              placeholder="https://sdp.contoso.local:8443"
              onChange={(e) => setConfig('baseUrl', e.target.value)}
            />
          )}
        </Field>
        <Field
          id={`${id}-portal`}
          label={
            <>
              {t('portalId')} {optional}
            </>
          }
          hint={t('portalIdHint')}
          error={error('config.portalId')}
        >
          {(p) => (
            <Input
              {...p}
              inputMode="numeric"
              value={text(config.portalId)}
              disabled={disabled}
              autoComplete="off"
              spellCheck={false}
              className="sm:max-w-40"
              onChange={(e) => setConfig('portalId', e.target.value.replace(/[^0-9]/g, ''))}
            />
          )}
        </Field>
      </fieldset>

      <fieldset className="grid min-w-0 gap-4">
        <legend className="mb-2 text-sm font-semibold">{t('authentication')}</legend>
        <Field
          id={`${id}-key`}
          label={t('apiKey')}
          hint={storedSecrets.includes('apiKey') ? t('stored') : t('apiKeyHint')}
          error={error('secrets.apiKey')}
        >
          {(p) => (
            <Input
              {...p}
              type="password"
              autoComplete="new-password"
              spellCheck={false}
              value={secrets.apiKey ?? ''}
              disabled={disabled}
              onChange={(e) => setSecret('apiKey', e.target.value)}
            />
          )}
        </Field>
      </fieldset>

      <div className="min-w-0">
        <button
          type="button"
          onClick={() => setAdvanced((a) => !a)}
          aria-expanded={advancedOpen}
          aria-controls={`${id}-advanced`}
          className="flex items-center gap-1.5 rounded-sm text-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <ChevronDownIcon
            className={`size-4 transition-transform duration-200 motion-reduce:transition-none ${advancedOpen ? 'rotate-180' : ''}`}
            aria-hidden
          />
          {t('advanced')}
        </button>
        <div id={`${id}-advanced`} hidden={!advancedOpen} className="grid min-w-0 grid-cols-1 gap-4 pt-4">
          <Field
            id={`${id}-endpoints`}
            label={
              <>
                {t('assetEndpoints')} {optional}
              </>
            }
            hint={t('assetEndpointsHint', { defaults: DEFAULTS })}
            error={endpointsError}
          >
            {(p) => (
              <Textarea
                {...p}
                rows={4}
                value={endpoints}
                disabled={disabled}
                spellCheck={false}
                className="font-mono text-xs"
                placeholder="Laptop = custom_asset_laptop"
                onChange={(e) => changeEndpoints(e.target.value)}
              />
            )}
          </Field>
        </div>
      </div>

      <section
        aria-labelledby={`${id}-help`}
        className="grid min-w-0 gap-3 rounded-md border bg-muted/40 p-4 text-sm"
      >
        <h3 id={`${id}-help`} className="flex items-center gap-2 font-semibold">
          <InfoIcon className="size-4 shrink-0 text-info" aria-hidden />
          {t('help.title')}
        </h3>
        <p className="text-muted-foreground">
          {t('help.builds', { target: String(SDP_TARGET_BUILD), minimum: String(SDP_MINIMUM_BUILD) })}
        </p>
        <ol className="grid min-w-0 list-decimal gap-2 pl-5 text-muted-foreground">
          <li>{t('help.https')}</li>
          <li>{t('help.technician')}</li>
          <li>{t('help.apiKey')}</li>
          <li>{t('help.certificates')}</li>
          <li>{t('help.throttling')}</li>
        </ol>
        <h4 className="font-semibold">{t('help.webhookTitle')}</h4>
        <ol className="grid min-w-0 list-decimal gap-2 pl-5 text-muted-foreground">
          <li>{t('help.webhook')}</li>
          <li className="min-w-0">
            {t('help.webhookBody')}
            <code className="mt-1 block overflow-x-auto rounded bg-muted px-2 py-1 font-mono text-xs text-foreground">
              {WEBHOOK_TEMPLATE}
            </code>
          </li>
          <li>{t('help.trigger')}</li>
        </ol>
        <p className="text-muted-foreground">{t('help.webhookNote')}</p>
      </section>
    </div>
  );
}
