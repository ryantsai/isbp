'use client';

import { Collapsible } from '@astryxdesign/core/Collapsible';
import { Icon } from '@astryxdesign/core/Icon';
import { VStack } from '@astryxdesign/core/Layout';
import { Text } from '@astryxdesign/core/Text';
import { TextArea } from '@astryxdesign/core/TextArea';
import { TextInput } from '@astryxdesign/core/TextInput';
import type { ConnectorConfigSlotProps } from '@isbp/contracts';
import { InfoIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import {
  ASSET_API_NAME_RE,
  DEFAULT_ASSET_ENDPOINTS,
  SDP_MINIMUM_BUILD,
  SDP_TARGET_BUILD,
  WEBHOOK_TEMPLATE,
} from '../../contracts';

/** A field's status: the error, if any (it replaces the hint). */
const failed = (message: string | null) => (message ? { type: 'error' as const, message } : undefined);

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

  return (
    <div className="grid min-w-0 gap-4">
      <VStack gap={4} className="min-w-0">
        <Text type="label">{t('server')}</Text>
        <TextInput
          label={t('baseUrl')}
          isRequired
          value={text(config.baseUrl)}
          isDisabled={disabled}
          autoComplete="off"
          placeholder="https://sdp.contoso.local:8443"
          description={error('config.baseUrl') ? undefined : t('baseUrlHint')}
          status={failed(error('config.baseUrl'))}
          onChange={(value) => setConfig('baseUrl', value)}
        />
        <TextInput
          label={t('portalId')}
          isOptional
          value={text(config.portalId)}
          isDisabled={disabled}
          autoComplete="off"
          description={error('config.portalId') ? undefined : t('portalIdHint')}
          status={failed(error('config.portalId'))}
          onChange={(value) => setConfig('portalId', value.replace(/[^0-9]/g, ''))}
        />
      </VStack>

      <VStack gap={4} className="min-w-0">
        <Text type="label">{t('authentication')}</Text>
        <TextInput
          label={t('apiKey')}
          isRequired={!storedSecrets.includes('apiKey')}
          type="password"
          autoComplete="new-password"
          value={secrets.apiKey ?? ''}
          isDisabled={disabled}
          description={
            error('secrets.apiKey')
              ? undefined
              : storedSecrets.includes('apiKey')
                ? t('stored')
                : t('apiKeyHint')
          }
          status={failed(error('secrets.apiKey'))}
          onChange={(value) => setSecret('apiKey', value)}
        />
      </VStack>

      <Collapsible
        trigger={<Text weight="medium">{t('advanced')}</Text>}
        isOpen={advancedOpen}
        onOpenChange={setAdvanced}
      >
        <VStack gap={4} className="min-w-0 pt-3">
          <TextArea
            label={t('assetEndpoints')}
            isOptional
            rows={4}
            value={endpoints}
            isDisabled={disabled}
            hasSpellCheck={false}
            placeholder="Laptop = custom_asset_laptop"
            description={endpointsError ? undefined : t('assetEndpointsHint', { defaults: DEFAULTS })}
            status={failed(endpointsError)}
            onChange={changeEndpoints}
          />
        </VStack>
      </Collapsible>

      <section
        aria-labelledby={`${id}-help`}
        className="grid min-w-0 gap-3 rounded-md border bg-muted/40 p-4 text-sm"
      >
        <h3 id={`${id}-help`} className="flex items-center gap-2 font-semibold">
          <Icon icon={InfoIcon} size="sm" color="accent" />
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
