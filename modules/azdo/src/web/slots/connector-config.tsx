'use client';

import { Collapsible } from '@astryxdesign/core/Collapsible';
import { VStack } from '@astryxdesign/core/Layout';
import { Selector } from '@astryxdesign/core/Selector';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import type { ConnectorConfigSlotProps } from '@isbp/contracts';
import { useTranslations } from 'next-intl';
import { API_VERSIONS, type ApiVersion, collectionUrlIssue, DEFAULT_API_VERSION } from '../../contracts';

/** Header the hub reads the webhook secret from (a technical name, not translated). */
const SECRET_HEADER = 'X-ISBP-Webhook-Secret';
const URL_EXAMPLE = 'https://ado.contoso.local/tfs/DefaultCollection';
const SERVICE_HOOK_EVENTS = [
  'workitem.created',
  'workitem.updated',
  'workitem.deleted',
  'workitem.restored',
  'workitem.commented',
  'git.push',
  'git.pullrequest.created',
  'git.pullrequest.updated',
  'git.pullrequest.merged',
] as const;

const hookKey = (event: (typeof SERVICE_HOOK_EVENTS)[number]) => event.replace(/\./g, '_');

/**
 * Settings of an on-premises Azure DevOps Server connection in the Integrations Hub
 * (`integrations.connector-config.azdo.server`): collection URL, REST API version and the personal access
 * token, with the server requirements and how to create the token and the service hooks.
 */
export default function AzdoServerConfig({
  config,
  onConfigChange,
  secrets,
  onSecretsChange,
  storedSecrets,
  errors,
  disabled,
}: ConnectorConfigSlotProps) {
  const t = useTranslations('azdo.config');
  const url = typeof config.collectionUrl === 'string' ? config.collectionUrl : '';
  const version = API_VERSIONS.includes(config.apiVersion as ApiVersion)
    ? (config.apiVersion as ApiVersion)
    : DEFAULT_API_VERSION;
  const patStored = storedSecrets.includes('pat');

  // The server's messages are English; say it in the viewer's language from the same check.
  const urlIssue = url.trim() ? (collectionUrlIssue(url.trim()) ?? 'invalid') : 'required';
  const urlError = errors?.['config.collectionUrl'] ? t(`errors.${urlIssue}`) : null;
  const versionError = errors?.['config.apiVersion'] ? t('errors.version') : null;
  const patError = errors?.['secrets.pat'] ? t('errors.pat') : null;

  /** A field's status: the error, if any (it replaces the hint). */
  const failed = (message: string | null) => (message ? { type: 'error' as const, message } : undefined);

  return (
    <div className="grid min-w-0 gap-4">
      <VStack gap={4} className="min-w-0">
        <Text type="label">{t('server')}</Text>
        <TextInput
          label={t('collectionUrl')}
          isRequired
          autoComplete="off"
          placeholder={URL_EXAMPLE}
          value={url}
          isDisabled={disabled}
          description={urlError ? undefined : t('collectionUrlHint')}
          status={failed(urlError)}
          onChange={(value) => onConfigChange({ ...config, collectionUrl: value.slice(0, 500) })}
        />
        <Selector
          label={t('apiVersion')}
          value={version}
          isDisabled={disabled}
          description={versionError ? undefined : t('apiVersionHint')}
          status={failed(versionError)}
          onChange={(v) => onConfigChange({ ...config, apiVersion: v })}
          options={API_VERSIONS.map((v) => ({ value: v, label: t(`versions.${v.replace('.', '_')}`) }))}
        />
      </VStack>

      <VStack gap={4} className="min-w-0">
        <Text type="label">{t('signIn')}</Text>
        <TextInput
          label={t('pat')}
          isRequired={!patStored}
          type="password"
          autoComplete="new-password"
          value={secrets.pat ?? ''}
          isDisabled={disabled}
          placeholder={patStored ? t('patStoredPlaceholder') : undefined}
          description={patError ? undefined : patStored ? t('patStored') : t('patHint')}
          status={failed(patError)}
          onChange={(value) => {
            const next = { ...secrets };
            if (value) next.pat = value;
            else delete next.pat;
            onSecretsChange(next);
          }}
        />
      </VStack>

      <Collapsible trigger={<Text weight="medium">{t('help.reqTitle')}</Text>} defaultIsOpen={false}>
        <ul className="mt-3 list-disc space-y-1.5 ps-5 text-muted-foreground">
          <li>{t('help.reqVersion')}</li>
          <li>{t('help.reqPat')}</li>
          <li>{t('help.reqHttps')}</li>
          <li>{t('help.reqTls')}</li>
          <li>{t('help.reqNetwork')}</li>
        </ul>
      </Collapsible>

      <Collapsible trigger={<Text weight="medium">{t('help.patTitle')}</Text>} defaultIsOpen={false}>
        <ol className="mt-3 list-decimal space-y-1.5 ps-5 text-muted-foreground">
          <li>{t('help.patStep1')}</li>
          <li>{t('help.patStep2')}</li>
          <li>
            {t('help.patStep3')}
            <ul className="mt-1 list-disc space-y-0.5 ps-5">
              <li>{t('help.scopeWorkItems')}</li>
              <li>{t('help.scopeCode')}</li>
              <li>{t('help.scopeProject')}</li>
            </ul>
          </li>
          <li>{t('help.patStep4')}</li>
        </ol>
      </Collapsible>

      <Collapsible trigger={<Text weight="medium">{t('help.hooksTitle')}</Text>} defaultIsOpen={false}>
        <div className="mt-3 space-y-2 text-muted-foreground">
          <p>{t('help.hooksIntro')}</p>
          <ol className="list-decimal space-y-1.5 ps-5">
            <li>{t('help.hooksStep1')}</li>
            <li>
              {t('help.hooksStep2')}
              <ul className="mt-1 list-disc space-y-0.5 ps-5">
                {SERVICE_HOOK_EVENTS.map((e) => (
                  <li key={e}>
                    {t(`help.events.${hookKey(e)}`)} <code className="font-mono text-xs">{e}</code>
                  </li>
                ))}
              </ul>
            </li>
            <li>{t('help.hooksStep3')}</li>
            <li>
              {t('help.hooksStep4')}{' '}
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs break-all text-foreground">
                {`${SECRET_HEADER}: ${t('help.secretPlaceholder')}`}
              </code>
            </li>
            <li>{t('help.hooksStep5')}</li>
          </ol>
          <p>{t('help.hooksNote')}</p>
          <p>{t('help.hooksNetwork')}</p>
        </div>
      </Collapsible>
    </div>
  );
}
